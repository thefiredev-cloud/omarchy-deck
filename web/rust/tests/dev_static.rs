//! `PIXEL_DECK_STATIC_DIR` runs the real binary against a throwaway HOME and a static directory whose files carry
//! markers. A debug build serves the shell pages and static files from that directory, with today's auth: login
//! for "/" without a cookie, index only for the owner, static files public, html never public, nothing outside the
//! directory. A release build (`cargo test --release`) must serve the embedded bytes and ignore the variable.
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TOKEN: &str = "tok_devstatic-3";

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(18_991)
}

fn get(port: u16, path: &str, cookie: bool) -> String {
    let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) else {
        return String::new();
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let ck = if cookie {
        format!("Cookie: pdeck={TOKEN}\r\n")
    } else {
        String::new()
    };
    let _ = s.write_all(
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n{ck}\r\n")
            .as_bytes(),
    );
    let mut out = String::new();
    let _ = s.read_to_string(&mut out);
    out
}

#[test]
fn static_dir_override_is_debug_only_and_keeps_auth() {
    let debug = cfg!(debug_assertions);
    let root = std::env::temp_dir().join(format!(
        "pdeck-devstatic-it-{}-{}",
        std::process::id(),
        debug
    ));
    let _ = std::fs::remove_dir_all(&root);
    let cfg = root.join(".config/pixel-deck");
    let st = root.join("static");
    for d in [&cfg, &st.join("css"), &st.join("pages"), &st.join("fonts")] {
        assert!(std::fs::create_dir_all(d).is_ok());
    }
    assert!(std::fs::write(cfg.join("token"), TOKEN).is_ok());
    for (rel, body) in [
        ("index.html", "DEVINDEX-7"),
        ("login.html", "DEVLOGIN-7"),
        ("cre.html", "DEVCRE-7"),
        ("app.js", "DEVAPP-7"),
        ("css/site.css", "DEVCSS-7"),
        ("pages/new.js", "DEVPAGE-7"),
        ("fonts/a.woff2", "DEVFONT-7"),
        ("secret.txt", "DEVSECRET-7"),
        ("notes.html", "DEVNOTES-7"),
    ] {
        assert!(std::fs::write(st.join(rel), body).is_ok());
    }
    assert!(std::fs::write(root.join("outside.js"), "DEVOUTSIDE-7").is_ok());
    assert!(std::os::unix::fs::symlink(root.join("outside.js"), st.join("link.js")).is_ok());

    let errf = root.join("stderr.log");
    let Ok(err) = std::fs::File::create(&errf) else {
        panic!("stderr file")
    };
    let port = free_port();
    let Ok(mut child) = Command::new(env!("CARGO_BIN_EXE_pixel-deck"))
        .env("HOME", &root)
        .env("PIXEL_DECK_PORT", port.to_string())
        .env("PIXEL_DECK_BINDS", "127.0.0.1")
        .env("PIXEL_DECK_BASE", &root)
        .env("PIXEL_DECK_STATIC_DIR", &st)
        .stdout(Stdio::null())
        .stderr(Stdio::from(err))
        .spawn()
    else {
        panic!("spawn pixel-deck")
    };
    let up = Instant::now();
    while get(port, "/healthz", false).is_empty() {
        assert!(
            up.elapsed() < Duration::from_secs(15),
            "server did not start"
        );
        std::thread::sleep(Duration::from_millis(100));
    }

    let login = get(port, "/", false);
    let index = get(port, "/", true);
    let cre = get(port, "/cre", true);
    let app = get(port, "/app.js", false);
    let css = get(port, "/css/site.css", false);
    let page = get(port, "/pages/new.js", false);
    let font = get(port, "/fonts/a.woff2", false);
    assert!(login.starts_with("HTTP/1.1 401"), "{login}");
    assert!(index.starts_with("HTTP/1.1 200"), "{index}");
    assert!(
        app.starts_with("HTTP/1.1 200"),
        "public files stay public: {app}"
    );
    if debug {
        assert!(login.contains("DEVLOGIN-7"), "{login}");
        assert!(index.contains("DEVINDEX-7"), "{index}");
        assert!(cre.contains("DEVCRE-7"), "{cre}");
        assert!(app.contains("DEVAPP-7"), "{app}");
        for (r, mark, ct) in [
            (&css, "DEVCSS-7", "text/css"),
            (&page, "DEVPAGE-7", "text/javascript"),
            (&font, "DEVFONT-7", "font/woff2"),
        ] {
            assert!(r.starts_with("HTTP/1.1 200") && r.contains(mark), "{r}");
            assert!(
                r.to_ascii_lowercase()
                    .contains(&format!("content-type: {ct}")),
                "{r}"
            );
            assert!(
                r.to_ascii_lowercase().contains("cache-control: no-store"),
                "{r}"
            );
        }
    } else {
        for r in [&login, &index, &cre, &app, &css, &page, &font] {
            for mark in [
                "DEVLOGIN-7",
                "DEVINDEX-7",
                "DEVCRE-7",
                "DEVAPP-7",
                "DEVCSS-7",
                "DEVPAGE-7",
                "DEVFONT-7",
            ] {
                assert!(
                    !r.contains(mark),
                    "a release build served the override ({mark}): {r}"
                );
            }
        }
        assert!(
            !css.starts_with("HTTP/1.1 200"),
            "a release build has no /css/site.css: {css}"
        );
        assert!(
            index.contains("<html") || index.contains("<!doctype") || index.contains("<!DOCTYPE"),
            "embedded index expected"
        );
    }

    // never served from the directory, by anyone: the shell pages as files, other types, traversal and links out
    for path in [
        "/index.html",
        "/notes.html",
        "/secret.txt",
        "/../outside.js",
        "/css/../app.js",
        "/link.js",
        "/%2e%2e/outside.js",
    ] {
        for cookie in [false, true] {
            let r = get(port, path, cookie);
            for mark in ["DEVINDEX-7", "DEVNOTES-7", "DEVSECRET-7", "DEVOUTSIDE-7"] {
                assert!(
                    !r.contains(mark),
                    "{path} (cookie {cookie}) leaked {mark}: {r}"
                );
            }
        }
    }

    let _ = Command::new("kill")
        .args(["-TERM", &child.id().to_string()])
        .status();
    let t0 = Instant::now();
    while matches!(child.try_wait(), Ok(None)) && t0.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    let log = std::fs::read_to_string(&errf).unwrap_or_default();
    assert_eq!(
        log.contains("dev static dir active"),
        debug,
        "startup line must appear only in a debug build: {log}"
    );
    let _ = std::fs::remove_dir_all(&root);
}
