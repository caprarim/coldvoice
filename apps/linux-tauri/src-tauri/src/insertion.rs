// Linux text insertion + focus detection.
//
// Focus detection reads the active window through xdotool on X11 (class, title
// and owning process). The resulting node is handed to the SHARED
// canInsertInto() rules from @coldvoice/input-detection, exactly like the
// Windows build does — see pipeline.rs for the bridge.
//
// Insertion is clipboard-preserving: save the clipboard, write the text,
// re-activate the window that had focus when dictation started, send the paste
// chord, then restore the clipboard. Terminals get Ctrl+Shift+V; everything
// else gets Ctrl+V. When focus sits on a window we positively recognise as a
// secure prompt (polkit, keyring, a password manager, the lock screen) nothing
// is ever typed — the text is left on the clipboard instead.

use serde_json::{json, Value};
use std::process::{Command, Stdio};
use std::time::Duration;


const CONSOLE_CLASSES: [&str; 16] = [
    "gnome-terminal", "gnome-terminal-server", "konsole", "xterm", "uxterm", "kitty",
    "alacritty", "wezterm", "org.wezfurlong.wezterm", "foot", "footclient", "terminator",
    "tilix", "xfce4-terminal", "mate-terminal", "st",
];

// Windows where ColdVoice must never type. Matched loosely on window class and
// title because these prompts vary between desktops.
const SECURE_HINTS: [&str; 12] = [
    "polkit", "gcr-prompter", "gnome-keyring", "keyring", "screensaver", "lockscreen",
    "gnome-screensaver", "keepass", "bitwarden", "1password", "seahorse", "sudo password",
];

pub fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").map(|v| !v.is_empty()).unwrap_or(false)
}

pub fn has_x11() -> bool {
    std::env::var("DISPLAY").map(|v| !v.is_empty()).unwrap_or(false)
}

pub fn have_tool(name: &str) -> bool {
    Command::new("which")
        .arg(name)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn process_name(pid: &str) -> String {
    std::fs::read_to_string(format!("/proc/{}/comm", pid))
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

fn is_console_name(class: &str, app: &str) -> bool {
    let cls = class.to_lowercase();
    if cls.contains("terminal") || cls.contains("console") || cls.contains("xterm") {
        return true;
    }
    let proc_name = app.trim().to_lowercase();
    CONSOLE_CLASSES.iter().any(|c| *c == cls || *c == proc_name)
}

fn looks_secure(class: &str, title: &str) -> bool {
    let haystack = format!("{} {}", class, title).to_lowercase();
    SECURE_HINTS.iter().any(|h| haystack.contains(h))
}

// Query the currently focused window. `known` mirrors the Windows meaning: the
// query actually resolved something. A failed or vague query must NOT downgrade
// insertion to clipboard-only — a paste chord is a harmless no-op on a surface
// that takes no text, whereas defaulting to clipboard silently drops dictations.
pub fn focused_target() -> Value {
    if !has_x11() || !have_tool("xdotool") {
        return json!({
            "windowId": "",
            "known": false,
            "isConsole": false,
            "isPassword": false,
            "appId": Value::Null,
        });
    }
    let window_id = run("xdotool", &["getactivewindow"]).unwrap_or_default();
    if window_id.is_empty() {
        return json!({ "windowId": "", "known": false, "isConsole": false, "isPassword": false });
    }
    let class = run("xdotool", &["getwindowclassname", window_id.as_str()]).unwrap_or_default();
    let title = run("xdotool", &["getwindowname", window_id.as_str()]).unwrap_or_default();
    let pid = run("xdotool", &["getwindowpid", window_id.as_str()]).unwrap_or_default();
    let app_id = if pid.is_empty() { String::new() } else { process_name(&pid) };
    let app_id = if app_id.is_empty() { class.to_lowercase() } else { app_id };

    let is_console = is_console_name(&class, &app_id);
    let secure = looks_secure(&class, &title);

    json!({
        "windowId": window_id,
        "className": class,
        "name": title,
        "appId": app_id,
        "isConsole": is_console,
        // Without an AT-SPI query we cannot see a password *field*, so a
        // recognised secure *window* is what gates insertion here.
        "isPassword": secure,
        "secure": secure,
        // X11 gives us a window, not a control: treat the target as editable
        // unless it is a secure prompt, the same default the Windows build
        // lands on when UI Automation cannot resolve an element.
        "acceptsKeyboard": !secure,
        "known": !class.is_empty() || !title.is_empty(),
    })
}

fn activate_window(window_id: &str) {
    if window_id.is_empty() {
        return;
    }
    let _ = Command::new("xdotool")
        .args(["windowactivate", "--sync", window_id])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

// Send the paste chord to whatever currently has focus.
fn send_paste_chord(is_console: bool) -> Result<(), String> {
    let chord = if is_console { "ctrl+shift+v" } else { "ctrl+v" };
    if has_x11() && have_tool("xdotool") {
        let status = Command::new("xdotool")
            .args(["key", "--clearmodifiers", chord])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
    }
    if is_wayland() && have_tool("wtype") {
        let mut args: Vec<&str> = vec!["-M", "ctrl"];
        if is_console {
            args.extend_from_slice(&["-M", "shift"]);
        }
        args.extend_from_slice(&["-k", "v", "-m", "ctrl"]);
        if is_console {
            args.extend_from_slice(&["-m", "shift"]);
        }
        let status = Command::new("wtype")
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
    }
    if have_tool("ydotool") {
        // 29 = left ctrl, 42 = left shift, 47 = v (Linux input event codes).
        let mut seq: Vec<String> = vec!["29:1".into()];
        if is_console {
            seq.push("42:1".into());
        }
        seq.push("47:1".into());
        seq.push("47:0".into());
        if is_console {
            seq.push("42:0".into());
        }
        seq.push("29:0".into());
        let status = Command::new("ydotool")
            .arg("key")
            .args(&seq)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
    }
    Err("No way to send a paste chord. Install xdotool (X11) or wtype / ydotool (Wayland).".into())
}

pub struct InsertOutcome {
    pub ok: bool,
    // "paste" | "clipboard"
    pub mode: &'static str,
    pub reason: &'static str,
}

// Insert text into the focused target.
//   - recognised secure prompt        -> refuse  (clipboard only, reason "password")
//   - known non-editable / no tooling -> clipboard
//   - everything else                 -> paste
// `can_insert` comes from the shared canInsertInto() rules; `target` is the node
// captured when dictation started so the paste lands where the user was typing.
pub fn insert_text(target: &Value, can_insert: bool, is_console: bool) -> InsertOutcome {
    if target.get("isPassword").and_then(|v| v.as_bool()) == Some(true) {
        return InsertOutcome { ok: false, mode: "clipboard", reason: "password" };
    }
    let known = target.get("known").and_then(|v| v.as_bool()).unwrap_or(false);
    if known && !can_insert {
        return InsertOutcome { ok: true, mode: "clipboard", reason: "" };
    }
    let window_id = target.get("windowId").and_then(|v| v.as_str()).unwrap_or("");
    if has_x11() && have_tool("xdotool") {
        activate_window(window_id);
        // Consoles in particular ignore a chord that fires in the same tick as
        // the window activation.
        std::thread::sleep(Duration::from_millis(if is_console { 120 } else { 40 }));
    }
    match send_paste_chord(is_console) {
        Ok(()) => {
            std::thread::sleep(Duration::from_millis(if is_console { 350 } else { 120 }));
            InsertOutcome { ok: true, mode: "paste", reason: "" }
        }
        Err(e) => {
            logf!("insertion failed, leaving text on the clipboard: {}", e);
            InsertOutcome { ok: true, mode: "clipboard", reason: "no-tooling" }
        }
    }
}

// Fire a paste using text already on the clipboard, for the paste-last-transcript
// shortcut.
pub fn paste_from_clipboard(is_console: bool) -> Result<(), String> {
    std::thread::sleep(Duration::from_millis(if is_console { 100 } else { 30 }));
    send_paste_chord(is_console)?;
    std::thread::sleep(Duration::from_millis(if is_console { 280 } else { 50 }));
    Ok(())
}

// A one-line summary of what insertion can actually do on this session, shown
// once at startup when something needed is missing.
pub fn tooling_problem() -> Option<String> {
    if has_x11() && have_tool("xdotool") {
        return None;
    }
    if is_wayland() && (have_tool("wtype") || have_tool("ydotool")) {
        return None;
    }
    if is_wayland() {
        Some("Install wtype or ydotool so ColdVoice can paste into other apps on Wayland.".into())
    } else {
        Some("Install xdotool so ColdVoice can paste into other apps.".into())
    }
}
