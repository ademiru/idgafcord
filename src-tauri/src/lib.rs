// Lightweight Discord Client
//
// Mimari notu: Discord uzak bir URL (https://discord.com) olarak yüklenir.
// Tauri v2 güvenlik modeli, uzak içeriğin Rust komutlarını `invoke` etmesine
// İZİN VERMEZ (page→Rust IPC bloke). Ancak:
//   * Rust→sayfa `eval` ve `initialization_script` ÇALIŞIR,
//   * enjekte edilen betik DOM'a öğe ekleyebilir,
//   * CSS, CSP'ye takılmamak için `adoptedStyleSheets` ile uygulanır.
// Bu yüzden uygulama-içi ayar paneli ve tema tamamen İSTEMCİ TARAFINDA
// (localStorage) çalışır; işletim sistemi ayarları (tepsi/autostart/GPU) ise
// native tepsi menüsündedir.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use tauri::menu::{CheckMenuItemBuilder, IconMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl};

use std::str::FromStr;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_updater::UpdaterExt;

// ---------------------------------------------------------------------------
// İşletim sistemi ayarları (Rust tarafı, settings.json). Görünüm/gizlilik
// ayarları localStorage'da tutulur; burada değildir.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct Settings {
    minimize_to_tray: bool,
    autostart: bool,
    start_minimized: bool,
    disable_gpu: bool,
    #[serde(default)]
    stream_performance: bool,
    #[serde(default = "default_true")]
    auto_update_check: bool,
    #[serde(default)]
    game_mode: bool,
    #[serde(default = "default_mute_shortcut")]
    mute_shortcut: String,
}

fn default_true() -> bool {
    true
}

fn default_mute_shortcut() -> String {
    "CommandOrControl+Shift+M".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            minimize_to_tray: true,
            autostart: false,
            start_minimized: false,
            disable_gpu: false,
            stream_performance: false,
            auto_update_check: true,
            game_mode: false,
            mute_shortcut: default_mute_shortcut(),
        }
    }
}

const DISCORD_URL: &str = "https://discord.com/app";

/// Oyun modu: gizliyken Discord'u boş sayfaya alıp neredeyse sıfır kaynağa indirir.
fn suspend_blank<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(url) = "about:blank".parse() {
            let _ = w.navigate(url);
        }
    }
}

/// (Devre dışı) Eskiden WebView2 controller'ının `SetIsVisible(false)` çağrısıyla
/// gizliyken çizimi durdururdu. Ancak bu, tepsiden geri açışta WebView2'de bilinen
/// bir SİYAH YÜZEY / DONMA hatasına yol açıyordu (pencere gösterilirken yüzey
/// yeniden boyanmıyor). WebView2 zaten gizli/occluded pencereleri kendisi kısar,
/// bu yüzden optimizasyon gereksiz ve riskli. No-op yapıldı → siyah ekran biter.
fn set_render<R: Runtime>(_app: &AppHandle<R>, _visible: bool) {}

/// Boş sayfadaysa Discord'u yeniden yükler (pencere gösterilmeden önce).
fn ensure_loaded<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let blank = w
            .url()
            .map(|u| u.as_str().starts_with("about:"))
            .unwrap_or(false);
        if blank {
            if let Ok(url) = DISCORD_URL.parse() {
                let _ = w.navigate(url);
            }
        }
    }
}

fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("portable.flag").exists() {
                return Some(dir.join("data"));
            }
        }
    }
    app.path().app_config_dir().ok()
}

fn load_settings<R: Runtime>(app: &AppHandle<R>) -> Settings {
    config_dir(app)
        .map(|d| d.join("settings.json"))
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings<R: Runtime>(app: &AppHandle<R>, settings: &Settings) {
    if let Some(dir) = config_dir(app) {
        let _ = fs::create_dir_all(&dir);
        if let Ok(json) = serde_json::to_string_pretty(settings) {
            let _ = fs::write(dir.join("settings.json"), json);
        }
    }
}

fn sync_native_settings<R: Runtime>(app: &AppHandle<R>) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    let Some(settings) = app
        .try_state::<Mutex<Settings>>()
        .and_then(|s| s.lock().ok().map(|s| s.clone()))
    else {
        return;
    };

    let payload = serde_json::json!({
        "minimize_to_tray": settings.minimize_to_tray,
        "start_minimized": settings.start_minimized,
        "autostart": settings.autostart,
        "disable_gpu": settings.disable_gpu,
        "stream_performance": settings.stream_performance,
        "game_mode": settings.game_mode,
        "auto_update_check": settings.auto_update_check,
        "mute_shortcut": settings.mute_shortcut,
    });
    let _ = w.eval(&format!(
        "window.__LDC_setNativeSettings&&window.__LDC_setNativeSettings({payload});"
    ));
}

fn register_mute_shortcut<R: Runtime>(app: &AppHandle<R>, shortcut: &str) -> bool {
    let Ok(shortcut) = Shortcut::from_str(shortcut) else {
        return false;
    };
    let _ = app.global_shortcut().unregister_all();
    app.global_shortcut().register(shortcut).is_ok()
}

fn panel_notice<R: Runtime>(app: &AppHandle<R>, msg: &str, warn: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let msg = serde_json::json!(msg);
        let warn = if warn { "true" } else { "false" };
        let _ = window.eval(&format!(
            "window.__LDC_nativeNotice&&window.__LDC_nativeNotice({msg},{warn});"
        ));
    }
}

fn update_status<R: Runtime>(app: &AppHandle<R>, msg: &str, warn: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let msg = serde_json::json!(msg);
        let warn = if warn { "true" } else { "false" };
        let _ = window.eval(&format!(
            "window.__LDC_updateStatus&&window.__LDC_updateStatus({msg},{warn});"
        ));
    }
    panel_notice(app, msg, warn);
}

fn spawn_update_check<R: Runtime>(app: AppHandle<R>, quiet: bool) {
    tauri::async_runtime::spawn(async move {
        if !quiet {
            update_status(&app, "Güncelleme kontrol ediliyor...", false);
        }
        match app.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(update)) => {
                    update_status(&app, "Yeni sürüm bulundu, indiriliyor...", false);
                    match update.download_and_install(|_, _| {}, || {}).await {
                        Ok(_) => {
                            update_status(&app, "Güncelleme kuruldu, yeniden başlatılıyor...", false);
                            app.restart();
                        }
                        Err(_) => update_status(&app, "Güncelleme indirilemedi.", true),
                    }
                }
                Ok(None) => {
                    if !quiet {
                        update_status(&app, "En güncel sürüm kullanılıyor.", false);
                    }
                }
                Err(_) => {
                    if !quiet {
                        update_status(&app, "Güncelleme kontrolü başarısız.", true);
                    }
                }
            }
            Err(_) => {
                if !quiet {
                    update_status(&app, "Güncelleme sistemi başlatılamadı.", true);
                }
            }
        }
    });
}

fn spawn_auto_update_loop<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(6 * 60 * 60));
        let enabled = app
            .try_state::<Mutex<Settings>>()
            .and_then(|s| s.lock().ok().map(|s| s.auto_update_check))
            .unwrap_or(false);
        if enabled {
            spawn_update_check(app.clone(), true);
        }
    });
}

// ---------------------------------------------------------------------------
// Enjekte edilen istemci betiği (IPC yok — her şey localStorage + DOM/CSS).
//   * Telemetri engelleyici (fetch/XHR/sendBeacon).
//   * CSS motoru: adoptedStyleSheets (CSP-geçirmez) → yerleşik tema + özel CSS
//     + reklam gizleme.
//   * Discord temasına uygun ayar paneli (dişli düğme + modal).
// ---------------------------------------------------------------------------

const LOGO_DATA_URI: &str = concat!("data:image/png;base64,", include_str!("logo-1024.png.b64"));

fn bootstrap_script() -> String {
    // .trim(): b64 dosyası sonda satır sonu (\r\n) ile üretilmişse, bu ham satır
    // sonu tek tırnaklı JS string literalini bozup enjekte edilen TÜM bootstrap
    // script'ini SyntaxError ile çökertir (yüzen dişli/rozet dahil kaybolur).
    BOOTSTRAP_TEMPLATE.replace("__LDC_LOGO_DATA_URI__", LOGO_DATA_URI.trim())
}

const BOOTSTRAP_TEMPLATE: &str = r####"(function(){
  if(window.__LDC_INIT__)return;window.__LDC_INIT__=1;
  var LDC_LOGO_DATA_URI='__LDC_LOGO_DATA_URI__';
  var LS=window.localStorage;
  function get(k,def){try{var v=LS.getItem('ldc_'+k);return v===null?def:v;}catch(e){return def;}}
  function set(k,v){try{LS.setItem('ldc_'+k,v);}catch(e){}}
  function ison(k,def){return get(k,def)==='1';}
  // Güvenli mod: Discord render olmadıysa (beyaz/siyah ekran) bu oturumda tema,
  // özel CSS ve telemetri engellemesi UYGULANMAZ. Ayarlar localStorage'da korunur;
  // yalnızca bu oturum temiz çalışır. Uygulama yeniden açılınca normale döner.
  var SAFE=false;try{SAFE=sessionStorage.getItem('ldc_safe')==='1';}catch(e){}

  /* ---------------- Telemetri engelleyici (kategorili + loglu) ---------------- */
  var blockedCount=0,blockedLog=[],catCount={};
  var PAT=[
    {re:/\/science\b/,c:'SCIENCE'},{re:/\/api\/v\d+\/track\b/,c:'TRACK'},{re:/\/metrics\b/,c:'METRICS'},
    {re:/sentry/i,c:'SENTRY'},{re:/\/api\/v\d+\/applications\/\d+\/analytics/,c:'ANALYTICS'},
    {re:/error-reporting/i,c:'ERROR'},{re:/crash-reporting/i,c:'CRASH'},{re:/\/rtc\/quality/i,c:'RTC-QoS'},
    {re:/\/api\/v\d+\/reporting/,c:'REPORTING'},{re:/segment\.(io|com)/i,c:'SEGMENT'},
    {re:/google-analytics/i,c:'GA'},{re:/doubleclick/i,c:'ADS'}
  ];
  function pushLog(cat,u){blockedCount++;catCount[cat]=(catCount[cat]||0)+1;var d=new Date().toISOString().slice(0,10);if(get('blockedDay','')!==d){set('blockedDay',d);set('blockedToday','0');}set('blockedToday',String((parseInt(get('blockedToday','0'),10)||0)+1));blockedLog.push({t:Date.now(),c:cat,u:String(u).replace(/^https?:\/\//,'').split('?')[0].slice(0,90)});if(blockedLog.length>500)blockedLog.shift();}
  function blocked(u){if(SAFE||!ison('block','1')||!u)return false;try{u=String(u);}catch(e){return false;}for(var i=0;i<PAT.length;i++){if(PAT[i].re.test(u)){pushLog(PAT[i].c,u);return true;}}return false;}
  // Engellenen isteğe BOŞ değil, geçerli boş-JSON döndür: bir yanıt .json()'lanırsa
  // Discord'un bootstrap'ı SyntaxError ile çökmesin (beyaz ekran koruması).
  var of=window.fetch;window.fetch=function(input,init){var u=typeof input==='string'?input:(input&&input.url)||'';if(blocked(u))return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));return of.apply(this,arguments);};
  var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){this.__ldc=u;return oo.apply(this,arguments);};
  var os=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){if(blocked(this.__ldc)){try{this.abort();}catch(e){}return;}return os.apply(this,arguments);};
  if(navigator.sendBeacon){var ob=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){if(blocked(u))return true;return ob(u,d);};}

  /* ---------------- CSS motoru (CSP-geçirmez) ---------------- */
  function Styler(){this.sheet=null;this.el=null;try{this.sheet=new CSSStyleSheet();document.adoptedStyleSheets=[].concat(Array.prototype.slice.call(document.adoptedStyleSheets||[]),[this.sheet]);}catch(e){this.sheet=null;}}
  Styler.prototype.set=function(css){if(this.sheet){try{this.sheet.replaceSync(css||'');return;}catch(e){}}if(!this.el){this.el=document.createElement('style');(document.head||document.documentElement).appendChild(this.el);}this.el.textContent=css||'';};

  var UPSELL_CSS='[aria-label="Send a gift"]{display:none !important;}a[href="/store"]{display:none !important;}[aria-label*="Nitro"]{display:none !important;}[class*="premiumTrial"]{display:none !important;}[class*="nitroUpsell"]{display:none !important;}[class*="upsell"]{display:none !important;}';
  /* Yerleşik "Midnight" teması — Discord'un CSS değişkenlerini ezerek çalışır
     (hash'li class adlarına bağlı değildir; eski+yeni değişken sistemleri). */
  var BASE_SEL=':root,.theme-dark,.theme-darker,.theme-light,.theme-midnight';
  function h2hsl(hex){hex=(hex||'').replace('#','');if(hex.length===3)hex=hex.replace(/(.)/g,'$1$1');if(hex.length<6)return '235 86% 65%';var r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255;var mx=Math.max(r,g,b),mn=Math.min(r,g,b),h,s,l=(mx+mn)/2;if(mx===mn){h=s=0;}else{var d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);if(mx===r)h=(g-b)/d+(g<b?6:0);else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h/=6;}return Math.round(h*360)+' '+Math.round(s*100)+'% '+Math.round(l*100)+'%';}
  function accentVars(hex){var hsl=h2hsl(hex);return '--brand-500:'+hex+' !important;--brand-560:'+hex+' !important;--brand-430:'+hex+' !important;--brand-500-hsl:'+hsl+' !important;--brand-experiment:'+hex+' !important;--text-link:'+hex+' !important;--mention-foreground:'+hex+' !important;';}
  function buildTheme(bg,accent,extra){
    var s=BASE_SEL+'{'+
      '--background-base-lowest:'+bg[0]+' !important;--background-base-lower:'+bg[1]+' !important;'+
      '--background-base-low:'+bg[2]+' !important;--background-base-high:'+bg[3]+' !important;'+
      '--background-base-higher:'+bg[4]+' !important;--background-base-highest:'+bg[5]+' !important;'+
      '--bg-overlay-app-frame:'+bg[0]+' !important;--bg-overlay-chat:'+bg[2]+' !important;'+
      '--background-primary:'+bg[2]+' !important;--background-secondary:'+bg[1]+' !important;'+
      '--background-secondary-alt:'+bg[0]+' !important;--background-tertiary:'+bg[0]+' !important;'+
      '--background-floating:'+bg[0]+' !important;--channeltextarea-background:'+bg[3]+' !important;'+
      '--sidebar-theme-overlay-opacity:0 !important;'+(accent?accentVars(accent):'')+'}'+
      '[class*="scroller_"]::-webkit-scrollbar-thumb{border-radius:8px !important;}';
    return s+(extra||'');
  }
  // Tekrar eden (kayan yıldız animasyonu için) yıldız alanı deseni.
  var STAR_BG='background-color:#04050c !important;background-image:radial-gradient(1.3px 1.3px at 20px 30px,#fff,transparent),radial-gradient(1px 1px at 120px 90px,#cfe0ff,transparent),radial-gradient(1.4px 1.4px at 60px 200px,#fff,transparent),radial-gradient(1px 1px at 160px 320px,#b9c9ff,transparent),radial-gradient(1px 1px at 30px 470px,#fff,transparent),radial-gradient(1.2px 1.2px at 140px 560px,#e0d4ff,transparent) !important;background-size:200px 600px !important;background-repeat:repeat !important;';
  var THEMES={
    off:'',
    midnight:buildTheme(['#050506','#09090c','#0e0e11','#16161a','#1c1c20','#212126'],''),
    space:buildTheme(['#04050c','#070912','#0b0e1c','#12162b','#181d38','#1f2547'],'#7c5cff','[class*="guilds_"]{'+STAR_BG+'}'),
    dracula:buildTheme(['#1a1b23','#21222c','#282a36','#343746','#3c4055','#454760'],'#bd93f9'),
    nord:buildTheme(['#242933','#2e3440','#343c4a','#3b4252','#434c5e','#4c566a'],'#88c0d0'),
    catppuccin:buildTheme(['#11111b','#181825','#1e1e2e','#302d41','#363a4f','#45475a'],'#cba6f7'),
    amoled:buildTheme(['#000000','#000000','#050505','#0d0d0d','#141414','#1c1c1c'],''),
    tokyonight:buildTheme(['#16161e','#1a1b26','#1f2335','#24283b','#2a2e42','#30354e'],'#7aa2f7'),
    gruvbox:buildTheme(['#1d2021','#282828','#32302f','#3c3836','#45403d','#504945'],'#fabd2f'),
    solarized:buildTheme(['#00212b','#002b36','#073642','#0d475a','#0f5265','#14607a'],'#268bd2'),
    rosepine:buildTheme(['#16141f','#191724','#1f1d2e','#26233a','#2a2740','#393552'],'#ebbcba'),
    synthwave:buildTheme(['#0d0221','#190833','#1f0a3d','#2a1052','#331466','#3d1a7a'],'#ff2e97'),
    monokai:buildTheme(['#1e1f1c','#272822','#2d2e28','#33342d','#3a3b33','#414339'],'#f92672'),
    idgaf:buildTheme(['#070000','#120000','#1c0303','#260505','#340707','#430909'],'#d80f12',
      BASE_SEL+'{--red-400:#ff3b3f !important;--red-500:#d80f12 !important;--status-danger:#ff3b3f !important;}'+
      '[class*="sidebar_"],[class*="guilds_"]{background:linear-gradient(180deg,#080000,#170000 55%,#050000) !important;}'+
      '[class*="chat_"]{background:radial-gradient(circle at top right,rgba(216,15,18,.18),transparent 34%),var(--background-primary) !important;}'+
      '[class*="selected_"],[class*="modeSelected_"]{background:rgba(216,15,18,.18) !important;}')
  };
  var STARS_ANIM='@keyframes ldcdrift{from{background-position:0 0}to{background-position:0 -600px}}[class*="guilds_"]{'+STAR_BG+'animation:ldcdrift 120s linear infinite !important;}';
  function uiCSS(){
    var fs=parseInt(get('fontsize','16'),10)||16;var s='';
    if(fs!==16)s+='[class*="markup_"],[class*="messageContent_"]{font-size:'+fs+'px !important;}';
    if(ison('compact','0'))s+=
      // Yalnızca sohbet mesajlarını sıkıştır — ses/kamera paneli, avatarlar,
      // başlıklar gibi genel bileşenlere DOKUNMA (aksi halde yerlerinden oynuyor).
      '[class*="message_"]{padding-top:2px !important;padding-bottom:2px !important;}'+
      '[class*="cozyMessage_"]{margin-top:0 !important;}'+
      '[class*="messageListItem_"]{margin-top:0 !important;}'+
      '[class*="messageContent_"]{line-height:1.28 !important;}';
    return s;
  }
  function bgCSS(u){u=u.replace(/["\\]/g,'');return BASE_SEL+'{--background-base-lowest:rgba(4,5,10,.74) !important;--background-base-lower:rgba(6,8,16,.62) !important;--background-base-low:rgba(10,12,22,.5) !important;--background-base-high:rgba(16,20,34,.55) !important;--background-primary:rgba(10,12,22,.5) !important;--background-secondary:rgba(6,8,16,.62) !important;}[class*="base_"]{background:linear-gradient(rgba(6,8,16,.5),rgba(6,8,16,.5)),url("'+u+'") center/cover fixed !important;}';}
  // Yapı & şekil: köşe yuvarlaklığı (Discord'un --radius-* değişkenleri) + özel logo.
  function structCSS(){
    var s='',r=get('radius','normal');
    if(r==='sharp')s+=BASE_SEL+'{--radius-xxs:0 !important;--radius-xs:2px !important;--radius-sm:3px !important;--radius-md:3px !important;--radius-lg:4px !important;}';
    else if(r==='soft')s+=BASE_SEL+'{--radius-xs:8px !important;--radius-sm:14px !important;--radius-md:18px !important;--radius-lg:24px !important;}';
    var logo=get('logo',LDC_LOGO_DATA_URI);
    if(logo){logo=logo.replace(/["\\]/g,'');
      s+='[data-list-item-id="guildsnav___home"] svg{opacity:0 !important;}'+
         '[data-list-item-id="guildsnav___home"]{position:relative !important;}'+
         '[data-list-item-id="guildsnav___home"]::after{content:"" !important;position:absolute !important;inset:0 !important;background:url("'+logo+'") center/62% no-repeat !important;pointer-events:none !important;}';
    }
    var font=get('font','');
    if(font){font=font.replace(/["'\\;{}]/g,'');s+=BASE_SEL+'{--font-primary:"'+font+'",sans-serif !important;--font-display:"'+font+'",sans-serif !important;--font-headline:"'+font+'",sans-serif !important;}';}
    if(ison('hideMembers','0'))s+='[class*="membersWrap_"]{display:none !important;}';
    if(ison('bubbles','0'))s+=
      // Balon = sadece metin kutusu. Dikey dolguyu negatif margin ile telafi et →
      // mesajın DIŞ yüksekliği ~sabit kalır, Discord'un sanal listesi kaymaz (üst üste binme yok).
      // Kenarlık ve gölge YOK → art arda balonlar arasında çizgi/dikiş görünmez.
      '[class*="messageContent_"]{background:var(--background-base-higher) !important;padding:5px 13px !important;margin:-5px 0 !important;border-radius:16px !important;width:fit-content !important;max-width:76% !important;box-sizing:border-box !important;transition:background .12s !important;}'+
      '[class*="messageContent_"]:hover{background:var(--background-base-highest) !important;}'+
      // Sadece-görsel/embed mesajlarda boş balon çıkmasın.
      '[class*="messageContent_"]:empty{display:none !important;}'+
      // Art arda AYNI kişinin mesajları BİRLEŞİK: bitişik köşeleri düzleştir (dikişsiz).
      '[class*="groupStart_"] [class*="messageContent_"]{border-bottom-left-radius:6px !important;}'+
      '[class*="cozyMessage_"]:not([class*="groupStart_"]) [class*="messageContent_"]{border-top-left-radius:6px !important;border-bottom-left-radius:6px !important;}'+
      // Alıntı (reply): kıvrım çizgisini gizle; sade, sönük, nötr bir alıntı bloğu.
      '[class*="messageSpine_"]{display:none !important;}'+
      '[class*="repliedMessage_"]{background:rgba(128,132,142,.10) !important;border-radius:8px !important;padding:3px 12px !important;margin:0 0 5px 2px !important;width:fit-content !important;max-width:88% !important;box-sizing:border-box !important;opacity:.82 !important;}'+
      // Alıntı metninin kesme sınırını aç → mesajın çok daha fazlası görünsün.
      '[class*="repliedMessage_"] [class*="repliedText"]{max-width:none !important;}'+
      // Yeni yazar bloğuna üstten nefes payı (padding = ölçülür, kaymaz).
      '[class*="groupStart_"]{padding-top:14px !important;}';
    return s;
  }

  /* Eski 'themeOn' ayarını yeni 'theme' seçicisine taşı */
  if(get('theme',null)===null){set('theme',ison('themeOn','0')?'midnight':'off');}

  var TERM_CSS=
    '.ldc-term{background:#080b10;border:1px solid #1c2733;border-radius:8px;padding:8px 10px;'+
    "font-family:'Cascadia Code','JetBrains Mono','Consolas',monospace;font-size:11px;line-height:1.38;"+
    'height:170px;overflow-y:auto;margin-top:6px;color:#8b98a5;}'+
    '.ldc-term::-webkit-scrollbar{width:7px}.ldc-term::-webkit-scrollbar-thumb{background:#1c2733;border-radius:8px}'+
    '.ldc-term-hd{color:#3fb950;margin-bottom:5px;position:sticky;top:-8px;background:#080b10;padding:2px 0;font-weight:600}'+
    '.ldc-term-hd .c{display:inline-block;width:6px;height:11px;background:#3fb950;vertical-align:middle;margin-left:3px;animation:ldcblink 1.05s steps(2) infinite}'+
    '@keyframes ldcblink{0%,49%{opacity:1}50%,100%{opacity:0}}'+
    '.ldc-tl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
    '.ldc-tt{color:#4b5563}.ldc-tk{font-weight:700}.ldc-tu{color:#6b7784}.ldc-dim{color:#4b5563}'+
    '.ldc-term-sum{color:#6e7681;font-size:11px;line-height:1.5}.ldc-term-sum b{color:#3fb950;font-size:14px}'+
    '.k-SCIENCE{color:#58a6ff}.k-TRACK{color:#d29922}.k-METRICS{color:#3fb950}.k-SENTRY{color:#f85149}'+
    '.k-ANALYTICS{color:#bc8cff}.k-ERROR{color:#f85149}.k-CRASH{color:#f85149}.k-RTC-QoS{color:#39c5cf}'+
    '.k-REPORTING{color:#d29922}.k-SEGMENT{color:#ff7b72}.k-GA{color:#e3b341}.k-ADS{color:#ff7b72}.k-EXPERIMENTS{color:#a5d6ff}';
  var SPLASH_CSS=
    '#ldc-splash{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;background:#08080a;animation:ldcSpIn .3s ease}'+
    '#ldc-splash.out{animation:ldcSpOut .55s ease forwards;pointer-events:none}'+
    ".ldc-sp-wrap{text-align:center;font-family:'gg sans','Segoe UI',system-ui,sans-serif}"+
    '.ldc-sp-mark{width:136px;height:136px;object-fit:contain;display:block;margin:0 auto 12px;opacity:0;transform:translateY(18px) scale(.94);filter:drop-shadow(0 18px 42px rgba(124,92,255,.35));animation:ldcPop .95s .05s cubic-bezier(.16,1,.3,1) forwards}'+
    '.ldc-sp-logo{font-size:52px;font-weight:800;line-height:1.12;color:#fafafa;opacity:0;transform:translateY(20px);animation:ldcPop .95s .18s cubic-bezier(.16,1,.3,1) forwards}'+
    '.ldc-sp-logo b{color:#8f7cff;font-weight:800}'+
    '@keyframes ldcPop{to{opacity:1;transform:none}}'+
    '.ldc-sp-line{height:1px;width:0;margin:24px auto 0;background:#26262b;animation:ldcLine .85s .65s cubic-bezier(.16,1,.3,1) forwards}'+
    '@keyframes ldcLine{to{width:240px}}'+
    ".ldc-sp-tag{margin-top:20px;font-size:11px;font-weight:500;letter-spacing:4px;color:#57575e;font-family:'Cascadia Code','JetBrains Mono','Consolas',monospace;opacity:0;animation:ldcUp .8s .8s ease forwards}"+
    '@keyframes ldcUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}'+
    '@keyframes ldcSpIn{from{opacity:0}to{opacity:1}}@keyframes ldcSpOut{from{opacity:1}to{opacity:0}}';
  var VOICE_CSS=
    '.ldc-vdot{width:9px;height:9px;border-radius:50%;background:#23a55a;flex:0 0 auto;animation:ldcpulse 1.6s ease-out infinite}'+
    '@keyframes ldcpulse{0%{box-shadow:0 0 0 0 rgba(35,165,90,.55)}70%{box-shadow:0 0 0 7px rgba(35,165,90,0)}100%{box-shadow:0 0 0 0 rgba(35,165,90,0)}}';
  var themeSt=new Styler(),accentSt=new Styler(),uiSt=new Styler(),structSt=new Styler(),starsSt=new Styler(),bgSt=new Styler(),upSt=new Styler(),cssSt=new Styler(),panelSt=new Styler();
  panelSt.set(TERM_CSS+SPLASH_CSS+VOICE_CSS);
  function splash(){try{
    if(SAFE||!ison('splash','1')||document.getElementById('ldc-splash'))return;
    var host=document.body||document.documentElement;if(!host)return;
    var s=document.createElement('div');s.id='ldc-splash';
    s.innerHTML='<div class="ldc-sp-wrap"><img class="ldc-sp-mark" src="'+LDC_LOGO_DATA_URI+'" alt=""><div class="ldc-sp-logo"><b>idgaf</b>cord</div><div class="ldc-sp-line"></div><div class="ldc-sp-tag">I DON’T GIVE A FUCK ABOUT YOUR DATA</div></div>';
    host.appendChild(s);
    // Splash'i KESİNLİKLE kaldır. setTimeout gizli/occluded pencerede kısılabilir
    // ve siyah splash ekranda takılı kalabilir; bu yüzden çok yönlü güvence:
    // süre + Discord çizildi + görünürlük + ilk etkileşim + gerçek-zaman tavanı.
    var born=Date.now(),done=false;
    function kill(){if(done)return;done=true;try{s.className='out';}catch(e){}setTimeout(function(){if(s.parentNode)s.parentNode.removeChild(s);},560);}
    var iv=setInterval(function(){if(done){clearInterval(iv);return;}if(Date.now()-born>2300||ldcRendered()){clearInterval(iv);kill();}},250);
    (function raf(){if(done)return;if(Date.now()-born>6000){kill();return;}try{requestAnimationFrame(raf);}catch(e){kill();}})();
    document.addEventListener('click',kill,true);
    document.addEventListener('keydown',kill,true);
    document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-born>1200)kill();});
  }catch(e){}}
  function applyAll(){
    if(SAFE){themeSt.set('');accentSt.set('');uiSt.set('');structSt.set('');starsSt.set('');bgSt.set('');upSt.set('');cssSt.set('');return;}
    themeSt.set(THEMES[get('theme','off')]||'');
    var ac=get('accent','');accentSt.set(ac?BASE_SEL+'{'+accentVars(ac)+'}':'');
    uiSt.set(uiCSS());
    structSt.set(structCSS());
    starsSt.set(ison('stars','0')?STARS_ANIM:'');
    var bi=get('bgimg','');bgSt.set(bi?bgCSS(bi):'');
    upSt.set(ison('upsell','0')?UPSELL_CSS:'');
    cssSt.set(ison('cssOn','0')?get('css',''):'');
  }
  window.__LDC_applyAll=applyAll;applyAll();
  document.addEventListener('DOMContentLoaded',applyAll);
  splash();document.addEventListener('DOMContentLoaded',splash);

  function showLoadIssue(){
    if(document.getElementById('ldc-load-issue'))return;
    var host=document.body||document.documentElement;if(!host)return;
    var box=mk('div',{position:'fixed',left:'50%',top:'76px',transform:'translateX(-50%)',zIndex:'2147482998',width:'min(440px,calc(100vw - 32px))',background:'rgba(30,31,34,.96)',border:'1px solid rgba(216,15,18,.45)',borderRadius:'8px',padding:'14px',boxShadow:'0 14px 38px rgba(0,0,0,.42)',fontFamily:"'gg sans','Segoe UI',system-ui,sans-serif",color:'#f2f3f5'});
    box.id='ldc-load-issue';
    box.appendChild(mk('div',{fontSize:'15px',fontWeight:'800'},'Discord yüklenemedi'));
    box.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',lineHeight:'1.45',marginTop:'4px'},'İnternet, Discord oturumu veya WebView geçici sorun yaşamış olabilir.'));
    var row=mk('div',{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'12px'});
    var r=mkBtn('Yenile',true),c=mkBtn('Kapat',false);
    r.onclick=function(){location.href='https://discord.com/app';};c.onclick=function(){if(box.parentNode)box.parentNode.removeChild(box);};
    row.appendChild(c);row.appendChild(r);box.appendChild(row);host.appendChild(box);
  }
  window.addEventListener('offline',showLoadIssue);
  window.addEventListener('online',function(){var e=document.getElementById('ldc-load-issue');if(e&&e.parentNode)e.parentNode.removeChild(e);});
  setTimeout(function(){var ok=document.querySelector('[class*="app_"],[class*="layers_"],[data-list-id="guildsnav"]');if(!ok&&location.hostname.indexOf('discord.com')>=0)showLoadIssue();},14000);

  // Discord render oldu mu? (beyaz/siyah ekran yakalayıcı)
  function ldcRendered(){return !!document.querySelector('[class*="app_"],[class*="appMount"],[class*="appAsidePanelWrapper"],[class*="base_"],[class*="layers_"],[class*="sidebarList"],[data-list-id="guildsnav"]');}
  function ldcSafeNotice(){
    if(document.getElementById('ldc-safe-note'))return;
    var host=document.body||document.documentElement;if(!host)return;
    var b=mk('div',{position:'fixed',left:'12px',bottom:'12px',zIndex:'2147482996',maxWidth:'330px',padding:'11px 13px',borderRadius:'10px',background:'rgba(35,37,42,.97)',border:'1px solid rgba(240,178,50,.55)',color:'#f2f3f5',fontFamily:"'gg sans','Segoe UI',system-ui,sans-serif",fontSize:'12px',lineHeight:'1.45',boxShadow:'0 14px 38px rgba(0,0,0,.45)'});
    b.id='ldc-safe-note';
    b.innerHTML='<div style="font-weight:800;margin-bottom:3px">Güvenli mod</div>Discord yüklenemediği için tema, özel CSS ve engelleme bu oturumda geçici kapatıldı. <b>Ayarların korundu.</b> Uygulamayı yeniden başlatınca normale döner.';
    host.appendChild(b);
  }
  // Discord ~13 sn içinde çizilmezse: ilk seferde bizim müdahalelerimizi bu oturum
  // için kapatıp BİR KEZ yeniden yükle (döngü koruması: sessionStorage bayrağı).
  function ldcRenderCheck(){
    try{
      if(location.hostname.indexOf('discord.com')<0||ldcRendered())return;
      if(SAFE){ldcSafeNotice();return;}
      try{sessionStorage.setItem('ldc_safe','1');}catch(e){}
      location.reload();
    }catch(e){}
  }
  setTimeout(ldcRenderCheck,13000);
  if(SAFE)setTimeout(function(){if(!ldcRendered())ldcSafeNotice();},2000);

  function textOf(el){return ((el&&((el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')+' '+(el.textContent||'')))||'').toLowerCase();}
  function visible(el){var r=el.getBoundingClientRect();return r.width>8&&r.height>8&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;}
  function micButton(){
    var nodes=Array.prototype.slice.call(document.querySelectorAll('button,[role="button"],[aria-label]'));
    var best=null,bestScore=-1;
    nodes.forEach(function(el){
      if(!visible(el))return;
      var t=textOf(el),score=0;
      if(!t)return;
      // Mikrofon susturma düğmesinin güçlü sinyalleri (TR + EN).
      if(/microphone|mikrofon/.test(t))score+=80;
      if(/(^|\s)(mute|unmute)(\s|$)|sustur|susturmayı aç|sesini aç|sesi aç/.test(t))score+=50;
      // Komşu düğmeleri (kamera/ekran/yayın/kulaklık/etkinlik) YANLIŞLIKLA seçme.
      if(/deafen|kulak|sağır|sagir|bildirim|notification|channel|server|sunucu|kanal|soundboard|activity|etkinlik|kamera|camera|video|ekran|screen|share|yayın|paylaş|hang ?up|ayrıl|disconnect|çıkış/.test(t))score-=95;
      var r=el.getBoundingClientRect();
      // Sol-alt ses/kullanıcı paneli (mute düğmesi burada durur).
      if(r.left<440&&r.top>innerHeight-220)score+=60;
      if(el.tagName==='BUTTON')score+=8;
      if(score>bestScore){bestScore=score;best=el;}
    });
    return bestScore>45?best:null;
  }
  function micAction(btn){
    var t=textOf(btn);
    if(/unmute|sesini aç|sesi aç|mikrofonu aç|mikrofon aç|aç/.test(t))return 'unmute';
    if(/mute|sustur|sessiz|mikrofonu kapat|mikrofon kapat|kapat/.test(t))return 'mute';
    return 'toggle';
  }
  function setMic(desired){
    var btn=micButton();
    if(!btn)return false;
    var action=micAction(btn);
    if(!desired||desired==='toggle'||action==='toggle'||desired===action){
      btn.click();
    }
    setTimeout(updateMicBadge,120);
    return true;
  }
  window.__LDC_toggleMute=function(){var ok=setMic('toggle');if(!ok)say('Mikrofon düğmesi bulunamadı.',C.warn);return ok;};
  window.__LDC_setMute=function(v){var ok=setMic(v);if(!ok)say('Mikrofon düğmesi bulunamadı.',C.warn);return ok;};

  var voiceRec=null,voiceActive=false,voiceRestartTimer=null,voiceWatchdog=null,voiceLastAction='',voiceLastActedAt=0,voiceAlive=0;
  var voiceStarting=false,voiceStartedAt=0,voiceFails=0,voiceHardErr=false,voiceGaveUp=false;
  var voiceHud=null,voiceHudDot=null,voiceHudTxt=null,voiceHudTimer=null,voiceStatusEl=null;
  // Türkçe karakterleri sadeleştir + noktalama temizle → eşleştirme kolaylaşır.
  function normVoice(s){return String(s||'').toLowerCase()
    .replace(/[ıİ]/g,'i').replace(/[ğĞ]/g,'g').replace(/[üÜ]/g,'u').replace(/[şŞ]/g,'s').replace(/[öÖ]/g,'o').replace(/[çÇ]/g,'c')
    .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}
  // Komut çözümleyici: normalize edilmiş metinde niyeti bulur. Yanlış tetiklemeyi
  // azaltmak için (özel ifade hariç) mikrofon/ses anahtarı + fiil şartı aranır.
  function matchVoiceCommand(t){
    var up=normVoice(get('voiceUnmutePhrase','mikrofonu aç'));
    var mp=normVoice(get('voiceMutePhrase','mikrofonu kapat'));
    if(up&&t.indexOf(up)>=0)return 'unmute';
    if(mp&&t.indexOf(mp)>=0)return 'mute';
    var mic=/\b(mikrofon\w*|mikp\w*|ses|sesi|sesim\w*|kendimi)\b/.test(t);
    if(/\bunmute\b|\bkonusabilir\w*\b/.test(t))return 'unmute';
    if(mic&&/\b(ac|acar|acsana|acabilir|acalim|geri ?ac|acin)\b/.test(t))return 'unmute';
    if(/\bmute\b|\bsustur\w*\b|\bsessiz\w*\b/.test(t))return 'mute';
    if(mic&&/\b(kapat\w*|kapa|kes)\b/.test(t))return 'mute';
    if(mic&&/\b(degistir\w*|toggle|ac ?kapa)\b/.test(t))return 'toggle';
    return null;
  }
  function actVoice(t){
    var cmd=matchVoiceCommand(t);if(!cmd)return false;
    var now=Date.now();
    // Aynı komutu 1.6 sn içinde tekrar uygulama (interim + final çift tetiklemesini engeller).
    if(cmd===voiceLastAction&&now-voiceLastActedAt<1600)return true;
    voiceLastAction=cmd;voiceLastActedAt=now;
    var ok=setMic(cmd);
    if(!ok){voiceHudFlash('Mikrofon düğmesi bulunamadı','warn');say('Mikrofon düğmesi bulunamadı.',C.warn);return true;}
    voiceHudFlash(cmd==='mute'?'Mikrofon kapatıldı':(cmd==='unmute'?'Mikrofon açıldı':'Mikrofon değiştirildi'),cmd);
    say(cmd==='mute'?'Ses komutu: mikrofon kapatıldı.':(cmd==='unmute'?'Ses komutu: mikrofon açıldı.':'Ses komutu: mikrofon değiştirildi.'));
    return true;
  }
  // Eski isim (geriye dönük uyumluluk).
  function handleVoice(s){return actVoice(normVoice(s));}

  function micState(){
    var btn=micButton();if(!btn)return 'unknown';
    var a=micAction(btn);return a==='unmute'?'muted':(a==='mute'?'live':'unknown');
  }
  function updateMicBadge(){
    if(!micBadge||!ison('micBadge','1'))return;
    var s=micState(),on=s==='live';
    micBadge.textContent=s==='unknown'?'Mikrofon ?':(on?'Mikrofon açık':'Mikrofon kapalı');
    micBadge.style.background=on?'rgba(35,165,90,.92)':'rgba(216,15,18,.92)';
  }
  function ensureMicBadge(){
    if(!ison('micBadge','1')){if(micBadge)micBadge.style.display='none';return;}
    if(!micBadge){micBadge=mk('div',{position:'fixed',left:'16px',bottom:'18px',zIndex:'2147482999',padding:'7px 11px',borderRadius:'18px',fontSize:'12px',fontWeight:'700',color:'#fff',boxShadow:'0 8px 26px rgba(0,0,0,.35)',pointerEvents:'none'});(document.body||document.documentElement).appendChild(micBadge);}
    micBadge.style.display='block';updateMicBadge();
  }
  // Sesle komut için sol-altta canlı durum balonu (dinleniyor / son komut).
  function ensureVoiceHud(){
    if(!voiceHud){
      voiceHud=mk('div',{position:'fixed',left:'16px',bottom:'52px',zIndex:'2147482997',display:'flex',alignItems:'center',gap:'8px',padding:'7px 13px 7px 11px',borderRadius:'20px',background:'rgba(20,21,24,.93)',border:'1px solid rgba(255,255,255,.09)',boxShadow:'0 8px 26px rgba(0,0,0,.42)',fontFamily:"'gg sans','Segoe UI',system-ui,sans-serif",fontSize:'12px',fontWeight:'600',color:'#e6e8ea',maxWidth:'320px',pointerEvents:'none',transition:'border-color .18s',backdropFilter:'blur(8px)'});
      voiceHudDot=mk('span',{});voiceHudDot.className='ldc-vdot';
      voiceHudTxt=mk('span',{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'},'Dinleniyor…');
      voiceHud.appendChild(voiceHudDot);voiceHud.appendChild(voiceHudTxt);
      (document.body||document.documentElement).appendChild(voiceHud);
    }
    voiceHud.style.display='flex';
  }
  function voiceHudState(mode){ // 'listen' | 'idle' | 'error'
    if(!voiceHudDot)return;
    voiceHudDot.style.background=mode==='error'?'#f0b232':(mode==='listen'?'#23a55a':'#80848e');
    voiceHudDot.style.animationPlayState=mode==='listen'?'running':'paused';
  }
  function voiceHudFlash(text,kind){ // kind: 'mute' | 'unmute' | 'heard' | 'warn'
    if(!voiceHud)return;
    voiceHudTxt.textContent=text;
    voiceHud.style.borderColor=kind==='mute'?'rgba(216,15,18,.65)':(kind==='unmute'?'rgba(35,165,90,.65)':(kind==='warn'?'rgba(240,178,50,.65)':'rgba(255,255,255,.09)'));
    if(voiceHudTimer)clearTimeout(voiceHudTimer);
    voiceHudTimer=setTimeout(function(){if(voiceHudTxt)voiceHudTxt.textContent='Dinleniyor…';if(voiceHud)voiceHud.style.borderColor='rgba(255,255,255,.09)';},2600);
  }
  function voiceReleaseRec(){if(voiceRec){try{voiceRec.onstart=null;voiceRec.onend=null;voiceRec.onerror=null;voiceRec.onresult=null;voiceRec.abort?voiceRec.abort():voiceRec.stop();}catch(e){}voiceRec=null;}}
  function stopVoice(){
    voiceActive=false;voiceStarting=false;
    if(voiceRestartTimer){clearTimeout(voiceRestartTimer);voiceRestartTimer=null;}
    if(voiceWatchdog){clearInterval(voiceWatchdog);voiceWatchdog=null;}
    voiceReleaseRec();
    if(voiceHud)voiceHud.style.display='none';
  }
  // Devre kesici: art arda hızlı çöküşlerde ses tanımayı KAPAT ki yeniden-başlatma
  // döngüsü sayfayı boğup dondurmasın/beyaz ekran yapmasın. Üstel geri çekilme.
  function voiceGiveUp(msg){voiceActive=false;voiceStarting=false;voiceGaveUp=true;if(voiceRestartTimer){clearTimeout(voiceRestartTimer);voiceRestartTimer=null;}if(voiceWatchdog){clearInterval(voiceWatchdog);voiceWatchdog=null;}voiceReleaseRec();voiceHudState('error');voiceHudFlash(msg||'Ses tanıma kapatıldı','warn');updateVoiceStatus();}
  function scheduleVoiceRestart(){
    if(!voiceActive||voiceStarting||voiceRestartTimer)return;
    // Sağlıklıyken (sessizlik/normal bitiş) HIZLI yeniden başla → sürekli dinleme.
    // Yalnızca ART ARDA SERT hatada üstel geri çekil. Tek-uçuş çakışmayı önler.
    var delay=voiceFails>0?Math.min(1000*Math.pow(2,Math.min(voiceFails,5)),20000):350;
    voiceRestartTimer=setTimeout(function(){voiceRestartTimer=null;startVoice();},delay);
  }
  function startVoice(){
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){voiceGiveUp('Ses tanıma bu ortamda yok');return false;}
    if(voiceStarting)return false;            // tek-uçuş: üst üste başlatma yok
    voiceStarting=true;
    if(voiceRestartTimer){clearTimeout(voiceRestartTimer);voiceRestartTimer=null;}
    voiceReleaseRec();
    voiceActive=true;voiceGaveUp=false;voiceHardErr=false;ensureVoiceHud();voiceHudState('listen');voiceAlive=Date.now();voiceStartedAt=Date.now();updateVoiceStatus();
    try{
      voiceRec=new SR();voiceRec.lang=get('voiceLang','tr-TR');voiceRec.continuous=true;voiceRec.interimResults=true;voiceRec.maxAlternatives=3;
      voiceRec.onstart=function(){voiceStarting=false;voiceStartedAt=Date.now();voiceAlive=Date.now();voiceHudState('listen');updateVoiceStatus();};
      voiceRec.onresult=function(e){
        voiceFails=0;voiceHardErr=false;voiceAlive=Date.now();  // çalışıyor → sayaç sıfır
        for(var i=e.resultIndex;i<e.results.length;i++){
          var res=e.results[i],acted=false;
          for(var a=0;a<res.length;a++){var t=normVoice(res[a].transcript);if(!t)continue;if(actVoice(t)){acted=true;break;}}
          if(!acted&&res.isFinal){var ft=normVoice(res[0].transcript);if(ft&&ft.length>1)voiceHudFlash('duydum: '+ft,'heard');}
        }
      };
      voiceRec.onerror=function(e){
        var err=e&&e.error;
        // İzin reddi kalıcıdır → tekrar deneme, kapat.
        if(err==='not-allowed'){voiceGiveUp('Mikrofon izni yok — ses komutu kapatıldı');say('Ses komutu için Windows/site mikrofon izni gerekli.',C.warn);return;}
        // 'no-speech' ve 'aborted' ZARARSIZDIR (sessizlik/normal). Yalnızca gerçek
        // servis hataları (network, service-not-allowed, audio-capture, bad-grammar)
        // devre kesici sayacını besler.
        if(err&&err!=='no-speech'&&err!=='aborted')voiceHardErr=true;
        voiceHudState('idle');
      };
      voiceRec.onend=function(){
        voiceStarting=false;voiceHudState('idle');
        if(!voiceActive)return;
        if(voiceHardErr)voiceFails++;else voiceFails=0;  // yalnızca sert hata sayılır
        voiceHardErr=false;
        if(voiceFails>=8){voiceGiveUp('Ses tanıma servisi yanıt vermiyor — kapatıldı. Ayarlardan “Yeniden başlat” ile deneyebilirsin.');return;}
        scheduleVoiceRestart();
        updateVoiceStatus();
      };
      voiceRec.start();
      // Hafif watchdog: onend hiç gelmezse (sessiz ölüm) diriltme dener.
      if(!voiceWatchdog)voiceWatchdog=setInterval(function(){
        if(voiceActive&&!voiceStarting&&!voiceRestartTimer&&(!voiceRec||Date.now()-voiceAlive>30000)){scheduleVoiceRestart();}
      },10000);
      return true;
    }catch(e){
      // start() zaten çalışıyorken/başarısızken hata verir; sert sayıp geri çekil.
      voiceStarting=false;voiceReleaseRec();voiceFails++;
      if(voiceFails>=8){voiceGiveUp('Ses tanıma başlatılamıyor — kapatıldı');return false;}
      scheduleVoiceRestart();
      return false;
    }
  }
  // Ses komutunu manuel (yeniden) başlat: devre kesiciyi sıfırlar.
  function restartVoice(){voiceGaveUp=false;voiceFails=0;voiceHardErr=false;if(voiceRestartTimer){clearTimeout(voiceRestartTimer);voiceRestartTimer=null;}startVoice();}
  function voiceStatusText(){
    if(!ison('voiceMute','0'))return 'Kapalı';
    if(voiceGaveUp)return 'Durdu (yeniden başlat gerekiyor)';
    if(voiceRec&&!voiceStarting)return 'Dinleniyor';
    return 'Başlatılıyor…';
  }
  function updateVoiceStatus(){if(voiceStatusEl){var s=voiceStatusText();voiceStatusEl.textContent=s;voiceStatusEl.style.color=(s.indexOf('Durdu')>=0)?C.warn:(s==='Dinleniyor'?'#fff':C.mut);voiceStatusEl.style.background=(s==='Dinleniyor')?C.grn:C.field;voiceStatusEl.style.borderColor=(s==='Dinleniyor')?C.grn:C.line;}}
  // Kendine ait, tasarımlı "Sesli komutlar" kartı: tetik kelimelerini belirlersin.
  var MIC_SVG='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  function buildVoiceCard(){
    var card=mk('div',{background:'linear-gradient(180deg,rgba(88,101,242,.07),rgba(0,0,0,0))',border:'1px solid '+C.line,borderRadius:'14px',padding:'15px 16px',margin:'8px 0 6px'});
    var hd=mk('div',{display:'flex',alignItems:'center',gap:'11px',marginBottom:'13px'});
    var ic=mk('div',{width:'36px',height:'36px',borderRadius:'11px',background:C.acc,display:'flex',alignItems:'center',justifyContent:'center',flex:'0 0 auto',boxShadow:'0 4px 12px rgba(88,101,242,.4)'});ic.innerHTML=MIC_SVG;
    var htx=mk('div',{flex:'1',minWidth:'0'});
    htx.appendChild(mk('div',{fontSize:'15px',fontWeight:'800',color:C.hl},'Sesli komutlar'));
    htx.appendChild(mk('div',{fontSize:'12px',color:C.mut,marginTop:'1px'},'Kendi tetik kelimelerini belirle'));
    voiceStatusEl=mk('div',{fontSize:'11px',fontWeight:'700',color:C.mut,padding:'5px 10px',borderRadius:'20px',background:C.field,border:'1px solid '+C.line,flex:'0 0 auto',whiteSpace:'nowrap'},voiceStatusText());
    hd.appendChild(ic);hd.appendChild(htx);hd.appendChild(voiceStatusEl);card.appendChild(hd);
    function cmdRow(cfg){
      var wrap=mk('div',{marginTop:cfg.top||'0'});
      var lab=mk('div',{display:'flex',alignItems:'center',gap:'8px',marginBottom:'7px'});
      lab.appendChild(mk('span',{width:'9px',height:'9px',borderRadius:'50%',background:cfg.dot,flex:'0 0 auto',boxShadow:'0 0 0 3px '+cfg.glow}));
      lab.appendChild(mk('span',{fontSize:'13px',fontWeight:'700',color:C.hl},cfg.title));
      lab.appendChild(mk('span',{fontSize:'11px',color:C.mut},cfg.hint));
      wrap.appendChild(lab);
      var inp=mk('input',{width:'100%',boxSizing:'border-box',background:C.field,color:C.fg,border:'1px solid '+C.line,borderRadius:'10px',padding:'11px 12px',fontSize:'13px',fontWeight:'500',outline:'none',transition:'border-color .12s'});
      inp.type='text';inp.placeholder=cfg.def;inp.value=get(cfg.key,cfg.def);
      inp.onfocus=function(){inp.style.borderColor=cfg.dot;};inp.onblur=function(){inp.style.borderColor=C.line;};
      wrap.appendChild(inp);cfg.assign(inp);
      var chips=mk('div',{display:'flex',flexWrap:'wrap',gap:'6px',marginTop:'8px'});
      cfg.presets.forEach(function(p){
        var c=mk('div',{fontSize:'12px',fontWeight:'600',color:C.mut,background:'transparent',border:'1px solid '+C.line,borderRadius:'16px',padding:'5px 12px',cursor:'pointer',transition:'all .12s'},p);
        c.onmouseenter=function(){c.style.borderColor=cfg.dot;c.style.color=C.hl;};
        c.onmouseleave=function(){c.style.borderColor=C.line;c.style.color=C.mut;};
        c.onclick=function(){inp.value=p;set(cfg.key,p);say(cfg.title+' komutu ayarlandı: “'+p+'”');};
        chips.appendChild(c);
      });
      wrap.appendChild(chips);return wrap;
    }
    card.appendChild(cmdRow({title:'Sustur',hint:'· duyunca mikrofonu kapatır',dot:'#f23f42',glow:'rgba(242,63,66,.18)',key:'voiceMutePhrase',def:'mikrofonu kapat',presets:['mikrofonu kapat','sustur','sessiz ol','beni sustur'],assign:function(i){voiceMuteInp=i;}}));
    card.appendChild(cmdRow({title:'Aç',hint:'· duyunca mikrofonu açar',dot:'#23a55a',glow:'rgba(35,165,90,.18)',key:'voiceUnmutePhrase',def:'mikrofonu aç',top:'14px',presets:['mikrofonu aç','sesimi aç','geri aç','konuşacağım'],assign:function(i){voiceUnmuteInp=i;}}));
    var act=mk('div',{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'15px'});
    var save=mkBtn('Kaydet',true);save.onclick=function(){set('voiceMutePhrase',(voiceMuteInp.value||'').trim()||'mikrofonu kapat');set('voiceUnmutePhrase',(voiceUnmuteInp.value||'').trim()||'mikrofonu aç');say('Sesli komutlar kaydedildi.');};
    var vrestart=mkBtn('Yeniden başlat',false);vrestart.onclick=function(){set('voiceMute','1');if(switches['voiceMute'])switches['voiceMute'].set(true);restartVoice();say('Ses tanıma yeniden başlatıldı — dinleniyor.');};
    var vtest=mkBtn('Mikrofonu test et',false);vtest.onclick=function(){var s=micState();if(s==='unknown')say('Discord’un mikrofon düğmesi bulunamadı — bir ses kanalındayken dene.',C.warn);else say('Mikrofon düğmesi bulundu (şu an “'+(s==='live'?'açık':'kapalı')+'”). Komutlar çalışmalı.');};
    act.appendChild(save);act.appendChild(vrestart);act.appendChild(vtest);card.appendChild(act);
    card.appendChild(mk('div',{fontSize:'11px',color:C.mut,marginTop:'11px',lineHeight:'1.5'},'İpucu: bu kelimelerin doğal varyasyonlarını da anlar (ör. “mikrofonu kapatır mısın”). Cümlenin içinde geçmesi yeter.'));
    return card;
  }

  /* ---------------- Ayar paneli (CSSOM, IPC yok) ---------------- */
  var GEAR='<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.9 4.6l1.9 1.5-1.9 3.3-2.3-.9c-.4.4-.9.6-1.4.9l-.3 2.4H9.2l-.3-2.4c-.5-.3-1-.5-1.4-.9l-2.3.9L3.3 14.1l1.9-1.5c0-.2-.1-.4-.1-.6s.1-.4.1-.6L3.3 9.9l1.9-3.3 2.3.9c.4-.4.9-.6 1.4-.9L9.2 4h4.6l.3 2.4c.5.3 1 .5 1.4.9l2.3-.9 1.9 3.3-1.9 1.5c0 .2.1.4.1.6s-.1.4 0 .8z"/></svg>';
  var FT=[
    {k:'block',def:'1',t:'Telemetriyi engelle',d:'Analiz/izleme isteklerini (science, metrics, sentry…) engeller.'},
    {k:'upsell',def:'0',t:'Nitro & reklamları gizle',d:'Yükseltme/hediye (upsell) öğelerini arayüzden gizler.'}
  ];
  var THEME_OPTS=[{v:'off',l:'Kapalı'},{v:'idgaf',l:'idgaf'},{v:'midnight',l:'Midnight'},{v:'space',l:'Uzay'},{v:'dracula',l:'Dracula'},{v:'nord',l:'Nord'},{v:'catppuccin',l:'Catppuccin'},{v:'amoled',l:'AMOLED'},{v:'tokyonight',l:'Tokyo Night'},{v:'gruvbox',l:'Gruvbox'},{v:'solarized',l:'Solarized'},{v:'rosepine',l:'Rosé Pine'},{v:'synthwave',l:'Synthwave'},{v:'monokai',l:'Monokai'}];
  var PROFILE_OPTS=[{v:'normal',l:'Normal'},{v:'save',l:'Tasarruf'},{v:'stream',l:'Yayın'},{v:'game',l:'Oyun'}];
  var RADIUS_OPTS=[{v:'normal',l:'Normal'},{v:'soft',l:'Yumuşak'},{v:'sharp',l:'Köşeli'}];
  var C={bg:'#313338',fg:'#dbdee1',hl:'#f2f3f5',mut:'#949ba4',acc:'#5865F2',accH:'#4752c4',grn:'#23a55a',line:'#232428',line2:'#3a3c41',field:'#1e1f22',btn:'#4e5058',btnH:'#6d6f78',warn:'#f0b232',red:'#f23f42'};
  function st(el,o){for(var k in o){el.style[k]=o[k];}return el;}
  function mk(tag,o,txt){var e=document.createElement(tag);if(o)st(e,o);if(txt!=null)e.textContent=txt;return e;}
  function hover(el,a,b){el.addEventListener('mouseenter',function(){el.style.background=b;});el.addEventListener('mouseleave',function(){el.style.background=a;});}
  var statusEl,themeEl,modal,footEl,switches={},nativeSwitches={},themePills,profilePills,accentInp,fontRange,fontVal,bgInp,termEl,termSumEl,termTimer=null,radiusPills,logoInp,fontInp,muteShortcutText,updateStatusEl,voiceMuteInp,voiceUnmuteInp,tabButtons={},activeTab='system',micBadge=null;
  var nativeState={minimize_to_tray:true,start_minimized:false,autostart:false,disable_gpu:false,stream_performance:false,game_mode:false,auto_update_check:true,mute_shortcut:'CommandOrControl+Shift+M'};
  function esc(s){return String(s).replace(/[&<>]/g,function(c){return c==='&'?'&amp;':c==='<'?'&lt;':'&gt;';});}
  function fmtTime(t){var d=new Date(t),p=function(n){return(n<10?'0':'')+n;};return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());}
  function shortUrl(u){return String(u).replace(/^[^/]*\//,'/').split('?')[0].slice(0,52);}
  function renderTerm(){
    if(!termEl)return;
    var out='<div class="ldc-term-hd">izleme engelleyici — canlı<span class="c"></span></div>';
    if(!blockedLog.length)out+='<div class="ldc-tl ldc-dim">henüz engellenen istek yok — Discord kullandıkça dolar</div>';
    var arr=blockedLog.slice(-140);
    for(var i=0;i<arr.length;i++){var e=arr[i];out+='<div class="ldc-tl"><span class="ldc-tt">'+fmtTime(e.t)+'</span>  <span class="k-'+e.c+'">'+e.c+'</span>  <span class="ldc-tu">'+esc(shortUrl(e.u))+'</span></div>';}
    termEl.innerHTML=out;termEl.scrollTop=termEl.scrollHeight;
    if(termSumEl){var parts=[];for(var k in catCount)parts.push('<span class="k-'+k+'">'+k+'</span> '+catCount[k]);termSumEl.innerHTML='<b>'+blockedCount+'</b> istek engellendi · bugün <b>'+get('blockedToday','0')+'</b>'+(parts.length?'<br>'+parts.sort().join('&nbsp;&nbsp; '):'');}
  }
  function mkPills(opts,cur,cb){
    // Segment kontrolü: iç arka planlı kapsül; seçili öğe aksan dolgulu.
    var wrap=mk('div',{display:'inline-flex',flexWrap:'wrap',gap:'4px',marginTop:'2px',padding:'4px',background:C.field,border:'1px solid '+C.line,borderRadius:'11px'});var btns={};
    opts.forEach(function(o){
      var b=mk('div',{padding:'7px 14px',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer',background:'transparent',color:C.mut,transition:'background .13s,color .13s,box-shadow .13s'},o.l);
      b.onclick=function(){wrap._v=o.v;render();cb(o.v);};
      b.onmouseenter=function(){if(wrap._v!==o.v)b.style.color=C.hl;};
      b.onmouseleave=function(){if(wrap._v!==o.v)b.style.color=C.mut;};
      btns[o.v]=b;wrap.appendChild(b);
    });
    wrap._v=cur;function render(){for(var k in btns){var on=k===wrap._v;btns[k].style.background=on?C.acc:'transparent';btns[k].style.color=on?'#fff':C.mut;btns[k].style.boxShadow=on?'0 2px 8px rgba(88,101,242,.4)':'none';}}
    wrap.set=function(v){wrap._v=v;render();};render();return wrap;
  }
  // Tema önizleme renkleri: [derin zemin, yüzey, aksan] — kart swatch'ında kullanılır.
  var THEME_SW={
    off:['#2b2d31','#3a3c41','#5865f2'],idgaf:['#120000','#340707','#d80f12'],
    midnight:['#09090c','#1c1c20','#5865f2'],space:['#070912','#181d38','#7c5cff'],
    dracula:['#21222c','#3c4055','#bd93f9'],nord:['#2e3440','#434c5e','#88c0d0'],
    catppuccin:['#181825','#363a4f','#cba6f7'],amoled:['#000000','#141414','#5865f2'],
    tokyonight:['#1a1b26','#2a2e42','#7aa2f7'],gruvbox:['#282828','#45403d','#fabd2f'],
    solarized:['#002b36','#0f5265','#268bd2'],rosepine:['#191724','#2a2740','#ebbcba'],
    synthwave:['#190833','#331466','#ff2e97'],monokai:['#272822','#3a3b33','#f92672']
  };
  function mkThemePicker(cur,cb){
    var grid=mk('div',{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(102px,1fr))',gap:'8px',marginTop:'6px'});
    var cards={};
    THEME_OPTS.forEach(function(o){
      var sw=THEME_SW[o.v]||['#2b2d31','#3a3c41','#5865f2'];
      var card=mk('div',{position:'relative',cursor:'pointer',borderRadius:'11px',overflow:'hidden',border:'2px solid transparent',background:C.field,transition:'border-color .14s,transform .14s,box-shadow .14s'});
      var prev=mk('div',{position:'relative',height:'48px',background:sw[0]});
      prev.appendChild(mk('div',{position:'absolute',top:'9px',left:'9px',width:'15px',height:'15px',borderRadius:'50%',background:sw[2],boxShadow:'0 0 0 2px rgba(0,0,0,.3)'}));
      prev.appendChild(mk('div',{position:'absolute',left:'9px',right:'22px',bottom:'9px',height:'7px',borderRadius:'4px',background:sw[1]}));
      var check=mk('div',{position:'absolute',top:'7px',right:'7px',width:'19px',height:'19px',borderRadius:'50%',background:C.acc,display:'none',alignItems:'center',justifyContent:'center',boxShadow:'0 1px 4px rgba(0,0,0,.4)'});
      check.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      var label=mk('div',{padding:'7px 10px',fontSize:'12px',fontWeight:'600',color:C.hl,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'},o.l);
      card.appendChild(prev);card.appendChild(check);card.appendChild(label);
      card.onclick=function(){grid._v=o.v;render();cb(o.v);};
      card.onmouseenter=function(){if(grid._v!==o.v){card.style.borderColor=C.line2;card.style.transform='translateY(-1px)';}};
      card.onmouseleave=function(){if(grid._v!==o.v){card.style.borderColor='transparent';card.style.transform='none';}};
      cards[o.v]={card:card,check:check};grid.appendChild(card);
    });
    grid._v=cur;
    function render(){for(var k in cards){var on=k===grid._v;cards[k].card.style.borderColor=on?C.acc:'transparent';cards[k].card.style.transform=on?'translateY(-1px)':'none';cards[k].card.style.boxShadow=on?'0 6px 16px rgba(0,0,0,.32)':'none';cards[k].check.style.display=on?'flex':'none';}}
    grid.set=function(v){grid._v=v;render();};render();return grid;
  }
  function mkRow(title,desc,ctrl){
    var row=mk('div',{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:'1px solid '+C.line2,gap:'16px'});
    var txt=mk('div',{flex:'1'});txt.appendChild(mk('div',{fontSize:'14px',color:C.hl,fontWeight:'500'},title));
    if(desc)txt.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',marginTop:'3px',lineHeight:'1.35'},desc));
    row.appendChild(txt);row.appendChild(ctrl);return row;
  }
  function say(m,c){if(statusEl){statusEl.textContent=m||'';statusEl.style.color=c||C.grn;}}
  function sec(t){var e=mk('div',{fontSize:'11px',textTransform:'uppercase',letterSpacing:'.6px',color:C.mut,fontWeight:'700',margin:'18px 0 4px'},t);e._sec=t;return e;}
  function mkBtn(l,p){var b=mk('button',{background:p?C.acc:C.btn,color:'#fff',border:'none',borderRadius:'6px',padding:'9px 15px',fontSize:'13px',cursor:'pointer',fontWeight:'500',fontFamily:'inherit',whiteSpace:'nowrap',flex:'0 0 auto'},l);hover(b,p?C.acc:C.btn,p?C.accH:C.btnH);return b;}
  function profileFromNative(){if(nativeState.game_mode)return 'game';if(nativeState.stream_performance)return 'stream';if(nativeState.disable_gpu)return 'save';return 'normal';}
  var TAB_ICONS={
    system:'<svg viewBox="0 0 24 24"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
    voice:'<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    privacy:'<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    theme:'<svg viewBox="0 0 24 24"><path d="M12 2.7l5.3 5.3a7.5 7.5 0 1 1-10.6 0z"/></svg>',
    look:'<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    advanced:'<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
  };
  function mkTabs(body){
    var opts=[{v:'system',l:'Sistem'},{v:'voice',l:'Ses'},{v:'privacy',l:'Gizlilik'},{v:'theme',l:'Tema'},{v:'look',l:'Görünüm'},{v:'advanced',l:'Gelişmiş'}];
    var bar=mk('div',{display:'flex',gap:'4px',padding:'12px 16px 14px',borderBottom:'1px solid '+C.line,overflowX:'auto',background:'linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,0))'});
    bar.className='ldc-tabbar';
    opts.forEach(function(o){
      var b=mk('button',{display:'flex',alignItems:'center',gap:'7px',background:'transparent',color:C.mut,border:'1px solid transparent',borderRadius:'10px',padding:'8px 13px',fontSize:'13px',fontWeight:'600',cursor:'pointer',whiteSpace:'nowrap',fontFamily:'inherit',transition:'background .14s,color .14s,box-shadow .14s,transform .14s',flex:'0 0 auto'});
      b.innerHTML='<span class="ldc-tab-ic" style="display:inline-flex;width:15px;height:15px">'+(TAB_ICONS[o.v]||'')+'</span><span>'+o.l+'</span>';
      var svg=b.querySelector('svg');if(svg){svg.setAttribute('width','15');svg.setAttribute('height','15');svg.style.fill='none';svg.style.stroke='currentColor';svg.style.strokeWidth='2';svg.style.strokeLinecap='round';svg.style.strokeLinejoin='round';}
      b.onclick=function(){activeTab=o.v;applyTabs(body);};
      b.onmouseenter=function(){if(activeTab!==o.v){b.style.background=C.field;b.style.color=C.hl;}};
      b.onmouseleave=function(){if(activeTab!==o.v){b.style.background='transparent';b.style.color=C.mut;}};
      tabButtons[o.v]=b;bar.appendChild(b);
    });
    return bar;
  }
  function tabForSection(t){
    if(/Sistem|Güncelleme/.test(t))return 'system';
    if(/Ses|Mikrofon/.test(t))return 'voice';
    if(/Engellenen|Gizlilik|Genel/.test(t))return 'privacy';
    if(/Özel tema/.test(t))return 'advanced';
    if(/Tema|Aksan/.test(t))return 'theme';
    if(/Görünüm|Yapı|Yıldız|Arka/.test(t))return 'look';
    return activeTab;
  }
  function applyTabs(body){
    var cur='system',kids=Array.prototype.slice.call(body.children);
    kids.forEach(function(ch){if(ch._sec)cur=tabForSection(ch._sec);ch._tab=cur;ch.style.display=(cur===activeTab)?'':'none';});
    for(var k in tabButtons){var on=k===activeTab,b=tabButtons[k];
      b.style.background=on?C.acc:'transparent';
      b.style.color=on?'#fff':C.mut;
      b.style.boxShadow=on?'0 4px 13px rgba(88,101,242,.42)':'none';
      b.style.transform=on?'translateY(-1px)':'none';
    }
    // Seçili sekmenin ilk satırını görünür kılmak için gövdeyi başa sar.
    var mb=document.getElementById('ldc-modal-body');if(mb)mb.scrollTop=0;
  }
  // Bilgisayardan görsel seç → data: URL (CSP'ye takılmaz, localStorage'da saklanır).
  function pickFile(maxLen,cb){var inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.style.display='none';inp.onchange=function(){var f=inp.files&&inp.files[0];if(!f)return;var r=new FileReader();r.onload=function(){var d=r.result;if(String(d).length>maxLen){cb(null);return;}cb(d);};r.readAsDataURL(f);};(document.body||document.documentElement).appendChild(inp);inp.click();setTimeout(function(){if(inp.parentNode)inp.parentNode.removeChild(inp);},1500);}
  function mkSwitch(on,cb){
    var w=mk('div',{position:'relative',width:'40px',height:'24px',flex:'0 0 auto',cursor:'pointer'});
    var tr=mk('div',{position:'absolute',top:'0',left:'0',right:'0',bottom:'0',borderRadius:'24px',transition:'.18s',background:on?C.grn:'#80848e'});
    var kn=mk('div',{position:'absolute',top:'3px',left:'3px',width:'18px',height:'18px',borderRadius:'50%',background:'#fff',transition:'.18s',transform:on?'translateX(16px)':'translateX(0)'});
    w.appendChild(tr);w.appendChild(kn);w._c=on;
    function r(){tr.style.background=w._c?C.grn:'#80848e';kn.style.transform=w._c?'translateX(16px)':'translateX(0)';}
    w.onclick=function(){w._c=!w._c;r();cb(w._c);};w.set=function(v){w._c=!!v;r();};return w;
  }
  function onToggle(k,v){set(k,v?'1':'0');applyAll();say('Kaydedildi.');}
  function onVoiceToggle(v){set('voiceMute',v?'1':'0');if(v){voiceGaveUp=false;voiceFails=0;voiceHardErr=false;startVoice();say('Ses komutu açıldı — dinleniyor.');}else{stopVoice();say('Ses komutu kapatıldı.');}updateVoiceStatus();}
  function nativeCmd(action,key,value){
    var u='idgafcord://native?action='+encodeURIComponent(action||'');
    if(key)u+='&key='+encodeURIComponent(key);
    if(value!=null)u+='&value='+encodeURIComponent(value);
    try{window.location.href=u;}catch(e){}
  }
  function nativeRow(key,title,desc){
    var sw=mkSwitch(!!nativeState[key],function(v){nativeCmd('set',key,v?'1':'0');say('Kaydedildi.');});
    nativeSwitches[key]=sw;
    return mkRow(title,desc,sw);
  }
  function shortcutLabel(s){return String(s||'CommandOrControl+Shift+M').replace('CommandOrControl','Ctrl/Cmd').replace(/\+/g,' + ');}
  function updateShortcutText(){if(muteShortcutText)muteShortcutText.textContent=shortcutLabel(nativeState.mute_shortcut);}
  function eventShortcut(e){
    var key='';
    if(/^Key[A-Z]$/.test(e.code))key=e.code.slice(3);
    else if(/^Digit[0-9]$/.test(e.code))key=e.code.slice(5);
    else if(/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code))key=e.code;
    else {
      var map={Space:'Space',Enter:'Enter',Tab:'Tab',Escape:'Escape',Backspace:'Backspace',Delete:'Delete',Insert:'Insert',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown',ArrowUp:'ArrowUp',ArrowDown:'ArrowDown',ArrowLeft:'ArrowLeft',ArrowRight:'ArrowRight'};
      key=map[e.code]||'';
    }
    if(!key||['Shift','Control','Alt','Meta'].indexOf(e.key)>=0)return '';
    var p=[];
    if(e.ctrlKey||e.metaKey)p.push('CommandOrControl');
    if(e.altKey)p.push('Alt');
    if(e.shiftKey)p.push('Shift');
    if(!p.length)return '';
    p.push(key);
    return p.join('+');
  }
  function startShortcutCapture(btn){
    var prev=btn.textContent,prevBg=btn.style.background;
    btn.textContent='Tuşlara bas… (Esc iptal)';
    btn.style.background=C.warn;
    say('Susturma kısayolu: Ctrl / Alt / Shift + bir tuşa bas. Esc = iptal.');
    function stop(){document.removeEventListener('keydown',done,true);btn.textContent=prev;btn.style.background=prevBg||'';}
    function done(e){
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();stop();say('Kısayol değişikliği iptal edildi.');return;}
      // Sadece bir değiştirici tuş basıldıysa geçerli kombinasyonu beklemeye devam et.
      if(['Shift','Control','Alt','Meta'].indexOf(e.key)>=0)return;
      e.preventDefault();e.stopPropagation();
      var combo=eventShortcut(e);
      if(!combo){say('En az Ctrl, Alt veya Shift ile birlikte bir tuş gerekir.',C.warn);return;}
      stop();
      nativeCmd('set_shortcut','mute_shortcut',combo);
      say('Kısayol kaydediliyor: '+shortcutLabel(combo));
    }
    setTimeout(function(){document.addEventListener('keydown',done,true);},30);
  }
  window.__LDC_setNativeSettings=function(s){
    nativeState=s||nativeState;
    for(var k in nativeSwitches){if(k in nativeState)nativeSwitches[k].set(!!nativeState[k]);}
    if(profilePills)profilePills.set(profileFromNative());
    updateShortcutText();
  };
  window.__LDC_nativeNotice=function(msg,warn){say(msg,warn?C.warn:C.grn);};
  window.__LDC_updateStatus=function(msg,warn){if(updateStatusEl){updateStatusEl.textContent=msg||'';updateStatusEl.style.color=warn?C.warn:C.grn;}say(msg,warn?C.warn:C.grn);};

  function build(){try{
    if(document.getElementById('ldc-root')||!document.body)return;
    if(get('firstRunDone','0')!=='1')activeTab='privacy';
    var root=mk('div',{});root.id='ldc-root';
    // Ergonomik launcher: koyu cam kapsül = [ sürükleme tutamağı | dişli ].
    var gear=mk('div',{position:'fixed',right:'16px',bottom:'96px',display:'flex',alignItems:'center',gap:'1px',padding:'4px',background:'rgba(30,31,34,.94)',border:'1px solid rgba(255,255,255,.09)',borderRadius:'26px',boxShadow:'0 6px 22px rgba(0,0,0,.5)',zIndex:'2147483000',backdropFilter:'blur(10px)'});
    gear.id='ldc-gear';
    var grip=mk('div',{width:'20px',height:'38px',display:'flex',alignItems:'center',justifyContent:'center',cursor:'grab',color:'#8b98a5',flex:'0 0 auto',borderRadius:'16px'});
    grip.title='Sürükle';
    grip.innerHTML='<svg width="10" height="16" viewBox="0 0 10 16"><g fill="currentColor"><circle cx="2" cy="2" r="1.4"/><circle cx="8" cy="2" r="1.4"/><circle cx="2" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="2" cy="14" r="1.4"/><circle cx="8" cy="14" r="1.4"/></g></svg>';
    hover(grip,'transparent','rgba(255,255,255,.07)');
    var gbtn=mk('div',{width:'38px',height:'38px',borderRadius:'50%',background:C.acc,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flex:'0 0 auto',transition:'background .15s,transform .15s'});
    gbtn.title='idgafcord ayarları';gbtn.innerHTML=GEAR;
    var sv=gbtn.firstChild;if(sv&&sv.style){st(sv,{width:'22px',height:'22px',fill:'#fff'});}
    hover(gbtn,C.acc,C.accH);gbtn.onclick=openPanel;
    gear.appendChild(grip);gear.appendChild(gbtn);
    // Kayıtlı konumu geri yükle (ekran dışına taşmışsa sınırla)
    (function(){var gp=get('gearpos','');if(gp){try{var p=JSON.parse(gp);var x=Math.max(4,Math.min(window.innerWidth-72,p.x)),y=Math.max(4,Math.min(window.innerHeight-50,p.y));st(gear,{left:x+'px',top:y+'px',right:'auto',bottom:'auto'});}catch(e){}}})();
    // Sürükleme YALNIZCA tutamaktan; dişliye tık paneli açar (karışmaz).
    (function(){var drag=false,sx,sy,ox,oy;
      grip.addEventListener('mousedown',function(e){drag=true;sx=e.clientX;sy=e.clientY;var r=gear.getBoundingClientRect();ox=r.left;oy=r.top;grip.style.cursor='grabbing';e.preventDefault();});
      document.addEventListener('mousemove',function(e){if(!drag)return;var nx=Math.max(4,Math.min(window.innerWidth-gear.offsetWidth-4,ox+(e.clientX-sx))),ny=Math.max(4,Math.min(window.innerHeight-gear.offsetHeight-4,oy+(e.clientY-sy)));st(gear,{left:nx+'px',top:ny+'px',right:'auto',bottom:'auto'});});
      document.addEventListener('mouseup',function(){if(!drag)return;drag=false;grip.style.cursor='grab';var r=gear.getBoundingClientRect();set('gearpos',JSON.stringify({x:Math.round(r.left),y:Math.round(r.top)}));});
    })();

    modal=mk('div',{position:'fixed',top:'0',left:'0',right:'0',bottom:'0',background:'rgba(0,0,0,.6)',display:'none',alignItems:'center',justifyContent:'center',zIndex:'2147483001',fontFamily:"'gg sans','Segoe UI',system-ui,sans-serif"});
    modal.id='ldc-modal';modal.addEventListener('click',function(e){if(e.target===modal)closePanel();});
    var card=mk('div',{width:'720px',maxWidth:'calc(100vw - 32px)',maxHeight:'calc(100vh - 64px)',background:C.bg,color:C.fg,borderRadius:'14px',boxShadow:'0 12px 40px rgba(0,0,0,.55)',display:'flex',flexDirection:'column',overflow:'hidden'});

    var head=mk('div',{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:'1px solid '+C.line});
    var hleft=mk('div',{display:'flex',alignItems:'center',gap:'12px',minWidth:'0'});
    var logoImg=mk('img',{width:'36px',height:'36px',borderRadius:'10px',objectFit:'cover',flex:'0 0 auto',boxShadow:'0 4px 14px rgba(0,0,0,.4)'});
    logoImg.src=get('logo','')||LDC_LOGO_DATA_URI;logoImg.alt='';logoImg.onerror=function(){logoImg.src=LDC_LOGO_DATA_URI;};
    var ht=mk('div',{minWidth:'0'});
    ht.appendChild(mk('div',{fontSize:'18px',fontWeight:'800',color:C.hl,letterSpacing:'.2px'},'idgafcord'));
    ht.appendChild(mk('div',{fontSize:'12px',color:C.mut,marginTop:'2px'},'Görünüm · Sistem · Gizlilik'));
    hleft.appendChild(logoImg);hleft.appendChild(ht);
    var x=mk('div',{cursor:'pointer',color:'#b5bac1',fontSize:'24px',lineHeight:'1',padding:'2px 8px',borderRadius:'6px',flex:'0 0 auto'},'×');hover(x,'transparent','#3f4147');x.onclick=closePanel;
    head.appendChild(hleft);head.appendChild(x);

    var body=mk('div',{padding:'4px 20px 18px',overflowY:'auto'});body.id='ldc-modal-body';
    var tabs=mkTabs(body);
    body.appendChild(sec('Genel & Gizlilik'));
    if(get('firstRunDone','0')!=='1'){
      var welcome=mk('div',{border:'1px solid rgba(216,15,18,.35)',background:'linear-gradient(135deg,rgba(216,15,18,.16),rgba(0,0,0,.14))',borderRadius:'8px',padding:'12px',margin:'10px 0'});
      welcome.appendChild(mk('div',{fontSize:'15px',fontWeight:'800',color:C.hl},'İlk kurulum'));
      welcome.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',lineHeight:'1.45',marginTop:'4px'},'Başlangıç ayarlarını hızlıca seç. Sonradan hepsi değiştirilebilir.'));
      var wb=mk('div',{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'10px'});
      var w1=mkBtn('Dengeli',true),w2=mkBtn('Yayın',false),w3=mkBtn('Gizlilik',false);
      w1.onclick=function(){nativeCmd('profile','mode','normal');set('theme','idgaf');set('firstRunDone','1');applyAll();welcome.style.display='none';say('Dengeli profil seçildi.');};
      w2.onclick=function(){nativeCmd('profile','mode','stream');set('theme','idgaf');set('firstRunDone','1');applyAll();welcome.style.display='none';say('Yayın profili seçildi.');};
      w3.onclick=function(){nativeCmd('profile','mode','save');set('block','1');set('upsell','1');set('firstRunDone','1');applyAll();welcome.style.display='none';say('Gizlilik profili seçildi.');};
      wb.appendChild(w1);wb.appendChild(w2);wb.appendChild(w3);welcome.appendChild(wb);body.appendChild(welcome);
    }
    FT.forEach(function(o){
      var row=mk('div',{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:'1px solid '+C.line2,gap:'16px'});
      var txt=mk('div',{flex:'1'});
      txt.appendChild(mk('div',{fontSize:'14px',color:C.hl,fontWeight:'500'},o.t));
      txt.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',marginTop:'3px',lineHeight:'1.35'},o.d));
      var sw=mkSwitch(ison(o.k,o.def),(function(key){return function(v){onToggle(key,v);};})(o.k));
      switches[o.k]=sw;row.appendChild(txt);row.appendChild(sw);body.appendChild(row);
    });

    body.appendChild(sec('Sistem & Güncelleme'));
    body.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',lineHeight:'1.4',margin:'2px 0 8px'},'Performans profili teknik ayarları otomatik düzenler. Değişikliklerin tamamı yeniden başlatınca etkili olur.'));
    profilePills=mkPills(PROFILE_OPTS,profileFromNative(),function(v){nativeCmd('profile','mode',v);say('Profil kaydedildi: '+v);});
    body.appendChild(profilePills);
    body.appendChild(nativeRow('minimize_to_tray','Kapatınca tepsiye küçült','Pencere kapatılınca uygulama tamamen kapanmaz, sistem tepsisinde çalışmaya devam eder.'));
    body.appendChild(nativeRow('autostart','Windows ile başlat','Windows açıldığında idgafcord otomatik başlatılır.'));
    body.appendChild(nativeRow('start_minimized','Tepside sessiz başlat','Otomatik başlatmada pencere açmadan doğrudan tepside bekler.'));
    body.appendChild(nativeRow('stream_performance','Ekran paylaşımı performansı','GPU hızlandırmayı açık tutar ve paylaşımda takılma/kalite düşmesini azaltır; 1080/60 izne bağlıdır.'));
    body.appendChild(nativeRow('auto_update_check','Güncellemeleri otomatik denetle','Başlangıçta ve 6 saatte bir yeni imzalı sürümü kontrol eder.'));
    body.appendChild(sec('Ses & Mikrofon'));
    var muteRow=mk('div',{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:'1px solid '+C.line2,gap:'16px'});
    var muteTxt=mk('div',{flex:'1'});muteTxt.appendChild(mk('div',{fontSize:'14px',color:C.hl,fontWeight:'500'},'Global mikrofon susturma kısayolu'));
    muteTxt.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',marginTop:'3px',lineHeight:'1.4'},'Uygulama arka planda / tepsideyken bile çalışır. Şu an atalı kısayol:'));
    muteShortcutText=mk('span',{display:'inline-block',marginTop:'6px',padding:'3px 9px',borderRadius:'6px',background:C.field,border:'1px solid '+C.line,color:C.hl,fontSize:'12px',fontWeight:'700',fontFamily:'Consolas,monospace',letterSpacing:'.3px'},shortcutLabel(nativeState.mute_shortcut));
    muteTxt.appendChild(muteShortcutText);
    var muteBtns=mk('div',{display:'flex',gap:'8px',flex:'0 0 auto'});
    var muteReset=mkBtn('Varsayılan',false);muteReset.onclick=function(){nativeCmd('set_shortcut','mute_shortcut','CommandOrControl+Shift+M');say('Varsayılan kısayola dönülüyor: Ctrl/Cmd + Shift + M');};
    var muteBtn=mkBtn('Değiştir',true);muteBtn.onclick=function(){startShortcutCapture(muteBtn);};
    muteBtns.appendChild(muteReset);muteBtns.appendChild(muteBtn);
    muteRow.appendChild(muteTxt);muteRow.appendChild(muteBtns);body.appendChild(muteRow);
    var voiceSw=mkSwitch(ison('voiceMute','0'),function(v){onVoiceToggle(v);});
    switches['voiceMute']=voiceSw;
    body.appendChild(mkRow('Sesle mikrofon komutu','Sürekli dinler; komut duyunca mikrofonu anında aç/kapatır. Sol altta canlı bir durum balonu (dinleniyor / son komut) belirir.',voiceSw));
    var badgeSw=mkSwitch(ison('micBadge','1'),function(v){set('micBadge',v?'1':'0');ensureMicBadge();say('Kaydedildi.');});
    switches['micBadge']=badgeSw;
    body.appendChild(mkRow('Mikrofon durum rozeti','Sol altta mikrofon açık/kapalı durumunu küçük rozetle gösterir.',badgeSw));
    body.appendChild(buildVoiceCard());updateVoiceStatus();
    var upRow=mk('div',{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:'1px solid '+C.line2,gap:'16px'});
    var upTxt=mk('div',{flex:'1'});upTxt.appendChild(mk('div',{fontSize:'14px',color:C.hl,fontWeight:'500'},'Güncellemeleri denetle'));
    upTxt.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',marginTop:'3px',lineHeight:'1.35'},'Şimdi GitHub Releases üzerinden yeni sürüm var mı kontrol eder.'));
    updateStatusEl=mk('div',{fontSize:'12px',color:C.mut,marginTop:'5px',lineHeight:'1.35'},'Son kontrol bekleniyor.');
    upTxt.appendChild(updateStatusEl);
    var upBtn=mkBtn('Denetle',true);upBtn.onclick=function(){nativeCmd('check_update');say('Güncelleme kontrol ediliyor...');};
    upRow.appendChild(upTxt);upRow.appendChild(upBtn);body.appendChild(upRow);
    body.appendChild(nativeRow('disable_gpu','Donanım hızlandırmayı kapat','GPU kaynak kullanımını azaltır; ekran paylaşımı performans modunu kapatır.'));
    body.appendChild(nativeRow('game_mode','Oyun modu: tepsideyken askıya al','Tepsiye küçültülünce Discord bağlantısını tamamen askıya alır; bildirimler durabilir.'));

    body.appendChild(sec('Engellenen izleme istekleri'));
    body.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',lineHeight:'1.4',marginBottom:'2px'},'Discord arka planda ne yaptığını takip eden istekler gönderir; hepsi ağa çıkmadan engellenir.'));
    termEl=mk('div',{});termEl.className='ldc-term';body.appendChild(termEl);
    var trow=mk('div',{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',marginTop:'8px'});
    termSumEl=mk('div',{fontSize:'12px'});termSumEl.className='ldc-term-sum';
    var termClr=mkBtn('Temizle',false);termClr.onclick=function(){blockedLog=[];catCount={};blockedCount=0;renderTerm();};
    trow.appendChild(termSumEl);trow.appendChild(termClr);body.appendChild(trow);

    body.appendChild(sec('Tema'));
    body.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',lineHeight:'1.4',margin:'2px 0 2px'},'Renk önizlemesine dokunarak seç. Aksan rengini aşağıdan ayrıca değiştirebilirsin.'));
    themePills=mkThemePicker(get('theme','off'),function(v){set('theme',v);applyAll();say(v==='off'?'Tema kapatıldı.':'Tema: '+v);});
    body.appendChild(themePills);

    body.appendChild(sec('Aksan rengi'));
    var accWrap=mk('div',{display:'flex',alignItems:'center',gap:'10px',marginTop:'4px'});
    accentInp=mk('input',{width:'48px',height:'34px',padding:'0',border:'none',background:'none',cursor:'pointer',borderRadius:'8px'});
    accentInp.type='color';accentInp.value=get('accent','')||'#5865f2';
    accentInp.addEventListener('input',function(){set('accent',accentInp.value);applyAll();say('Aksan rengi güncellendi.');});
    var accReset=mkBtn('Sıfırla',false);accReset.onclick=function(){set('accent','');accentInp.value='#5865f2';applyAll();say('Aksan sıfırlandı.');};
    accWrap.appendChild(accentInp);accWrap.appendChild(mk('div',{flex:'1',fontSize:'12px',color:'#b5bac1'},'Buton, link ve vurgu rengi. Temadan bağımsızdır.'));accWrap.appendChild(accReset);
    body.appendChild(accWrap);

    body.appendChild(sec('Görünüm'));
    var compSw=mkSwitch(ison('compact','0'),function(v){set('compact',v?'1':'0');applyAll();say('Kaydedildi.');});
    switches['compact']=compSw;
    body.appendChild(mkRow('Kompakt mod','Mesaj aralıklarını daraltır.',compSw));
    var frow=mk('div',{padding:'12px 0'});
    frow.appendChild(mk('div',{fontSize:'14px',color:C.hl,fontWeight:'500'},'Yazı boyutu'));
    var fwrap=mk('div',{display:'flex',alignItems:'center',gap:'12px',marginTop:'8px'});
    fontRange=mk('input',{flex:'1',accentColor:C.acc});fontRange.type='range';fontRange.min='12';fontRange.max='20';fontRange.step='1';fontRange.value=get('fontsize','16');
    fontVal=mk('div',{width:'44px',textAlign:'right',fontSize:'13px',color:C.mut},get('fontsize','16')+'px');
    fontRange.addEventListener('input',function(){fontVal.textContent=fontRange.value+'px';set('fontsize',fontRange.value);applyAll();});
    fwrap.appendChild(fontRange);fwrap.appendChild(fontVal);frow.appendChild(fwrap);body.appendChild(frow);
    var splashSw=mkSwitch(ison('splash','1'),function(v){set('splash',v?'1':'0');say('Kaydedildi — açılışta görünür.');});
    switches['splash']=splashSw;
    body.appendChild(mkRow('Açılış ekranı','Uygulama açılırken idgafcord logosu ve sloganı gösterilir.',splashSw));

    body.appendChild(sec('Yapı & Şekil'));
    body.appendChild(mk('div',{fontSize:'12px',color:'#b5bac1',marginBottom:'4px'},'Köşe yuvarlaklığı (butonlar, kartlar, menüler, pencereler).'));
    radiusPills=mkPills(RADIUS_OPTS,get('radius','normal'),function(v){set('radius',v);applyAll();say('Köşe stili: '+v);});
    body.appendChild(radiusPills);
    var logoWrap=mk('div',{display:'flex',gap:'8px',marginTop:'12px'});
    logoInp=mk('input',{flex:'1',boxSizing:'border-box',background:C.field,color:C.fg,border:'1px solid '+C.line,borderRadius:'8px',padding:'9px 10px',fontSize:'12px'});
    logoInp.type='text';logoInp.placeholder='Özel logo URL (sol üstteki Discord simgesi)';logoInp.value=get('logo','');
    var logoFile=mkBtn('Dosya',false);logoFile.onclick=function(){pickFile(2500000,function(d){if(!d){say('Görsel çok büyük (~1.8MB altı olmalı).',C.red);return;}logoInp.value=d;set('logo',d);applyAll();say('Logo (bilgisayardan) uygulandı.');});};
    var logoApply=mkBtn('Uygula',true);logoApply.onclick=function(){set('logo',logoInp.value.trim());applyAll();say(logoInp.value.trim()?'Logo uygulandı. Görünmezse Discord URL\'yi engelliyordur — Dosya ile seç.':'Logo sıfırlandı.');};
    logoWrap.appendChild(logoInp);logoWrap.appendChild(logoFile);logoWrap.appendChild(logoApply);body.appendChild(logoWrap);
    var fontWrap=mk('div',{display:'flex',gap:'8px',marginTop:'10px'});
    fontInp=mk('input',{flex:'1',boxSizing:'border-box',background:C.field,color:C.fg,border:'1px solid '+C.line,borderRadius:'8px',padding:'9px 10px',fontSize:'12px'});
    fontInp.type='text';fontInp.placeholder='Özel font adı (sistemde yüklü olmalı, ör. Inter)';fontInp.value=get('font','');
    var fontApply=mkBtn('Uygula',true);fontApply.onclick=function(){set('font',fontInp.value.trim());applyAll();say(fontInp.value.trim()?'Font uygulandı.':'Font sıfırlandı.');};
    fontWrap.appendChild(fontInp);fontWrap.appendChild(fontApply);body.appendChild(fontWrap);
    var bubbleSw=mkSwitch(ison('bubbles','0'),function(v){set('bubbles',v?'1':'0');applyAll();say('Kaydedildi.');});
    switches['bubbles']=bubbleSw;body.appendChild(mkRow('Mesaj balonları','Mesajları baloncuk (chat) stilinde gösterir.',bubbleSw));
    var memSw=mkSwitch(ison('hideMembers','0'),function(v){set('hideMembers',v?'1':'0');applyAll();say('Kaydedildi.');});
    switches['hideMembers']=memSw;body.appendChild(mkRow('Üye listesini gizle','Sağdaki üye listesini kapatır (daha çok yer).',memSw));

    body.appendChild(sec('Yıldızlar'));
    var starSw=mkSwitch(ison('stars','0'),function(v){set('stars',v?'1':'0');applyAll();say('Kaydedildi.');});
    switches['stars']=starSw;
    body.appendChild(mkRow('Yıldızları canlandır','Sunucu çubuğunda yavaşça kayan yıldız alanı (uzay hissi). Her temayla çalışır.',starSw));

    body.appendChild(sec('Arka plan görseli'));
    var bgwrap=mk('div',{display:'flex',gap:'8px',marginTop:'4px'});
    bgInp=mk('input',{flex:'1',boxSizing:'border-box',background:C.field,color:C.fg,border:'1px solid '+C.line,borderRadius:'8px',padding:'9px 10px',fontSize:'12px'});
    bgInp.type='text';bgInp.placeholder='https://… görsel URL';bgInp.value=get('bgimg','');
    var bgFile=mkBtn('Dosya',false);bgFile.onclick=function(){pickFile(4000000,function(d){if(!d){say('Görsel çok büyük (~3MB altı olmalı).',C.red);return;}bgInp.value=d;set('bgimg',d);applyAll();say('Arka plan (bilgisayardan) uygulandı.');});};
    var bgApply=mkBtn('Uygula',true);bgApply.onclick=function(){set('bgimg',bgInp.value.trim());applyAll();say(bgInp.value.trim()?'Arka plan uygulandı.':'Arka plan kaldırıldı.');};
    bgwrap.appendChild(bgInp);bgwrap.appendChild(bgFile);bgwrap.appendChild(bgApply);body.appendChild(bgwrap);
    body.appendChild(mk('div',{fontSize:'12px',color:C.mut,marginTop:'6px',lineHeight:'1.4'},'Yüzeyler yarı saydam olur, görsel arkada görünür. Kutuyu boşaltıp Uygula ile kaldırılır.'));

    body.appendChild(sec('Özel tema (CSS)'));
    var cssSw=mkSwitch(ison('cssOn','0'),function(v){set('cssOn',v?'1':'0');applyAll();say('Kaydedildi.');});
    switches['cssOn']=cssSw;
    body.appendChild(mkRow('Özel CSS uygula','Aşağıdaki düzenleyicideki kuralları uygular.',cssSw));
    themeEl=mk('textarea',{width:'100%',boxSizing:'border-box',height:'130px',background:C.field,color:C.fg,border:'1px solid '+C.line,borderRadius:'8px',padding:'10px',fontFamily:'Consolas,monospace',fontSize:'12px',resize:'vertical',marginTop:'6px'});
    themeEl.spellcheck=false;themeEl.placeholder='/* Kendi CSS kurallarınız */';themeEl.value=get('css','');
    body.appendChild(themeEl);
    var tb=mk('div',{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'10px'});
    var saveBtn=mkBtn('CSS Kaydet & Uygula',true);
    tb.appendChild(saveBtn);body.appendChild(tb);

    var note=mk('div',{fontSize:'12px',color:C.mut,marginTop:'16px',lineHeight:'1.4'},'Sistem ayarları bu panelden ve sistem tepsisi menüsünden aynı kayıtlı ayarları değiştirir.');
    body.appendChild(note);
    statusEl=mk('div',{minHeight:'18px',marginTop:'10px',fontSize:'12px',color:C.grn});body.appendChild(statusEl);

    footEl=mk('div',{padding:'12px 20px',borderTop:'1px solid '+C.line,fontSize:'12px',color:C.mut,display:'flex',justifyContent:'space-between'});
    var fb=mk('span',{},'0 istek engellendi');footEl._b=fb;footEl.appendChild(mk('span',{},'v0.1.15'));footEl.appendChild(fb);

    card.appendChild(head);card.appendChild(tabs);card.appendChild(body);card.appendChild(footEl);modal.appendChild(card);
    root.appendChild(gear);root.appendChild(modal);document.body.appendChild(root);

    saveBtn.onclick=function(){set('css',themeEl.value);applyAll();say('Özel CSS kaydedildi ve uygulandı.');};
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal&&modal.style.display==='flex')closePanel();});
    applyTabs(body);
  }catch(e){}}

  function refresh(){
    FT.forEach(function(o){if(switches[o.k])switches[o.k].set(ison(o.k,o.def));});
    ['compact','stars','cssOn','bubbles','hideMembers','voiceMute'].forEach(function(k){if(switches[k])switches[k].set(ison(k,'0'));});
    if(switches['micBadge'])switches['micBadge'].set(ison('micBadge','1'));
    if(switches['splash'])switches['splash'].set(ison('splash','1'));
    if(themePills)themePills.set(get('theme','off'));
    if(profilePills)profilePills.set(profileFromNative());
    if(radiusPills)radiusPills.set(get('radius','normal'));
    if(logoInp)logoInp.value=get('logo','');
    if(fontInp)fontInp.value=get('font','');
    if(accentInp)accentInp.value=get('accent','')||'#5865f2';
    if(fontRange){fontRange.value=get('fontsize','16');if(fontVal)fontVal.textContent=get('fontsize','16')+'px';}
    if(bgInp)bgInp.value=get('bgimg','');
    if(themeEl)themeEl.value=get('css','');
    if(voiceMuteInp)voiceMuteInp.value=get('voiceMutePhrase','mikrofonu kapat');
    if(voiceUnmuteInp)voiceUnmuteInp.value=get('voiceUnmutePhrase','mikrofonu aç');
    if(footEl&&footEl._b)footEl._b.textContent=blockedCount+' istek engellendi';
    ensureMicBadge();updateVoiceStatus();
    if(modal){var b=modal.querySelector('#ldc-modal-body');if(b)applyTabs(b);}
  }
  function openPanel(){build();nativeCmd('sync');if(modal){modal.style.display='flex';refresh();renderTerm();if(termTimer)clearInterval(termTimer);termTimer=setInterval(renderTerm,1000);}}
  function closePanel(){if(modal)modal.style.display='none';if(termTimer){clearInterval(termTimer);termTimer=null;}}
  window.__LDC_openSettings=openPanel;

  if(document.body)build();else document.addEventListener('DOMContentLoaded',build);
  if(ison('voiceMute','0'))setTimeout(startVoice,1500);
  setTimeout(ensureMicBadge,1200);
  // Hafif: yalnızca panel düğmesi kaybolduysa yeniden ekle. CSS'ler adopted
  // sheet olarak kalıcıdır; sürekli yeniden uygulamak gereksiz CPU harcar.
  setInterval(function(){if(document.body&&!document.getElementById('ldc-root'))build();},5000);
  setInterval(updateMicBadge,2500);
})();"####;

const MUTE_TOGGLE_SCRIPT: &str = r#"
    window.__LDC_toggleMute&&window.__LDC_toggleMute();
"#;

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval(MUTE_TOGGLE_SCRIPT);
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let mut settings = load_settings(&handle);

            // Otomatik başlatmayı kayıtlı ayara göre senkronize et.
            let autostart = app.autolaunch();
            if settings.autostart {
                let _ = autostart.enable();
            } else {
                let _ = autostart.disable();
            }
            settings.autostart = autostart.is_enabled().unwrap_or(settings.autostart);

            // ---- Tepsi menüsü ve Discord içi ayar paneli aynı native ayarları kullanır. ----
            // Menü başlığı: uygulama logosu + adı (pencere ikonuyla aynı görsel).
            let i_brand = {
                let builder = IconMenuItemBuilder::with_id("brand", "idgafcord").enabled(false);
                let builder = match app.default_window_icon().cloned() {
                    Some(icon) => builder.icon(icon),
                    None => builder,
                };
                builder.build(app)?
            };
            let i_tray = CheckMenuItemBuilder::with_id("t_tray", "Kapatınca tepsiye küçült")
                .checked(settings.minimize_to_tray)
                .build(app)?;
            let i_startmin = CheckMenuItemBuilder::with_id("t_startmin", "Tepside sessiz başlat")
                .checked(settings.start_minimized)
                .build(app)?;
            let i_autostart = CheckMenuItemBuilder::with_id("t_autostart", "Windows ile başlat")
                .checked(settings.autostart)
                .build(app)?;
            let i_stream = CheckMenuItemBuilder::with_id(
                "t_stream",
                "Ekran paylaşımı performansı (yeniden başlat)",
            )
            .checked(settings.stream_performance)
            .build(app)?;
            let i_gpu = CheckMenuItemBuilder::with_id("t_gpu", "Donanım hızlandırmayı kapat (yeniden başlat)")
                .checked(settings.disable_gpu)
                .build(app)?;
            let i_game = CheckMenuItemBuilder::with_id("t_game", "Oyun modu: tepsideyken askıya al (bildirimler durur)")
                .checked(settings.game_mode)
                .build(app)?;
            let i_auto_update = CheckMenuItemBuilder::with_id(
                "t_auto_update",
                "Güncellemeleri otomatik denetle",
            )
            .checked(settings.auto_update_check)
            .build(app)?;
            let i_settings = MenuItemBuilder::with_id("settings", "Ayarlar (tema, gizlilik)").build(app)?;
            let i_cache = MenuItemBuilder::with_id("clear_cache", "Önbelleği temizle").build(app)?;
            let i_repair = MenuItemBuilder::with_id("repair", "Sorun giderme: güvenli yeniden başlat").build(app)?;
            let i_update = MenuItemBuilder::with_id("check_update", "Güncellemeleri denetle").build(app)?;
            let i_show = MenuItemBuilder::with_id("show", "Discord'u Göster").build(app)?;
            let i_quit = MenuItemBuilder::with_id("quit", "Çıkış").build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[&i_brand])
                .separator()
                .items(&[&i_tray, &i_startmin, &i_autostart, &i_stream, &i_gpu, &i_game])
                .separator()
                .items(&[&i_settings, &i_auto_update, &i_cache, &i_repair, &i_update])
                .separator()
                .items(&[&i_show, &i_quit])
                .build()?;

            let c_tray = i_tray.clone();
            let c_startmin = i_startmin.clone();
            let c_autostart = i_autostart.clone();
            let c_stream = i_stream.clone();
            let c_gpu = i_gpu.clone();
            let c_game = i_game.clone();
            let c_auto_update = i_auto_update.clone();
            let n_tray = i_tray.clone();
            let n_startmin = i_startmin.clone();
            let n_autostart = i_autostart.clone();
            let n_stream = i_stream.clone();
            let n_gpu = i_gpu.clone();
            let n_game = i_game.clone();
            let n_auto_update = i_auto_update.clone();
            let check_on_start = settings.auto_update_check;
            let disable_gpu = settings.disable_gpu;
            let stream_performance = settings.stream_performance;
            let start_minimized = settings.start_minimized;
            let mute_shortcut = settings.mute_shortcut.clone();

            app.manage(Mutex::new(settings));

            // Ana pencere. Betik hem document-start'ta hem sayfa yüklenince
            // çalıştırılır; __LDC_INIT__ koruması çift çalışmayı engeller.
            let bootstrap = bootstrap_script();
            let bootstrap_for_load = bootstrap.clone();
            let nav_handle = handle.clone();

            let mut builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("https://discord.com/app".parse().unwrap()),
            )
            .title("idgafcord")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .center()
            .initialization_script(&bootstrap)
            .on_page_load(move |window, payload| {
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    let _ = window.eval(&bootstrap_for_load);
                    sync_native_settings(window.app_handle());
                }
            })
            .on_navigation(move |url| {
                if url.scheme() != "idgafcord" || url.host_str() != Some("native") {
                    return true;
                }

                let mut action = String::new();
                let mut key = String::new();
                let mut value = String::new();
                for (k, v) in url.query_pairs() {
                    match k.as_ref() {
                        "action" => action = v.into_owned(),
                        "key" => key = v.into_owned(),
                        "value" => value = v.into_owned(),
                        _ => {}
                    }
                }

                match action.as_str() {
                    "sync" => sync_native_settings(&nav_handle),
                    "check_update" => spawn_update_check(nav_handle.clone(), false),
                    "set" => {
                        let enabled = matches!(value.as_str(), "1" | "true" | "on");
                        let mut should_check_update = false;
                        if let Some(state) = nav_handle.try_state::<Mutex<Settings>>() {
                            if let Ok(mut s) = state.lock() {
                                match key.as_str() {
                                    "minimize_to_tray" => {
                                        s.minimize_to_tray = enabled;
                                        let _ = n_tray.set_checked(enabled);
                                    }
                                    "start_minimized" => {
                                        s.start_minimized = enabled;
                                        let _ = n_startmin.set_checked(enabled);
                                    }
                                    "autostart" => {
                                        let mgr = nav_handle.autolaunch();
                                        if enabled {
                                            let _ = mgr.enable();
                                        } else {
                                            let _ = mgr.disable();
                                        }
                                        s.autostart = mgr.is_enabled().unwrap_or(enabled);
                                        let _ = n_autostart.set_checked(s.autostart);
                                    }
                                    "disable_gpu" => {
                                        s.disable_gpu = enabled;
                                        let _ = n_gpu.set_checked(enabled);
                                        if enabled {
                                            s.stream_performance = false;
                                            let _ = n_stream.set_checked(false);
                                        }
                                    }
                                    "stream_performance" => {
                                        s.stream_performance = enabled;
                                        let _ = n_stream.set_checked(enabled);
                                        if enabled {
                                            s.disable_gpu = false;
                                            let _ = n_gpu.set_checked(false);
                                        }
                                    }
                                    "game_mode" => {
                                        s.game_mode = enabled;
                                        let _ = n_game.set_checked(enabled);
                                    }
                                    "auto_update_check" => {
                                        s.auto_update_check = enabled;
                                        let _ = n_auto_update.set_checked(enabled);
                                        should_check_update = enabled;
                                    }
                                    _ => {}
                                }
                                save_settings(&nav_handle, &s);
                            }
                        }
                        sync_native_settings(&nav_handle);
                        if should_check_update {
                            spawn_update_check(nav_handle.clone(), true);
                        }
                    }
                    "profile" => {
                        let profile = value.trim();
                        if let Some(state) = nav_handle.try_state::<Mutex<Settings>>() {
                            if let Ok(mut s) = state.lock() {
                                match profile {
                                    "save" => {
                                        s.disable_gpu = true;
                                        s.stream_performance = false;
                                        s.game_mode = false;
                                    }
                                    "stream" => {
                                        s.disable_gpu = false;
                                        s.stream_performance = true;
                                        s.game_mode = false;
                                    }
                                    "game" => {
                                        s.disable_gpu = false;
                                        s.stream_performance = true;
                                        s.game_mode = true;
                                    }
                                    _ => {
                                        s.disable_gpu = false;
                                        s.stream_performance = false;
                                        s.game_mode = false;
                                    }
                                }
                                let _ = n_gpu.set_checked(s.disable_gpu);
                                let _ = n_stream.set_checked(s.stream_performance);
                                let _ = n_game.set_checked(s.game_mode);
                                save_settings(&nav_handle, &s);
                            }
                        }
                        sync_native_settings(&nav_handle);
                    }
                    "set_shortcut" => {
                        let candidate = value.trim().to_string();
                        let mut saved = false;
                        if !candidate.is_empty() && register_mute_shortcut(&nav_handle, &candidate) {
                            if let Some(state) = nav_handle.try_state::<Mutex<Settings>>() {
                                if let Ok(mut s) = state.lock() {
                                    s.mute_shortcut = candidate;
                                    save_settings(&nav_handle, &s);
                                    saved = true;
                                }
                            }
                        }
                        sync_native_settings(&nav_handle);
                        let msg = if saved {
                            serde_json::json!("Kısayol kaydedildi.")
                        } else {
                            serde_json::json!("Bu kısayol Windows tarafından kabul edilmedi.")
                        };
                        let warn = if saved { "false" } else { "true" };
                        if let Some(window) = nav_handle.get_webview_window("main") {
                            let _ = window.eval(&format!(
                                "window.__LDC_nativeNotice&&window.__LDC_nativeNotice({msg},{warn});"
                            ));
                        }
                    }
                    _ => {}
                }
                false
            });
            if disable_gpu {
                builder = builder.additional_browser_args(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu",
                );
            } else if stream_performance {
                // NOT: --ignore-gpu-blocklist / --enable-gpu-rasterization / --enable-zero-copy
                // bazı ekran kartı sürücülerinde SİYAH EKRAN yapıyordu; kaldırıldı. Geriye
                // yalnızca güvenli (arka plan kısmasını kapatan) bayraklar bırakıldı — ekran
                // paylaşımı akıcılığına yeter, siyah ekran riski yok.
                builder = builder.additional_browser_args(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --autoplay-policy=no-user-gesture-required",
                );
            }
            if start_minimized {
                builder = builder.visible(false);
            }
            let _window = builder.build()?;

            if !register_mute_shortcut(&handle, &mute_shortcut) {
                let fallback = default_mute_shortcut();
                if register_mute_shortcut(&handle, &fallback) {
                    if let Some(state) = handle.try_state::<Mutex<Settings>>() {
                        if let Ok(mut s) = state.lock() {
                            s.mute_shortcut = fallback;
                            save_settings(&handle, &s);
                        }
                    }
                }
            }

            spawn_auto_update_loop(handle.clone());
            if check_on_start {
                spawn_update_check(handle.clone(), true);
            }

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Lightweight Discord")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    let state = app.state::<Mutex<Settings>>();
                    match event.id().as_ref() {
                        "t_tray" => {
                            let mut s = state.lock().unwrap();
                            s.minimize_to_tray = !s.minimize_to_tray;
                            let _ = c_tray.set_checked(s.minimize_to_tray);
                            save_settings(app, &s);
                            drop(s);
                            sync_native_settings(app);
                        }
                        "t_startmin" => {
                            let mut s = state.lock().unwrap();
                            s.start_minimized = !s.start_minimized;
                            let _ = c_startmin.set_checked(s.start_minimized);
                            save_settings(app, &s);
                            drop(s);
                            sync_native_settings(app);
                        }
                        "t_autostart" => {
                            let mut s = state.lock().unwrap();
                            s.autostart = !s.autostart;
                            let mgr = app.autolaunch();
                            if s.autostart { let _ = mgr.enable(); } else { let _ = mgr.disable(); }
                            let _ = c_autostart.set_checked(s.autostart);
                            save_settings(app, &s);
                            drop(s);
                            sync_native_settings(app);
                        }
                        "t_gpu" => {
                            let mut s = state.lock().unwrap();
                            s.disable_gpu = !s.disable_gpu;
                            let _ = c_gpu.set_checked(s.disable_gpu);
                            if s.disable_gpu {
                                s.stream_performance = false;
                                let _ = c_stream.set_checked(false);
                            }
                            save_settings(app, &s);
                            drop(s);
                            sync_native_settings(app);
                        }
                        "t_stream" => {
                            let mut s = state.lock().unwrap();
                            s.stream_performance = !s.stream_performance;
                            let _ = c_stream.set_checked(s.stream_performance);
                            if s.stream_performance {
                                s.disable_gpu = false;
                                let _ = c_gpu.set_checked(false);
                            }
                            save_settings(app, &s);
                            drop(s);
                            sync_native_settings(app);
                        }
                        "t_game" => {
                            let mut s = state.lock().unwrap();
                            s.game_mode = !s.game_mode;
                            let _ = c_game.set_checked(s.game_mode);
                            save_settings(app, &s);
                            drop(s);
                            sync_native_settings(app);
                        }
                        "t_auto_update" => {
                            let enabled = {
                                let mut s = state.lock().unwrap();
                                s.auto_update_check = !s.auto_update_check;
                                let _ = c_auto_update.set_checked(s.auto_update_check);
                                save_settings(app, &s);
                                s.auto_update_check
                            };
                            sync_native_settings(app);
                            if enabled {
                                spawn_update_check(app.clone(), true);
                            }
                        }
                        "settings" => {
                            ensure_loaded(app);
                            set_render(app, true);
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                                let _ = w.eval("window.__LDC_openSettings&&window.__LDC_openSettings();");
                            }
                        }
                        "clear_cache" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.clear_all_browsing_data();
                            }
                        }
                        "repair" => {
                            // Beyaz/siyah ekran yapabilecek HER ŞEYİ güvenli hâle getir:
                            // native (GPU/oyun modu) + sayfa (tema/splash/özel CSS/arka plan),
                            // sonra temiz yeniden başlat.
                            {
                                let mut s = state.lock().unwrap();
                                s.stream_performance = false;
                                s.disable_gpu = false;
                                s.game_mode = false;
                                let _ = c_stream.set_checked(false);
                                let _ = c_gpu.set_checked(false);
                                let _ = c_game.set_checked(false);
                                save_settings(app, &s);
                            }
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                                let _ = w.eval("try{localStorage.setItem('ldc_theme','off');localStorage.setItem('ldc_splash','0');localStorage.setItem('ldc_cssOn','0');localStorage.setItem('ldc_bgimg','');localStorage.removeItem('ldc_css');sessionStorage.removeItem('ldc_safe');}catch(e){}");
                            }
                            let app2 = app.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(Duration::from_millis(500));
                                app2.restart();
                            });
                        }
                        "check_update" => {
                            spawn_update_check(app.clone(), false);
                        }
                        "show" => {
                            ensure_loaded(app);
                            set_render(app, true);
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, button_state, .. } = event {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let app = tray.app_handle();
                            ensure_loaded(app);
                            set_render(app, true);
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let (minimize, game) = app
                    .try_state::<Mutex<Settings>>()
                    .and_then(|s| s.lock().ok().map(|s| (s.minimize_to_tray, s.game_mode)))
                    .unwrap_or((true, false));
                if minimize {
                    let _ = window.hide();
                    api.prevent_close();
                    // Her zaman: arayüzü çizmeyi bırak ama sayfayı çalışır tut
                    // (sohbet/ses/bildirim devam eder).
                    set_render(app, false);
                    // Oyun modu (opsiyonel): Discord'u tamamen boşalt (bağlantı da kesilir).
                    if game {
                        suspend_blank(app);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
