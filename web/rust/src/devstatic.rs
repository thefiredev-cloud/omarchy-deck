//! Debug builds only: with `PIXEL_DECK_STATIC_DIR=<dir>` the shell pages (index.html, login.html, cre.html) and the
//! public static files come from that directory instead of the embedded bytes, so a page edit needs no rebuild.
//! A release build never reads the variable. Auth is unchanged: the shell pages are still served only where the
//! embedded ones are (index.html behind the owner check), and only static file types are public. A request path
//! with an empty, `.` or `..` segment, a backslash, or a file that resolves outside the directory is never served.
use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::Response;
use std::borrow::Cow;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub const VAR: &str = "PIXEL_DECK_STATIC_DIR";
static DIR: LazyLock<Option<PathBuf>> = LazyLock::new(|| from_value(std::env::var_os(VAR)));

/// The override directory for a value of the variable: always None in a release build, None when the value is
/// unset, empty or not a directory. The path is canonical, so a containment check is a plain prefix test.
pub fn from_value(v: Option<OsString>) -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let v = v.filter(|v| !v.is_empty())?;
    std::fs::canonicalize(v).ok().filter(|p| p.is_dir())
}

/// The active override directory, if any (the variable is read once, on first use).
pub fn dir() -> Option<&'static Path> {
    DIR.as_deref()
}

/// Content type of a public static file; None for everything else (html included: shell pages are not public files).
fn ctype(rel: &str) -> Option<&'static str> {
    Some(match rel.rsplit_once('.')?.1 {
        "js" => "text/javascript",
        "css" => "text/css",
        "woff2" => "font/woff2",
        "webmanifest" => "application/manifest+json",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// `root/rel` when rel is a plain relative path and the file it resolves to (links followed) is inside root.
fn inside(root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty()
        || rel.contains('\\')
        || rel.contains('\0')
        || rel
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
    {
        return None;
    }
    let p = std::fs::canonicalize(root.join(rel)).ok()?;
    (p.starts_with(root) && p.is_file()).then_some(p)
}

/// A public static file under root for a request path, with its content type.
pub fn public_in(root: &Path, path: &str) -> Option<(Vec<u8>, &'static str)> {
    let rel = path.strip_prefix('/')?;
    let ct = ctype(rel)?;
    std::fs::read(inside(root, rel)?).ok().map(|b| (b, ct))
}

/// The worker stamped against root (`shell::build`): root's sw.js when present, else the embedded template; for each
/// SHELL entry root's file when present, else `embedded`'s (`/` is root's index.html and cre.html together, as the
/// embedded set hashes it). A kit edit of any cached file gives a new cache name as a release would, and the same
/// tree always gives the same name, so a reload can never loop.
pub fn sw_in(
    root: &Path,
    embedded_sw: &[u8],
    embedded: &dyn Fn(&str) -> Option<Cow<'static, [u8]>>,
) -> Vec<u8> {
    let sw = page_in(root, "sw.js");
    let get = |p: &str| -> Option<Cow<'static, [u8]>> {
        let own = match p {
            "/sw.js" => return None,
            "/" => page_in(root, "index.html").zip(page_in(root, "cre.html")).map(|(i, c)| [i, c].concat()),
            _ => public_in(root, p).map(|(b, _)| b),
        };
        own.map(Cow::Owned).or_else(|| embedded(p))
    };
    let s = crate::shell::build(sw.as_deref().unwrap_or(embedded_sw), &get);
    for p in &s.problems {
        crate::util::log("error", "shell stamp (static dir)", &[("problem", p.clone())]);
    }
    s.body
}

/// The response for a public static file from the override directory, or None to fall through to the embedded set
/// and the routes. Never cached by the browser, so an edit shows on the next load. `/sw.js` is always stamped here
/// (`sw_in`) while the directory is active, so the raw token is never served.
pub fn public(
    path: &str,
    embedded_sw: &[u8],
    embedded: &dyn Fn(&str) -> Option<Cow<'static, [u8]>>,
) -> Option<Response> {
    let root = dir()?;
    let (body, ct) = if path == "/sw.js" {
        (sw_in(root, embedded_sw, embedded), "text/javascript")
    } else {
        public_in(root, path)?
    };
    let mut r = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, ct)
        .header(header::CACHE_CONTROL, "no-store");
    if path == "/sw.js" {
        r = r.header("Service-Worker-Allowed", "/");
    }
    r.body(Body::from(body)).ok()
}

/// One shell page from root, if present there.
pub fn page_in(root: &Path, name: &str) -> Option<Vec<u8>> {
    std::fs::read(inside(root, name)?).ok()
}

/// A shell page (index.html, login.html, cre.html): the override directory's copy when active and present, else
/// the embedded bytes.
pub fn page(name: &str, embedded: &'static [u8]) -> Cow<'static, [u8]> {
    match dir().and_then(|d| page_in(d, name)) {
        Some(b) => Cow::Owned(b),
        None => Cow::Borrowed(embedded),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!(
            "pdeck-devstatic-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("static");
        for d in ["css", "pages", "fonts"] {
            assert!(std::fs::create_dir_all(root.join(d)).is_ok());
        }
        for (rel, body) in [
            ("index.html", "IDX"),
            ("app.js", "APP"),
            ("css/site.css", "CSS"),
            ("pages/new.js", "NEW"),
            ("fonts/a.woff2", "FONT"),
            ("secret.txt", "SECRET"),
            ("notes.html", "NOTES"),
        ] {
            assert!(std::fs::write(root.join(rel), body).is_ok());
        }
        assert!(std::fs::write(base.join("outside.js"), "OUT").is_ok());
        assert!(std::os::unix::fs::symlink(base.join("outside.js"), root.join("link.js")).is_ok());
        let Ok(root) = std::fs::canonicalize(&root) else {
            panic!("canonical root")
        };
        (base, root)
    }

    #[test]
    fn serves_static_types_from_the_dir_and_its_new_subfolders() {
        let (base, root) = tree();
        let got = |p: &str| {
            public_in(&root, p).map(|(b, ct)| (String::from_utf8_lossy(&b).into_owned(), ct))
        };
        assert_eq!(got("/app.js"), Some(("APP".into(), "text/javascript")));
        assert_eq!(got("/css/site.css"), Some(("CSS".into(), "text/css")));
        assert_eq!(
            got("/pages/new.js"),
            Some(("NEW".into(), "text/javascript"))
        );
        assert_eq!(got("/fonts/a.woff2"), Some(("FONT".into(), "font/woff2")));
        assert_eq!(got("/missing.js"), None);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn refuses_other_types_traversal_and_links_out_of_the_dir() {
        let (base, root) = tree();
        for p in [
            "/secret.txt",
            "/notes.html",
            "/index.html",
            "/../outside.js",
            "/css/../app.js",
            "/./app.js",
            "//app.js",
            "/css\\site.css",
            "/link.js",
            "app.js",
        ] {
            assert!(public_in(&root, p).is_none(), "{p} must not be served");
        }
        assert_eq!(
            page_in(&root, "index.html").as_deref(),
            Some(b"IDX".as_slice())
        );
        assert!(page_in(&root, "../outside.js").is_none());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn the_variable_counts_only_in_debug_builds_and_only_for_a_directory() {
        let (base, root) = tree();
        assert_eq!(
            from_value(Some(root.clone().into_os_string())).is_some(),
            cfg!(debug_assertions)
        );
        assert!(from_value(None).is_none());
        assert!(from_value(Some(OsString::new())).is_none());
        assert!(from_value(Some(root.join("app.js").into_os_string())).is_none());
        assert!(from_value(Some(base.join("nope").into_os_string())).is_none());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn the_override_worker_is_stamped_from_override_files_and_embedded_ones_alike() {
        let (base, root) = tree();
        let tpl = "const V='pdeck-shell-__SHELL_HASH__',SHELL=['/','/app.js','/deck.js'];";
        let embedded = |deck: &'static [u8]| {
            move |p: &str| -> Option<Cow<'static, [u8]>> {
                match p {
                    "/" => Some(Cow::Borrowed(b"EIDX".as_slice())),
                    "/app.js" => Some(Cow::Borrowed(b"EAPP".as_slice())),
                    "/deck.js" => Some(Cow::Borrowed(deck)),
                    _ => None,
                }
            }
        };
        let e1 = embedded(b"EDECK");
        // no sw.js in the dir: the embedded template, stamped against the dir's index.html with its cre.html, app.js, embedded deck.js
        assert!(std::fs::write(root.join("cre.html"), "CRE").is_ok());
        let first = sw_in(&root, tpl.as_bytes(), &e1);
        let want = crate::shell::stamp(tpl.as_bytes(), &|p: &str| -> Option<Cow<'static, [u8]>> {
            Some(Cow::Borrowed(match p {
                "/" => b"IDXCRE".as_slice(),
                "/app.js" => b"APP".as_slice(),
                _ => b"EDECK".as_slice(),
            }))
        });
        assert_eq!(Ok(first.clone()), want);
        assert_eq!(sw_in(&root, tpl.as_bytes(), &e1), first, "same tree, same name: no reload loop");
        // one byte of an overridden file moves the name, and putting it back restores it
        assert!(std::fs::write(root.join("app.js"), "APQ").is_ok());
        assert_ne!(sw_in(&root, tpl.as_bytes(), &e1), first);
        assert!(std::fs::write(root.join("app.js"), "APP").is_ok());
        assert_eq!(sw_in(&root, tpl.as_bytes(), &e1), first);
        // the deal desk's page (a viewer's `/`) moves it too
        assert!(std::fs::write(root.join("cre.html"), "CRF").is_ok());
        assert_ne!(sw_in(&root, tpl.as_bytes(), &e1), first);
        assert!(std::fs::write(root.join("cre.html"), "CRE").is_ok());
        assert_eq!(sw_in(&root, tpl.as_bytes(), &e1), first);
        // a file the dir does not have comes from the embedded set and counts too
        assert_ne!(sw_in(&root, tpl.as_bytes(), &embedded(b"EDECQ")), first);
        // the dir's own sw.js wins over the template
        assert!(std::fs::write(root.join("sw.js"), format!("{tpl}//kit")).is_ok());
        let own = sw_in(&root, tpl.as_bytes(), &e1);
        assert!(own.ends_with(b"//kit") && crate::shell::version_of(&own).is_some());
        assert!(!own.windows(crate::shell::TOKEN.len()).any(|w| w == crate::shell::TOKEN));
        let _ = std::fs::remove_dir_all(base);
    }
}
