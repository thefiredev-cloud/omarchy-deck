//! Smaller first paint over the tailnet: gzip for text responses and revalidation for the public shell files.
//!
//! Public shell files (app.js, deck.js, icons, ...) are compiled into the binary, so each one is compressed and hashed
//! once, then served with an `ETag` and `Cache-Control: no-cache`: the service worker's background refresh gets a 304
//! instead of the whole file again. Everything else keeps `no-store` and is only gzipped on the way out (JSON, the
//! page itself, theme.css) when the client accepts gzip. Video, images and WebSocket upgrades pass untouched.
//!
//! JSON reads under `/api/` also revalidate (round "Better" item 8): each 200 carries a weak `ETag` of its bytes and a
//! request that names it in `If-None-Match` gets a 304 with no body, so an idle page that asks again every minute moves
//! a few hundred bytes instead of the whole feed. The client sends the header itself (the reads stay `no-store`).
use axum::body::{Body, Bytes, HttpBody};
use axum::extract::Request;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, LazyLock, Mutex};

/// Below this a gzip header costs more than it saves.
const MIN_BYTES: u64 = 1024;
/// Responses larger than this are passed through rather than buffered.
const MAX_BYTES: u64 = 8 * 1024 * 1024;

/// True when `Accept-Encoding` lists gzip (or `*`) without `q=0`.
pub fn accepts_gzip(h: &HeaderMap) -> bool {
    h.get_all(header::ACCEPT_ENCODING).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(',')).any(|part| {
        let mut it = part.split(';');
        let name = it.next().unwrap_or("").trim().to_ascii_lowercase();
        let q_zero = it.any(|p| {
            let p = p.trim().to_ascii_lowercase();
            p.strip_prefix("q=").and_then(|q| q.trim().parse::<f32>().ok()) == Some(0.0)
        });
        (name == "gzip" || name == "*") && !q_zero
    })
}

pub fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut e = GzEncoder::new(Vec::with_capacity(bytes.len() / 3 + 64), Compression::default());
    // writing into a Vec cannot fail
    let _ = e.write_all(bytes);
    e.finish().unwrap_or_default()
}

/// FNV-1a over the bytes: stable for a given build, changes when the file changes.
fn etag_of(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("\"pd-{:016x}-{:x}\"", h, bytes.len())
}

fn compressible(ctype: &str) -> bool {
    let c = ctype.to_ascii_lowercase();
    c.starts_with("text/") || c.starts_with("application/json") || c.starts_with("application/manifest+json") || c.starts_with("image/svg+xml")
}

struct Asset {
    etag: String,
    gz: Option<Bytes>,
}

fn asset(body: &'static [u8], ctype: &str) -> Arc<Asset> {
    static CACHE: LazyLock<Mutex<HashMap<usize, Arc<Asset>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
    let cache = &*CACHE;
    let key = body.as_ptr() as usize;
    if let Some(a) = cache.lock().ok().and_then(|m| m.get(&key).cloned()) {
        return a;
    }
    let gz = (compressible(ctype) && body.len() as u64 >= MIN_BYTES).then(|| Bytes::from(gzip(body)));
    let a = Arc::new(Asset { etag: etag_of(body), gz });
    if let Ok(mut m) = cache.lock() {
        m.insert(key, a.clone());
    }
    a
}

/// One public shell file: ETag + no-cache, 304 on a matching `If-None-Match`, gzip when accepted.
pub fn static_file(body: &'static [u8], ctype: &str, extra: &[(&str, String)], req: &HeaderMap) -> Response {
    let a = asset(body, ctype);
    let matches = req
        .get_all(header::IF_NONE_MATCH)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .any(|t| t.trim() == a.etag || t.trim() == "*");
    let mut b = Response::builder()
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::ETAG, a.etag.as_str())
        .header(header::VARY, "Accept-Encoding");
    for (k, v) in extra {
        b = b.header(*k, v.as_str());
    }
    let out = if matches {
        b.status(StatusCode::NOT_MODIFIED).body(Body::empty())
    } else {
        b = b.status(StatusCode::OK).header(header::CONTENT_TYPE, ctype);
        match (&a.gz, accepts_gzip(req)) {
            (Some(gz), true) => b.header(header::CONTENT_ENCODING, "gzip").body(Body::from(gz.clone())),
            _ => b.body(Body::from(body)),
        }
    };
    out.unwrap_or_else(|_| status_only(StatusCode::INTERNAL_SERVER_ERROR))
}

fn status_only(code: StatusCode) -> Response {
    let mut r = Response::new(Body::empty());
    *r.status_mut() = code;
    r
}

/// Middleware: gzip a finished 200 text or JSON response of known size when the client accepts it.
pub async fn gzip_layer(req: Request, next: Next) -> Response {
    let gz_ok = accepts_gzip(req.headers());
    let res = next.run(req).await;
    if !gz_ok || res.status() != StatusCode::OK || res.headers().contains_key(header::CONTENT_ENCODING) {
        return res;
    }
    let ctype = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !compressible(ctype) {
        return res;
    }
    let size = res.body().size_hint();
    match size.exact() {
        Some(n) if (MIN_BYTES..=MAX_BYTES).contains(&n) => {}
        _ => return res,
    }
    let (mut parts, body) = res.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, MAX_BYTES as usize).await else {
        return status_only(StatusCode::INTERNAL_SERVER_ERROR);
    };
    parts.headers.remove(header::CONTENT_LENGTH);
    parts.headers.insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
    parts.headers.append(header::VARY, HeaderValue::from_static("Accept-Encoding"));
    Response::from_parts(parts, Body::from(gzip(&bytes)))
}

/// Private marker of an answer that carries amounts (set by `amount_json` in `main.rs`): no fingerprint of it ever leaves,
/// not even a hash. `revalidate_layer` honours it and strips it from every answer, so the marker never leaves either.
pub const AMOUNT: &str = "x-pdeck-amount";

/// The tag of an answer body; weak because gzip may send other bytes for the same answer.
fn api_tag(bytes: &[u8]) -> String {
    format!("W/{}", etag_of(bytes))
}

/// True when an `If-None-Match` value names `tag` (weak comparison: `W/` ignored on both sides) or is `*`.
fn names(inm: &[HeaderValue], tag: &str) -> bool {
    let bare = |t: &str| t.trim().trim_start_matches("W/").to_string();
    let want = bare(tag);
    inm.iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(',')).any(|t| t.trim() == "*" || bare(t) == want)
}

/// Middleware (inside `gzip_layer`): a GET under `/api/` that answers 200 JSON of known size gets an `ETag`; when the
/// request already names it, a 304 with the same headers and no body. An answer marked `AMOUNT` is never tagged.
pub async fn revalidate_layer(req: Request, next: Next) -> Response {
    let wanted = req.method() == axum::http::Method::GET && req.uri().path().starts_with("/api/");
    let inm: Vec<HeaderValue> = req.headers().get_all(header::IF_NONE_MATCH).iter().cloned().collect();
    let mut res = next.run(req).await;
    let amount = res.headers_mut().remove(AMOUNT).is_some();
    if amount || !wanted || res.status() != StatusCode::OK || res.headers().contains_key(header::ETAG) || res.headers().contains_key(header::SET_COOKIE) {
        return res;
    }
    let json = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|c| c.starts_with("application/json"));
    if !json || !res.body().size_hint().exact().is_some_and(|n| n <= MAX_BYTES) {
        return res;
    }
    let (mut parts, body) = res.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, MAX_BYTES as usize).await else {
        return status_only(StatusCode::INTERNAL_SERVER_ERROR);
    };
    let tag = api_tag(&bytes);
    let Ok(v) = HeaderValue::from_str(&tag) else {
        return Response::from_parts(parts, Body::from(bytes));
    };
    parts.headers.insert(header::ETAG, v);
    if names(&inm, &tag) {
        parts.status = StatusCode::NOT_MODIFIED;
        parts.headers.remove(header::CONTENT_TYPE);
        parts.headers.remove(header::CONTENT_LENGTH);
        return Response::from_parts(parts, Body::empty());
    }
    Response::from_parts(parts, Body::from(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::GzDecoder;
    use std::io::Read;

    fn h(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut m = HeaderMap::new();
        for (k, v) in pairs {
            m.append(*k, HeaderValue::from_static(v));
        }
        m
    }

    fn gunzip(b: &[u8]) -> Vec<u8> {
        let mut out = vec![];
        let _ = GzDecoder::new(b).read_to_end(&mut out);
        out
    }

    #[test]
    fn accept_encoding_parsing() {
        assert!(accepts_gzip(&h(&[("accept-encoding", "gzip, deflate, br")])));
        assert!(accepts_gzip(&h(&[("accept-encoding", "br;q=1.0, gzip;q=0.8")])));
        assert!(accepts_gzip(&h(&[("accept-encoding", "*")])));
        assert!(!accepts_gzip(&h(&[("accept-encoding", "gzip;q=0")])));
        assert!(!accepts_gzip(&h(&[("accept-encoding", "br, deflate")])));
        assert!(!accepts_gzip(&HeaderMap::new()));
    }

    static JS: &[u8] = include_bytes!("../../static/app.js");
    static TINY: &[u8] = b"ok";
    static PNG: &[u8] = include_bytes!("../../static/icon-192.png");

    async fn body_of(r: Response) -> Vec<u8> {
        axum::body::to_bytes(r.into_body(), usize::MAX).await.map(|b| b.to_vec()).unwrap_or_default()
    }

    #[tokio::test]
    async fn static_file_gzips_and_revalidates() {
        let r = static_file(JS, "text/javascript", &[], &h(&[("accept-encoding", "gzip")]));
        assert_eq!(r.status(), 200);
        assert_eq!(r.headers()["content-encoding"], "gzip");
        assert_eq!(r.headers()["cache-control"], "no-cache");
        let tag = r.headers()["etag"].to_str().unwrap_or("").to_string();
        let gz = body_of(r).await;
        assert!(gz.len() < JS.len() / 2, "{} vs {}", gz.len(), JS.len());
        assert_eq!(gunzip(&gz), JS);
        // no gzip asked: the plain bytes
        let plain = static_file(JS, "text/javascript", &[], &HeaderMap::new());
        assert!(plain.headers().get("content-encoding").is_none());
        assert_eq!(body_of(plain).await, JS);
        // the same tag answers 304 with no body; another tag gets the file
        let mut inm = HeaderMap::new();
        inm.insert(header::IF_NONE_MATCH, HeaderValue::from_str(&tag).unwrap_or(HeaderValue::from_static("x")));
        let nm = static_file(JS, "text/javascript", &[], &inm);
        assert_eq!(nm.status(), 304);
        assert!(body_of(nm).await.is_empty());
        let other = static_file(JS, "text/javascript", &[], &h(&[("if-none-match", "\"pd-old\"")]));
        assert_eq!(other.status(), 200);
        // tiny files and images are never gzipped
        assert!(static_file(TINY, "text/plain", &[], &h(&[("accept-encoding", "gzip")])).headers().get("content-encoding").is_none());
        assert!(static_file(PNG, "image/png", &[], &h(&[("accept-encoding", "gzip")])).headers().get("content-encoding").is_none());
    }

    #[test]
    fn etag_changes_with_content() {
        assert_ne!(etag_of(b"a"), etag_of(b"b"));
        assert_eq!(etag_of(b"same"), etag_of(b"same"));
    }

    /// Serve one handler through `gzip_layer` on a loopback port and fetch it with a client that never decodes.
    async fn fetch(status: StatusCode, ctype: &'static str, extra: &'static [(&'static str, &'static str)], body: Vec<u8>, accept: Option<&str>) -> (StatusCode, HeaderMap, Vec<u8>) {
        let app = axum::Router::new()
            .route(
                "/x",
                axum::routing::get(move || {
                    let body = body.clone();
                    async move { reply(status, ctype, extra, body) }
                }),
            )
            .layer(axum::middleware::from_fn(gzip_layer));
        let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:0").await else { panic!("bind failed") };
        let Ok(addr) = listener.local_addr() else { panic!("no local addr") };
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let Ok(client) = reqwest::Client::builder().no_proxy().build() else { panic!("client build failed") };
        let mut req = client.get(format!("http://{addr}/x"));
        if let Some(a) = accept {
            req = req.header("accept-encoding", a);
        }
        let Ok(res) = req.send().await else { panic!("request failed") };
        let (st, hd) = (res.status(), res.headers().clone());
        let Ok(wire) = res.bytes().await else { panic!("body read failed") };
        (st, hd, wire.to_vec())
    }

    fn reply(status: StatusCode, ctype: &'static str, extra: &'static [(&'static str, &'static str)], body: Vec<u8>) -> Response {
        let mut b = Response::builder().status(status).header(header::CONTENT_TYPE, ctype);
        for (k, v) in extra {
            b = b.header(*k, *v);
        }
        b.body(Body::from(body)).unwrap_or_else(|_| status_only(StatusCode::INTERNAL_SERVER_ERROR))
    }

    #[tokio::test]
    async fn gzip_layer_compresses_a_large_text_200_for_a_client_that_accepts_it() {
        let body: Vec<u8> = br#"{"items":["x","y","z"]}"#.iter().copied().cycle().take(4096).collect();
        let (st, hd, wire) = fetch(StatusCode::OK, "application/json", &[], body.clone(), Some("gzip, br")).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(hd["content-encoding"], "gzip");
        assert_eq!(hd["vary"], "Accept-Encoding");
        assert!(wire.len() < body.len() / 4, "{} vs {}", wire.len(), body.len());
        assert_eq!(gunzip(&wire), body);
    }

    #[tokio::test]
    async fn gzip_layer_leaves_the_body_alone_when_gzip_is_not_accepted_or_refused() {
        let body = vec![b'a'; 4096];
        for accept in [None, Some("br, deflate"), Some("gzip;q=0")] {
            let (st, hd, wire) = fetch(StatusCode::OK, "text/plain", &[], body.clone(), accept).await;
            assert_eq!(st, StatusCode::OK, "{accept:?}");
            assert!(hd.get("content-encoding").is_none(), "{accept:?}");
            assert_eq!(wire, body, "{accept:?}");
        }
    }

    #[tokio::test]
    async fn gzip_layer_size_window_starts_at_one_kib_and_skips_bodies_over_eight_mib() {
        let small = vec![b'a'; MIN_BYTES as usize - 1];
        let (_, hd, wire) = fetch(StatusCode::OK, "text/plain", &[], small.clone(), Some("gzip")).await;
        assert!(hd.get("content-encoding").is_none());
        assert_eq!(wire, small);

        let edge = vec![b'a'; MIN_BYTES as usize];
        let (_, hd, wire) = fetch(StatusCode::OK, "text/plain", &[], edge.clone(), Some("gzip")).await;
        assert_eq!(hd["content-encoding"], "gzip");
        assert_eq!(gunzip(&wire), edge);

        let huge = vec![b'a'; MAX_BYTES as usize + 1];
        let (_, hd, wire) = fetch(StatusCode::OK, "text/plain", &[], huge.clone(), Some("gzip")).await;
        assert!(hd.get("content-encoding").is_none());
        assert_eq!(wire.len(), huge.len());
    }

    #[tokio::test]
    async fn gzip_layer_passes_through_non_text_errors_and_already_encoded_bodies() {
        let body = vec![b'a'; 4096];
        let gz = Some("gzip");
        let (_, hd, wire) = fetch(StatusCode::OK, "image/png", &[], body.clone(), gz).await;
        assert!(hd.get("content-encoding").is_none());
        assert_eq!(wire, body);

        let (st, hd, wire) = fetch(StatusCode::NOT_FOUND, "text/plain", &[], body.clone(), gz).await;
        assert_eq!(st, StatusCode::NOT_FOUND);
        assert!(hd.get("content-encoding").is_none());
        assert_eq!(wire, body);

        let (_, hd, wire) = fetch(StatusCode::OK, "text/plain", &[("content-encoding", "br")], body.clone(), gz).await;
        assert_eq!(hd["content-encoding"], "br");
        assert_eq!(wire, body);
    }

    #[test]
    fn only_text_json_manifest_and_svg_are_compressible() {
        for ok in ["text/html; charset=utf-8", "TEXT/css", "application/json", "application/manifest+json", "image/svg+xml"] {
            assert!(compressible(ok), "{ok}");
        }
        for no in ["image/png", "video/mp4", "application/octet-stream", "application/javascript-ish-not", "audio/mpeg"] {
            assert!(!compressible(no), "{no}");
        }
    }

    /// The production order (revalidate inside gzip): a JSON read under /api/ carries a weak tag of its bytes and answers
    /// 304 to it, gzipped or not; a changed answer gets a new tag; nothing else is tagged.
    #[tokio::test]
    async fn api_reads_revalidate_and_nothing_else_is_tagged() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let big: Vec<u8> = br#"{"rows":["a","b"]}"#.iter().copied().cycle().take(4096).collect();
        let app = axum::Router::new()
            .route("/api/feed", axum::routing::get(move || { let b = big.clone(); async move { reply(StatusCode::OK, "application/json", &[], b) } }))
            .route("/api/moves", axum::routing::get(|| async { reply(StatusCode::OK, "application/json", &[], format!("{{\"n\":{}}}", N.load(Ordering::SeqCst)).into_bytes()) }))
            .route("/api/money", axum::routing::get(|| async { reply(StatusCode::OK, "application/json", &[(AMOUNT, "1")], b"{}".to_vec()) }))
            .route("/api/money-refused", axum::routing::get(|| async { reply(StatusCode::FORBIDDEN, "text/plain", &[(AMOUNT, "1")], b"no".to_vec()) }))
            .route("/api/text", axum::routing::get(|| async { reply(StatusCode::OK, "text/plain", &[], b"ok".to_vec()) }))
            .route("/api/gone", axum::routing::get(|| async { reply(StatusCode::NOT_FOUND, "application/json", &[], b"{}".to_vec()) }))
            .route("/api/post", axum::routing::post(|| async { reply(StatusCode::OK, "application/json", &[], b"{}".to_vec()) }))
            .route("/theme.json", axum::routing::get(|| async { reply(StatusCode::OK, "application/json", &[], b"{}".to_vec()) }))
            .layer(axum::middleware::from_fn(revalidate_layer))
            .layer(axum::middleware::from_fn(gzip_layer));
        let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:0").await else { panic!("bind failed") };
        let Ok(addr) = listener.local_addr() else { panic!("no local addr") };
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let Ok(c) = reqwest::Client::builder().no_proxy().build() else { panic!("client") };
        let get = |p: &str, h: &[(&str, &str)]| {
            let mut r = c.get(format!("http://{addr}{p}"));
            for (k, v) in h {
                r = r.header(*k, *v);
            }
            r.send()
        };
        let tag_of = |r: &reqwest::Response| r.headers().get("etag").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        // gzipped first answer: tagged weak; asking again with the tag is a bodyless 304, gzip or not, with the same tag
        let Ok(first) = get("/api/feed", &[("accept-encoding", "gzip")]).await else { panic!("feed") };
        let tag = tag_of(&first);
        assert!(tag.starts_with("W/\"pd-"), "{tag}");
        assert_eq!(first.headers()["content-encoding"], "gzip");
        for enc in ["gzip", "identity"] {
            let Ok(again) = get("/api/feed", &[("if-none-match", tag.as_str()), ("accept-encoding", enc)]).await else { panic!("again") };
            assert_eq!((again.status().as_u16(), tag_of(&again)), (304, tag.clone()), "{enc}");
            assert!(again.bytes().await.map(|b| b.is_empty()).unwrap_or(false));
        }
        // the strong form and a list both match; a stale tag gets the whole answer
        let strong = tag.trim_start_matches("W/").to_string();
        let list = format!("\"pd-old\", {tag}");
        assert_eq!(get("/api/feed", &[("if-none-match", strong.as_str())]).await.map(|r| r.status().as_u16()).unwrap_or(0), 304);
        assert_eq!(get("/api/feed", &[("if-none-match", list.as_str())]).await.map(|r| r.status().as_u16()).unwrap_or(0), 304);
        assert_eq!(get("/api/feed", &[("if-none-match", "W/\"pd-old\"")]).await.map(|r| r.status().as_u16()).unwrap_or(0), 200);
        // a changed answer: a new tag, and the old one no longer answers 304
        let Ok(m1) = get("/api/moves", &[]).await else { panic!("moves") };
        let t1 = tag_of(&m1);
        N.store(1, Ordering::SeqCst);
        let Ok(m2) = get("/api/moves", &[("if-none-match", t1.as_str())]).await else { panic!("moves 2") };
        assert_eq!(m2.status().as_u16(), 200);
        assert_ne!(tag_of(&m2), t1);
        // never tagged: an answer marked as an amount (by its route, whatever its path), text, an error, a POST, a path
        // outside /api/; the private marker never leaves the server
        for p in ["/api/money", "/api/money-refused", "/api/text", "/api/gone", "/theme.json"] {
            let Ok(r) = get(p, &[("if-none-match", "*")]).await else { panic!("{p}") };
            assert!(r.headers().get("etag").is_none() && r.status().as_u16() != 304, "{p}");
            assert!(r.headers().get(AMOUNT).is_none(), "{p}: the marker leaked");
        }
        let Ok(r) = c.post(format!("http://{addr}/api/post")).header("if-none-match", "*").send().await else { panic!("post") };
        assert!(r.headers().get("etag").is_none() && r.status().as_u16() == 200);
    }
}
