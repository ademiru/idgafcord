use std::{
    io::Read,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{AppHandle, Manager};
static BUSY: AtomicBool = AtomicBool::new(false);
pub fn endpoint(input: &str) -> Option<String> {
    if input.is_empty() {
        return Some(String::new());
    }
    let url = tauri::Url::parse(input).ok()?;
    let host = url.host_str()?;
    (url.scheme() == "https"
        && host.ends_with(".workers.dev")
        && host.split('.').count() >= 3
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none())
    .then(|| url.origin().ascii_serialization())
}
fn notify(app: &AppHandle, request: &str, id: &str, card: Option<serde_json::Value>, status: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let data = serde_json::json!({"request":request,"id":id,"card":card,"status":status});
        let _ = window.eval(format!(
            "window.__LDC_ecosystemCard&&window.__LDC_ecosystemCard({data});"
        ));
    }
}
pub fn lookup(app: &AppHandle, request: String, id: String) {
    if request.len() > 80
        || !(16..=22).contains(&id.len())
        || !id.bytes().all(|c| c.is_ascii_digit())
    {
        return;
    }
    let Some(settings) = app
        .try_state::<std::sync::Mutex<crate::Settings>>()
        .and_then(|settings| settings.lock().ok().map(|settings| settings.clone()))
    else {
        return;
    };
    if !settings.ecosystem_enabled || settings.ecosystem_url.is_empty() {
        notify(app, &request, &id, None, "disabled");
        return;
    }
    let Some(origin) = endpoint(&settings.ecosystem_url).filter(|value| !value.is_empty()) else {
        return;
    };
    if BUSY.swap(true, Ordering::AcqRel) {
        notify(app, &request, &id, None, "busy");
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let target = id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let client = reqwest::blocking::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(6))
                .build()
                .ok()?;
            let response = client
                .get(format!("{origin}/v1/cards?ids={target}"))
                .send()
                .ok()?
                .error_for_status()
                .ok()?;
            if response.status().is_redirection() {
                return None;
            }
            let mut bytes = Vec::new();
            response.take(65537).read_to_end(&mut bytes).ok()?;
            if bytes.len() > 65536 {
                return None;
            }
            let response: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
            Some(
                response
                    .get("cards")?
                    .get(&target)
                    .filter(|card| card.is_object())
                    .cloned(),
            )
        })
        .await;
        BUSY.store(false, Ordering::Release);
        match result {
            Ok(Some(card)) => notify(&handle, &request, &id, card, "ok"),
            _ => notify(&handle, &request, &id, None, "error"),
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_is_https_worker_origin_only() {
        assert_eq!(
            endpoint("https://idgafcord.account.workers.dev").unwrap(),
            "https://idgafcord.account.workers.dev"
        );
        assert_eq!(endpoint(""), Some(String::new()));
        for value in [
            "http://idgafcord.account.workers.dev",
            "https://workers.dev",
            "https://localhost",
            "https://idgafcord.account.workers.dev.evil.test",
            "https://idgafcord.account.workers.dev/path",
            "https://user@idgafcord.account.workers.dev",
            "https://idgafcord.account.workers.dev?query=1",
        ] {
            assert!(endpoint(value).is_none(), "{value}");
        }
    }
}
