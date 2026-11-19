//! Trackpad WebSocket session: one socket bound to one input agent process. When the socket
//! closes or goes quiet the agent gets a release line, then EOF, then a grace period to exit on
//! its own (so a long `text` op can finish its key-up), then SIGTERM, and only then SIGKILL.
//! A dropped phone therefore never leaves a key or button held down.
//!
//! Session policy: at most one live session per target and `MAX_SESSIONS` overall. A new session
//! for a target closes the older one, so a phone that reconnects after a network drop wins
//! instead of being locked out by its own zombie.
use crate::pad::{agent_argv, is_queued, parse, Cmd, HoldGuard, KeyQueue, Limiter, HOLD_MAX_SECS, KEY_GAP_MS};
use axum::extract::ws::{Message, WebSocket};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

const READY_SECS: u64 = 12;
const QUIET_SECS: u64 = 45;
const MAX_PER_SEC: u32 = 240;
/// A write to the agent's stdin that takes longer than this means the agent stopped reading.
const WRITE_SECS: u64 = 2;
/// A frame to the phone that is not taken within this long means the phone stopped reading: the session ends and its keys are released.
const SEND_SECS: u64 = 2;
/// After EOF the agent gets this long to release held keys and exit by itself.
const EOF_GRACE_SECS: u64 = 2;
/// After SIGTERM it gets this long before SIGKILL.
const TERM_GRACE_SECS: u64 = 1;
pub const MAX_SESSIONS: usize = 3;

#[derive(Debug, PartialEq, Eq)]
pub enum WriteErr {
    Closed,
    Timeout,
}

/// Write one line to the agent, bounded in time so a stalled agent cannot freeze the session loop.
pub async fn write_line<W: AsyncWrite + Unpin>(
    w: &mut W,
    line: &[u8],
    limit: Duration,
) -> Result<(), WriteErr> {
    match tokio::time::timeout(limit, w.write_all(line)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err(WriteErr::Closed),
        Err(_) => Err(WriteErr::Timeout),
    }
}

/// Orderly agent shutdown: release line, EOF, wait `eof`, SIGTERM, wait `term`, SIGKILL.
pub async fn end_agent(
    child: &mut tokio::process::Child,
    mut stdin: tokio::process::ChildStdin,
    eof: Duration,
    term: Duration,
) -> ExitStatus {
    let _ = write_line(
        &mut stdin,
        b"{\"op\":\"release\"}\n",
        Duration::from_millis(500),
    )
    .await;
    drop(stdin);
    if let Ok(Ok(st)) = tokio::time::timeout(eof, child.wait()).await {
        return st;
    }
    if let Some(pid) = child.id().and_then(|p| i32::try_from(p).ok()) {
        // SAFETY: plain kill(2) on the pid of our own, still unreaped child.
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
        if let Ok(Ok(st)) = tokio::time::timeout(term, child.wait()).await {
            return st;
        }
    }
    let _ = child.start_kill();
    match child.wait().await {
        Ok(st) => st,
        Err(_) => std::os::unix::process::ExitStatusExt::from_raw(9),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Reject {
    TooMany,
    Closing,
}

struct Inner {
    next: u64,
    active: HashMap<String, (u64, oneshot::Sender<()>)>,
    live: usize,
    closing: bool,
}

/// Live pad sessions. Holds a slot per target; the ticket frees it on drop.
pub struct Registry {
    max: usize,
    inner: Mutex<Inner>,
}

pub struct Ticket {
    reg: Arc<Registry>,
    target: String,
    id: u64,
    /// Fires when a newer session for the same target, or shutdown, wants this one closed.
    pub evicted: oneshot::Receiver<()>,
}

impl Registry {
    pub fn new(max: usize) -> Arc<Self> {
        Arc::new(Self {
            max,
            inner: Mutex::new(Inner {
                next: 0,
                active: HashMap::new(),
                live: 0,
                closing: false,
            }),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn active(&self) -> usize {
        self.lock().active.len()
    }

    pub fn acquire(self: &Arc<Self>, target: &str) -> Result<Ticket, Reject> {
        let mut g = self.lock();
        if g.closing {
            return Err(Reject::Closing);
        }
        if !g.active.contains_key(target) && g.active.len() >= self.max {
            return Err(Reject::TooMany);
        }
        g.next += 1;
        let id = g.next;
        let (tx, rx) = oneshot::channel();
        if let Some((_, old)) = g.active.insert(target.to_string(), (id, tx)) {
            let _ = old.send(());
        }
        g.live += 1;
        Ok(Ticket {
            reg: self.clone(),
            target: target.to_string(),
            id,
            evicted: rx,
        })
    }

    /// Refuse new sessions, ask every live one to close, wait up to `limit` for their cleanup.
    /// True when every session finished (agents released and reaped) in time.
    pub async fn shutdown(&self, limit: Duration) -> bool {
        {
            let mut g = self.lock();
            g.closing = true;
            for (_, (_, tx)) in g.active.drain() {
                let _ = tx.send(());
            }
        }
        let deadline = Instant::now() + limit;
        loop {
            if self.lock().live == 0 {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        let mut g = self.reg.lock();
        g.live = g.live.saturating_sub(1);
        if g.active
            .get(&self.target)
            .is_some_and(|(id, _)| *id == self.id)
        {
            g.active.remove(&self.target);
        }
    }
}

pub fn registry() -> Arc<Registry> {
    static R: OnceLock<Arc<Registry>> = OnceLock::new();
    R.get_or_init(|| Registry::new(MAX_SESSIONS)).clone()
}

fn msg(v: Value) -> Message {
    Message::Text(v.to_string().into())
}

/// Label the agent's first line for the phone. Anything without `ready` is fatal.
pub fn hello(first: Option<&str>, target: &str) -> (Value, bool) {
    let mut v = match first {
        Some(l) => {
            serde_json::from_str::<Value>(l).unwrap_or(json!({"error":"agent said nothing"}))
        }
        None => json!({"error": format!("{target} agent exited")}),
    };
    let ok = v.get("ready").and_then(Value::as_bool) == Some(true);
    if !v.is_object() {
        v = json!({"error":"agent said nothing"});
    }
    if let Some(o) = v.as_object_mut() {
        o.insert("target".into(), json!(target));
    }
    (v, ok)
}

/// What the session needs from the phone's socket. The real one is axum's WebSocket; the tests use sockets that never read.
trait WsIo {
    fn recv(&mut self) -> impl Future<Output = Option<Result<Message, axum::Error>>> + Send;
    fn send(&mut self, m: Message) -> impl Future<Output = bool> + Send;
}

impl WsIo for WebSocket {
    async fn recv(&mut self) -> Option<Result<Message, axum::Error>> {
        WebSocket::recv(self).await
    }
    async fn send(&mut self, m: Message) -> bool {
        WebSocket::send(self, m).await.is_ok()
    }
}

/// One frame to the phone, bounded in time like `write_line` is for the agent. A phone that sends and never reads fills its TCP window;
/// an unbounded send would then park the whole session loop, and with it the quiet timeout and the held-key cap, so the held key
/// would stay down. False means the phone did not take the frame in time (or is gone): the caller ends the session.
async fn send_bounded<W: WsIo>(ws: &mut W, v: Value, limit: Duration) -> bool {
    tokio::time::timeout(limit, ws.send(msg(v))).await.unwrap_or(false)
}

/// Time limits of one session (the tests shorten them).
struct Cfg {
    send: Duration,
    write: Duration,
    quiet_secs: u64,
    hold_cap: Duration,
    tick: Duration,
    key_gap: Duration,
}

impl Cfg {
    fn live() -> Self {
        Self {
            send: Duration::from_secs(SEND_SECS),
            write: Duration::from_secs(WRITE_SECS),
            quiet_secs: QUIET_SECS,
            hold_cap: Duration::from_secs(HOLD_MAX_SECS),
            tick: Duration::from_secs(1),
            key_gap: Duration::from_millis(KEY_GAP_MS),
        }
    }
}

pub async fn session(mut ws: WebSocket, target: String, uid: u32) {
    let mut ticket = match registry().acquire(&target) {
        Ok(t) => t,
        Err(_) => {
            let _ = ws.send(msg(json!({"error":"too many sessions"}))).await;
            return;
        }
    };
    let Some(argv) = agent_argv(&target) else {
        let _ = ws.send(msg(json!({"error":"bad target"}))).await;
        return;
    };
    let mut cmd = tokio::process::Command::new(&argv[0]);
    cmd.args(&argv[1..])
        .env("XDG_RUNTIME_DIR", format!("/run/user/{uid}"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => {
            let _ = ws.send(msg(json!({"error":"agent failed to start"}))).await;
            return;
        }
    };
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = ws.send(msg(json!({"error":"agent pipes"}))).await;
        return;
    };
    let mut lines = BufReader::new(stdout).lines();
    let (hi, ok) = match tokio::time::timeout(Duration::from_secs(READY_SECS), lines.next_line())
        .await
    {
        Ok(Ok(l)) => hello(l.as_deref(), &target),
        Ok(Err(_)) => hello(None, &target),
        Err(_) => (
            json!({"error": format!("{target} did not answer in {READY_SECS} s"), "target": target}),
            false,
        ),
    };
    if !send_bounded(&mut ws, hi, Duration::from_secs(SEND_SECS)).await || !ok {
        let _ = child.kill().await;
        return;
    }
    if ticket.evicted.try_recv().is_ok() {
        // replaced while the agent was starting
        end_agent(
            &mut child,
            stdin,
            Duration::from_secs(EOF_GRACE_SECS),
            Duration::from_secs(TERM_GRACE_SECS),
        )
        .await;
        return;
    }
    crate::util::log(
        "info",
        "pad session open",
        &[
            ("target", target.clone()),
            ("active", registry().active().to_string()),
        ],
    );
    run_session(&mut ws, &mut ticket.evicted, &mut stdin, &mut lines, &target, &Cfg::live()).await;
    end_agent(
        &mut child,
        stdin,
        Duration::from_secs(EOF_GRACE_SECS),
        Duration::from_secs(TERM_GRACE_SECS),
    )
    .await;
    crate::util::log("info", "pad session closed", &[("target", target)]);
    drop(ticket);
}

/// One op to the agent. False ends the session: the agent is gone or stalled (the phone is told if it can be).
async fn to_agent<W: WsIo>(
    ws: &mut W,
    stdin: &mut tokio::process::ChildStdin,
    c: &Cmd,
    hold: &mut HoldGuard,
    cfg: &Cfg,
) -> bool {
    hold.observe(c, Instant::now());
    let mut l = c.line();
    l.push('\n');
    match write_line(stdin, l.as_bytes(), cfg.write).await {
        Ok(()) => true,
        Err(WriteErr::Closed) => {
            let _ = send_bounded(ws, json!({"error":"agent gone"}), cfg.send).await;
            false
        }
        Err(WriteErr::Timeout) => {
            let _ = send_bounded(ws, json!({"error":"agent stalled"}), cfg.send).await;
            false
        }
    }
}

/// The live part of a session: phone frames to the agent, agent lines to the phone, the quiet timeout and the held-key cap. Every wait
/// in it is bounded (agent writes by `cfg.write`, phone sends by `cfg.send`), so a stalled peer ends the session instead of freezing it;
/// the caller then releases everything through `end_agent`.
///
/// Key taps and typed text do not hit the agent when they arrive: they join one ordered `KeyQueue` and leave it one at a time, at most
/// 29 a second, so a burst after a network stall is typed in order, only slower, and nothing is dropped or resent. Everything else
/// (moves, clicks, holds, releases) goes straight through; the queue never delays a release, a hold-up or the held-key cap.
async fn run_session<W: WsIo>(
    ws: &mut W,
    evicted: &mut oneshot::Receiver<()>,
    stdin: &mut tokio::process::ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    target: &str,
    cfg: &Cfg,
) {
    let mut lim = Limiter::new(MAX_PER_SEC);
    let mut hold = HoldGuard::with_cap(cfg.hold_cap);
    let mut keyq = KeyQueue::new(cfg.key_gap);
    let mut tick = tokio::time::interval(cfg.tick);
    let mut note = tokio::time::interval(Duration::from_millis(100));
    let mut drain = tokio::time::interval(Duration::from_millis(5));
    let mut last_rx = Instant::now();
    loop {
        tokio::select! {
            _ = &mut *evicted => {
                let _ = send_bounded(ws, json!({"error":"session replaced"}), cfg.send).await;
                break;
            }
            m = ws.recv() => {
                let Some(Ok(m)) = m else { break };
                last_rx = Instant::now();
                let txt = match m {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                match parse(&txt) {
                    Ok(c) if is_queued(&c) => {
                        keyq.push(c);
                        // the first tap after a quiet moment goes out at once
                        if let Some(c) = keyq.pop_ready(Instant::now()) {
                            if !to_agent(ws, stdin, &c, &mut hold, cfg).await { break; }
                        }
                    }
                    Ok(c) => {
                        // release, button-up and hold-up always pass; the rest share the session cap
                        if matches!(c, Cmd::Release) {
                            keyq.clear(); // "let go of everything" also means: stop typing what was waiting
                        }
                        if !lim.allow_cmd(&c, Instant::now()) {
                            continue;
                        }
                        if !to_agent(ws, stdin, &c, &mut hold, cfg).await { break; }
                    }
                    Err(e) => {
                        if lim.allow(Instant::now()) && !send_bounded(ws, json!({"reject": e}), cfg.send).await {
                            break;
                        }
                    }
                }
            }
            _ = drain.tick(), if !keyq.is_empty() => {
                if let Some(c) = keyq.pop_ready(Instant::now()) {
                    if !to_agent(ws, stdin, &c, &mut hold, cfg).await { break; }
                }
            }
            l = lines.next_line() => {
                match l {
                    Ok(Some(l)) => {
                        if let Ok(v) = serde_json::from_str::<Value>(&l) {
                            if !send_bounded(ws, v, cfg.send).await { break; }
                        }
                    }
                    _ => {
                        let _ = send_bounded(ws, json!({"error": format!("{target} agent exited")}), cfg.send).await;
                        break;
                    }
                }
            }
            _ = note.tick() => {
                if let Some(f) = keyq.lost_note(Instant::now()) {
                    if !send_bounded(ws, f, cfg.send).await { break; }
                }
            }
            _ = tick.tick() => {
                if last_rx.elapsed().as_secs() > cfg.quiet_secs { break; }
                // a held key never outlives the server's own cap, even when the page stopped sending
                if hold.expired(Instant::now()) {
                    let mut l = Cmd::Hold("ralt".into(), false).line();
                    l.push('\n');
                    if write_line(stdin, l.as_bytes(), cfg.write).await.is_err() { break; }
                    crate::util::log("info", "pad held key released by the server cap", &[("target", target.to_string())]);
                }
            }
        }
    }
    keyq.clear(); // whatever was still waiting is never typed once the session is over
}

#[cfg(test)]
#[allow(clippy::expect_used)] // tests spawn real processes; a panic is the failure signal
mod tests {
    use super::*;

    #[test]
    fn hello_marks_ready_and_target() {
        let (v, ok) = hello(Some(r#"{"ready":true,"os":"macos"}"#), "mini");
        assert!(ok && v["target"] == "mini" && v["os"] == "macos");
        let (v, ok) = hello(
            Some(r#"{"error":"ydotoold socket unavailable","fatal":true}"#),
            "Dell",
        );
        assert!(!ok && v["target"] == "Dell" && v["error"] == "ydotoold socket unavailable");
        let (v, ok) = hello(None, "mini");
        assert!(!ok && v["error"] == "mini agent exited");
        let (v, ok) = hello(Some("garbage"), "mini");
        assert!(!ok && v["error"] == "agent said nothing");
        let (_, ok) = hello(Some("[1]"), "mini");
        assert!(!ok);
    }

    // ---- shutdown, write bound, session registry (written before the implementation) ----

    fn sh(script: &str) -> tokio::process::Command {
        let mut c = tokio::process::Command::new("/bin/sh");
        c.args(["-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        c
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let d = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".into());
        std::path::Path::new(&d).join(format!("pdeck-{name}-{}", std::process::id()))
    }

    #[tokio::test]
    async fn end_agent_sends_release_and_eof_and_lets_agent_exit_cleanly() {
        use std::os::unix::process::ExitStatusExt;
        let out = scratch("eof");
        let _ = std::fs::remove_file(&out);
        // agent: log every stdin line, exit 0 on EOF after a short "release" cleanup
        let script = format!(
            "while read l; do echo \"$l\" >> {}; sleep 0.3; done; exit 0",
            out.display()
        );
        let mut child = sh(&script).spawn().expect("spawn");
        let stdin = child.stdin.take().expect("stdin");
        let t0 = Instant::now();
        // the EOF grace is 20 s, so a prompt return is an order: end_agent came back when the agent exited (0.3 s), long before the
        // grace ran out. Waiting out the grace, or a fixed sleep of it, reads 20 s and fails.
        let st = end_agent(
            &mut child,
            stdin,
            Duration::from_secs(20),
            Duration::from_secs(1),
        )
        .await;
        assert!(t0.elapsed() < Duration::from_secs(10), "end_agent waited out the grace: {:?}", t0.elapsed());
        assert_eq!(
            st.code(),
            Some(0),
            "agent must exit on its own, not be killed: {st:?}"
        );
        assert_eq!(st.signal(), None);
        let got = std::fs::read_to_string(&out).unwrap_or_default();
        let _ = std::fs::remove_file(&out);
        assert_eq!(got.trim(), r#"{"op":"release"}"#);
    }

    #[tokio::test]
    async fn end_agent_waits_for_slow_release_before_any_signal() {
        use std::os::unix::process::ExitStatusExt;
        // cleanup takes 1.2 s: longer than the old 800 ms grace, shorter than the 2 s grace
        let mut child = sh("read l; sleep 1.2; exit 0").spawn().expect("spawn");
        let stdin = child.stdin.take().expect("stdin");
        let st = end_agent(
            &mut child,
            stdin,
            Duration::from_secs(2),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(st.code(), Some(0), "was signalled too early: {st:?}");
        assert_eq!(st.signal(), None);
    }

    #[tokio::test]
    async fn end_agent_sends_sigterm_before_sigkill() {
        use std::os::unix::process::ExitStatusExt;
        // never reads stdin, exits on SIGTERM
        let mut child = sh("exec sleep 30").spawn().expect("spawn");
        let stdin = child.stdin.take().expect("stdin");
        let st = end_agent(
            &mut child,
            stdin,
            Duration::from_millis(200),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(st.signal(), Some(15), "expected SIGTERM, got {st:?}");
    }

    #[tokio::test]
    async fn end_agent_kills_when_term_is_ignored() {
        use std::os::unix::process::ExitStatusExt;
        let mut child = sh("trap '' TERM; while :; do sleep 0.05; done")
            .spawn()
            .expect("spawn");
        let stdin = child.stdin.take().expect("stdin");
        let t0 = Instant::now();
        let st = end_agent(
            &mut child,
            stdin,
            Duration::from_millis(200),
            Duration::from_millis(300),
        )
        .await;
        assert_eq!(st.signal(), Some(9), "expected SIGKILL, got {st:?}");
        // a generous bound (5 times the old 2 s): the signals go to a real child, so no fake clock fits. It still catches graces that
        // are not applied, such as a default of seconds used where the caller gave 0.2 s and 0.3 s.
        assert!(t0.elapsed() < Duration::from_secs(10), "took {:?}", t0.elapsed());
    }

    #[tokio::test]
    async fn write_line_times_out_on_a_stalled_reader() {
        // 8 byte pipe, nobody reads: write_all can never finish
        let (mut w, _r) = tokio::io::duplex(8);
        let t0 = Instant::now();
        let r = write_line(&mut w, &[b'x'; 200], Duration::from_millis(150)).await;
        assert_eq!(r, Err(WriteErr::Timeout));
        // a generous bound (5 times the old 1 s): tokio's paused clock needs its test-util feature, which this crate does not build.
        // The timeout is the outcome above; this catches a limit far longer than the 150 ms the caller gave.
        assert!(t0.elapsed() < Duration::from_secs(5), "took {:?}", t0.elapsed());
    }

    #[tokio::test]
    async fn write_line_reports_closed_pipe_and_success() {
        let (mut w, r) = tokio::io::duplex(1024);
        assert_eq!(
            write_line(&mut w, b"hi\n", Duration::from_secs(1)).await,
            Ok(())
        );
        drop(r);
        assert_eq!(
            write_line(&mut w, b"hi\n", Duration::from_secs(1)).await,
            Err(WriteErr::Closed)
        );
    }

    #[tokio::test]
    async fn registry_one_session_per_target_newer_wins() {
        let reg = Registry::new(3);
        let mut a1 = reg.acquire("mini").expect("a1");
        let _b = reg.acquire("Dell").expect("b");
        let a2 = reg.acquire("mini").expect("newer mini must win");
        assert!(
            a1.evicted.try_recv().is_ok(),
            "older session must be told to close"
        );
        assert_eq!(reg.active(), 2);
        // old ticket dropping later must not remove the newer entry
        drop(a1);
        assert_eq!(reg.active(), 2);
        drop(a2);
        assert_eq!(reg.active(), 1);
    }

    #[tokio::test]
    async fn registry_caps_total_sessions() {
        let reg = Registry::new(3);
        let _a = reg.acquire("t1").expect("t1");
        let _b = reg.acquire("t2").expect("t2");
        let _c = reg.acquire("t3").expect("t3");
        assert!(matches!(reg.acquire("t4"), Err(Reject::TooMany)));
        // replacing an existing target is not a new slot
        assert!(reg.acquire("t2").is_ok());
    }

    #[tokio::test]
    async fn registry_shutdown_evicts_and_waits_for_cleanup() {
        let reg = Registry::new(3);
        let mut t = reg.acquire("mini").expect("t");
        let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let d2 = done.clone();
        tokio::spawn(async move {
            let _ = (&mut t.evicted).await;
            tokio::time::sleep(Duration::from_millis(200)).await; // release + agent exit
            d2.store(true, std::sync::atomic::Ordering::SeqCst);
            drop(t);
        });
        assert!(
            reg.shutdown(Duration::from_secs(2)).await,
            "cleanup should finish in time"
        );
        assert!(done.load(std::sync::atomic::Ordering::SeqCst));
        assert!(matches!(reg.acquire("mini"), Err(Reject::Closing)));
    }

    #[tokio::test]
    async fn registry_shutdown_gives_up_after_the_deadline() {
        let reg = Registry::new(3);
        let _t = reg.acquire("mini").expect("t"); // never released
        assert!(!reg.shutdown(Duration::from_millis(150)).await);
    }

    // ---- a phone that sends and never reads must not park the session (and keep Right Alt down) ----

    /// A phone socket fed from a channel whose sends never complete: a client that fills its TCP window and stops reading.
    struct NonReader {
        rx: tokio::sync::mpsc::Receiver<String>,
    }
    impl WsIo for NonReader {
        async fn recv(&mut self) -> Option<Result<Message, axum::Error>> {
            self.rx.recv().await.map(|t| Ok(Message::Text(t.into())))
        }
        async fn send(&mut self, _m: Message) -> bool {
            std::future::pending::<bool>().await
        }
    }

    /// A phone socket that reads everything and records what it was sent.
    struct Recorder {
        rx: tokio::sync::mpsc::Receiver<String>,
        got: Arc<Mutex<Vec<Value>>>,
    }
    impl WsIo for Recorder {
        async fn recv(&mut self) -> Option<Result<Message, axum::Error>> {
            self.rx.recv().await.map(|t| Ok(Message::Text(t.into())))
        }
        async fn send(&mut self, m: Message) -> bool {
            if let Message::Text(t) = m {
                if let Ok(v) = serde_json::from_str::<Value>(t.as_str()) {
                    self.got.lock().unwrap_or_else(|p| p.into_inner()).push(v);
                }
            }
            true
        }
    }

    /// An agent that logs every line it is given and exits on EOF, like the real ones.
    fn logging_agent(log: &std::path::Path) -> tokio::process::Child {
        let mut c = tokio::process::Command::new("/bin/sh");
        c.args(["-c", &format!("while read l; do echo \"$l\" >> {}; done; exit 0", log.display())])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        c.spawn().expect("spawn agent")
    }

    fn cfg(key_gap_ms: u64, hold_cap_ms: u64) -> Cfg {
        Cfg {
            send: Duration::from_millis(200),
            write: Duration::from_secs(1),
            quiet_secs: 45,
            hold_cap: Duration::from_millis(hold_cap_ms),
            tick: Duration::from_millis(50),
            key_gap: Duration::from_millis(key_gap_ms),
        }
    }

    /// An agent, its pipes and a session ticket, plus the log file the agent appends to.
    struct Rig {
        child: tokio::process::Child,
        stdin: tokio::process::ChildStdin,
        lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
        ticket: Ticket,
        log: std::path::PathBuf,
    }

    fn rig(name: &str) -> Rig {
        let log = scratch(name);
        let _ = std::fs::remove_file(&log);
        let mut child = logging_agent(&log);
        let stdin = child.stdin.take().expect("stdin");
        let lines = BufReader::new(child.stdout.take().expect("stdout")).lines();
        let ticket = Registry::new(3).acquire("mini").expect("ticket");
        Rig { child, stdin, lines, ticket, log }
    }

    impl Rig {
        async fn run<W: WsIo>(&mut self, ws: &mut W, cfg: &Cfg) {
            run_session(ws, &mut self.ticket.evicted, &mut self.stdin, &mut self.lines, "mini", cfg).await;
        }
        /// The session is over: the caller's cleanup runs, then everything the agent was ever given, parsed.
        async fn finish(self) -> Vec<Value> {
            let Rig { mut child, stdin, log, .. } = self;
            end_agent(&mut child, stdin, Duration::from_secs(2), Duration::from_secs(1)).await;
            let got = read_log(&log);
            let _ = std::fs::remove_file(&log);
            got
        }
    }

    /// Every line the agent has logged so far, parsed (a line it is still writing is skipped).
    fn read_log(log: &std::path::Path) -> Vec<Value> {
        let got = std::fs::read_to_string(log).unwrap_or_default();
        got.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
    }

    /// How long a test waits for the key queue to drain before it calls the drain hung. Far above a healthy drain (2 s at most here),
    /// so only a real hang reaches it (the session's own quiet timeout, 45 s in `cfg`, may end a hung session first; the count fails either way).
    const DRAIN_LIMIT: Duration = Duration::from_secs(60);

    /// The phone goes away once the agent has been given `n` keys and texts, however long the queue takes to drain on a busy machine.
    /// At `limit` it goes away anyway, so a hung drain still ends the session and fails the test's count.
    async fn hang_up_once_typed(tx: tokio::sync::mpsc::Sender<String>, log: std::path::PathBuf, n: usize, limit: Duration) {
        let t0 = Instant::now();
        while typed(&read_log(&log)).len() < n && t0.elapsed() < limit {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        drop(tx);
    }

    fn key(k: &str) -> String {
        format!(r#"{{"op":"key","k":"{k}","mods":[]}}"#)
    }
    fn text(s: &str) -> String {
        format!(r#"{{"op":"text","s":"{s}"}}"#)
    }
    /// "key:a" or "text:hi" for the key and text lines an agent log holds, in order.
    fn typed(log: &[Value]) -> Vec<String> {
        log.iter()
            .filter_map(|v| match v["op"].as_str() {
                Some("key") => Some(format!("key:{}", v["k"].as_str().unwrap_or(""))),
                Some("text") => Some(format!("text:{}", v["s"].as_str().unwrap_or(""))),
                _ => None,
            })
            .collect()
    }
    const HOLD_DOWN: &str = r#"{"op":"hold","k":"ralt","down":true}"#;
    fn is_hold_up(v: &Value) -> bool {
        v["op"] == "hold" && v["down"] == false
    }

    #[tokio::test]
    async fn a_phone_that_floods_and_stops_reading_ends_the_session_and_the_held_key_is_released() {
        let mut r = rig("nonreader");
        let (tx, rx) = tokio::sync::mpsc::channel::<String>(1024);
        let mut ws = NonReader { rx };
        // Right Alt goes down, then 300 key taps arrive in one burst: 256 wait in the queue, 44 do not fit and the phone is to be told
        tx.send(HOLD_DOWN.into()).await.expect("send hold");
        for _ in 0..300 {
            tx.send(key("a")).await.expect("send key");
        }
        // the loop must give up by itself: the unbounded send of the note parked it forever (no quiet timeout, no 120 s cap, key still down).
        // An order, not a clock: it must end by its own 200 ms send bound before 30 s, ahead of every other way out (the 45 s quiet
        // timeout and the 60 s hold cap in `cfg`).
        let done = tokio::time::timeout(Duration::from_secs(30), r.run(&mut ws, &cfg(34, 60_000))).await;
        assert!(done.is_ok(), "run_session stayed parked on a send to a phone that does not read");
        let log = r.finish().await;
        assert!(log.iter().any(|v| v["op"] == "hold" && v["down"] == true), "hold down reached the agent: {log:?}");
        assert_eq!(log.last().map(|v| v["op"].clone()), Some(json!("release")), "the last thing the agent heard is the release: {log:?}");
        let n = typed(&log).len();
        assert!((1..30).contains(&n), "only a few taps went out before the stall, the rest were never typed: {n}");
        drop(tx);
    }

    #[tokio::test]
    async fn a_reject_reply_to_a_phone_that_does_not_read_also_ends_the_session() {
        let mut r = rig("nonreader2");
        let (tx, rx) = tokio::sync::mpsc::channel::<String>(8);
        let mut ws = NonReader { rx };
        tx.send(r#"{"op":"nope"}"#.into()).await.expect("send junk");
        let done = tokio::time::timeout(Duration::from_secs(30), r.run(&mut ws, &cfg(34, 60_000))).await; // before the 45 s quiet timeout
        assert!(done.is_ok());
        let _ = r.finish().await;
        drop(tx);
    }

    #[tokio::test]
    async fn keys_and_text_keep_their_order_through_a_stall_and_a_burst() {
        let mut r = rig("order");
        let (tx, rx) = tokio::sync::mpsc::channel::<String>(1024);
        let got = Arc::new(Mutex::new(Vec::new()));
        let mut ws = Recorder { rx, got: got.clone() };
        // 150 ops: letters, digits and typed text mixed; the network stalls after 50 of them and the other 100 arrive in one burst
        let ops: Vec<(String, String)> = (0..150)
            .map(|i| if i % 9 == 4 { (text(&format!("t{i}")), format!("text:t{i}")) } else { let k = char::from(if i % 2 == 0 { b'a' + (i % 26) as u8 } else { b'0' + (i % 10) as u8 }).to_string(); (key(&k), format!("key:{k}")) })
            .collect();
        let want: Vec<String> = ops.iter().map(|(_, w)| w.clone()).collect();
        let log = r.log.clone();
        let feeder = tokio::spawn(async move {
            for (frame, _) in &ops[..50] {
                tx.send(frame.clone()).await.expect("send");
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            tokio::time::sleep(Duration::from_millis(700)).await; // the stall
            for (frame, _) in &ops[50..] {
                tx.send(frame.clone()).await.expect("send"); // the burst
            }
            hang_up_once_typed(tx, log, 150, DRAIN_LIMIT).await; // the phone stays until the ordered queue has drained
        });
        r.run(&mut ws, &cfg(5, 60_000)).await;
        feeder.abort(); // already done unless the session ended on its own
        let log = r.finish().await;
        assert_eq!(typed(&log), want, "every key and text reached the agent, once, in the order they were sent");
        let frames = got.lock().unwrap_or_else(|p| p.into_inner()).clone();
        assert!(frames.iter().all(|f| f.get("lost").is_none() && f.get("dropped").is_none()), "nothing was dropped or lost: {frames:?}");
    }

    #[tokio::test]
    async fn a_burst_beyond_the_queue_reports_how_many_were_turned_away() {
        let mut r = rig("overflow");
        let (tx, rx) = tokio::sync::mpsc::channel::<String>(1024);
        let got = Arc::new(Mutex::new(Vec::new()));
        let mut ws = Recorder { rx, got: got.clone() };
        for _ in 0..300 {
            tx.send(key("a")).await.expect("send key");
        }
        let feeder = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            drop(tx);
        });
        r.run(&mut ws, &cfg(50, 60_000)).await;
        let _ = feeder.await;
        let log = r.finish().await;
        let frames: Vec<Value> = got.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let lost: u64 = frames.iter().filter_map(|f| f["lost"].as_u64()).sum();
        // one tap leaves at once, a few more by the end of the 400 ms, 256 wait, the rest did not fit
        let typed_n = typed(&log).len() as u64;
        assert!((1..=10).contains(&typed_n), "typed {typed_n}");
        assert!((30..=44).contains(&lost), "lost {lost}");
        assert!(frames.len() <= 3, "told in a few frames, not one per tap: {frames:?}");
        assert!(frames.iter().all(|f| f.get("dropped").is_none()), "no resend protocol any more");
    }

    #[tokio::test]
    async fn the_held_key_cap_still_fires_while_the_key_queue_drains() {
        let mut r = rig("holdcap");
        let (tx, rx) = tokio::sync::mpsc::channel::<String>(1024);
        let got = Arc::new(Mutex::new(Vec::new()));
        let mut ws = Recorder { rx, got };
        tx.send(HOLD_DOWN.into()).await.expect("send hold");
        for _ in 0..60 {
            tx.send(key("a")).await.expect("send key"); // 60 x 30 ms = 1.8 s of draining
        }
        let feeder = tokio::spawn(hang_up_once_typed(tx, r.log.clone(), 60, DRAIN_LIMIT)); // the phone stays until all 60 are typed
        r.run(&mut ws, &cfg(30, 500)).await; // the cap is 500 ms: it must fire in the middle of the drain
        feeder.abort(); // already done unless the session ended on its own
        let log = r.finish().await;
        let up = log.iter().position(is_hold_up).expect("the server let Right Alt go by itself");
        let last_key = log.iter().rposition(|v| v["op"] == "key").expect("keys were typed");
        assert!(up < last_key, "the cap fired while keys were still draining (up at {up}, last key at {last_key})");
        assert_eq!(typed(&log).len(), 60, "and the queue kept draining after it");
    }

    #[tokio::test]
    async fn a_disconnect_while_the_queue_drains_releases_the_key_and_types_nothing_more() {
        let mut r = rig("disconnect");
        let (tx, rx) = tokio::sync::mpsc::channel::<String>(1024);
        let got = Arc::new(Mutex::new(Vec::new()));
        let mut ws = Recorder { rx, got };
        tx.send(HOLD_DOWN.into()).await.expect("send hold");
        for _ in 0..100 {
            tx.send(key("b")).await.expect("send key"); // 100 x 250 ms = 25 s to drain
        }
        // the phone goes away mid-drain, once two taps have reached the agent (an event, not a clock)
        let feeder = tokio::spawn(hang_up_once_typed(tx, r.log.clone(), 2, DRAIN_LIMIT));
        r.run(&mut ws, &cfg(250, 60_000)).await;
        let _ = feeder.await;
        let log = r.finish().await;
        assert_eq!(log.last().map(|v| v["op"].clone()), Some(json!("release")), "release is the last thing the agent heard: {log:?}");
        let n = typed(&log).len();
        // the order: the session ended with the phone, not after the queue (all 100). Up to 10 more taps leave 2.5 s of slack for a busy machine.
        assert!((2..=12).contains(&n), "only the few taps that had left before the phone went; the buffer was thrown away: {n}");
        // and nothing else came after the release line
        let rel = log.iter().position(|v| v["op"] == "release").unwrap_or(0);
        assert!(log[rel..].iter().all(|v| v["op"] == "release"), "no key after the release: {log:?}");
    }

    #[tokio::test]
    async fn a_release_op_also_stops_the_typing_that_was_waiting() {
        let mut r = rig("release");
        let (tx, rx) = tokio::sync::mpsc::channel::<String>(1024);
        let got = Arc::new(Mutex::new(Vec::new()));
        let mut ws = Recorder { rx, got };
        tx.send(HOLD_DOWN.into()).await.expect("send hold");
        for _ in 0..50 {
            tx.send(key("c")).await.expect("send key");
        }
        tx.send(r#"{"op":"release"}"#.into()).await.expect("send release");
        let feeder = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            drop(tx);
        });
        r.run(&mut ws, &cfg(50, 60_000)).await;
        let _ = feeder.await;
        let log = r.finish().await;
        let n = typed(&log).len();
        assert!(n <= 3, "the waiting taps were cleared by the release, not typed: {n}");
        let rel = log.iter().position(|v| v["op"] == "release").unwrap_or(0);
        assert!(log[rel..].iter().all(|v| v["op"] == "release"), "nothing typed after the release: {log:?}");
    }
}
