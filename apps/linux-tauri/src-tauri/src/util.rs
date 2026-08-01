// Small helpers shared across the Linux core: a file logger (stdout is useless
// when the app is launched from a .desktop entry), WAV framing for whisper, and
// a cheap connectivity probe.

use std::fs::OpenOptions;
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub fn data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("coldvoice");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn log(msg: &str) {
    let line = format!("[{}] {}\n", now_ms(), msg);
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir().join("_debug.log"))
    {
        let _ = f.write_all(line.as_bytes());
    }
}

macro_rules! logf {
    ($($arg:tt)*) => { $crate::util::log(&format!($($arg)*)) };
}

// 16-bit mono PCM wrapped in a RIFF/WAVE header — the only format whisper-cli
// and the Groq upload both accept without a transcode step.
pub fn wav_buffer(pcm: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_len = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in pcm {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

// Connectivity only governs the account features and the cloud AI path —
// dictation itself never depends on it. A plain TCP handshake against public
// resolvers keeps this free of DNS caching lies and of any telemetry.
const PROBE_ADDRS: [&str; 3] = ["1.1.1.1:443", "8.8.8.8:443", "9.9.9.9:443"];

pub fn probe_online() -> bool {
    for addr in PROBE_ADDRS {
        if let Ok(sock) = addr.parse::<SocketAddr>() {
            if TcpStream::connect_timeout(&sock, Duration::from_millis(1500)).is_ok() {
                return true;
            }
        }
    }
    false
}

pub fn word_count(text: &str) -> i64 {
    text.split_whitespace().filter(|w| !w.is_empty()).count() as i64
}
