//! Browser-wallet signing bridge.
//!
//! Lets the user approve payment transactions with a browser-extension wallet
//! (MetaMask, Rabby, …) running in their *system default browser* — extensions
//! cannot run inside the Tauri webview, so the approval UI has to live where
//! the extension lives.
//!
//! Topology (Truffle-Dashboard style):
//!
//! ```text
//!   webview (wagmi connector)          this module                 default browser
//!   ─ invoke bridge_request ──▶  queue ─ GET /signer/requests ──▶  page forwards to
//!   ◀─ command return ────────  oneshot ◀─ POST /signer/response ─  window.ethereum
//! ```
//!
//! The webview side talks to this module over Tauri IPC only (no HTTP, no
//! CORS surface). The browser side talks HTTP to a loopback listener that
//! serves the signing page and two relay endpoints.
//!
//! Security posture (see the feature ticket for the full checklist):
//! * listener binds `127.0.0.1` only, on a stable port so the wallet's
//!   per-origin "connected site" approval survives across sessions;
//! * every `/signer/*` call must present the per-session bearer token, which
//!   travels to the page in the URL *fragment* (never sent over the wire in
//!   the navigation request, never logged, no Referer leakage);
//! * token comparison is constant-time;
//! * the `Host` header must match the bound address exactly (DNS-rebinding
//!   defense) and state-changing POSTs must carry the loopback `Origin`;
//! * no CORS headers are ever emitted — cross-origin pages get opaque
//!   failures;
//! * responses relayed from the page are treated as untrusted input: the
//!   existing finalize path validates tx hashes, and nothing secret ever
//!   crosses the bridge (quotes and hashes are public chain data).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tokio::sync::{oneshot, watch, Mutex, Notify};

/// First port tried for the loopback listener. Stable (rather than ephemeral)
/// so the page origin `http://127.0.0.1:17423` stays the same across sessions
/// and the wallet's per-site connection approval sticks. Falls forward up to
/// [`PORT_ATTEMPTS`] ports if occupied.
const DEFAULT_PORT: u16 = 17423;
const PORT_ATTEMPTS: u16 = 10;

/// How long a signer long-poll parks before returning 204 (the page
/// immediately re-polls; this is also the liveness heartbeat).
const SIGNER_POLL_PARK: Duration = Duration::from_secs(25);

/// The page is considered connected if it polled within this window.
const SIGNER_LIVENESS_WINDOW: Duration = Duration::from_secs(35);

/// Ceiling on a single relayed request. Wallet approvals are human-paced
/// (the user may be reading a MetaMask popup), so this is generous; the
/// frontend applies its own tighter flow-level timeouts.
const RPC_RESPONSE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// EIP-1193 "disconnected" error code, returned to the webview when the
/// session is torn down while requests are still in flight.
const EIP1193_DISCONNECTED: i64 = 4900;

// ── wire types ──

/// One EIP-1193 request queued for the browser page.
#[derive(Clone, Serialize)]
struct RpcRequest {
    id: u64,
    method: String,
    params: Value,
}

/// JSON-RPC-shaped error relayed from the wallet (code preserved so the
/// frontend can map 4001 user-rejections etc.).
#[derive(Clone, Serialize, Deserialize)]
pub struct RpcErrorPayload {
    pub code: i64,
    pub message: String,
}

/// Outcome of one relayed request. Exactly one of `result` / `error` is set.
/// Returned as a value (not a command error) so the error code survives the
/// IPC boundary intact.
#[derive(Clone, Serialize)]
pub struct BridgeRpcOutcome {
    pub result: Option<Value>,
    pub error: Option<RpcErrorPayload>,
}

#[derive(Deserialize)]
struct SignerResponse {
    id: u64,
    result: Option<Value>,
    error: Option<RpcErrorPayload>,
}

#[derive(Serialize)]
pub struct BridgeInfo {
    pub port: u16,
    pub url: String,
    /// True if the signing page was already connected when this call ran
    /// (in which case the browser was not re-opened).
    pub signer_connected: bool,
}

#[derive(Serialize)]
pub struct BridgeStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub signer_connected: bool,
    pub pending_requests: usize,
}

// ── session ──

struct SessionInner {
    port: u16,
    /// 256-bit bearer token, lowercase hex.
    token: String,
    queue: Mutex<VecDeque<RpcRequest>>,
    /// Wakes parked signer long-polls when the queue gains an item.
    queue_notify: Notify,
    pending: Mutex<HashMap<u64, oneshot::Sender<BridgeRpcOutcome>>>,
    next_id: AtomicU64,
    last_signer_poll: Mutex<Option<Instant>>,
    shutdown_tx: watch::Sender<bool>,
}

impl SessionInner {
    fn signer_connected(&self, last_poll: Option<Instant>) -> bool {
        last_poll.is_some_and(|t| t.elapsed() < SIGNER_LIVENESS_WINDOW)
    }

    fn page_url(&self) -> String {
        // Token in the fragment: fragments are not sent in HTTP requests,
        // don't show up in server logs, and don't leak via Referer.
        format!("http://127.0.0.1:{}/#{}", self.port, self.token)
    }
}

/// Tauri-managed state. At most one live session; restarting reuses it.
pub struct BridgeState(Mutex<Option<Arc<SessionInner>>>);

impl BridgeState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

// ── helpers ──

/// Constant-time equality over the token strings (both sides are ASCII hex
/// of fixed length; length mismatch fails without early exit on content).
fn ct_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn new_token() -> Result<String, String> {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).map_err(|e| format!("entropy source failed: {e}"))?;
    Ok(hex::encode(buf))
}

/// Enqueue one request and wait for the page to answer it.
async fn enqueue_and_wait(
    session: &Arc<SessionInner>,
    method: String,
    params: Value,
) -> Result<BridgeRpcOutcome, String> {
    let id = session.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    session.pending.lock().await.insert(id, tx);
    session
        .queue
        .lock()
        .await
        .push_back(RpcRequest { id, method, params });
    session.queue_notify.notify_waiters();

    match tokio::time::timeout(RPC_RESPONSE_TIMEOUT, rx).await {
        Ok(Ok(outcome)) => Ok(outcome),
        // Sender dropped: session torn down mid-flight.
        Ok(Err(_)) => Ok(disconnected_outcome()),
        Err(_) => {
            // Timed out — withdraw both the queue entry (if unclaimed) and
            // the pending slot so a late response is ignored.
            session.queue.lock().await.retain(|r| r.id != id);
            session.pending.lock().await.remove(&id);
            Err("Timed out waiting for the browser wallet".into())
        }
    }
}

fn disconnected_outcome() -> BridgeRpcOutcome {
    BridgeRpcOutcome {
        result: None,
        error: Some(RpcErrorPayload {
            code: EIP1193_DISCONNECTED,
            message: "Bridge session closed".into(),
        }),
    }
}

/// Fail every in-flight request (used on stop, so the webview unblocks
/// immediately instead of waiting out the timeout).
async fn drain_pending(session: &Arc<SessionInner>) {
    session.queue.lock().await.clear();
    let mut pending = session.pending.lock().await;
    for (_, tx) in pending.drain() {
        let _ = tx.send(disconnected_outcome());
    }
}

// ── HTTP server ──

mod server {
    use super::*;
    use axum::extract::State as AxState;
    use axum::http::{header, HeaderMap, StatusCode};
    use axum::response::{IntoResponse, Response};
    use axum::routing::{get, post};
    use axum::{Json, Router};

    const SIGNING_PAGE: &str = include_str!("../bridge-page/index.html");

    /// Host must be exactly the loopback authority we bound — a browser
    /// reaching us through a rebound DNS name presents that name here and
    /// is rejected (go-ethereum's rebinding defense, PR #15962).
    fn host_ok(headers: &HeaderMap, port: u16) -> bool {
        headers
            .get(header::HOST)
            .and_then(|h| h.to_str().ok())
            .map(|h| h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"))
            .unwrap_or(false)
    }

    /// State-changing endpoints additionally require the loopback Origin
    /// (browsers always attach Origin to fetch POSTs; a cross-origin page
    /// would present its own origin and be rejected).
    fn origin_ok(headers: &HeaderMap, port: u16) -> bool {
        headers
            .get(header::ORIGIN)
            .and_then(|h| h.to_str().ok())
            .map(|o| {
                o == format!("http://127.0.0.1:{port}") || o == format!("http://localhost:{port}")
            })
            .unwrap_or(false)
    }

    fn token_ok(headers: &HeaderMap, session: &SessionInner) -> bool {
        headers
            .get("x-bridge-token")
            .and_then(|h| h.to_str().ok())
            .map(|t| ct_eq(t, &session.token))
            .unwrap_or(false)
    }

    fn guard(
        headers: &HeaderMap,
        session: &SessionInner,
        require_origin: bool,
    ) -> Result<(), StatusCode> {
        if !host_ok(headers, session.port) {
            return Err(StatusCode::FORBIDDEN);
        }
        if !token_ok(headers, session) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        if require_origin && !origin_ok(headers, session.port) {
            return Err(StatusCode::FORBIDDEN);
        }
        Ok(())
    }

    async fn page(AxState(session): AxState<Arc<SessionInner>>, headers: HeaderMap) -> Response {
        if !host_ok(&headers, session.port) {
            return StatusCode::FORBIDDEN.into_response();
        }
        (
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                // Wallet extensions inject regardless of page CSP; this
                // hardens the page itself (inline-only, no external loads,
                // fetches restricted to this origin).
                (
                    header::CONTENT_SECURITY_POLICY,
                    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
                     connect-src 'self'; img-src data:",
                ),
                (header::REFERRER_POLICY, "no-referrer"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            SIGNING_PAGE,
        )
            .into_response()
    }

    /// Long-poll: hand the page the oldest queued request, or 204 after
    /// [`SIGNER_POLL_PARK`]. Doubles as the liveness heartbeat.
    async fn signer_requests(
        AxState(session): AxState<Arc<SessionInner>>,
        headers: HeaderMap,
    ) -> Response {
        if let Err(code) = guard(&headers, &session, false) {
            return code.into_response();
        }
        *session.last_signer_poll.lock().await = Some(Instant::now());

        let deadline = Instant::now() + SIGNER_POLL_PARK;
        loop {
            if let Some(req) = session.queue.lock().await.pop_front() {
                return Json(req).into_response();
            }
            let now = Instant::now();
            if now >= deadline {
                return StatusCode::NO_CONTENT.into_response();
            }
            let _ = tokio::time::timeout(deadline - now, session.queue_notify.notified()).await;
        }
    }

    async fn signer_response(
        AxState(session): AxState<Arc<SessionInner>>,
        headers: HeaderMap,
        body: Json<SignerResponse>,
    ) -> Response {
        if let Err(code) = guard(&headers, &session, true) {
            return code.into_response();
        }
        let Json(resp) = body;
        let outcome = BridgeRpcOutcome {
            result: resp.result,
            error: resp.error,
        };
        match session.pending.lock().await.remove(&resp.id) {
            Some(tx) => {
                let _ = tx.send(outcome);
                StatusCode::NO_CONTENT.into_response()
            }
            // Unknown/expired id — late reply after a timeout. Not an error
            // worth surfacing to the page.
            None => StatusCode::GONE.into_response(),
        }
    }

    /// Best-effort "tab is closing" signal so status flips immediately
    /// instead of waiting out the liveness window.
    async fn signer_bye(
        AxState(session): AxState<Arc<SessionInner>>,
        headers: HeaderMap,
    ) -> Response {
        if let Err(code) = guard(&headers, &session, true) {
            return code.into_response();
        }
        *session.last_signer_poll.lock().await = None;
        StatusCode::NO_CONTENT.into_response()
    }

    pub(super) fn router(session: Arc<SessionInner>) -> Router {
        Router::new()
            .route("/", get(page))
            .route("/signer/requests", get(signer_requests))
            .route("/signer/response", post(signer_response))
            .route("/signer/bye", post(signer_bye))
            .with_state(session)
    }
}

/// Bind the loopback listener and spawn the server. Factored out of the
/// command so tests can drive a real session without a Tauri app.
async fn start_session(preferred_port: u16, attempts: u16) -> Result<Arc<SessionInner>, String> {
    let token = new_token()?;

    let mut listener = None;
    let mut last_err = String::new();
    for offset in 0..attempts {
        let candidate = preferred_port
            .checked_add(offset)
            .ok_or_else(|| "bridge port range overflow".to_string())?;
        match tokio::net::TcpListener::bind(("127.0.0.1", candidate)).await {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    let listener = listener.ok_or_else(|| {
        format!(
            "No free loopback port in {preferred_port}..{}: {last_err}",
            preferred_port + attempts
        )
    })?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let session = Arc::new(SessionInner {
        port,
        token,
        queue: Mutex::new(VecDeque::new()),
        queue_notify: Notify::new(),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        last_signer_poll: Mutex::new(None),
        shutdown_tx,
    });

    let app = server::router(session.clone());
    tokio::spawn(async move {
        let serve = axum::serve(listener, app).with_graceful_shutdown(async move {
            // Ends when `true` is observed or the sender is dropped.
            while shutdown_rx.changed().await.is_ok() {
                if *shutdown_rx.borrow() {
                    break;
                }
            }
        });
        if let Err(e) = serve.await {
            tracing::warn!("wallet bridge server exited with error: {e}");
        }
    });

    tracing::info!("wallet bridge listening on 127.0.0.1:{port}");
    Ok(session)
}

// ── commands ──

/// Start (or reuse) the bridge session and open the signing page in the
/// system default browser. Reopening is skipped when the page is already
/// connected — repeated connect attempts shouldn't spawn tab piles.
#[tauri::command]
pub async fn bridge_start(
    app: AppHandle,
    state: State<'_, BridgeState>,
) -> Result<BridgeInfo, String> {
    use tauri_plugin_opener::OpenerExt;

    let mut guard = state.0.lock().await;
    let session = match guard.as_ref() {
        Some(s) => s.clone(),
        None => {
            let s = start_session(DEFAULT_PORT, PORT_ATTEMPTS).await?;
            *guard = Some(s.clone());
            s
        }
    };
    drop(guard);

    let last_poll = *session.last_signer_poll.lock().await;
    let signer_connected = session.signer_connected(last_poll);
    let url = session.page_url();

    if !signer_connected {
        app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| format!("Failed to open the browser: {e}"))?;
    }

    Ok(BridgeInfo {
        port: session.port,
        url,
        signer_connected,
    })
}

/// Relay one EIP-1193 request to the browser wallet and wait for its answer.
/// Errors are returned in-band (`outcome.error`) with their JSON-RPC codes
/// preserved; the command only fails on infrastructure problems.
#[tauri::command]
pub async fn bridge_request(
    state: State<'_, BridgeState>,
    method: String,
    params: Option<Value>,
) -> Result<BridgeRpcOutcome, String> {
    let session = state
        .0
        .lock()
        .await
        .as_ref()
        .cloned()
        .ok_or_else(|| "Wallet bridge is not running".to_string())?;
    enqueue_and_wait(&session, method, params.unwrap_or(Value::Array(vec![]))).await
}

#[tauri::command]
pub async fn bridge_status(state: State<'_, BridgeState>) -> Result<BridgeStatus, String> {
    let guard = state.0.lock().await;
    match guard.as_ref() {
        None => Ok(BridgeStatus {
            running: false,
            port: None,
            signer_connected: false,
            pending_requests: 0,
        }),
        Some(s) => {
            let last_poll = *s.last_signer_poll.lock().await;
            Ok(BridgeStatus {
                running: true,
                port: Some(s.port),
                signer_connected: s.signer_connected(last_poll),
                pending_requests: s.pending.lock().await.len(),
            })
        }
    }
}

/// Tear the session down: unblock in-flight requests with a disconnect
/// error, stop the listener, forget the token.
#[tauri::command]
pub async fn bridge_stop(state: State<'_, BridgeState>) -> Result<(), String> {
    let session = state.0.lock().await.take();
    if let Some(session) = session {
        drain_pending(&session).await;
        let _ = session.shutdown_tx.send(true);
    }
    Ok(())
}

// ── tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_eq_matches_and_rejects() {
        assert!(ct_eq("abc123", "abc123"));
        assert!(!ct_eq("abc123", "abc124"));
        assert!(!ct_eq("abc123", "abc12"));
        assert!(!ct_eq("", "a"));
        assert!(ct_eq("", ""));
    }

    #[test]
    fn tokens_are_unique_and_hex() {
        let a = new_token().unwrap();
        let b = new_token().unwrap();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    /// Full loop over a real listener: app enqueues → signer polls it out →
    /// signer posts the answer → app receives it.
    #[tokio::test]
    async fn request_response_roundtrip() {
        let session = start_session(0, 1).await.expect("bind ephemeral");
        let base = format!("http://127.0.0.1:{}", session.port);
        let client = reqwest::Client::new();

        let s2 = session.clone();
        let waiter = tokio::spawn(async move {
            enqueue_and_wait(&s2, "eth_chainId".into(), Value::Array(vec![])).await
        });

        // Signer side: poll the request out.
        let req: serde_json::Value = client
            .get(format!("{base}/signer/requests"))
            .header("x-bridge-token", &session.token)
            .send()
            .await
            .expect("poll")
            .json()
            .await
            .expect("request json");
        assert_eq!(req["method"], "eth_chainId");
        let id = req["id"].as_u64().expect("id");

        // Signer side: answer it.
        let resp = client
            .post(format!("{base}/signer/response"))
            .header("x-bridge-token", &session.token)
            .header("origin", &base)
            .json(&serde_json::json!({ "id": id, "result": "0xa4b1", "error": null }))
            .send()
            .await
            .expect("post response");
        assert_eq!(resp.status(), 204);

        let outcome = waiter.await.expect("join").expect("outcome");
        assert_eq!(outcome.result, Some(Value::String("0xa4b1".into())));
        assert!(outcome.error.is_none());

        let _ = session.shutdown_tx.send(true);
    }

    #[tokio::test]
    async fn rejects_bad_token_host_and_origin() {
        let session = start_session(0, 1).await.expect("bind ephemeral");
        let base = format!("http://127.0.0.1:{}", session.port);
        let client = reqwest::Client::new();

        // Wrong token → 401.
        let r = client
            .get(format!("{base}/signer/requests"))
            .header("x-bridge-token", "deadbeef")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 401);

        // Forged Host (rebound DNS name) → 403.
        let r = client
            .get(format!("{base}/signer/requests"))
            .header("x-bridge-token", &session.token)
            .header("host", "evil.example:80")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 403);

        // POST without loopback Origin → 403 (cross-origin page).
        let r = client
            .post(format!("{base}/signer/response"))
            .header("x-bridge-token", &session.token)
            .header("origin", "https://evil.example")
            .json(&serde_json::json!({ "id": 1, "result": null, "error": null }))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 403);

        // Page itself is served with only a Host check (token rides the
        // URL fragment, which never reaches the server).
        let r = client.get(format!("{base}/")).send().await.unwrap();
        assert_eq!(r.status(), 200);

        let _ = session.shutdown_tx.send(true);
    }

    #[tokio::test]
    async fn stop_unblocks_inflight_requests_with_disconnect_code() {
        let session = start_session(0, 1).await.expect("bind ephemeral");

        let s2 = session.clone();
        let waiter = tokio::spawn(async move {
            enqueue_and_wait(&s2, "eth_requestAccounts".into(), Value::Array(vec![])).await
        });
        // Let the request land in the queue before draining.
        tokio::time::sleep(Duration::from_millis(50)).await;

        drain_pending(&session).await;
        let outcome = waiter.await.expect("join").expect("outcome");
        assert_eq!(outcome.error.as_ref().map(|e| e.code), Some(4900));

        let _ = session.shutdown_tx.send(true);
    }
}
