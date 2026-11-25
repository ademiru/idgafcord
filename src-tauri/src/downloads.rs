//! Original attachment downloads. No Discord cookies/tokens, image re-encoding,
//! redirects or page-supplied filesystem paths are used.
use std::{
    io::{Read, Write},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

static BUSY: AtomicBool = AtomicBool::new(false);
const LIMIT: u64 = 100 * 1024 * 1024;

fn original_url(input: &str) -> Result<tauri::Url, String> {
    let mut url = tauri::Url::parse(input).map_err(|_| "Invalid image URL")?;
    if url.scheme() != "https"
        || !matches!(
            url.host_str(),
            Some("cdn.discordapp.com" | "media.discordapp.net")
        )
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only Discord attachment sources are supported".into());
    }
    let segments: Vec<_> = url
        .path_segments()
        .ok_or("Invalid attachment path")?
        .collect();
    if segments.len() != 4
        || !matches!(segments[0], "attachments" | "ephemeral-attachments")
        || segments[1..3]
            .iter()
            .any(|s| s.is_empty() || !s.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err("Not a Discord attachment".into());
    }
    let extension = segments[3]
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "bmp" | "tif" | "tiff" | "heic" | "heif"
    ) {
        return Err("Unsupported image format".into());
    }
    let pairs: Vec<_> = url
        .query_pairs()
        .filter(|(key, _)| {
            !matches!(
                key.as_ref(),
                "width" | "height" | "quality" | "format" | "size"
            )
        })
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    url.set_host(Some("cdn.discordapp.com"))
        .map_err(|_| "Invalid image host")?;
    url.set_query(None);
    url.set_fragment(None);
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs);
    }
    Ok(url)
}
fn filename(url: &tauri::Url) -> String {
    let last = url
        .path_segments()
        .and_then(|mut parts| parts.next_back())
        .unwrap_or("image.png");
    // The original URL is preserved; only the save dialog's suggested filename
    // is conservative to avoid device names and separators on Windows.
    let safe: String = last
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .take(160)
        .collect();
    format!("idgafcord-{safe}")
}
fn notify(app: &AppHandle, id: &str, status: &str, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let data = serde_json::json!({"id":id,"status":status,"message":message});
        let _ = window.eval(format!(
            "window.__LDC_downloadStatus&&window.__LDC_downloadStatus({data});"
        ));
    }
}
fn transfer(url: tauri::Url, path: &std::path::Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    if response.status().is_redirection() {
        return Err("The attachment redirected; reopen the image in Discord".into());
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("image/") && !v.starts_with("image/svg"))
    {
        return Err("The source did not return an image".into());
    }
    let expected = response.content_length();
    if expected.is_some_and(|length| length > LIMIT) {
        return Err("Image exceeds the 100 MB download limit".into());
    }
    let parent = path.parent().ok_or("Invalid destination")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0;
    loop {
        let count = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > LIMIT {
            return Err("Image exceeds the 100 MB download limit".into());
        }
        temporary
            .write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
    }
    if total == 0 || expected.is_some_and(|length| length != total) {
        return Err("The download was incomplete".into());
    }
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn start(app: &AppHandle, id: String, input: String) {
    if id.len() > 80 {
        return;
    }
    let url = match original_url(&input) {
        Ok(url) => url,
        Err(message) => {
            notify(app, &id, "error", &message);
            return;
        }
    };
    if BUSY.swap(true, Ordering::AcqRel) {
        notify(app, &id, "busy", "Another download is in progress");
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let handle = app.clone();
        let request = id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let picker = handle
                .dialog()
                .file()
                .set_file_name(filename(&url))
                .set_title("idgafcord · Save original image");
            let picker = if let Some(window) = handle.get_webview_window("main") {
                picker.set_parent(&window)
            } else {
                picker
            };
            let Some(path) = picker.blocking_save_file() else {
                return Ok(false);
            };
            let path = path
                .into_path()
                .map_err(|_| "Invalid destination".to_string())?;
            notify(&handle, &request, "downloading", "");
            transfer(url, &path)?;
            Ok::<bool, String>(true)
        })
        .await;
        match result {
            Ok(Ok(true)) => notify(&app, &id, "saved", ""),
            Ok(Ok(false)) => notify(&app, &id, "cancelled", ""),
            Ok(Err(message)) => notify(&app, &id, "error", &message),
            Err(_) => notify(&app, &id, "error", "Download worker failed"),
        }
        BUSY.store(false, Ordering::Release);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_keeps_signature_but_removes_thumbnail_conversion() {
        let url=original_url("https://media.discordapp.net/attachments/123/456/photo.png?ex=abc&is=def&hm=signed&width=300&height=100&format=webp&quality=lossless").unwrap();
        assert_eq!(
            url.as_str(),
            "https://cdn.discordapp.com/attachments/123/456/photo.png?ex=abc&is=def&hm=signed"
        );
    }
    #[test]
    fn rejects_non_attachment_hosts_credentials_and_non_images() {
        for url in [
            "http://cdn.discordapp.com/attachments/1/2/a.png",
            "https://cdn.discordapp.com.evil.test/attachments/1/2/a.png",
            "https://localhost/a.png",
            "https://cdn.discordapp.com/avatars/1/a.png",
            "https://cdn.discordapp.com/attachments/1/2/a.exe",
            "https://cdn.discordapp.com:444/attachments/1/2/a.png",
            "https://user@cdn.discordapp.com/attachments/1/2/a.png",
        ] {
            assert!(original_url(url).is_err(), "{url}");
        }
    }
    fn server(response: Vec<u8>) -> tauri::Url {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = socket.read(&mut request);
            socket.write_all(&response).unwrap();
        });
        tauri::Url::parse(&format!("http://{address}/original.png")).unwrap()
    }
    #[test]
    fn download_saves_source_bytes_without_encoding() {
        let body = b"\x89PNG\r\n\x1a\nsource-image-bytes";
        let response=[format!("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).as_bytes(),body].concat();
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("original.png");
        transfer(server(response), &path).unwrap();
        assert_eq!(std::fs::read(path).unwrap(), body);
    }
    #[test]
    fn incomplete_download_and_redirect_preserve_existing_destination() {
        for response in [b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 100\r\nConnection: close\r\n\r\npartial".to_vec(),b"HTTP/1.1 302 Found\r\nLocation: https://example.org/image.png\r\nContent-Length: 0\r\n\r\n".to_vec()]{let folder=tempfile::tempdir().unwrap();let path=folder.path().join("original.png");std::fs::write(&path,b"existing").unwrap();assert!(transfer(server(response),&path).is_err());assert_eq!(std::fs::read(&path).unwrap(),b"existing");assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(),1);}
    }
}
