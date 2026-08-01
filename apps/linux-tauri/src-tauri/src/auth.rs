// ColdVoice account layer. Same rules as the Windows build:
//   - Sign in / sign up require a network connection. When offline the form is
//     blocked, BUT an existing session keeps the user signed in and the app
//     keeps working fully offline.
//   - If Supabase credentials are configured (env or a coldvoice.config.json in
//     the data folder) real Supabase email/password auth is used. Otherwise a
//     local-only account is created so the flow still works end to end.
// The session lives in the local settings table, so it survives restarts and
// stays valid offline.

use serde_json::{json, Value};

use crate::util;

pub const SESSION_KEY: &str = "auth.session";

pub struct SupabaseCfg {
    pub url: String,
    pub anon_key: String,
}

pub fn read_config() -> Option<SupabaseCfg> {
    if let Ok(url) = std::env::var("SUPABASE_URL") {
        if !url.is_empty() {
            return Some(SupabaseCfg {
                url,
                anon_key: std::env::var("SUPABASE_ANON_KEY").unwrap_or_default(),
            });
        }
    }
    let file = util::data_dir().join("coldvoice.config.json");
    let text = std::fs::read_to_string(file).ok()?;
    let json: Value = serde_json::from_str(&text).ok()?;
    let url = json.get("supabaseUrl")?.as_str()?.to_string();
    Some(SupabaseCfg {
        url,
        anon_key: json.get("supabaseAnonKey").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    })
}

pub async fn supabase_sign_in(cfg: &SupabaseCfg, mode: &str, email: &str, password: &str) -> Result<Value, String> {
    let base = cfg.url.trim_end_matches('/');
    let endpoint = if mode == "signup" {
        format!("{}/auth/v1/signup", base)
    } else {
        format!("{}/auth/v1/token?grant_type=password", base)
    };
    let res = reqwest::Client::new()
        .post(endpoint)
        .header("Content-Type", "application/json")
        .header("apikey", &cfg.anon_key)
        .json(&json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|e| format!("Sign in failed: {}", e))?;
    let status = res.status();
    let data: Value = res.json().await.unwrap_or_else(|_| json!({}));
    if !status.is_success() {
        let msg = data
            .get("error_description")
            .or_else(|| data.get("msg"))
            .or_else(|| data.get("error"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("Sign in failed ({})", status.as_u16()));
        return Err(msg);
    }
    Ok(json!({
        "email": data["user"]["email"].as_str().unwrap_or(email),
        "accessToken": data.get("access_token").cloned().unwrap_or(Value::Null),
        "refreshToken": data.get("refresh_token").cloned().unwrap_or(Value::Null),
        "local": false,
        "signedInAt": util::now_ms() as u64,
    }))
}

pub fn local_session(email: &str) -> Value {
    json!({ "email": email, "local": true, "signedInAt": util::now_ms() as u64 })
}

pub fn status_from(session_raw: &str, online: bool) -> Value {
    let session: Value = serde_json::from_str(session_raw).unwrap_or(Value::Null);
    let email = session.get("email").and_then(|v| v.as_str());
    json!({
        "signedIn": email.is_some(),
        "email": email,
        "local": session.get("local").and_then(|v| v.as_bool()).unwrap_or(false),
        "online": online,
    })
}
