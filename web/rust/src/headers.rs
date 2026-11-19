//! Headers that cost nothing (round "Better" item 3, findings X1, X2, X3, X5).
//!
//! Every answer, whichever route or layer built it, leaves through `layer` with:
//! - `X-Content-Type-Options: nosniff`: an answer runs only as the type it names, so a JSON or camera answer can never
//!   be loaded as a script or a style sheet (every shell file carries its true type: `main.rs` tests pin each one);
//! - `Referrer-Policy: same-origin`: a listing or news link sends the deck's address nowhere, while our own requests
//!   keep the Origin and Referer that `pad::csrf_ok` reads (`no-referrer` would send `Origin: null` on a beacon POST);
//! - `X-Frame-Options: DENY`: no page frames the deck, the deck included (red team check, 2026-11-15), so no other port
//!   of this host can clickjack a two-tap action. A framer is never reported: the framed document never runs.
//!
//! A header a route already set is kept (the Almanac sends its own). The two shell pages (`/` and `/cre`) also carry
//! `PAGE_POLICY` in report-only mode: nothing is blocked, and the pages' `securitypolicyviolation` listener reports
//! what the policy would refuse to `/api/client-error`, which is the work left before it may ever be enforced.
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use std::sync::LazyLock;

/// The headers every answer carries.
pub const EVERY: [(&str, &str); 3] = [
    ("x-content-type-options", "nosniff"),
    ("referrer-policy", "same-origin"),
    ("x-frame-options", "DENY"),
];

/// The header the shell pages' policy rides in: report-only, never enforced this round.
pub const REPORT_ONLY: &str = "Content-Security-Policy-Report-Only";

/// The origins the page may frame: the surf cams on `youtube-nocookie.com`, then the published tailnet route of every app
/// in the catalog (`apps.rs`), in catalog order. Which of them actually allows framing is a live probe (`frame` in
/// `/api/apps`); the catalog is the fixed superset, so "Open here" never fills the report log, and an app whose own
/// headers forbid framing opens in a new tab instead (PRODUCT.md, Apps).
pub fn frame_sources() -> Vec<String> {
    let mut out = vec!["https://www.youtube-nocookie.com".to_string()];
    for a in crate::apps::PC {
        if let Some(p) = a.serve {
            let o = format!("https://{}:{p}", crate::apps::NODE);
            if !out.contains(&o) {
                out.push(o);
            }
        }
    }
    out
}

/// The shell pages' policy (PlanEng section 4). Inline styles stay (index.html's `<style>` and the geometry custom
/// properties in style attributes); hls.js plays from a `blob:` source and runs a `blob:` worker (`child-src` for older
/// WebKit); frames come from `frame_sources`; nothing may frame the deck.
pub static PAGE_POLICY: LazyLock<String> = LazyLock::new(|| {
    format!(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self' blob:; \
worker-src 'self' blob:; child-src 'self' blob:; frame-src {}; connect-src 'self'; font-src 'self'; manifest-src 'self'; \
object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        frame_sources().join(" ")
    )
});

/// The extra header pair for a shell page answer.
pub fn page_policy() -> (&'static str, String) {
    (REPORT_ONLY, PAGE_POLICY.clone())
}

/// Outermost layer: adds `EVERY` to an answer that does not already carry the header.
pub async fn layer(req: Request, next: Next) -> Response {
    let mut r = next.run(req).await;
    let h = r.headers_mut();
    for (k, v) in EVERY {
        let k = HeaderName::from_static(k);
        if !h.contains_key(&k) {
            h.insert(k, HeaderValue::from_static(v));
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_policy_is_report_only_and_keeps_what_the_pages_need() {
        let directives: Vec<&str> = PAGE_POLICY.split("; ").collect();
        for d in [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "media-src 'self' blob:",
            "worker-src 'self' blob:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
        ] {
            assert!(directives.contains(&d), "missing {d}: {}", *PAGE_POLICY);
        }
        // one line, no doubled spaces from the source's line breaks, never an inline script allowance
        assert!(!PAGE_POLICY.contains("  ") && !PAGE_POLICY.contains('\n'));
        assert!(!PAGE_POLICY.contains("unsafe-eval") && !directives.iter().any(|d| d.starts_with("script-src") && d.contains("unsafe-inline")));
        assert_eq!(page_policy().0, "Content-Security-Policy-Report-Only");
        assert!(HeaderValue::from_str(&PAGE_POLICY).is_ok());
        assert!(EVERY.contains(&("x-frame-options", "DENY")));
    }

    /// Every app the Apps list may offer in a panel is a frame source, so "Open here" never fills the report log;
    /// nothing else is: no wildcard, no `'self'` (nothing the deck serves needs the deck to frame it).
    #[test]
    fn frame_sources_are_the_surf_cams_and_the_catalog_routes_only() {
        let Some(frame_src) = PAGE_POLICY.split("; ").find_map(|d| d.strip_prefix("frame-src ")) else { panic!("no frame-src") };
        let listed: Vec<&str> = frame_src.split(' ').collect();
        assert_eq!(listed[0], "https://www.youtube-nocookie.com");
        let routed: Vec<_> = crate::apps::PC.iter().filter(|a| a.serve.is_some()).collect();
        assert!(routed.len() > 20, "catalog parse");
        for a in routed {
            let o = format!("https://pc-desktop.example.ts.net:{}", a.serve.unwrap_or(0));
            assert!(listed.contains(&o.as_str()), "{} ({o}) is not a frame source", a.id);
        }
        assert!(listed.iter().all(|s| s.starts_with("https://") && !s.contains('*')), "{frame_src}");
        assert!(!listed.contains(&"'self'"));
    }
}
