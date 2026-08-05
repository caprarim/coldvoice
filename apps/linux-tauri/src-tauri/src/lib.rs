// ColdVoice for Linux — Tauri v2 core.
//
// Same product as the Windows build: press a hotkey, speak, and the cleaned
// text lands in whatever field already has focus. The pieces map one to one
// onto apps/windows-electron/src/main:
//
//   db.rs        <- db.js          (shared SQLite schema)
//   audio.rs     <- recorder.js    (capture + pause segmentation, now in Rust)
//   asr.rs       <- asr.js         (whisper.cpp subprocess)
//   groq.rs      <- groq.js        (cloud Whisper + Llama polish)
//   insertion.rs <- insertion.js   (focus detection + clipboard-preserving paste)
//   overlays.rs  <- pill/alert/notice.js
//   pipeline.rs  -> the shared JS text pipeline, run in a hidden webview
//
// Dictation never depends on the network: the cloud path is entered only when
// AI is on, a key exists and we are online, and it falls back silently.

#[macro_use]
mod util;

mod asr;
mod audio;
mod auth;
mod db;
mod groq;
mod insertion;
mod overlays;
mod pipeline;
mod updater;

use audio::AudioEvent;
use once_cell::sync::OnceCell;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::mpsc::UnboundedReceiver;

const SILENCE_RMS: f32 = 0.002;
const MIN_MS: i64 = 250;
const MODEL: &str = "base.en";

// --- state -------------------------------------------------------------------
#[derive(Default)]
struct Dictation {
    recording: bool,
    paused: bool,
    mode: String,
    no_mic_hold: bool,
    capture: Option<audio::CaptureHandle>,
}

#[derive(Default)]
struct MicState {
    connected: bool,
    label: String,
    disconnect_alert_shown: bool,
}

#[derive(Default)]
struct UpdateState {
    artifact_url: String,
    ready_path: Option<PathBuf>,
    downloading: bool,
}

pub struct AppState {
    conn: Mutex<Connection>,
    bridge: pipeline::Bridge,
    online: AtomicBool,
    generation: AtomicU64,
    dictation: Mutex<Dictation>,
    mic: Mutex<MicState>,
    last_transcript: Mutex<String>,
    clipboard: Mutex<std::sync::mpsc::Sender<ClipMsg>>,
    preview: Mutex<Option<audio::PreviewHandle>>,
    update: Mutex<UpdateState>,
    shortcuts: Mutex<Vec<(Shortcut, String)>>,
}

impl AppState {
    fn setting(&self, key: &str, fallback: &str) -> String {
        let conn = self.conn.lock().unwrap();
        db::get_setting(&conn, key, fallback)
    }
    fn set_setting(&self, key: &str, value: &str) {
        let conn = self.conn.lock().unwrap();
        db::set_setting(&conn, key, value);
    }
    fn clip_write(&self, text: &str) {
        let tx = self.clipboard.lock().unwrap();
        let _ = tx.send(ClipMsg::Set(text.to_string()));
    }
    fn clip_read(&self) -> String {
        let (reply_tx, reply_rx) = std::sync::mpsc::channel::<String>();
        {
            let tx = self.clipboard.lock().unwrap();
            if tx.send(ClipMsg::Get(reply_tx)).is_err() {
                return String::new();
            }
        }
        reply_rx.recv_timeout(Duration::from_millis(1500)).unwrap_or_default()
    }
}

enum ClipMsg {
    Set(String),
    Get(std::sync::mpsc::Sender<String>),
}

// X11 clipboard ownership lives with the process that set it, and arboard only
// serves requests while its Clipboard is alive. One long-lived thread owns it
// for the life of the app, which also keeps the handle off the shared state.
fn start_clipboard() -> std::sync::mpsc::Sender<ClipMsg> {
    let (tx, rx) = std::sync::mpsc::channel::<ClipMsg>();
    std::thread::spawn(move || {
        let mut clipboard = arboard::Clipboard::new().ok();
        while let Ok(msg) = rx.recv() {
            if clipboard.is_none() {
                clipboard = arboard::Clipboard::new().ok();
            }
            match msg {
                ClipMsg::Set(text) => {
                    if let Some(cb) = clipboard.as_mut() {
                        if let Err(e) = cb.set_text(text) {
                            logf!("clipboard write failed: {}", e);
                        }
                    }
                }
                ClipMsg::Get(reply) => {
                    let text = clipboard.as_mut().and_then(|cb| cb.get_text().ok()).unwrap_or_default();
                    let _ = reply.send(text);
                }
            }
        }
    });
    tx
}

fn state_of(app: &AppHandle) -> State<'_, AppState> {
    app.state::<AppState>()
}

// The cloud AI path (Groq Whisper + Llama) is used only when the master switch
// is on, a key is set, AND we currently have connectivity.
fn cloud_ready(state: &AppState) -> bool {
    if state.setting("ai.enabled", "1") != "1" {
        return false;
    }
    if state.setting("ai.groqApiKey", "").trim().len() <= 10 {
        return false;
    }
    state.online.load(Ordering::SeqCst)
}

// --- dictation ---------------------------------------------------------------
fn pill_scale(state: &AppState) -> f64 {
    state.setting("pill.scale", "1.9").parse::<f64>().unwrap_or(1.9).clamp(0.6, 4.0)
}

fn saved_pill_position(state: &AppState) -> Option<(f64, f64)> {
    let x = state.setting("pill.x", "").parse::<f64>().ok()?;
    let y = state.setting("pill.y", "").parse::<f64>().ok()?;
    Some((x, y))
}

fn show_pill(app: &AppHandle) {
    let state = state_of(app);
    overlays::pill_show(app, saved_pill_position(&state), pill_scale(&state));
}

// After a dictation ends, either hide the pill or drop it back to the always-on
// idle bar, depending on the setting.
fn finish_pill(app: &AppHandle, delay_ms: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(delay_ms));
        let state = state_of(&app);
        let (recording, no_mic_hold) = {
            let d = state.dictation.lock().unwrap();
            (d.recording, d.no_mic_hold)
        };
        if recording {
            return;
        }
        let idle = state.setting("dictation.showBarAlways", "0") == "1";
        let mic_connected = state.mic.lock().unwrap().connected;
        if idle {
            show_pill(&app);
            if mic_connected {
                overlays::pill_state(&app, "idle", None);
            } else {
                overlays::pill_state(&app, "nomic", Some("No microphone"));
            }
        } else if no_mic_hold {
            show_pill(&app);
            overlays::pill_state(&app, "nomic", Some("No microphone"));
        } else {
            overlays::pill_hide(&app);
        }
    });
}

fn is_current(app: &AppHandle, gen: u64) -> bool {
    state_of(app).generation.load(Ordering::SeqCst) == gen
}

enum Action {
    Toggle,
    StartHold,
    StopHold,
    Cancel,
    PauseResume,
    PasteLast,
    ShowMain,
    Pill(String),
}

static ACTIONS: OnceCell<std::sync::mpsc::Sender<Action>> = OnceCell::new();

fn run_action(app: &AppHandle, action: Action) {
    match action {
        Action::Toggle => toggle_dictation(app),
        Action::StartHold => {
            let recording = state_of(app).dictation.lock().unwrap().recording;
            if !recording {
                start_dictation(app, "hold");
            }
        }
        Action::StopHold => {
            let (recording, mode) = {
                let state = state_of(app);
                let d = state.dictation.lock().unwrap();
                (d.recording, d.mode.clone())
            };
            if recording && mode == "hold" {
                stop_dictation(app);
            }
        }
        Action::Cancel => cancel_dictation(app),
        Action::PauseResume => toggle_pause(app),
        Action::PasteLast => paste_last_transcript(app),
        Action::ShowMain => show_main(app),
        Action::Pill(name) => run_pill_action(app, &name),
    }
    let idle = {
        let state = state_of(app);
        let d = state.dictation.lock().unwrap();
        !d.recording && !d.no_mic_hold
    };
    if idle {
        unregister_escape(app);
    }
}

fn dispatch(app: &AppHandle, action: Action) {
    match ACTIONS.get() {
        Some(tx) => {
            let _ = tx.send(action);
        }
        None => run_action(app, action),
    }
}

fn start_action_worker(app: AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<Action>();
    if ACTIONS.set(tx).is_err() {
        return;
    }
    std::thread::spawn(move || {
        while let Ok(action) = rx.recv() {
            run_action(&app, action);
        }
    });
}

fn toggle_dictation(app: &AppHandle) {
    let state = state_of(app);
    let (recording, no_mic_hold) = {
        let d = state.dictation.lock().unwrap();
        (d.recording, d.no_mic_hold)
    };
    if no_mic_hold {
        dismiss_no_mic_hold(app);
        return;
    }
    if recording {
        stop_dictation(app);
    } else {
        start_dictation(app, "toggle");
    }
}

fn dismiss_no_mic_hold(app: &AppHandle) {
    state_of(app).dictation.lock().unwrap().no_mic_hold = false;
    unregister_escape(app);
    finish_pill(app, 0);
}

fn start_dictation(app: &AppHandle, mode: &str) {
    let state = state_of(app);
    {
        let d = state.dictation.lock().unwrap();
        if d.recording {
            return;
        }
    }
    if !state.mic.lock().unwrap().connected {
        state.dictation.lock().unwrap().no_mic_hold = true;
        show_pill(app);
        overlays::pill_state(app, "nomic", Some("No microphone"));
        overlays::alert_show(
            app,
            "disconnect",
            "Microphone disconnected",
            "No microphone is connected. Plug one in to dictate.",
            true,
            0,
        );
        logf!("dictation blocked: no microphone");
        return;
    }

    let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let cloud = cloud_ready(&state);
    let model_ready = asr::is_ready(MODEL);
    let device_id = state.setting("dictation.microphoneDeviceId", "");

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<AudioEvent>();
    let (status_tx, status_rx) = tokio::sync::mpsc::unbounded_channel::<audio::MicSignal>();

    let capture = match audio::start_capture(app.clone(), device_id, !cloud, tx, status_tx) {
        Ok(handle) => handle,
        Err(e) => {
            logf!("capture failed to start: {}", e);
            overlays::pill_state(app, "error", Some(&e));
            show_pill(app);
            finish_pill(app, 2500);
            return;
        }
    };

    // The window that had focus when dictation started is where the text goes,
    // exactly like the Windows build.
    let target = insertion::focused_target();

    {
        let mut d = state.dictation.lock().unwrap();
        d.recording = true;
        d.paused = false;
        d.mode = mode.to_string();
        d.capture = Some(capture);
    }

    overlays::preview_hide(app);
    overlays::notice_show(
        app,
        "started",
        "ColdVoice has started dictating",
        "Listening. Speak now.",
        2200,
    );
    logf!("dictation engine: {}", if cloud { "cloud (Groq)" } else { "local (whisper.cpp)" });
    if cloud {
        let key = state.setting("ai.groqApiKey", "");
        tauri::async_runtime::spawn(async move { groq::warm(key).await });
    } else if !model_ready {
        overlays::alert_show(
            app,
            "fallback",
            "Offline model missing",
            "No local speech model found. Add a Groq key in Settings, or install the model.",
            false,
            7000,
        );
    }

    show_pill(app);
    overlays::pill_state(app, "recording", None);
    register_escape(app);
    logf!("dictation started (mode={})", mode);

    let app_for_status = app.clone();
    tauri::async_runtime::spawn(async move { drain_mic_signals(app_for_status, status_rx).await });
    let app_for_session = app.clone();
    tauri::async_runtime::spawn(async move {
        run_session(app_for_session, gen, rx, cloud, model_ready, target).await;
    });
}

async fn drain_mic_signals(app: AppHandle, mut rx: UnboundedReceiver<audio::MicSignal>) {
    while let Some(signal) = rx.recv().await {
        match signal {
            audio::MicSignal::TooLoud => {
                logf!("mic: level too loud");
                overlays::alert_show(&app, "level", "Mic too loud", "Please stay quiet or lower your mic volume.", false, 4000);
            }
            audio::MicSignal::TooQuiet => {
                logf!("mic: level too quiet");
                overlays::alert_show(&app, "level", "Mic too quiet", "Please speak up or move closer to your mic.", false, 4000);
            }
        }
    }
}

fn stop_dictation(app: &AppHandle) {
    let state = state_of(app);
    let mut d = state.dictation.lock().unwrap();
    if !d.recording {
        drop(d);
        unregister_escape(app);
        return;
    }
    d.recording = false;
    d.paused = false;
    if let Some(capture) = d.capture.take() {
        capture.stop();
    }
    drop(d);
    unregister_escape(app);
    overlays::notice_show(
        app,
        "stopped",
        "ColdVoice has stopped dictating",
        "Transcribing, then inserting your text.",
        2000,
    );
}

fn cancel_dictation(app: &AppHandle) {
    let state = state_of(app);
    {
        let d = state.dictation.lock().unwrap();
        if d.no_mic_hold {
            drop(d);
            dismiss_no_mic_hold(app);
            return;
        }
    }
    let was_recording = {
        let mut d = state.dictation.lock().unwrap();
        let was = d.recording;
        d.recording = false;
        d.paused = false;
        if let Some(capture) = d.capture.take() {
            capture.stop();
        }
        was
    };
    // Bumping the generation orphans the running session task.
    state.generation.fetch_add(1, Ordering::SeqCst);
    unregister_escape(app);
    if was_recording {
        overlays::notice_show(
            app,
            "stopped",
            "ColdVoice has stopped dictating",
            "Cancelled. Nothing was inserted.",
            2000,
        );
    }
    finish_pill(app, 0);
}

// Hold / release the live dictation. Audio captured before the pause is kept,
// so resuming carries on the same transcript from where the user left off.
fn toggle_pause(app: &AppHandle) {
    let state = state_of(app);
    let mut d = state.dictation.lock().unwrap();
    if !d.recording {
        return;
    }
    d.paused = !d.paused;
    let paused = d.paused;
    if let Some(capture) = d.capture.as_ref() {
        if paused {
            capture.pause();
        } else {
            capture.resume();
        }
    }
    drop(d);
    overlays::pill_state(app, if paused { "paused" } else { "recording" }, None);
    logf!("dictation {}", if paused { "paused" } else { "resumed" });
}

fn fail_dictation(app: &AppHandle, message: &str) {
    let state = state_of(app);
    {
        let mut d = state.dictation.lock().unwrap();
        d.recording = false;
        d.paused = false;
        if let Some(capture) = d.capture.take() {
            capture.stop();
        }
    }
    state.generation.fetch_add(1, Ordering::SeqCst);
    unregister_escape(app);
    overlays::pill_state(app, "error", Some(message));
    finish_pill(app, 3000);
}

// Persist the raw WAV when "Store audio" is enabled.
fn maybe_store_audio(state: &AppState, pcm: &[i16], sample_rate: u32) {
    if state.setting("privacy.storeAudio", "0") != "1" {
        return;
    }
    let dir = util::data_dir().join("recordings");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = dir.join(format!("dictation-{}.wav", util::now_ms()));
    if std::fs::write(&file, util::wav_buffer(pcm, sample_rate)).is_ok() {
        logf!("stored audio: {}", file.display());
    }
}

// Recording ran; assemble, post-process and insert the transcript. Segments are
// transcribed as they arrive so only the final tail is left when the user stops.
async fn run_session(
    app: AppHandle,
    gen: u64,
    mut rx: UnboundedReceiver<AudioEvent>,
    cloud: bool,
    model_ready: bool,
    target: Value,
) {
    let mut parts: Vec<String> = Vec::new();
    let mut all_pcm: Vec<i16> = Vec::new();
    let mut sample_rate: u32 = 16000;
    let mut max_rms: f32 = 0.0;

    loop {
        let event = match rx.recv().await {
            Some(e) => e,
            None => break,
        };
        if !is_current(&app, gen) {
            return;
        }
        match event {
            AudioEvent::Segment { pcm, sample_rate: sr, samples, rms } => {
                sample_rate = sr;
                if rms > max_rms {
                    max_rms = rms;
                }
                all_pcm.extend_from_slice(&pcm);
                // Cloud path: just accumulate. The whole recording goes to Groq
                // in one fast request on stop.
                if cloud || !model_ready {
                    continue;
                }
                // Skip silent segments — whisper hallucinates "you" on silence.
                if samples == 0 || rms < SILENCE_RMS {
                    continue;
                }
                let result = tauri::async_runtime::spawn_blocking(move || asr::transcribe(&pcm, MODEL, sr)).await;
                match result {
                    Ok(Ok(text)) => {
                        let clean = text.trim().to_string();
                        logf!("segment asr: {:?}", clean);
                        if !clean.is_empty() {
                            parts.push(clean);
                        }
                    }
                    Ok(Err(e)) => logf!("segment asr failed: {}", e),
                    Err(e) => logf!("segment asr task failed: {}", e),
                }
            }
            AudioEvent::Error(message) => {
                logf!("recorder error: {}", message);
                fail_dictation(&app, &message);
                return;
            }
            AudioEvent::Done => break,
        }
    }

    if !is_current(&app, gen) {
        return;
    }
    overlays::pill_state(&app, "transcribing", None);

    let duration_ms = ((all_pcm.len() as f64 / sample_rate as f64) * 1000.0) as i64;
    // Bail on an empty / too-short / near-silent recording before spending any
    // ASR work — whisper hallucinates phantom phrases on silence.
    if all_pcm.is_empty() || duration_ms < MIN_MS || max_rms < SILENCE_RMS {
        overlays::pill_state(&app, "info", Some("No speech detected"));
        finish_pill(&app, 1400);
        return;
    }
    if !cloud && !model_ready {
        overlays::pill_state(&app, "error", Some("Offline model missing"));
        finish_pill(&app, 3500);
        return;
    }

    let state = state_of(&app);
    maybe_store_audio(&state, &all_pcm, sample_rate);

    let developer_mode = state.setting("dictation.developerMode", "1") == "1";
    let tone_setting = state.setting("dictation.tone", "auto");
    let tone = if tone_setting == "auto" { None } else { Some(tone_setting) };
    let groq_key = state.setting("ai.groqApiKey", "").trim().to_string();
    let (dictionary, snippets) = {
        let conn = state.conn.lock().unwrap();
        (db::dictionary_for_pipeline(&conn), db::snippets_for_pipeline(&conn))
    };
    let app_id = target.get("appId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let is_console = target.get("isConsole").and_then(|v| v.as_bool()).unwrap_or(false);
    let auto_lists = !is_console;
    let pipeline_options = json!({
        "dictionary": dictionary,
        "snippets": snippets,
        "appId": if app_id.is_empty() { Value::Null } else { Value::String(app_id.clone()) },
        "developerMode": developer_mode,
        "autoLists": auto_lists,
        "style": tone.clone(),
    });

    let mut raw = String::new();
    let mut final_text = String::new();
    let mut used_cloud = false;

    // 1) Cloud path (Wispr-style): Groq Whisper for ASR, then Groq Llama for the
    //    grammar correction + formatting. The user's dictionary and snippets are
    //    exact rules, so they still apply on top of the AI output.
    if cloud {
        let hint = groq::asr_prompt(&pipeline_options["dictionary"]);
        let wav = util::wav_buffer(&all_pcm, sample_rate);
        logf!("cloud asr upload: {} bytes (wav)", wav.len());
        match groq::transcribe(&groq_key, wav, "wav", hint).await {
            Ok(text) => raw = text,
            Err(e) => {
                logf!("cloud asr failed, falling back to offline: {}", e);
                overlays::alert_show(
                    &app,
                    "fallback",
                    "Switched to offline speech",
                    "Cloud transcription failed. Using local base.en (weaker).",
                    false,
                    8000,
                );
            }
        }
        if !is_current(&app, gen) {
            return;
        }
        if !raw.trim().is_empty() {
            let word_count = raw.split_whitespace().count();
            if word_count <= 3 {
                final_text = pipeline::process_text(&app, &state.bridge, &raw, pipeline_options.clone()).await;
            } else {
                overlays::pill_state(&app, "transcribing", Some("Polishing"));
                let opts = groq::CleanOptions {
                    developer_mode,
                    auto_lists,
                    tone: tone.clone(),
                    context: target.get("textContext").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                };
                match groq::clean_text(&groq_key, &raw, opts).await {
                    Ok(result) => {
                        if result.used_fallback {
                            overlays::alert_show(&app, "fallback", "Weaker grammar model", "Primary LLM rate-limited. Using llama-3.1-8b-instant.", false, 7000);
                        }
                        if result.aborted {
                            overlays::alert_show(&app, "fallback", "Grammar polish skipped", "Cleanup output looked wrong. Using raw cloud transcript.", false, 7000);
                        }
                        final_text = pipeline::apply_user_rules(&app, &state.bridge, &result.text, pipeline_options.clone()).await;
                    }
                    Err(e) => {
                        // Cleanup unavailable: keep the accurate cloud transcript
                        // and run the deterministic pipeline on it rather than
                        // re-transcribing with the much weaker local model.
                        logf!("cloud cleanup failed, using raw cloud transcript: {}", e);
                        overlays::alert_show(&app, "fallback", "Grammar polish unavailable", "Cleanup failed. Using cloud speech with basic rules only.", false, 7000);
                        final_text = pipeline::process_text(&app, &state.bridge, &raw, pipeline_options.clone()).await;
                    }
                }
            }
            used_cloud = true;
        }
    }

    if !is_current(&app, gen) {
        return;
    }

    // 2) Offline fallback: local whisper + the deterministic rule pipeline. Uses
    //    the streamed segments when present, else transcribes the whole clip.
    if !used_cloud {
        if !parts.is_empty() {
            raw = parts.join(" ").split_whitespace().collect::<Vec<_>>().join(" ");
        } else if model_ready {
            let pcm = all_pcm.clone();
            let sr = sample_rate;
            match tauri::async_runtime::spawn_blocking(move || asr::transcribe(&pcm, MODEL, sr)).await {
                Ok(Ok(text)) => raw = text.trim().to_string(),
                Ok(Err(e)) => logf!("offline asr failed: {}", e),
                Err(e) => logf!("offline asr task failed: {}", e),
            }
        }
        if !is_current(&app, gen) {
            return;
        }
        if !raw.trim().is_empty() {
            final_text = pipeline::process_text(&app, &state.bridge, &raw, pipeline_options.clone()).await;
        }
    }

    logf!("asr raw: {:?} durMs={} cloud={}", raw, duration_ms, used_cloud);
    if !is_current(&app, gen) {
        return;
    }
    if raw.trim().is_empty() || final_text.trim().is_empty() {
        overlays::pill_state(&app, "info", Some("No speech detected"));
        finish_pill(&app, 1400);
        return;
    }

    *state.last_transcript.lock().unwrap() = final_text.clone();
    let transcript_id = {
        let conn = state.conn.lock().unwrap();
        db::save_transcript(
            &conn,
            &raw,
            &final_text,
            if app_id.is_empty() { None } else { Some(app_id.as_str()) },
            duration_ms,
        )
    };
    let _ = app.emit("transcript:new", json!({}));
    // Bottom-left card with the finished text, for apps ColdVoice cannot type
    // into: copy it from there, fix it, or open the main window.
    overlays::preview_show(&app, &final_text, transcript_id);

    // When "insert on release" is off, just copy — never auto-paste.
    if state.setting("dictation.insertOnRelease", "1") != "1" {
        state.clip_write(&final_text);
        overlays::pill_state(&app, "info", Some("Copied to clipboard"));
        finish_pill(&app, 1600);
        return;
    }

    // The shared safety gate decides whether this target may be typed into.
    let can_insert = pipeline::can_insert_into(&app, &state.bridge, target.clone()).await;
    if !is_current(&app, gen) {
        return;
    }

    let previous_clipboard = state.clip_read();
    state.clip_write(&final_text);
    let target_for_insert = target.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        insertion::insert_text(&target_for_insert, can_insert, is_console)
    })
    .await;
    let outcome = match outcome {
        Ok(o) => o,
        Err(e) => {
            logf!("insertion task failed: {}", e);
            overlays::pill_state(&app, "error", Some("Insertion failed"));
            finish_pill(&app, 3500);
            return;
        }
    };
    if !is_current(&app, gen) {
        return;
    }

    if !outcome.ok && outcome.reason == "password" {
        overlays::pill_state(&app, "info", Some("Copied (password prompt skipped)"));
        finish_pill(&app, 1800);
        return;
    }
    if outcome.mode == "clipboard" {
        overlays::pill_state(&app, "info", Some("Copied to clipboard"));
        finish_pill(&app, 1600);
        return;
    }
    // Pasted into a real field: hand the user's own clipboard back.
    if !previous_clipboard.is_empty() && previous_clipboard != final_text {
        state.clip_write(&previous_clipboard);
    }
    overlays::pill_state(&app, "done", None);
    finish_pill(&app, 500);
}

fn paste_last_transcript(app: &AppHandle) {
    let state = state_of(app);
    let text = state.last_transcript.lock().unwrap().clone();
    if text.trim().is_empty() {
        return;
    }
    if state.dictation.lock().unwrap().recording {
        return;
    }
    let target = insertion::focused_target();
    let is_console = target.get("isConsole").and_then(|v| v.as_bool()).unwrap_or(false);
    state.clip_write(&text);
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = insertion::paste_from_clipboard(is_console) {
            logf!("paste last transcript failed: {}", e);
        }
        // Keep the dictation on the clipboard for a manual paste if the chord
        // could not be delivered.
        state_of(&app).clip_write(&text);
    });
}

// --- microphone watch --------------------------------------------------------
// cpal has no hot-plug events, so the device list is polled. Connects are
// reported immediately; disconnects are debounced so a bouncing USB mic never
// flashes the "Mic is not ready" modal.
fn start_mic_watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut missing_since: Option<u128> = None;
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let present = audio::has_input_device();
            let label = if present { audio::default_device_label() } else { String::new() };
            let state = state_of(&app);
            let (was_connected, was_label) = {
                let mic = state.mic.lock().unwrap();
                (mic.connected, mic.label.clone())
            };

            if present {
                missing_since = None;
                if !was_connected {
                    {
                        let mut mic = state.mic.lock().unwrap();
                        mic.connected = true;
                        mic.label = label.clone();
                    }
                    logf!("mic: reconnected ({})", label);
                    broadcast_mic_status(&app);
                    let announce = {
                        let mut mic = state.mic.lock().unwrap();
                        let shown = mic.disconnect_alert_shown;
                        mic.disconnect_alert_shown = false;
                        shown
                    };
                    if announce {
                        overlays::alert_show(&app, "connected", "Microphone connected", &format!("Using: {}", label), false, 4000);
                    }
                    let hold = state.dictation.lock().unwrap().no_mic_hold;
                    if hold {
                        dismiss_no_mic_hold(&app);
                    }
                } else if !label.is_empty() && label != was_label {
                    {
                        let mut mic = state.mic.lock().unwrap();
                        mic.label = label.clone();
                    }
                    logf!("mic: switched to {}", label);
                    broadcast_mic_status(&app);
                    overlays::alert_show(&app, "switch", "Microphone switched", &format!("Now using: {}", label), false, 5000);
                }
                continue;
            }

            // Missing. Hold the alert briefly so a quick bounce never shows a
            // false "disconnected".
            let now = util::now_ms();
            let since = *missing_since.get_or_insert(now);
            if !was_connected || now - since < 1200 {
                continue;
            }
            {
                let mut mic = state.mic.lock().unwrap();
                mic.connected = false;
                mic.label = String::new();
                mic.disconnect_alert_shown = true;
            }
            logf!("mic: disconnected");
            broadcast_mic_status(&app);
            overlays::alert_show(
                &app,
                "disconnect",
                "Microphone disconnected",
                "ColdVoice lost your microphone. Check the cable, then plug it back in.",
                true,
                0,
            );
        }
    });
}

fn broadcast_mic_status(app: &AppHandle) {
    let state = state_of(app);
    let mic = state.mic.lock().unwrap();
    let _ = app.emit("mic:status", json!({ "connected": mic.connected, "label": mic.label }));
}

fn start_net_watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        let online = util::probe_online();
        let state = state_of(&app);
        let was = state.online.swap(online, Ordering::SeqCst);
        if was != online {
            logf!("connectivity: {}", if online { "online" } else { "offline" });
            let _ = app.emit("app:connectivity", json!({ "online": online }));
        }
        std::thread::sleep(Duration::from_secs(8));
    });
}

// --- shortcuts ---------------------------------------------------------------
fn register_escape(app: &AppHandle) {
    unregister_escape(app);
    if let Ok(shortcut) = "Escape".parse::<Shortcut>() {
        let _ = app.global_shortcut().register(shortcut.clone());
        state_of(app).shortcuts.lock().unwrap().push((shortcut, "cancel".into()));
    }
}

fn unregister_escape(app: &AppHandle) {
    let state = state_of(app);
    let dropped: Vec<Shortcut> = {
        let mut shortcuts = state.shortcuts.lock().unwrap();
        let mut dropped = Vec::new();
        let mut kept = Vec::new();
        for (shortcut, id) in shortcuts.drain(..) {
            if id == "cancel" {
                dropped.push(shortcut);
            } else {
                kept.push((shortcut, id));
            }
        }
        *shortcuts = kept;
        dropped
    };
    for shortcut in dropped {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

fn refresh_hotkeys(app: &AppHandle) {
    let state = state_of(app);
    let toggle = state.setting("shortcut.handsFreeToggle", "Ctrl+1");
    let hold = state.setting("shortcut.holdToDictate", "Ctrl+CapsLock");
    let paste = state.setting("shortcut.pasteLastTranscriptAlt", "Alt+Shift+Z");
    // Pause ships unbound so it can never collide with an existing shortcut.
    let pause = state.setting("shortcut.pauseResume", "");

    let _ = app.global_shortcut().unregister_all();
    state.shortcuts.lock().unwrap().clear();

    let mut wanted: Vec<(String, &str)> = vec![
        (toggle.clone(), "toggle"),
        (hold.clone(), "hold"),
        (paste.clone(), "paste"),
    ];
    if !pause.trim().is_empty() {
        wanted.push((pause.clone(), "pauseResume"));
    }

    let mut failed: Vec<String> = Vec::new();
    for (accel, id) in wanted {
        if accel.trim().is_empty() {
            continue;
        }
        match accel.parse::<Shortcut>() {
            Ok(shortcut) => match app.global_shortcut().register(shortcut.clone()) {
                Ok(()) => state.shortcuts.lock().unwrap().push((shortcut, id.to_string())),
                Err(e) => {
                    logf!("shortcut {} ({}) could not be registered: {}", accel, id, e);
                    failed.push(accel);
                }
            },
            Err(e) => {
                logf!("shortcut {} ({}) could not be parsed: {}", accel, id, e);
                failed.push(accel);
            }
        }
    }
    logf!("dictation armed: toggle={} hold={} paste={} pause={}", toggle, hold, paste, if pause.is_empty() { "not set" } else { pause.as_str() });

    if !failed.is_empty() {
        let message = format!("{} could not be bound. Pick different keys in Settings.", failed.join(", "));
        overlays::alert_show(app, "fallback", "Shortcut unavailable", &message, false, 9000);
    }
}

fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, state: ShortcutState) {
    let id = {
        let app_state = state_of(app);
        let shortcuts = app_state.shortcuts.lock().unwrap();
        shortcuts.iter().find(|(s, _)| s == shortcut).map(|(_, id)| id.clone())
    };
    let Some(id) = id else { return };
    match state {
        ShortcutState::Pressed => match id.as_str() {
            "toggle" => dispatch(app, Action::Toggle),
            "hold" => dispatch(app, Action::StartHold),
            "paste" => dispatch(app, Action::PasteLast),
            "pauseResume" => dispatch(app, Action::PauseResume),
            "cancel" => dispatch(app, Action::Cancel),
            _ => {}
        },
        ShortcutState::Released => {
            if id == "hold" {
                dispatch(app, Action::StopHold);
            }
        }
    }
}

// --- settings side effects ---------------------------------------------------
fn apply_launch_at_login(enabled: bool) {
    let Some(config) = dirs::config_dir() else { return };
    let dir = config.join("autostart");
    let file = dir.join("coldvoice.desktop");
    if !enabled {
        let _ = std::fs::remove_file(file);
        return;
    }
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let exec = std::env::var("APPIMAGE")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::current_exe().ok().map(|p| p.display().to_string()))
        .unwrap_or_else(|| "coldvoice".into());
    let desktop = format!(
        "[Desktop Entry]\nType=Application\nName=ColdVoice\nExec={}\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n",
        exec
    );
    let _ = std::fs::write(file, desktop);
}

fn open_sound_settings() {
    for (cmd, args) in [
        ("gnome-control-center", vec!["sound"]),
        ("systemsettings", vec!["kcm_pulseaudio"]),
        ("pavucontrol", vec![]),
    ] {
        if insertion::have_tool(cmd) {
            let _ = std::process::Command::new(cmd).args(args).spawn();
            return;
        }
    }
}

fn apply_side_effects(app: &AppHandle, key: &str) {
    match key {
        "shortcut.handsFreeToggle" | "shortcut.holdToDictate" | "shortcut.pasteLastTranscriptAlt" | "shortcut.pauseResume" => {
            refresh_hotkeys(app)
        }
        "app.launchAtLogin" => apply_launch_at_login(state_of(app).setting("app.launchAtLogin", "0") == "1"),
        "dictation.showBarAlways" => {
            let recording = state_of(app).dictation.lock().unwrap().recording;
            if !recording {
                finish_pill(app, 0);
            }
        }
        _ => {}
    }
}

// --- commands ----------------------------------------------------------------
#[tauri::command]
fn db_get_settings(state: State<'_, AppState>) -> Value {
    let conn = state.conn.lock().unwrap();
    db::all_settings(&conn)
}

#[tauri::command]
fn db_set_setting(app: AppHandle, state: State<'_, AppState>, key: String, value: String) -> bool {
    {
        let conn = state.conn.lock().unwrap();
        db::set_setting(&conn, &key, &value);
    }
    apply_side_effects(&app, &key);
    true
}

#[tauri::command]
fn db_list_dictionary(state: State<'_, AppState>) -> Value {
    let conn = state.conn.lock().unwrap();
    db::list_dictionary(&conn)
}

#[tauri::command]
fn db_upsert_dictionary(state: State<'_, AppState>, entry: Value) -> i64 {
    let conn = state.conn.lock().unwrap();
    db::upsert_dictionary(&conn, &entry)
}

#[tauri::command]
fn db_delete_dictionary(state: State<'_, AppState>, id: i64) -> bool {
    let conn = state.conn.lock().unwrap();
    db::delete_dictionary(&conn, id);
    true
}

#[tauri::command]
fn db_list_snippets(state: State<'_, AppState>) -> Value {
    let conn = state.conn.lock().unwrap();
    db::list_snippets(&conn)
}

#[tauri::command]
fn db_upsert_snippet(state: State<'_, AppState>, snippet: Value) -> i64 {
    let conn = state.conn.lock().unwrap();
    db::upsert_snippet(&conn, &snippet)
}

#[tauri::command]
fn db_delete_snippet(state: State<'_, AppState>, id: i64) -> bool {
    let conn = state.conn.lock().unwrap();
    db::delete_snippet(&conn, id);
    true
}

#[tauri::command]
fn db_list_transcripts(state: State<'_, AppState>, limit: Option<i64>) -> Value {
    let conn = state.conn.lock().unwrap();
    db::list_transcripts(&conn, limit.unwrap_or(200))
}

#[tauri::command]
fn db_update_transcript(state: State<'_, AppState>, id: i64, text: String) -> bool {
    let conn = state.conn.lock().unwrap();
    db::update_transcript(&conn, id, &text);
    true
}

#[tauri::command]
fn db_delete_transcript(state: State<'_, AppState>, id: i64) -> bool {
    let conn = state.conn.lock().unwrap();
    db::delete_transcript(&conn, id);
    true
}

#[tauri::command]
fn db_clear_transcripts(state: State<'_, AppState>) -> bool {
    let conn = state.conn.lock().unwrap();
    db::clear_transcripts(&conn);
    true
}

#[tauri::command]
fn db_transcript_stats(state: State<'_, AppState>) -> Value {
    let conn = state.conn.lock().unwrap();
    db::transcript_stats(&conn)
}

#[tauri::command]
fn asr_status() -> Value {
    json!({ "ready": asr::is_ready(MODEL), "setup": asr::setup_message(MODEL) })
}

#[tauri::command]
fn ai_status(state: State<'_, AppState>) -> Value {
    let has_key = state.setting("ai.groqApiKey", "").trim().len() > 10;
    let enabled = state.setting("ai.enabled", "1") == "1";
    let online = state.online.load(Ordering::SeqCst);
    json!({
        "hasKey": has_key,
        "enabled": enabled,
        "online": online,
        "active": enabled && has_key && online,
    })
}

#[tauri::command]
async fn ai_test(state: State<'_, AppState>) -> Result<Value, String> {
    let key = state.setting("ai.groqApiKey", "").trim().to_string();
    Ok(groq::test(&key).await)
}

#[tauri::command]
fn app_is_online(state: State<'_, AppState>) -> Value {
    json!({ "online": state.online.load(Ordering::SeqCst) })
}

#[tauri::command]
fn app_open_sound_settings() -> bool {
    open_sound_settings();
    true
}

#[tauri::command]
fn auth_status(state: State<'_, AppState>) -> Value {
    let raw = state.setting(auth::SESSION_KEY, "");
    auth::status_from(&raw, state.online.load(Ordering::SeqCst))
}

#[tauri::command]
async fn auth_sign_in(state: State<'_, AppState>, mode: String, email: String, password: String) -> Result<Value, String> {
    let email = email.trim().to_string();
    if email.is_empty() || password.is_empty() {
        return Ok(json!({ "ok": false, "error": "Enter your email and password." }));
    }
    // Hard rule: no sign in / sign up while offline.
    if !state.online.load(Ordering::SeqCst) {
        return Ok(json!({
            "ok": false,
            "error": "You are offline. Sign in needs a connection — your existing session still works offline."
        }));
    }
    let session = match auth::read_config() {
        Some(cfg) => match auth::supabase_sign_in(&cfg, &mode, &email, &password).await {
            Ok(s) => s,
            Err(e) => return Ok(json!({ "ok": false, "error": e })),
        },
        // No backend configured: a local-only account keeps the flow working.
        None => auth::local_session(&email),
    };
    let raw = serde_json::to_string(&session).unwrap_or_default();
    state.set_setting(auth::SESSION_KEY, &raw);
    logf!("auth: signed in {}", email);
    Ok(json!({ "ok": true, "status": auth::status_from(&raw, true) }))
}

#[tauri::command]
fn auth_sign_out(state: State<'_, AppState>) -> Value {
    state.set_setting(auth::SESSION_KEY, "");
    logf!("auth: signed out");
    json!({ "ok": true, "status": auth::status_from("", state.online.load(Ordering::SeqCst)) })
}

#[tauri::command]
fn mic_status(state: State<'_, AppState>) -> Value {
    let mic = state.mic.lock().unwrap();
    json!({ "connected": mic.connected, "label": mic.label })
}

#[tauri::command]
fn mic_list() -> Value {
    Value::Array(audio::list_devices())
}

#[tauri::command]
fn mic_preview_start(app: AppHandle, state: State<'_, AppState>, device_ids: Vec<String>) -> bool {
    let mut slot = state.preview.lock().unwrap();
    if let Some(existing) = slot.take() {
        existing.stop();
    }
    *slot = Some(audio::start_preview(app, device_ids));
    true
}

#[tauri::command]
fn mic_preview_stop(state: State<'_, AppState>) -> bool {
    if let Some(existing) = state.preview.lock().unwrap().take() {
        existing.stop();
    }
    true
}

#[tauri::command]
fn mic_verify(device_id: String) -> Result<bool, String> {
    audio::verify_device(&device_id).map(|_| true)
}

fn run_pill_action(app: &AppHandle, action: &str) {
    let no_mic_hold = state_of(app).dictation.lock().unwrap().no_mic_hold;
    if no_mic_hold {
        dismiss_no_mic_hold(app);
        return;
    }
    match action {
        "cancel" => cancel_dictation(app),
        "pause" => toggle_pause(app),
        "confirm" => stop_dictation(app),
        _ => {}
    }
}

#[tauri::command]
fn pill_action(app: AppHandle, action: String) -> bool {
    dispatch(&app, Action::Pill(action));
    true
}

#[tauri::command]
fn pill_save_position(app: AppHandle, state: State<'_, AppState>, scale: Option<f64>) -> bool {
    if let Some((x, y)) = overlays::pill_position(&app) {
        state.set_setting("pill.x", &x.round().to_string());
        state.set_setting("pill.y", &y.round().to_string());
    }
    if let Some(scale) = scale {
        let clamped = scale.clamp(0.6, 4.0);
        if (clamped - pill_scale(&state)).abs() > 0.01 {
            state.set_setting("pill.scale", &format!("{:.2}", clamped));
        }
    }
    true
}

#[tauri::command]
fn alert_dismiss(app: AppHandle) -> bool {
    logf!("alert: dismissed");
    overlays::alert_hide(&app);
    true
}

#[tauri::command]
fn preview_action(app: AppHandle, state: State<'_, AppState>, action: String, text: Option<String>) -> bool {
    logf!("preview: {}", action);
    match action.as_str() {
        "copy" => {
            let body = text.unwrap_or_default();
            if !body.trim().is_empty() {
                state.clip_write(&body);
            }
        }
        // Text corrected in the card replaces the saved row and becomes what
        // the paste shortcut hands out, so a fixed transcript is fixed
        // everywhere.
        "save" => {
            let body = text.unwrap_or_default().trim().to_string();
            if body.is_empty() {
                return true;
            }
            *state.last_transcript.lock().unwrap() = body.clone();
            if let Some(id) = overlays::preview_id() {
                let conn = state.conn.lock().unwrap();
                db::update_transcript(&conn, id, &body);
                drop(conn);
                let _ = app.emit("transcript:new", json!({}));
            }
        }
        "open" => {
            overlays::preview_hide(&app);
            show_main(&app);
        }
        "close" => overlays::preview_hide(&app),
        _ => {}
    }
    true
}

#[tauri::command]
fn preview_resize(app: AppHandle, height: f64) -> bool {
    overlays::preview_resize(&app, height);
    true
}

#[tauri::command]
fn pipeline_result(state: State<'_, AppState>, id: u64, result: Value) -> bool {
    state.bridge.resolve(id, result);
    true
}

#[tauri::command]
async fn update_check(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let current = app.package_info().version.to_string();
    let result = updater::check(&current).await;
    state.update.lock().unwrap().artifact_url = result.artifact_url;
    Ok(result.value)
}

#[tauri::command]
async fn update_download(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let (url, ready, busy) = {
        let u = state.update.lock().unwrap();
        (u.artifact_url.clone(), u.ready_path.clone(), u.downloading)
    };
    if busy {
        return Ok(json!({ "error": "An update is already downloading." }));
    }
    if let Some(path) = ready {
        if path.exists() {
            return Ok(json!({ "ok": true, "ready": true }));
        }
    }
    if url.is_empty() {
        return Ok(json!({ "error": "Check for updates first." }));
    }
    state.update.lock().unwrap().downloading = true;
    let result = updater::download(&app, &url).await;
    let mut u = state.update.lock().unwrap();
    u.downloading = false;
    match result {
        Ok(path) => {
            u.ready_path = Some(path);
            Ok(json!({ "ok": true, "ready": true }))
        }
        Err(e) => Ok(json!({ "error": e })),
    }
}

#[tauri::command]
fn update_install(app: AppHandle, state: State<'_, AppState>) -> Value {
    let path = state.update.lock().unwrap().ready_path.clone();
    let Some(path) = path else {
        return json!({ "error": "Download the update first." });
    };
    if !path.exists() {
        return json!({ "error": "Download the update first." });
    }
    match updater::install(&path) {
        Ok(()) => {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(800));
                app.exit(0);
            });
            json!({ "ok": true })
        }
        Err(e) => json!({ "error": e }),
    }
}

// Seed any settings missing from older databases.
fn seed_defaults(conn: &Connection) {
    let defaults: [(&str, &str); 13] = [
        ("shortcut.handsFreeToggle", "Ctrl+1"),
        ("shortcut.holdToDictate", "Ctrl+CapsLock"),
        ("shortcut.cancel", "Esc"),
        ("shortcut.pasteLastTranscriptAlt", "Alt+Shift+Z"),
        ("shortcut.pauseResume", ""),
        ("dictation.insertOnRelease", "1"),
        ("dictation.showBarAlways", "0"),
        ("dictation.developerMode", "1"),
        ("dictation.tone", "auto"),
        ("app.launchAtLogin", "0"),
        ("privacy.storeTranscripts", "1"),
        ("privacy.storeAudio", "0"),
        ("ai.enabled", "1"),
    ];
    for (key, value) in defaults {
        if !db::has_setting(conn, key) {
            db::set_setting(conn, key, value);
        }
    }
    if !db::has_setting(conn, "ai.groqApiKey") {
        db::set_setting(conn, "ai.groqApiKey", &std::env::var("GROQ_API_KEY").unwrap_or_default());
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open ColdVoice", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Start / stop dictation", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &toggle, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id("coldvoice").tooltip("ColdVoice").menu(&menu);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => dispatch(app, Action::ShowMain),
            "toggle" => dispatch(app, Action::Toggle),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn show_main(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = handle.get_webview_window("main") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::open();
    seed_defaults(&conn);

    let state = AppState {
        conn: Mutex::new(conn),
        bridge: pipeline::Bridge::new(),
        online: AtomicBool::new(false),
        generation: AtomicU64::new(0),
        dictation: Mutex::new(Dictation::default()),
        mic: Mutex::new(MicState { connected: audio::has_input_device(), label: audio::default_device_label(), disconnect_alert_shown: false }),
        last_transcript: Mutex::new(String::new()),
        clipboard: Mutex::new(start_clipboard()),
        preview: Mutex::new(None),
        update: Mutex::new(UpdateState::default()),
        shortcuts: Mutex::new(Vec::new()),
    };

    tauri::Builder::default()
        // Only one ColdVoice may run, or two key listeners would fight over the
        // mic. A second launch (`coldvoice --toggle`) drives the running one —
        // that is how dictation is triggered on Wayland, where an app cannot
        // grab global hotkeys for itself.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.iter().any(|a| a == "--toggle") {
                dispatch(app, Action::Toggle);
            } else {
                dispatch(app, Action::ShowMain);
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| on_shortcut(app, shortcut, event.state()))
                .build(),
        )
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            db_get_settings,
            db_set_setting,
            db_list_dictionary,
            db_upsert_dictionary,
            db_delete_dictionary,
            db_list_snippets,
            db_upsert_snippet,
            db_delete_snippet,
            db_list_transcripts,
            db_update_transcript,
            db_delete_transcript,
            db_clear_transcripts,
            db_transcript_stats,
            asr_status,
            ai_status,
            ai_test,
            app_is_online,
            app_open_sound_settings,
            auth_status,
            auth_sign_in,
            auth_sign_out,
            mic_status,
            mic_list,
            mic_preview_start,
            mic_preview_stop,
            mic_verify,
            pill_action,
            pill_save_position,
            alert_dismiss,
            preview_action,
            preview_resize,
            pipeline_result,
            update_check,
            update_download,
            update_install,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            logf!("app ready");
            if let Ok(dir) = app.path().resource_dir() {
                asr::init(dir);
            }
            start_action_worker(handle.clone());
            build_tray(&handle)?;
            refresh_hotkeys(&handle);
            apply_launch_at_login(state_of(&handle).setting("app.launchAtLogin", "0") == "1");
            start_mic_watch(handle.clone());
            start_net_watch(handle.clone());

            // Never start up with a stray pill on screen.
            if state_of(&handle).setting("dictation.showBarAlways", "0") == "1" {
                finish_pill(&handle, 200);
            } else {
                overlays::pill_hide(&handle);
            }

            // Warm the model so the first real dictation isn't slow: this pulls
            // the model file into the OS cache and primes whisper's code paths.
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_millis(1500));
                if asr::is_ready(MODEL) {
                    let _ = asr::transcribe(&vec![0i16; 16000], MODEL, 16000);
                }
            });

            // Tell the user once if nothing on this session can deliver a paste.
            if let Some(problem) = insertion::tooling_problem() {
                let handle = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    overlays::alert_show(&handle, "fallback", "Cannot type into other apps", &problem, false, 12000);
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep running in the tray instead of quitting: closing the main
            // window only hides it, the same as on Windows.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running ColdVoice");
}
