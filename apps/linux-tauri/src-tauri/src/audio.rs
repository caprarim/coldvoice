// Microphone capture for Linux via cpal (ALSA / PipeWire). This replaces the
// hidden Electron recorder window: the segmentation, adaptive noise floor,
// silence trimming and quiet-speech normalisation are ports of
// apps/windows-electron/src/renderer/recorder.js, so both platforms hand the
// same kind of audio to whisper.
//
// Segments are flushed at natural pauses and transcribed in the background
// while the user is still speaking, so on stop only the final tail is left.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::mpsc::UnboundedSender as Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::util;

const TARGET_RATE: u32 = 16000;
const VOICE_RMS_MIN: f32 = 0.003;
const NOISE_FLOOR_MAX: f32 = 0.02;
const SEGMENT_MIN_MS: f64 = 1500.0;
const SEGMENT_MAX_MS: f64 = 7000.0;
const SEGMENT_HARD_MS: f64 = 12000.0;
const SILENCE_HOLD_MS: f64 = 450.0;
const SILENCE_DIP_MS: f64 = 150.0;
const BUFFER_HARD_MS: f64 = 120000.0;
const QUIET_RMS: f32 = 0.015;
const QUIET_MIN_VOICED_MS: f64 = 2500.0;
const LOUD_RMS: f32 = 0.35;
const LOUD_HOLD_MS: f64 = 600.0;
const CLIP_SAMPLE: f32 = 0.98;
const CLIP_FRACTION: f64 = 0.003;
const TRIM_FRAME_MS: u32 = 20;
const TRIM_PAD_MS: u32 = 250;

pub enum AudioEvent {
    Segment { pcm: Vec<i16>, sample_rate: u32, samples: usize, rms: f32 },
    Done,
    Error(String),
}

pub struct CaptureHandle {
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
}

impl CaptureHandle {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
    }
    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
    }
    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
}

struct Segmenter {
    pending: Vec<f32>,
    input_rate: u32,
    noise_floor: f32,
    last_voice_at: u128,
    last_level_sent: u128,
    segment_enabled: bool,
    clip_count: f64,
    clip_window: f64,
    hot_ms: f64,
    voiced_ms: f64,
    voiced_quiet_ms: f64,
    voiced_max_rms: f32,
    level_loud_sent: bool,
    level_quiet_sent: bool,
}

impl Segmenter {
    fn new(input_rate: u32, segment_enabled: bool) -> Self {
        Self {
            pending: Vec::new(),
            input_rate,
            noise_floor: 0.001,
            last_voice_at: util::now_ms(),
            last_level_sent: 0,
            segment_enabled,
            clip_count: 0.0,
            clip_window: 0.0,
            hot_ms: 0.0,
            voiced_ms: 0.0,
            voiced_quiet_ms: 0.0,
            voiced_max_rms: 0.0,
            level_loud_sent: false,
            level_quiet_sent: false,
        }
    }

    fn voice_threshold(&self) -> f32 {
        (self.noise_floor * 2.5).max(VOICE_RMS_MIN)
    }
}

fn rms_of(buf: &[f32]) -> f32 {
    if buf.is_empty() {
        return 0.0;
    }
    let sum: f32 = buf.iter().map(|s| s * s).sum();
    (sum / buf.len() as f32).sqrt()
}

fn downsample(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (input.len() as f64 / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let start = (i as f64 * ratio).floor() as usize;
        let end = (((i + 1) as f64 * ratio).floor() as usize).min(input.len());
        if end <= start {
            out.push(0.0);
            continue;
        }
        let slice = &input[start..end];
        out.push(slice.iter().sum::<f32>() / slice.len() as f32);
    }
    out
}

// Trim leading/trailing sub-threshold audio, keeping a little padding so words
// are never clipped. Whisper hallucinates phrases like "Thank you." on silence,
// and every segment ends with the silence that triggered its flush. Returns
// None when no frame reaches the threshold.
fn trim_silence(buf: &[f32], rate: u32, threshold: f32) -> Option<(usize, usize)> {
    let frame = ((rate * TRIM_FRAME_MS) as usize / 1000).max(1);
    let frames = buf.len() / frame;
    let mut first: isize = -1;
    let mut last: isize = -1;
    for f in 0..frames {
        let start = f * frame;
        let slice = &buf[start..start + frame];
        if rms_of(slice) >= threshold {
            if first < 0 {
                first = f as isize;
            }
            last = f as isize;
        }
    }
    if first < 0 {
        return None;
    }
    let pad = (rate * TRIM_PAD_MS) as usize / 1000;
    let from = (first as usize * frame).saturating_sub(pad);
    let to = (((last as usize) + 1) * frame + pad).min(buf.len());
    Some((from, to))
}

// Peak-normalize quiet speech so whisper gets a strong signal even when the
// user is far from the mic. Gain is capped so noise-only audio is not blown up
// into something whisper hallucinates on, and loud audio is left untouched.
fn normalize_quiet(buf: &[f32], rms: f32) -> Vec<f32> {
    if rms < 0.0015 {
        return buf.to_vec();
    }
    let peak = buf.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    if peak < 1e-6 {
        return buf.to_vec();
    }
    let gain = (0.9 / peak).min(12.0);
    if gain <= 1.05 {
        return buf.to_vec();
    }
    buf.iter().map(|s| s * gain).collect()
}

fn float_to_pcm16(buf: &[f32]) -> Vec<i16> {
    buf.iter()
        .map(|s| {
            let clamped = s.clamp(-1.0, 1.0);
            if clamped < 0.0 {
                (clamped * 32768.0) as i16
            } else {
                (clamped * 32767.0) as i16
            }
        })
        .collect()
}

fn flush_segment(seg: &mut Segmenter, tx: &Sender<AudioEvent>) {
    if seg.pending.is_empty() {
        return;
    }
    let merged: Vec<f32> = std::mem::take(&mut seg.pending);
    let down = downsample(&merged, seg.input_rate, TARGET_RATE);
    let threshold = seg.voice_threshold();
    let trimmed = trim_silence(&down, TARGET_RATE, threshold);
    let voiced: &[f32] = match trimmed {
        Some((from, to)) => &down[from..to],
        None => &down[..],
    };
    let rms = rms_of(voiced);
    // The reported rms is the ORIGINAL (pre-normalization) level so the caller
    // can still reject true silence.
    let reported = if trimmed.is_some() { rms } else { rms_of(&down) };
    let pcm = float_to_pcm16(&normalize_quiet(voiced, rms));
    let _ = tx.send(AudioEvent::Segment {
        samples: voiced.len(),
        pcm,
        sample_rate: TARGET_RATE,
        rms: reported,
    });
}

fn process_frames(
    seg: &mut Segmenter,
    mono: &[f32],
    app: &AppHandle,
    tx: &Sender<AudioEvent>,
    status_tx: &Sender<MicSignal>,
) {
    seg.pending.extend_from_slice(mono);
    let rms = rms_of(mono);
    let now = util::now_ms();

    // Track the noise floor: follow drops quickly, climb slowly so speech
    // doesn't drag it up. Speech = meaningfully above the floor.
    if rms < seg.noise_floor {
        seg.noise_floor = seg.noise_floor * 0.8 + rms * 0.2;
    } else {
        seg.noise_floor = (seg.noise_floor * 0.995 + rms * 0.005).min(NOISE_FLOOR_MAX);
    }
    let threshold = seg.voice_threshold();
    if rms >= threshold {
        seg.last_voice_at = now;
    }

    let buf_ms = (mono.len() as f64 / seg.input_rate as f64) * 1000.0;
    let clipped = mono.iter().filter(|s| s.abs() >= CLIP_SAMPLE).count() as f64;
    seg.clip_count += clipped;
    seg.clip_window += mono.len() as f64;
    if rms >= LOUD_RMS {
        seg.hot_ms += buf_ms;
    } else {
        seg.hot_ms = (seg.hot_ms - buf_ms).max(0.0);
    }
    if rms >= threshold {
        seg.voiced_ms += buf_ms;
        if rms > seg.voiced_max_rms {
            seg.voiced_max_rms = rms;
        }
        if rms < QUIET_RMS {
            seg.voiced_quiet_ms += buf_ms;
        }
    }
    if seg.clip_window >= seg.input_rate as f64 {
        let clip_frac = seg.clip_count / seg.clip_window;
        if !seg.level_loud_sent && (clip_frac >= CLIP_FRACTION || seg.hot_ms >= LOUD_HOLD_MS) {
            seg.level_loud_sent = true;
            let _ = status_tx.send(MicSignal::TooLoud);
        }
        if !seg.level_quiet_sent
            && !seg.level_loud_sent
            && seg.voiced_ms >= QUIET_MIN_VOICED_MS
            && seg.voiced_max_rms < QUIET_RMS * 1.3
            && seg.voiced_quiet_ms / seg.voiced_ms > 0.9
        {
            seg.level_quiet_sent = true;
            let _ = status_tx.send(MicSignal::TooQuiet);
        }
        seg.clip_count = 0.0;
        seg.clip_window = 0.0;
    }

    // Stream a coarse level (~25 fps) for the live waveform. The curve is
    // compressed so quiet far-from-mic speech still visibly registers.
    if now - seg.last_level_sent > 40 {
        seg.last_level_sent = now;
        let level = ((rms * 8.0).powf(0.7)).min(1.0);
        let _ = app.emit("pill:level", serde_json::json!({ "level": level }));
    }

    // Flush at a natural pause, or once the segment gets long.
    let seg_ms = (seg.pending.len() as f64 / seg.input_rate as f64) * 1000.0;
    let silence_ms = (now - seg.last_voice_at) as f64;
    if seg.segment_enabled {
        if seg_ms >= SEGMENT_HARD_MS
            || (seg_ms >= SEGMENT_MIN_MS && silence_ms >= SILENCE_HOLD_MS)
            || (seg_ms >= SEGMENT_MAX_MS && silence_ms >= SILENCE_DIP_MS)
        {
            flush_segment(seg, tx);
        }
    } else if seg_ms >= BUFFER_HARD_MS {
        flush_segment(seg, tx);
    }
}

pub enum MicSignal {
    TooLoud,
    TooQuiet,
}

fn to_mono(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    data.chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect()
}

pub fn list_devices() -> Vec<serde_json::Value> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();
    let mut out = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                let is_default = name == default_name;
                out.push(serde_json::json!({
                    "deviceId": name,
                    "label": name,
                    "default": is_default,
                }));
            }
        }
    }
    out
}

pub fn default_device_label() -> String {
    cpal::default_host()
        .default_input_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default()
}

pub fn has_input_device() -> bool {
    let host = cpal::default_host();
    if host.default_input_device().is_some() {
        return true;
    }
    host.input_devices().map(|mut d| d.next().is_some()).unwrap_or(false)
}

fn pick_device(device_id: &str) -> Option<cpal::Device> {
    let host = cpal::default_host();
    if !device_id.is_empty() {
        if let Ok(devices) = host.input_devices() {
            for device in devices {
                if device.name().ok().as_deref() == Some(device_id) {
                    return Some(device);
                }
            }
        }
    }
    // The pinned mic is gone: fall back to the system default rather than
    // refusing to record.
    host.default_input_device()
}

// Open the mic and stream segments until stop() is called. The cpal stream is
// not Send, so it lives on its own thread for the whole dictation.
pub fn start_capture(
    app: AppHandle,
    device_id: String,
    segment_enabled: bool,
    tx: Sender<AudioEvent>,
    status_tx: Sender<MicSignal>,
) -> Result<CaptureHandle, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let handle = CaptureHandle { stop: stop.clone(), paused: paused.clone() };
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

    std::thread::spawn(move || {
        let device = match pick_device(&device_id) {
            Some(d) => d,
            None => {
                let _ = ready_tx.send(Err("No microphone is available.".into()));
                return;
            }
        };
        let supported = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Microphone could not start: {}", e)));
                return;
            }
        };
        let sample_format = supported.sample_format();
        let channels = supported.channels() as usize;
        let input_rate = supported.sample_rate().0;
        let config: cpal::StreamConfig = supported.into();

        let seg = Arc::new(Mutex::new(Segmenter::new(input_rate, segment_enabled)));
        let err_seen = Arc::new(Mutex::new(Option::<String>::None));

        let build = |fmt: cpal::SampleFormat| -> Result<cpal::Stream, String> {
            let seg = seg.clone();
            let app = app.clone();
            let tx = tx.clone();
            let status_tx = status_tx.clone();
            let paused = paused.clone();
            let err_seen_cb = err_seen.clone();
            let err_fn = move |e: cpal::StreamError| {
                if let Ok(mut slot) = err_seen_cb.lock() {
                    *slot = Some(e.to_string());
                }
            };
            match fmt {
                cpal::SampleFormat::F32 => device
                    .build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            if paused.load(Ordering::SeqCst) {
                                return;
                            }
                            let mono = to_mono(data, channels);
                            if let Ok(mut s) = seg.lock() {
                                process_frames(&mut s, &mono, &app, &tx, &status_tx);
                            }
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| e.to_string()),
                cpal::SampleFormat::I16 => device
                    .build_input_stream(
                        &config,
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            if paused.load(Ordering::SeqCst) {
                                return;
                            }
                            let floats: Vec<f32> = data.iter().map(|s| *s as f32 / 32768.0).collect();
                            let mono = to_mono(&floats, channels);
                            if let Ok(mut s) = seg.lock() {
                                process_frames(&mut s, &mono, &app, &tx, &status_tx);
                            }
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| e.to_string()),
                cpal::SampleFormat::U16 => device
                    .build_input_stream(
                        &config,
                        move |data: &[u16], _: &cpal::InputCallbackInfo| {
                            if paused.load(Ordering::SeqCst) {
                                return;
                            }
                            let floats: Vec<f32> =
                                data.iter().map(|s| (*s as f32 - 32768.0) / 32768.0).collect();
                            let mono = to_mono(&floats, channels);
                            if let Ok(mut s) = seg.lock() {
                                process_frames(&mut s, &mono, &app, &tx, &status_tx);
                            }
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| e.to_string()),
                other => Err(format!("Unsupported sample format: {:?}", other)),
            }
        };

        let stream = match build(sample_format) {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(e));
                return;
            }
        };
        if let Err(e) = stream.play() {
            let _ = ready_tx.send(Err(e.to_string()));
            return;
        }
        let _ = ready_tx.send(Ok(()));

        while !stop.load(Ordering::SeqCst) {
            if let Ok(slot) = err_seen.lock() {
                if let Some(msg) = slot.clone() {
                    drop(slot);
                    let _ = tx.send(AudioEvent::Error(msg));
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(40));
        }

        drop(stream);
        if let Ok(mut s) = seg.lock() {
            flush_segment(&mut s, &tx); // final tail segment, if any
        }
        let _ = tx.send(AudioEvent::Done);
    });

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("Microphone did not start in time.".into()),
    }
}

// --- live level preview for the Settings microphone picker -------------------
// Every listed input gets its own short-lived capture stream while the picker is
// open, so each row shows a real, flowing level meter. All streams are torn down
// the moment the picker closes.
pub struct PreviewHandle {
    stop: Arc<AtomicBool>,
}

impl PreviewHandle {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

pub fn start_preview(app: AppHandle, device_ids: Vec<String>) -> PreviewHandle {
    let stop = Arc::new(AtomicBool::new(false));
    for id in device_ids {
        let stop = stop.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            let device = match pick_device(&id) {
                Some(d) => d,
                None => {
                    let _ = app.emit("mic:dead", serde_json::json!({ "deviceId": id.clone() }));
                    return;
                }
            };
            let supported = match device.default_input_config() {
                Ok(c) => c,
                Err(_) => {
                    let _ = app.emit("mic:dead", serde_json::json!({ "deviceId": id.clone() }));
                    return;
                }
            };
            let channels = supported.channels() as usize;
            let sample_format = supported.sample_format();
            let config: cpal::StreamConfig = supported.into();
            let last = Arc::new(Mutex::new(0u128));

            let emit_level = {
                let app = app.clone();
                let id = id.clone();
                let last = last.clone();
                move |mono: Vec<f32>| {
                    let now = util::now_ms();
                    let mut guard = match last.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    if now - *guard < 45 {
                        return;
                    }
                    *guard = now;
                    let rms = rms_of(&mono);
                    let level = ((rms * 9.0).powf(0.6)).min(1.0);
                    let _ = app.emit("mic:levels", serde_json::json!({ "deviceId": id, "level": level }));
                }
            };

            let err_fn = |_e: cpal::StreamError| {};
            let stream = match sample_format {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| emit_level(to_mono(data, channels)),
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let floats: Vec<f32> = data.iter().map(|s| *s as f32 / 32768.0).collect();
                        emit_level(to_mono(&floats, channels))
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::U16 => device.build_input_stream(
                    &config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        let floats: Vec<f32> =
                            data.iter().map(|s| (*s as f32 - 32768.0) / 32768.0).collect();
                        emit_level(to_mono(&floats, channels))
                    },
                    err_fn,
                    None,
                ),
                _ => {
                    let _ = app.emit("mic:dead", serde_json::json!({ "deviceId": id.clone() }));
                    return;
                }
            };
            let stream = match stream {
                Ok(s) => s,
                Err(_) => {
                    let _ = app.emit("mic:dead", serde_json::json!({ "deviceId": id.clone() }));
                    return;
                }
            };
            if stream.play().is_err() {
                let _ = app.emit("mic:dead", serde_json::json!({ "deviceId": id.clone() }));
                return;
            }
            while !stop.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(60));
            }
            drop(stream);
        });
    }
    PreviewHandle { stop }
}

// Verify a device can actually be opened, used by the picker before pinning it.
pub fn verify_device(device_id: &str) -> Result<(), String> {
    let device = pick_device(device_id).ok_or_else(|| "That microphone is not available.".to_string())?;
    if !device_id.is_empty() && device.name().ok().as_deref() != Some(device_id) {
        return Err("That microphone is not available.".into());
    }
    device
        .default_input_config()
        .map(|_| ())
        .map_err(|e| {
            logf!("mic verify failed for {}: {}", device_id, e);
            "That microphone did not start.".to_string()
        })
}
