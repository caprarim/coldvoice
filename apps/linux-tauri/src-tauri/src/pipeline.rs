// Bridge to the shared JavaScript logic.
//
// packages/shared/text-processing (the ordered deterministic cleanup pipeline)
// and packages/shared/input-detection (the canInsertInto safety gate) are the
// single source of truth for both platforms, and they are plain JavaScript.
// Rather than fork them into Rust — where they would immediately start drifting
// from the Windows build — the Linux app runs them where JavaScript already
// runs: a hidden "processor" webview, mirroring the hidden recorder window the
// Electron app already uses.
//
// Rust emits a request, the webview answers with the pipeline_result command.
// Every call is bounded by a timeout and every caller has a plain fallback, so
// a wedged webview can never swallow a dictation.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;


#[derive(Default)]
pub struct Bridge {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
}

impl Bridge {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn call(&self, app: &AppHandle, op: &str, payload: Value, timeout_ms: u64) -> Option<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel::<Value>();
        {
            let mut pending = self.pending.lock().ok()?;
            pending.insert(id, tx);
        }
        let sent = app.emit_to(
            "processor",
            "pipeline:request",
            serde_json::json!({ "id": id, "op": op, "payload": payload }),
        );
        if let Err(e) = sent {
            logf!("pipeline: emit failed for {}: {}", op, e);
            self.forget(id);
            return None;
        }
        match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
            Ok(Ok(value)) => Some(value),
            Ok(Err(_)) => None,
            Err(_) => {
                logf!("pipeline: {} timed out after {}ms", op, timeout_ms);
                self.forget(id);
                None
            }
        }
    }

    pub fn resolve(&self, id: u64, result: Value) {
        let sender = self.pending.lock().ok().and_then(|mut p| p.remove(&id));
        if let Some(tx) = sender {
            let _ = tx.send(result);
        }
    }

    fn forget(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
    }
}

// Run the full deterministic pipeline. Falls back to the raw transcript rather
// than losing a dictation.
pub async fn process_text(app: &AppHandle, bridge: &Bridge, raw: &str, options: Value) -> String {
    let payload = serde_json::json!({ "text": raw, "options": options });
    match bridge.call(app, "process", payload, 4000).await {
        Some(Value::String(s)) => s,
        _ => raw.trim().to_string(),
    }
}

// The cloud path already had the LLM do grammar and formatting, so only the
// user's exact rules (spoken punctuation, dictionary, snippets) are applied.
pub async fn apply_user_rules(app: &AppHandle, bridge: &Bridge, text: &str, options: Value) -> String {
    let payload = serde_json::json!({ "text": text, "options": options });
    match bridge.call(app, "userRules", payload, 4000).await {
        Some(Value::String(s)) => s,
        _ => text.trim().to_string(),
    }
}

// The shared insertion safety gate. Defaults to true when the webview cannot
// answer, matching the Windows policy that an unresolved target still pastes —
// insert_text() refuses secure prompts on its own before this is consulted.
pub async fn can_insert_into(app: &AppHandle, bridge: &Bridge, node: Value) -> bool {
    match bridge.call(app, "canInsert", node, 2000).await {
        Some(Value::Bool(b)) => b,
        _ => true,
    }
}
