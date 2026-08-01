// In-app updates for the Linux build. The same version manifest the Windows app
// reads is used here; only the artifact differs. A .deb is handed to the
// system installer, an AppImage replaces itself in place and relaunches.

use futures_util::StreamExt;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter};

use crate::util;

const LATEST_URL: &str = "https://coldvoice.vercel.app/downloads/latest.json";

pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let pa: Vec<i64> = a.split('.').map(|n| n.parse::<i64>().unwrap_or(0)).collect();
    let pb: Vec<i64> = b.split('.').map(|n| n.parse::<i64>().unwrap_or(0)).collect();
    let len = pa.len().max(pb.len());
    for i in 0..len {
        let d = pa.get(i).copied().unwrap_or(0) - pb.get(i).copied().unwrap_or(0);
        if d != 0 {
            return if d > 0 { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Less };
        }
    }
    std::cmp::Ordering::Equal
}

fn is_version(s: &str) -> bool {
    !s.is_empty() && s.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn absolute(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }
    match LATEST_URL.rfind('/') {
        Some(i) => format!("{}{}", &LATEST_URL[..=i], url.trim_start_matches('/')),
        None => url.to_string(),
    }
}

pub struct CheckResult {
    pub value: Value,
    pub artifact_url: String,
}

pub async fn check(current: &str) -> CheckResult {
    let url = format!("{}?t={}", LATEST_URL, util::now_ms());
    let fail = |msg: String| CheckResult {
        value: json!({ "ok": false, "current": current, "error": msg }),
        artifact_url: String::new(),
    };
    let res = match reqwest::get(&url).await {
        Ok(r) => r,
        Err(e) => return fail(e.to_string()),
    };
    if !res.status().is_success() {
        return fail(format!("HTTP {}", res.status().as_u16()));
    }
    let data: Value = match res.json().await {
        Ok(v) => v,
        Err(e) => return fail(e.to_string()),
    };
    let latest = data.get("version").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if !is_version(&latest) {
        return fail("Bad version format".into());
    }
    // A dedicated `linux` field wins; otherwise fall back to the conventional
    // AppImage name next to the manifest.
    let artifact = data
        .get("linux")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(absolute)
        .unwrap_or_else(|| absolute("ColdVoice.AppImage"));

    let available = compare_versions(&latest, current) == std::cmp::Ordering::Greater;
    CheckResult {
        value: json!({ "ok": true, "current": current, "latest": latest, "updateAvailable": available }),
        artifact_url: artifact,
    }
}

pub async fn download(app: &AppHandle, url: &str) -> Result<PathBuf, String> {
    let name = url.rsplit('/').next().unwrap_or("ColdVoice-Update").to_string();
    let dir = util::data_dir().join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(name);

    let res = reqwest::get(url).await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let total = res.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut last_sent = util::now_ms();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let now = util::now_ms();
        if now - last_sent > 250 {
            last_sent = now;
            let _ = app.emit("update:progress", json!({ "received": received, "total": total }));
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    if received < 1024 * 1024 {
        let _ = std::fs::remove_file(&dest);
        return Err("Download incomplete. Try again.".into());
    }
    logf!("update downloaded to {}", dest.display());
    Ok(dest)
}

pub fn install(path: &PathBuf) -> Result<(), String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.ends_with(".AppImage") {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
        }
        // Running from an AppImage: swap the file in place, then relaunch it.
        if let Ok(current) = std::env::var("APPIMAGE") {
            if !current.is_empty() {
                std::fs::copy(path, &current).map_err(|e| e.to_string())?;
                Command::new(&current)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
        Command::new(path).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    // .deb (or anything else): let the desktop's own installer take it.
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|e| format!("Could not open the installer: {}", e))?;
    Ok(())
}
