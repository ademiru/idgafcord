//! Device permission decisions are made in a bundled local window, never by
//! accepting a permission response from Discord's remote page or its URL bridge.
use std::{
    cell::RefCell,
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use webview2_com::{
    CoTaskMemPWSTR, Microsoft::Web::WebView2::Win32::*, PermissionRequestedEventHandler,
    SetPermissionStateCompletedHandler,
};
use windows::core::{Interface, PWSTR};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
fn defer(app: &AppHandle, job: impl FnOnce(AppHandle) + Send + 'static) {
    let dispatcher = app.clone();
    // Creating or closing a WebView while inside its COM callback can re-enter
    // WebView2. Post the UI work from an async worker after the callback returns.
    tauri::async_runtime::spawn(async move {
        let app = dispatcher.clone();
        let _ = dispatcher.run_on_main_thread(move || job(app));
    });
}
struct Pending {
    id: u64,
    kind: &'static str,
    args: ICoreWebView2PermissionRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
}
thread_local! {
    // COM objects stay on WebView2's UI thread, including cancellation.
    static QUEUE:RefCell<VecDeque<Pending>>=const {RefCell::new(VecDeque::new())};
    static ACTIVE:RefCell<Option<u64>>=const {RefCell::new(None)};
}
fn discord_origin(uri: &str) -> bool {
    tauri::Url::parse(uri).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("discord.com")
            && url.port_or_known_default() == Some(443)
            && url.username().is_empty()
            && url.password().is_none()
    })
}
fn answer(pending: Pending, allow: bool, remember: bool) {
    // SAFETY: event arguments and deferral were obtained on, and never leave,
    // the WebView2 UI thread. Every pending request completes exactly once.
    unsafe {
        if let Ok(args) = pending
            .args
            .cast::<ICoreWebView2PermissionRequestedEventArgs3>()
        {
            let _ = args.SetSavesInProfile(remember);
        }
        let _ = pending.args.SetState(if allow {
            COREWEBVIEW2_PERMISSION_STATE_ALLOW
        } else {
            COREWEBVIEW2_PERMISSION_STATE_DENY
        });
        let _ = pending.deferral.Complete();
    }
}
fn finish(app: &AppHandle, id: u64, allow: bool, remember: bool) {
    let pending = QUEUE.with(|queue| {
        let mut queue = queue.borrow_mut();
        let index = queue.iter().position(|pending| pending.id == id)?;
        queue.remove(index)
    });
    let Some(pending) = pending else { return };
    answer(pending, allow, remember);
    let active = ACTIVE.with(|active| {
        let mut active = active.borrow_mut();
        if *active == Some(id) {
            *active = None;
            true
        } else {
            false
        }
    });
    if let Some(window) = app.get_webview_window(&format!("device-permission-{id}")) {
        let _ = window.close();
    }
    if active {
        show_next(app);
    }
}
fn show_next(app: &AppHandle) {
    if ACTIVE.with(|active| active.borrow().is_some()) {
        return;
    }
    let Some((id, kind)) = QUEUE.with(|queue| {
        queue
            .borrow()
            .front()
            .map(|pending| (pending.id, pending.kind))
    }) else {
        return;
    };
    let Some(parent) = app.get_webview_window("main") else {
        finish(app, id, false, false);
        return;
    };
    ACTIVE.with(|active| *active.borrow_mut() = Some(id));
    let settings = app
        .try_state::<Mutex<crate::Settings>>()
        .and_then(|state| state.lock().ok().map(|settings| settings.clone()))
        .unwrap_or_default();
    let snapshot = serde_json::json!({"kind":kind,"origin":"https://discord.com","language":settings.language,"appearance":settings.appearance});
    let label = format!("device-permission-{id}");
    let nav_app = app.clone();
    let close_app = app.clone();
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("permission.html".into()))
        .title("idgafcord · Device permission")
        .inner_size(420., 310.)
        .resizable(false)
        .decorations(false)
        .skip_taskbar(true)
        .center()
        .background_color(settings.appearance.color())
        .theme(Some(settings.appearance.theme()))
        .initialization_script(format!("window.__LDC_PERMISSION__={snapshot};"))
        .on_navigation(move |url| {
            if url.scheme() == "idgafcord" && url.host_str() == Some("permission") {
                let decision = url
                    .query_pairs()
                    .find(|(key, _)| key == "decision")
                    .map(|(_, value)| value.into_owned());
                let remember = url
                    .query_pairs()
                    .any(|(key, value)| key == "remember" && value == "1");
                defer(&nav_app, move |app| {
                    finish(&app, id, decision.as_deref() == Some("allow"), remember)
                });
                return false;
            }
            (url.scheme() == "tauri"
                && url.host_str() == Some("localhost")
                && url.path() == "/permission.html")
                || (url.scheme() == "http"
                    && url.host_str() == Some("tauri.localhost")
                    && url.path() == "/permission.html")
        });
    let builder = match builder.parent(&parent) {
        Ok(builder) => builder,
        Err(_) => {
            finish(app, id, false, false);
            return;
        }
    };
    let builder = if let Some(root) = crate::config_dir(app) {
        let portable = std::env::current_exe()
            .ok()
            .and_then(|path| {
                path.parent()
                    .map(|path| path.join("portable.flag").exists())
            })
            .unwrap_or(false);
        if cfg!(debug_assertions) || portable {
            builder.data_directory(root.join("webview"))
        } else {
            builder
        }
    } else {
        builder
    };
    match builder.build() {
        Ok(window) => window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                defer(&close_app, move |app| finish(&app, id, false, false));
            }
        }),
        Err(_) => finish(app, id, false, false),
    }
}
pub fn cancel(app: &AppHandle) {
    defer(app, move |app| {
        let pending = QUEUE.with(|queue| queue.borrow_mut().drain(..).collect::<Vec<_>>());
        ACTIVE.with(|active| *active.borrow_mut() = None);
        for request in pending {
            let id = request.id;
            answer(request, false, false);
            if let Some(window) = app.get_webview_window(&format!("device-permission-{id}")) {
                let _ = window.close();
            }
        }
    });
}
pub fn install(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let mut token = 0;
        let _ = core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                let kind = match kind {
                    COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => "microphone",
                    COREWEBVIEW2_PERMISSION_KIND_CAMERA => "camera",
                    _ => return Ok(()),
                };
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                if !discord_origin(&CoTaskMemPWSTR::from(uri).to_string()) {
                    return Ok(());
                }
                // Older runtimes keep their own prompt rather than changing the
                // persistence meaning of the user's choice.
                if args
                    .cast::<ICoreWebView2PermissionRequestedEventArgs3>()
                    .is_err()
                {
                    return Ok(());
                }
                let mut state = COREWEBVIEW2_PERMISSION_STATE::default();
                args.State(&mut state)?;
                if state != COREWEBVIEW2_PERMISSION_STATE_DEFAULT {
                    return Ok(());
                }
                if QUEUE.with(|queue| queue.borrow().len() >= 8) {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                    return Ok(());
                }
                let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
                let deferral = args.GetDeferral()?;
                QUEUE.with(|queue| {
                    queue.borrow_mut().push_back(Pending {
                        id,
                        kind,
                        args,
                        deferral,
                    })
                });
                defer(&app, move |app| show_next(&app));
                let timeout_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(120)).await;
                    let app = timeout_app.clone();
                    let _ = timeout_app.run_on_main_thread(move || finish(&app, id, false, false));
                });
                Ok(())
            })),
            &mut token,
        );
    });
}
fn reset_notice(app: &AppHandle, ok: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(format!(
            "window.__LDC_voicePermissionReset&&window.__LDC_voicePermissionReset({ok});"
        ));
    }
}
pub fn reset(window: &WebviewWindow) {
    cancel(window.app_handle());
    let app = window.app_handle().clone();
    let _ = window.with_webview(move |webview| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let profile = webview
                .controller()
                .CoreWebView2()?
                .cast::<ICoreWebView2_13>()?
                .Profile()?
                .cast::<ICoreWebView2Profile4>()?;
            let camera_profile = profile.clone();
            let callback_app = app.clone();
            profile.SetPermissionState(
                COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                windows::core::w!("https://discord.com"),
                COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
                &SetPermissionStateCompletedHandler::create(Box::new(move |result| {
                    if result.is_err() {
                        reset_notice(&callback_app, false);
                        return Ok(());
                    }
                    let final_app = callback_app.clone();
                    if camera_profile
                        .SetPermissionState(
                            COREWEBVIEW2_PERMISSION_KIND_CAMERA,
                            windows::core::w!("https://discord.com"),
                            COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
                            &SetPermissionStateCompletedHandler::create(Box::new(move |result| {
                                reset_notice(&final_app, result.is_ok());
                                Ok(())
                            })),
                        )
                        .is_err()
                    {
                        reset_notice(&callback_app, false);
                    }
                    Ok(())
                })),
            )?;
            Ok(())
        })();
        if result.is_err() {
            reset_notice(&app, false);
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_exact_discord_https_origin_gets_the_custom_prompt() {
        assert!(discord_origin("https://discord.com/channels/@me"));
        for uri in [
            "http://discord.com",
            "https://discord.com.evil.test",
            "https://discord.com:8443",
            "https://discord.com@evil.test",
            "https://user:pass@discord.com",
            "file:///permission.html",
        ] {
            assert!(!discord_origin(uri), "{uri}");
        }
    }
}
