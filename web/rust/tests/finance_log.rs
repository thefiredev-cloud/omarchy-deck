//! The deck must never write a finance or portfolio amount to its log. This runs the real binary against a throwaway HOME with
//! finance.json and portfolio files holding obviously fake numbers, drives the finance and Invest routes (served, refused, wrong
//! method, bad token, cross-site) and reads the process's whole stderr afterwards. Digits from the values must not appear in any line.
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TOKEN: &str = "tok_logtest-9";
// every one of these appears in the file below and must never reach stderr
const PROBES: [&str; 6] = ["424242", "313131", "919191", "565656", "777777", "42.42"];

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(18_990)
}

fn http(port: u16, req: &str) -> String {
    let mut s = match TcpStream::connect(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = s.write_all(req.as_bytes());
    let mut out = String::new();
    let _ = s.read_to_string(&mut out);
    out
}

fn request(method: &str, path: &str, extra: &str) -> String {
    format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Length: 0\r\n{extra}\r\n")
}

#[test]
fn finance_amounts_never_reach_the_process_log() {
    let root = std::env::temp_dir().join(format!("pdeck-finlog-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let deck = root.join(".meshvault/status/deck");
    let cfg = root.join(".config/pixel-deck");
    assert!(std::fs::create_dir_all(&deck).is_ok() && std::fs::create_dir_all(&cfg).is_ok());
    assert!(std::fs::write(cfg.join("token"), TOKEN).is_ok());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let file = format!(
        r#"{{"v":1,"t":{now},"refresh":3600,"src":["sample"],"errors":[],"sample":true,
        "inventory":{{"installed":190,"finance_related":14,"covered":1,"src":"sample","t":{now}}},
        "apps":[{{"id":"coinbase","name":"Coinbase","kind":"crypto","route":"iphone_screen","status":"ok","last_ok":{now},
          "values":{{"balance_usd":424242.42,"as_of":{now},"items":[{{"label":"BTC","usd":313131.31}}]}}}}],
        "totals":{{"net_usd":565656.56,"by_kind":{{"crypto":919191.91}},"apps_ok":1,"apps":1}},"stray":777777}}"#
    );
    assert!(std::fs::write(deck.join("finance.json"), file).is_ok());
    // the Invest tab pair: the public feed (with a collector error line that names an amount) and the values file
    let portfolio = format!(
        r#"{{"t":{now},"refresh":300,"src":["sample"],"errors":[{{"source":"quote AAA","reason":"holding 565656 shares"}}],
        "totals":{{"day_pct":-1.5,"positions":1,"priced":1,"margin_in_use":false,"positions_usd":919191}},
        "positions":[{{"symbol":"AAA","kind":"equity","name":"Alpha","price":100.0,"chg":-1.0,"pct":-0.99,"t":{now},"qty":424242}}]}}"#
    );
    let portfolio_values = format!(
        r#"{{"t":{now},"refresh":300,"src":["sample"],"errors":[],
        "totals":{{"positions_usd":919191.0,"day_chg_usd":565656.0,"net_est_usd":777777.0}},
        "positions":[{{"symbol":"AAA","kind":"equity","qty":424242.0,"value":313131.0,"day_chg":-1000.0}}]}}"#
    );
    assert!(std::fs::write(deck.join("portfolio.json"), portfolio).is_ok());
    assert!(std::fs::write(deck.join("portfolio-values.json"), portfolio_values).is_ok());

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
        .stdout(Stdio::null())
        .stderr(Stdio::from(err))
        .spawn()
    else {
        panic!("spawn pixel-deck")
    };

    let up = Instant::now();
    while http(port, &request("GET", "/healthz", "")).is_empty() {
        assert!(up.elapsed() < Duration::from_secs(15), "server did not start");
        std::thread::sleep(Duration::from_millis(100));
    }

    let ck = format!("Cookie: pdeck={TOKEN}\r\n");
    let served = http(port, &request("GET", "/api/finance-values", &ck));
    assert!(served.starts_with("HTTP/1.1 200"), "{}", &served[..served.len().min(60)]);
    assert!(served.contains("424242.42"), "the values route must serve the amounts");
    let public = http(port, &request("GET", "/api/finance", &ck));
    assert!(public.starts_with("HTTP/1.1 200"));
    assert!(!PROBES.iter().any(|p| public.contains(p)), "amount in /api/finance");
    assert!(public.to_ascii_lowercase().contains("cache-control: no-store"));
    let invest_values = http(port, &request("GET", "/api/portfolio-values", &format!("{ck}Sec-Fetch-Site: same-origin\r\n")));
    assert!(invest_values.starts_with("HTTP/1.1 200"), "{}", &invest_values[..invest_values.len().min(60)]);
    assert!(invest_values.contains("919191"), "the portfolio values route must serve the amounts");
    assert!(invest_values.to_ascii_lowercase().contains("cache-control: no-store"));
    let invest_public = http(port, &request("GET", "/api/portfolio", &ck));
    assert!(invest_public.starts_with("HTTP/1.1 200"));
    assert!(!PROBES.iter().any(|p| invest_public.contains(p)), "amount in /api/portfolio: {invest_public}");
    // refusals that do log: bad cookie, token in the URL, wrong method, cross-origin write, cross-site read
    let refused = [
        http(port, &request("GET", "/api/finance-values", "Cookie: pdeck=nope\r\n")),
        http(port, &request("GET", &format!("/api/finance-values?t={TOKEN}"), "")),
        http(port, &request("POST", "/api/finance-values", &ck)),
        http(port, &request("POST", "/api/finance", &format!("{ck}Origin: http://evil.example\r\n"))),
        http(port, &request("GET", "/api/finance-values", &format!("{ck}Sec-Fetch-Site: cross-site\r\n"))),
        http(port, &request("GET", "/api/portfolio-values", "Cookie: pdeck=nope\r\n")),
        http(port, &request("GET", &format!("/api/portfolio-values?t={TOKEN}"), "")),
        http(port, &request("POST", "/api/portfolio-values", &ck)),
        http(port, &request("GET", "/api/portfolio-values", &format!("{ck}Sec-Fetch-Site: cross-site\r\n"))),
    ];
    for r in &refused {
        assert!(!r.starts_with("HTTP/1.1 200"), "refusal expected: {}", &r[..r.len().min(40)]);
        assert!(!PROBES.iter().any(|p| r.contains(p)), "amount in a refusal");
    }

    // SIGTERM so the shutdown path is in the log too, then wait for the process
    let pid = child.id().to_string();
    let _ = Command::new("kill").args(["-TERM", &pid]).status();
    let t0 = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if t0.elapsed() < Duration::from_secs(10) => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }

    let log = std::fs::read_to_string(&errf).unwrap_or_default();
    // a log that is empty proves nothing: the lines we expect must be there
    assert!(log.contains("\"msg\":\"listening\""), "no listening line: {log}");
    assert!(log.contains("csrf refused"), "the cross-origin refusal should be logged: {log}");
    for p in PROBES {
        assert!(!log.contains(p), "{p} reached the log");
    }
    assert!(!log.contains(TOKEN), "the token reached the log");
    for banned in ["balance_usd", "net_usd", "BTC", "Coinbase", "positions_usd", "net_est_usd", "day_chg"] {
        assert!(!log.contains(banned), "{banned} reached the log");
    }
    let _ = std::fs::remove_dir_all(&root);
}
