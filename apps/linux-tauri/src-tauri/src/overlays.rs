// The three floating overlays: the dictation pill, the mic alert toast, and the
// start/stop notice banner. Same shapes, sizes and behaviour as the Windows
// build — frameless, transparent, always on top, off the taskbar.
//
// Unlike Windows, these windows are driven by ordinary DOM handlers: there is no
// global mouse poller, because insertion re-activates the recorded target window
// before pasting, so the pill briefly taking focus cannot misdirect a dictation.

use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager};

pub const PILL_WIDTH: f64 = 138.0;
pub const PILL_HEIGHT: f64 = 22.0;
const ALERT_WIDTH: f64 = 420.0;
const ALERT_HEIGHT: f64 = 96.0;
const NOTICE_WIDTH: f64 = 460.0;
const NOTICE_HEIGHT: f64 = 92.0;
const NOTICE_TOP_MARGIN: f64 = 24.0;
const PREVIEW_WIDTH: f64 = 340.0;
const PREVIEW_HEIGHT: f64 = 152.0;
const PREVIEW_MARGIN: f64 = 18.0;

static ALERT_GEN: AtomicU64 = AtomicU64::new(0);
static PREVIEW_GEN: AtomicU64 = AtomicU64::new(0);
static NOTICE_GEN: AtomicU64 = AtomicU64::new(0);
static NOTICE_VISIBLE: AtomicBool = AtomicBool::new(false);

// Work area in logical pixels. Tauri reports monitors in physical pixels, so
// everything is divided by the scale factor to match the CSS sizes above.
fn work_area(app: &AppHandle) -> (f64, f64, f64, f64) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = win.primary_monitor() {
            let scale = monitor.scale_factor();
            let size = monitor.size();
            let pos = monitor.position();
            return (
                pos.x as f64 / scale,
                pos.y as f64 / scale,
                size.width as f64 / scale,
                size.height as f64 / scale,
            );
        }
    }
    (0.0, 0.0, 1920.0, 1080.0)
}

fn emit_to(app: &AppHandle, label: &str, event: &str, payload: Value) {
    let _ = app.emit_to(label, event, payload);
}

// --- pill -------------------------------------------------------------------
pub fn pill_show(app: &AppHandle, saved: Option<(f64, f64)>, scale: f64) {
    let Some(win) = app.get_webview_window("pill") else { return };
    let w = PILL_WIDTH * scale;
    let h = PILL_HEIGHT * scale;
    let _ = win.set_size(LogicalSize::new(w, h));
    // Zoom the contents with the frame so the pill scales as one piece.
    let _ = win.set_zoom(scale);
    let (ax, ay, aw, ah) = work_area(app);
    let (x, y) = match saved {
        Some((sx, sy)) => (
            sx.max(ax).min(ax + aw - w),
            sy.max(ay).min(ay + ah - h),
        ),
        // Bottom-centre by default, the same resting spot as on Windows.
        None => (ax + aw / 2.0 - w / 2.0, ay + ah - h - 14.0),
    };
    let _ = win.set_position(LogicalPosition::new(x, y));
    let _ = win.set_always_on_top(true);
    let _ = win.show();
}

pub fn pill_hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("pill") {
        let _ = win.hide();
    }
}

pub fn pill_state(app: &AppHandle, state: &str, message: Option<&str>) {
    emit_to(
        app,
        "pill",
        "pill:state",
        json!({ "state": state, "message": message }),
    );
}

pub fn pill_position(app: &AppHandle) -> Option<(f64, f64)> {
    let win = app.get_webview_window("pill")?;
    let scale = win.scale_factor().ok()?;
    let pos = win.outer_position().ok()?;
    Some((pos.x as f64 / scale, pos.y as f64 / scale))
}

// --- notice (start / stop banner) -------------------------------------------
pub fn notice_show(app: &AppHandle, kind: &str, title: &str, message: &str, timeout_ms: u64) {
    let Some(win) = app.get_webview_window("notice") else { return };
    let (ax, ay, aw, _ah) = work_area(app);
    let _ = win.set_size(LogicalSize::new(NOTICE_WIDTH, NOTICE_HEIGHT));
    let _ = win.set_position(LogicalPosition::new(
        ax + aw / 2.0 - NOTICE_WIDTH / 2.0,
        ay + NOTICE_TOP_MARGIN,
    ));
    let _ = win.set_always_on_top(true);
    emit_to(
        app,
        "notice",
        "notice:show",
        json!({ "kind": kind, "title": title, "message": message }),
    );
    let _ = win.show();
    NOTICE_VISIBLE.store(true, Ordering::SeqCst);

    let gen = NOTICE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(timeout_ms));
        if NOTICE_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        NOTICE_VISIBLE.store(false, Ordering::SeqCst);
        if let Some(win) = app.get_webview_window("notice") {
            let _ = win.hide();
        }
    });
}

// --- preview (finished transcript card) --------------------------------------
pub fn preview_show(app: &AppHandle, text: &str, timeout_ms: u64) {
    let body = text.trim();
    if body.is_empty() {
        return;
    }
    let Some(win) = app.get_webview_window("preview") else { return };
    let (ax, ay, _aw, ah) = work_area(app);
    let _ = win.set_size(LogicalSize::new(PREVIEW_WIDTH, PREVIEW_HEIGHT));
    let _ = win.set_position(LogicalPosition::new(
        ax + PREVIEW_MARGIN,
        ay + ah - PREVIEW_HEIGHT - PREVIEW_MARGIN,
    ));
    let _ = win.set_always_on_top(true);
    emit_to(
        app,
        "preview",
        "preview:show",
        json!({ "text": body, "words": body.split_whitespace().count() }),
    );
    let _ = win.show();

    let gen = PREVIEW_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(timeout_ms));
        if PREVIEW_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        if let Some(win) = app.get_webview_window("preview") {
            let _ = win.hide();
        }
    });
}

pub fn preview_hide(app: &AppHandle) {
    PREVIEW_GEN.fetch_add(1, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("preview") {
        let _ = win.hide();
    }
}

// --- alert (mic problems) ----------------------------------------------------
pub fn alert_show(app: &AppHandle, kind: &str, title: &str, message: &str, sticky: bool, timeout_ms: u64) {
    let Some(win) = app.get_webview_window("alert") else { return };
    let (ax, ay, aw, _ah) = work_area(app);
    // Stack under the start/stop banner when both are up.
    let top = if NOTICE_VISIBLE.load(Ordering::SeqCst) {
        ay + NOTICE_TOP_MARGIN + NOTICE_HEIGHT + 10.0
    } else {
        ay + 18.0
    };
    let _ = win.set_size(LogicalSize::new(ALERT_WIDTH, ALERT_HEIGHT));
    let _ = win.set_position(LogicalPosition::new(ax + aw / 2.0 - ALERT_WIDTH / 2.0, top));
    let _ = win.set_always_on_top(true);
    emit_to(
        app,
        "alert",
        "alert:show",
        json!({ "kind": kind, "title": title, "message": message }),
    );
    let _ = win.show();

    let gen = ALERT_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    if sticky {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(timeout_ms));
        if ALERT_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        if let Some(win) = app.get_webview_window("alert") {
            let _ = win.hide();
        }
    });
}

pub fn alert_hide(app: &AppHandle) {
    ALERT_GEN.fetch_add(1, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("alert") {
        let _ = win.hide();
    }
}
