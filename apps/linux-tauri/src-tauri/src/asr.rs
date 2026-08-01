// Offline ASR adapter for Linux using whisper.cpp. It shells out to a local
// whisper-cli executable and reads back the transcript. No cloud service is
// used. The binary and the model ship inside the .deb / AppImage, and a user
// can drop their own build or a bigger model into ~/.local/share/coldvoice.

use once_cell::sync::OnceCell;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::util;

static RESOURCE_DIR: OnceCell<PathBuf> = OnceCell::new();

pub fn init(resource_dir: PathBuf) {
    let _ = RESOURCE_DIR.set(resource_dir);
    // Bundlers do not always preserve the executable bit on resources.
    if let Some(bin) = find_binary() {
        make_executable(&bin);
    }
}

fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mode = meta.permissions().mode();
            if mode & 0o111 == 0 {
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode | 0o755));
            }
        }
    }
}

pub fn model_file(model_name: &str) -> &'static str {
    match model_name {
        "tiny.en" => "ggml-tiny.en.bin",
        "small.en" => "ggml-small.en.bin",
        _ => "ggml-base.en.bin",
    }
}

pub fn native_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(res) = RESOURCE_DIR.get() {
        dirs.push(res.join("native").join("asr"));
    }
    dirs.push(util::data_dir().join("native").join("asr"));
    dirs
}

pub fn model_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(res) = RESOURCE_DIR.get() {
        dirs.push(res.join("models"));
    }
    dirs.push(util::data_dir().join("models"));
    dirs
}

pub fn find_binary() -> Option<PathBuf> {
    for dir in native_dirs() {
        for name in ["whisper-cli", "main", "whisper"] {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    // A system-wide whisper.cpp build is a perfectly good fallback.
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            let p = Path::new(dir).join("whisper-cli");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

pub fn model_path(model_name: &str) -> Option<PathBuf> {
    let file = model_file(model_name);
    for dir in model_dirs() {
        let p = dir.join(file);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

pub fn is_ready(model_name: &str) -> bool {
    find_binary().is_some() && model_path(model_name).is_some()
}

pub fn setup_message(model_name: &str) -> String {
    let file = model_file(model_name);
    format!(
        "Offline ASR is not set up yet.\n1. Put a whisper.cpp build (whisper-cli) in: {}\n2. Put the model \"{}\" in: {}\nNo internet is used - everything runs locally.",
        native_dirs().iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(" or "),
        file,
        model_dirs().iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(" or "),
    )
}

fn strip_non_speech(text: &str) -> String {
    // Strip whisper's non-speech annotations: [BLANK_AUDIO], (music), (wind
    // blowing), etc. These are always fully bracketed or parenthesised.
    let mut lines: Vec<String> = Vec::new();
    for line in text.lines() {
        let cleaned = strip_bracketed(line);
        let cleaned = cleaned.trim();
        if !cleaned.is_empty() {
            lines.push(cleaned.to_string());
        }
    }
    lines.join(" ").trim().to_string()
}

fn strip_bracketed(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut square = 0i32;
    let mut round = 0i32;
    for c in line.chars() {
        match c {
            '[' => square += 1,
            ']' => square = (square - 1).max(0),
            '(' => round += 1,
            ')' => round = (round - 1).max(0),
            _ => {
                if square == 0 && round == 0 {
                    out.push(c);
                }
            }
        }
    }
    out
}

fn cpu_threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).max(1)
}

// Transcribe 16 kHz mono PCM16 with the local model. Blocking: callers run this
// on a worker thread, never on the UI thread.
pub fn transcribe(pcm: &[i16], model_name: &str, sample_rate: u32) -> Result<String, String> {
    let bin = find_binary().ok_or_else(|| setup_message(model_name))?;
    let model = model_path(model_name).ok_or_else(|| setup_message(model_name))?;

    let wav_path = std::env::temp_dir().join(format!("coldvoice-{}.wav", util::now_ms()));
    std::fs::write(&wav_path, util::wav_buffer(pcm, sample_rate)).map_err(|e| e.to_string())?;
    let txt_path = PathBuf::from(format!("{}.txt", wav_path.display()));

    // Speed flags: all CPU cores, greedy decode (beam size 1 / best-of 1), no
    // temperature fallback. Same set the Windows build uses.
    let status = Command::new(&bin)
        .arg("-m").arg(&model)
        .arg("-f").arg(&wav_path)
        .arg("-t").arg(cpu_threads().to_string())
        .arg("-bs").arg("1")
        .arg("-bo").arg("1")
        .arg("-nf")
        .arg("-nt")
        .arg("-otxt")
        .arg("-of").arg(&wav_path)
        .output();

    let result = match status {
        Ok(out) if out.status.success() => std::fs::read_to_string(&txt_path)
            .map(|t| strip_non_speech(&t))
            .map_err(|e| e.to_string()),
        Ok(out) => Err(format!(
            "whisper-cli exited with {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).chars().take(300).collect::<String>()
        )),
        Err(e) => Err(e.to_string()),
    };

    let _ = std::fs::remove_file(&wav_path);
    let _ = std::fs::remove_file(&txt_path);
    result
}
