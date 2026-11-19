//! `/almanac/*`: the Almanac (Tanner's 20-year history app, `almanac serve` on 127.0.0.1:8795) behind the deck's
//! owner cookie. The deck strips the `/almanac` prefix, sends the request with Host `127.0.0.1:8795`
//! (Almanac refuses any other Host: DNS-rebinding guard) and passes back the body with its Content-Type,
//! Cache-Control and Content-Security-Policy. GET, HEAD and POST only; a POST body is at most 10 KB of JSON.
//! The Almanac sleeps when idle (ha-apps on-demand policy, 2026-11-01), so the request goes to the ha-apps gateway
//! door first, which starts it and waits for it; straight to the Almanac only when the gateway refuses the connection.
//! Auth is decided in main.rs before this runs: owner cookie only, never the `?t=` bootstrap, never the guest.
use axum::body::Body;
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use std::time::Duration;

/// The Almanac itself. Its Host goes with every request, whichever door it takes (the gateway passes it on), and an
/// absolute redirect to it is folded back under `/almanac`.
pub const UPSTREAM: &str = "http://127.0.0.1:8795";
/// The ha-apps gateway door for the Almanac (`~/projects/ha-apps/apps.yaml` gateway_port 4801). A request there starts
/// a sleeping Almanac and waits up to 45 s for it; a request straight to 8795 finds it asleep and is refused.
pub const GATEWAY: &str = "http://127.0.0.1:4801";
/// Tried in order; the next door only when one refuses the connection.
pub const DOORS: [&str; 2] = [GATEWAY, UPSTREAM];
pub const PREFIX: &str = "/almanac";
pub const MAX_BODY: usize = 10 * 1024;
/// Ask runs a local model while the cluster is off: 60 to 120 s is normal.
const ASK_TIMEOUT: Duration = Duration::from_secs(150);
const TIMEOUT: Duration = Duration::from_secs(30);
/// Used when the Almanac answers without a Content-Security-Policy: same-origin files only, no inline script, no framing.
pub const FALLBACK_CSP: &str =
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/// The upstream path and query for a deck path, or None when it is not an Almanac path or tries to leave it.
pub fn upstream_path(path: &str, query: Option<&str>) -> Option<String> {
    let rest = path.strip_prefix(PREFIX)?;
    if !rest.starts_with('/') {
        return None;
    }
    let ok_char = |c: char| c.is_ascii_alphanumeric() || "/-._~%".contains(c);
    if !rest.chars().all(ok_char) || rest.split('/').any(|s| s == ".." || s == ".") || rest.contains("//") {
        return None;
    }
    // encoded dots, slashes and backslashes could leave the prefix; encoded NUL, CR, LF and a double-encoded % are never a real page
    let lower = rest.to_ascii_lowercase();
    if ["%2e", "%2f", "%5c", "%00", "%0a", "%0d", "%25"].iter().any(|e| lower.contains(e)) {
        return None;
    }
    Some(match query {
        Some(q) if !q.is_empty() => format!("{rest}?{q}"),
        _ => rest.to_string(),
    })
}

/// A redirect inside the Almanac stays inside `/almanac`; anything that would leave it is dropped.
pub fn rewrite_location(loc: &str) -> Option<String> {
    let l = loc.strip_prefix(UPSTREAM).unwrap_or(loc);
    // a backslash reads as a slash in browsers ("/\evil.com" is "//evil.com"), and control characters never belong in a redirect
    if l.contains('\\') || l.chars().any(char::is_control) {
        return None;
    }
    if l.starts_with('/') && !l.starts_with("//") {
        Some(format!("{PREFIX}{l}"))
    } else if !l.contains(':') && !l.starts_with("//") {
        Some(l.to_string()) // relative: the browser resolves it under /almanac/
    } else {
        None
    }
}

fn plain(code: u16, msg: &str) -> Response {
    Response::builder()
        .status(StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY))
        .header(header::CONTENT_TYPE, "text/plain")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(msg.to_string()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

pub async fn proxy(
    http: &reqwest::Client,
    doors: &[&str],
    method: &Method,
    path: &str,
    query: Option<&str>,
    headers: &HeaderMap,
    body: Body,
) -> Response {
    if path == PREFIX {
        return Response::builder()
            .status(StatusCode::FOUND)
            .header(header::LOCATION, "/almanac/")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }
    let Some(up) = upstream_path(path, query) else {
        return plain(404, "nf");
    };
    let m = match *method {
        Method::GET => reqwest::Method::GET,
        Method::HEAD => reqwest::Method::HEAD,
        Method::POST => reqwest::Method::POST,
        _ => return plain(405, "GET, HEAD or POST"),
    };
    let ask = up.starts_with("/api/ask");
    let accept = headers.get(header::ACCEPT).and_then(|v| v.to_str().ok());
    let content_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok());
    // read once, so the same body can go to the next door
    let post = if m == reqwest::Method::POST {
        let Ok(bytes) = axum::body::to_bytes(body, MAX_BODY).await else {
            return plain(413, "too large");
        };
        Some(bytes)
    } else {
        None
    };
    let mut answer = None;
    for door in doors {
        let mut rb = http
            .request(m.clone(), format!("{door}{up}"))
            .timeout(if ask { ASK_TIMEOUT } else { TIMEOUT })
            .header(reqwest::header::HOST, "127.0.0.1:8795");
        if let Some(a) = accept {
            rb = rb.header(reqwest::header::ACCEPT, a);
        }
        if let Some(bytes) = &post {
            if let Some(ct) = content_type {
                rb = rb.header(reqwest::header::CONTENT_TYPE, ct);
            }
            rb = rb.body(bytes.clone());
        }
        match rb.send().await {
            Ok(r) => {
                answer = Some(r);
                break;
            }
            Err(e) if e.is_timeout() => return plain(504, "The Almanac took too long to answer."),
            Err(e) if e.is_connect() => continue,
            Err(_) => break,
        }
    }
    let Some(r) = answer else {
        return plain(502, "The Almanac is not running (gateway 127.0.0.1:4801 and 127.0.0.1:8795 did not answer).");
    };
    let code = r.status().as_u16();
    let pick = |n: reqwest::header::HeaderName| r.headers().get(n).and_then(|v| v.to_str().ok()).map(str::to_string);
    let ct = pick(reqwest::header::CONTENT_TYPE).unwrap_or_else(|| "application/octet-stream".into());
    // owner-only history never sits in a shared or disk cache, whatever the Almanac asks for
    let cc = "private, no-store";
    let csp = pick(reqwest::header::CONTENT_SECURITY_POLICY);
    let loc = pick(reqwest::header::LOCATION).and_then(|l| rewrite_location(&l));
    let Ok(bytes) = r.bytes().await else {
        return plain(502, "The Almanac answer was cut off.");
    };
    let mut b = Response::builder()
        .status(StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY))
        .header(header::CONTENT_TYPE, ct)
        .header(header::CACHE_CONTROL, cc)
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Frame-Options", "DENY");
    // the Almanac shares the deck origin, so its pages must never run inline script. FALLBACK_CSP is always sent; the
    // Almanac's own policy is sent beside it, and a browser enforces both, so a weaker upstream policy can only add limits.
    b = b.header(header::CONTENT_SECURITY_POLICY, FALLBACK_CSP);
    if let Some(c) = csp {
        b = b.header(header::CONTENT_SECURITY_POLICY, c);
    }
    if let Some(l) = loc {
        b = b.header(header::LOCATION, l);
    }
    let body = if *method == Method::HEAD { Body::empty() } else { Body::from(bytes) };
    b.body(body).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_almanac() {
        assert_eq!(upstream_path("/almanac/", None).as_deref(), Some("/"));
        assert_eq!(upstream_path("/almanac/static/app.js", None).as_deref(), Some("/static/app.js"));
        assert_eq!(upstream_path("/almanac/api/years", Some("y=2014&q=a%20b")).as_deref(), Some("/api/years?y=2014&q=a%20b"));
        for bad in ["/almanac", "/almanacx/", "/api/x", "/almanac/../api", "/almanac/a/../../x", "/almanac//evil.com",
            "/almanac/%2e%2e/x", "/almanac/a%2Fb", "/almanac/a b", "/almanac/./x", "/almanac/a\\b", "/almanac/a%00", "/almanac/a%0d%0aX:1",
            "/almanac/%252e%252e/x"] {
            assert_eq!(upstream_path(bad, None), None, "{bad}");
        }
    }

    #[test]
    fn redirects_stay_inside_the_almanac() {
        assert_eq!(rewrite_location("/years/2014").as_deref(), Some("/almanac/years/2014"));
        assert_eq!(rewrite_location("http://127.0.0.1:8795/x").as_deref(), Some("/almanac/x"));
        assert_eq!(rewrite_location("page2").as_deref(), Some("page2"));
        assert_eq!(rewrite_location("https://evil.example/"), None);
        assert_eq!(rewrite_location("//evil.example/"), None);
        assert_eq!(rewrite_location("/\\evil.example/"), None);
        assert_eq!(rewrite_location("\\evil.example"), None);
    }

    /// A fake Almanac on a loopback port that echoes method, path, Host, Content-Type and body, and refuses a foreign Host.
    async fn fake() -> Option<String> {
        use axum::extract::Request;
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.ok()?;
        let addr = l.local_addr().ok()?;
        let app = axum::Router::new().fallback(|req: Request| async move {
            let host = req.headers().get("host").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            if host != "127.0.0.1:8795" {
                return (StatusCode::FORBIDDEN, "bad host").into_response();
            }
            let (m, uri) = (req.method().clone(), req.uri().clone());
            let ct = req.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            let b = axum::body::to_bytes(req.into_body(), 1 << 20).await.unwrap_or_default();
            if uri.path() == "/go" {
                return Response::builder().status(302).header("location", "/years/").body(Body::empty()).unwrap_or_default();
            }
            Response::builder()
                .status(if m == Method::HEAD { StatusCode::NO_CONTENT } else { StatusCode::OK })
                .header("content-type", "text/html; charset=utf-8")
                .header("cache-control", "max-age=60")
                .header("content-security-policy", "default-src 'self'")
                .body(Body::from(format!("{m} {uri} {ct} {}", String::from_utf8_lossy(&b))))
                .unwrap_or_default()
        });
        tokio::spawn(async move {
            let _ = axum::serve(l, app).await;
        });
        Some(format!("http://{addr}"))
    }

    async fn body_text(r: Response) -> String {
        String::from_utf8_lossy(&axum::body::to_bytes(r.into_body(), 1 << 20).await.unwrap_or_default()).into_owned()
    }

    #[tokio::test]
    async fn proxies_with_the_almanac_host_and_passes_headers_back() {
        let Some(base) = fake().await else { panic!("no fake listener") };
        let doors = [base.as_str()];
        let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap_or_default();
        let none = HeaderMap::new();
        let r = proxy(&http, &doors, &Method::GET, "/almanac/years", Some("y=2014"), &none, Body::empty()).await;
        assert_eq!(r.status(), 200);
        let h = r.headers().clone();
        assert_eq!(h.get("content-type").and_then(|v| v.to_str().ok()), Some("text/html; charset=utf-8"));
        // the deck forces no-store, framing off and its strict CSP beside the Almanac's own policy
        assert_eq!(h.get("cache-control").and_then(|v| v.to_str().ok()), Some("private, no-store"));
        assert_eq!(h.get("x-frame-options").and_then(|v| v.to_str().ok()), Some("DENY"));
        let csps: Vec<&str> = h.get_all("content-security-policy").iter().filter_map(|v| v.to_str().ok()).collect();
        assert_eq!(csps, [FALLBACK_CSP, "default-src 'self'"]);
        assert_eq!(body_text(r).await, "GET /years?y=2014  ");
        let mut hj = HeaderMap::new();
        hj.insert(header::CONTENT_TYPE, "application/json".parse().unwrap_or(header::HeaderValue::from_static("x")));
        let r = proxy(&http, &doors, &Method::POST, "/almanac/api/ask", None, &hj, Body::from(r#"{"q":"2014"}"#)).await;
        assert_eq!(body_text(r).await, r#"POST /api/ask application/json {"q":"2014"}"#);
        let big = Body::from(vec![b'x'; MAX_BODY + 1]);
        assert_eq!(proxy(&http, &doors, &Method::POST, "/almanac/api/ask", None, &hj, big).await.status(), 413);
        let r = proxy(&http, &doors, &Method::GET, "/almanac/go", None, &none, Body::empty()).await;
        assert_eq!(r.headers().get("location").and_then(|v| v.to_str().ok()), Some("/almanac/years/"));
        let r = proxy(&http, &doors, &Method::GET, "/almanac", None, &none, Body::empty()).await;
        assert_eq!((r.status().as_u16(), r.headers().get("location").and_then(|v| v.to_str().ok())), (302, Some("/almanac/")));
        assert_eq!(proxy(&http, &doors, &Method::PUT, "/almanac/x", None, &none, Body::empty()).await.status(), 405);
        assert_eq!(proxy(&http, &doors, &Method::GET, "/almanac/../x", None, &none, Body::empty()).await.status(), 404);
    }

    #[test]
    fn the_gateway_door_that_wakes_the_almanac_is_tried_first() {
        assert_eq!(DOORS, [GATEWAY, UPSTREAM]);
        assert_eq!(GATEWAY, "http://127.0.0.1:4801");
    }

    #[tokio::test]
    async fn a_refused_gateway_falls_through_to_the_almanac_itself_with_the_same_body() {
        let Some(base) = fake().await else { panic!("no fake listener") };
        let doors = ["http://127.0.0.1:1", base.as_str()];
        let http = reqwest::Client::new();
        let r = proxy(&http, &doors, &Method::GET, "/almanac/api/today", None, &HeaderMap::new(), Body::empty()).await;
        assert_eq!(r.status(), 200);
        assert_eq!(body_text(r).await, "GET /api/today  ");
        let mut hj = HeaderMap::new();
        hj.insert(header::CONTENT_TYPE, "application/json".parse().unwrap_or(header::HeaderValue::from_static("x")));
        let r = proxy(&http, &doors, &Method::POST, "/almanac/api/ask", None, &hj, Body::from(r#"{"q":"2014"}"#)).await;
        assert_eq!(body_text(r).await, r#"POST /api/ask application/json {"q":"2014"}"#);
    }

    #[tokio::test]
    async fn head_requests_reach_the_upstream_as_head_without_a_body() {
        let Some(base) = fake().await else { panic!("no fake listener") };
        let http = reqwest::Client::new();
        let r = proxy(
            &http,
            &[base.as_str()],
            &Method::HEAD,
            "/almanac/api/today",
            None,
            &HeaderMap::new(),
            Body::empty(),
        )
        .await;

        assert_eq!(r.status(), StatusCode::NO_CONTENT);
        assert!(body_text(r).await.is_empty());
    }

    #[tokio::test]
    async fn a_dead_almanac_is_a_502_with_a_reason() {
        let http = reqwest::Client::new();
        let doors = ["http://127.0.0.1:1", "http://127.0.0.1:1"];
        let r = proxy(&http, &doors, &Method::GET, "/almanac/", None, &HeaderMap::new(), Body::empty()).await;
        assert_eq!(r.status(), 502);
        assert!(body_text(r).await.contains("not running"));
    }
}
