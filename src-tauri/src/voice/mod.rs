mod audio;
mod commands;
mod engine;
mod install;

pub use commands::Config;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

pub enum Request {
    Start { session: String, config: Config },
    Stop,
    Install { session: String, language: String },
}
pub struct VoiceManager {
    tx: SyncSender<Request>,
    root: PathBuf,
    bundled: Option<PathBuf>,
}

fn event(app: &AppHandle, session: &str, phase: &str, message: &str, action: Option<&str>) {
    if let Some(window) = app.get_webview_window("main") {
        let payload =
            serde_json::json!({"session":session,"phase":phase,"message":message,"action":action});
        let _ = window.eval(format!(
            "window.__LDC_voiceEvent&&window.__LDC_voiceEvent({payload});"
        ));
    }
}
impl VoiceManager {
    pub fn new(app: AppHandle, root: PathBuf) -> Self {
        let (tx, rx) = mpsc::sync_channel(8);
        let bundled = app.path().resource_dir().ok().map(|p| p.join("voice"));
        let manager = Self {
            tx,
            root: root.clone(),
            bundled: bundled.clone(),
        };
        std::thread::spawn(move || {
            let mut pending = None;
            while let Some(request) = pending.take().or_else(|| rx.recv().ok()) {
                match request {
                    Request::Stop => {}
                    Request::Install { session, language } => {
                        event(
                            &app,
                            &session,
                            "installing",
                            "Yerel ses paketi indiriliyor…",
                            None,
                        );
                        match install::install(&root, &language) {
                            Ok(()) => event(
                                &app,
                                &session,
                                "ready",
                                "Ses paketi hazır. Komutu açabilirsin.",
                                None,
                            ),
                            Err(e) => event(&app, &session, "error", &e, None),
                        }
                    }
                    Request::Start { session, config } => {
                        if let Err(e) = config.validate() {
                            event(&app, &session, "error", &e, None);
                            continue;
                        }
                        let resources = bundled
                            .as_ref()
                            .filter(|p| install::ready(p, &config.language))
                            .unwrap_or(&root);
                        if !install::ready(resources, &config.language) {
                            event(
                                &app,
                                &session,
                                "missing",
                                "Yerel ses dosyaları eksik. Güncel kurulumla uygulamayı onar; mikrofon açılmadı.",
                                None,
                            );
                            continue;
                        }
                        event(
                            &app,
                            &session,
                            "starting",
                            "Yerel komut motoru hazırlanıyor…",
                            None,
                        );
                        match listen(&app, resources, &session, config, &rx) {
                            Ok(next) => pending = next,
                            Err(e) => event(&app, &session, "error", &e, None),
                        }
                    }
                }
            }
        });
        manager
    }
    pub fn ready(&self, language: &str) -> bool {
        self.bundled
            .as_ref()
            .is_some_and(|p| install::ready(p, language))
            || install::ready(&self.root, language)
    }
    pub fn send(&self, request: Request) -> Result<(), String> {
        self.tx
            .try_send(request)
            .map_err(|_| "Ses motoru meşgul. Biraz sonra tekrar dene.".into())
    }
}

fn listen(
    app: &AppHandle,
    root: &std::path::Path,
    session: &str,
    config: Config,
    commands: &Receiver<Request>,
) -> Result<Option<Request>, String> {
    let mut engine = engine::Engine::load(root, config)?;
    // A stop/reconfigure arriving during model loading prevents opening the mic.
    if let Ok(next) = commands.try_recv() {
        return Ok(Some(next));
    }
    let (tx, audio_rx) = mpsc::sync_channel(12);
    let overflow = Arc::new(AtomicBool::new(false));
    let _capture = audio::capture(tx, overflow.clone())?;
    let mut gate = audio::Gate::default();
    let mut last_action = Instant::now() - Duration::from_secs(5);
    let mut last_frame = Instant::now();
    event(app, session, "listening", "Yerel komut dinleme açık", None);
    loop {
        match commands.try_recv() {
            Ok(next) => return Ok(Some(next)),
            Err(mpsc::TryRecvError::Disconnected) => return Ok(None),
            Err(mpsc::TryRecvError::Empty) => {}
        }
        if overflow.swap(false, Ordering::Relaxed) {
            gate = audio::Gate::default();
            while audio_rx.try_recv().is_ok() {}
        }
        match audio_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(audio::Audio::Frame(frame)) => {
                last_frame = Instant::now();
                if let Some(utterance) = gate.push(&frame) {
                    if last_action.elapsed() < Duration::from_millis(800) {
                        continue;
                    }
                    if let Some(action) = engine.recognize(&utterance) {
                        last_action = Instant::now();
                        event(app, session, "listening", "", Some(action));
                    }
                }
            }
            Ok(audio::Audio::Error) => {
                return Err(
                    "Mikrofon bağlantısı kesildi. Giriş aygıtını kontrol edip yeniden başlat."
                        .into(),
                )
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Mikrofon akışı kapandı.".into())
            }
            Err(mpsc::RecvTimeoutError::Timeout)
                if last_frame.elapsed() > Duration::from_secs(5) =>
            {
                return Err(
                    "Mikrofondan ses verisi gelmiyor. Aygıtı kontrol edip yeniden başlat.".into(),
                )
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    #[cfg(windows)]
    fn working_set() -> usize {
        #[repr(C)]
        struct Counters {
            size: u32,
            faults: u32,
            values: [usize; 8],
        }
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn K32GetProcessMemoryInfo(process: isize, counters: *mut Counters, size: u32) -> i32;
        }
        let size = std::mem::size_of::<Counters>() as u32;
        let mut counters = Counters {
            size,
            faults: 0,
            values: [0; 8],
        };
        assert_ne!(
            unsafe { K32GetProcessMemoryInfo(-1, &mut counters, size) },
            0
        );
        counters.values[1]
    }

    #[test]
    #[cfg(windows)]
    #[ignore = "manual resource probe using verified packs, without a microphone"]
    fn offline_resource_probe() {
        let root =
            PathBuf::from(std::env::var_os("IDGAFCORD_VOICE_TEST_ROOT").expect("test assets"));
        let fixtures =
            PathBuf::from(std::env::var_os("IDGAFCORD_VOICE_FIXTURES").expect("test fixtures"));
        let baseline = working_set();
        let start = Instant::now();
        let mut engine = engine::Engine::load(
            &root,
            Config {
                language: "tr".into(),
                mute: "mikrofonu kapat".into(),
                unmute: "mikrofonu aç".into(),
            },
        )
        .unwrap();
        let load_ms = start.elapsed().as_millis();
        let active = working_set();
        let bytes = std::fs::read(fixtures.join("tr-mute.pcm")).unwrap();
        let samples: Vec<_> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|s| i16::from_le_bytes(*s))
            .collect();
        let start = Instant::now();
        for _ in 0..20 {
            assert_eq!(engine.recognize(&samples), Some("mute"));
        }
        let decode_ms = start.elapsed().as_secs_f64() * 1000.0 / 20.0;
        let mut gate = audio::Gate::default();
        let start = Instant::now();
        for _ in 0..3000 {
            assert!(gate.push(&[0; 320]).is_none());
        }
        let silent_ms = start.elapsed().as_secs_f64() * 1000.0;
        drop(engine);
        println!(
            "{}",
            serde_json::json!({"model_load_ms":load_ms,"working_set_before_mb":baseline/1024/1024,"working_set_active_mb":active/1024/1024,"working_set_after_release_mb":working_set()/1024/1024,"average_command_decode_ms":decode_ms,"simulated_60s_silence_gate_ms":silent_ms,"microphone_opened":false})
        );
    }
    #[test]
    #[ignore = "requires verified voice packs and local synthetic PCM16 fixtures; see scripts/test-voice.ps1"]
    fn offline_synthetic_commands() {
        let root =
            PathBuf::from(std::env::var_os("IDGAFCORD_VOICE_TEST_ROOT").expect("test assets"));
        // Match installed Tauri resource paths, including Windows' verbatim
        // prefix; plain development paths hid a Vosk model-loading regression.
        #[cfg(windows)]
        let root = std::fs::canonicalize(root).expect("canonical model directory");
        let fixtures =
            PathBuf::from(std::env::var_os("IDGAFCORD_VOICE_FIXTURES").expect("test fixtures"));
        for language in ["tr", "en"] {
            assert!(
                install::ready(&root, language),
                "Pack layout must be recognized before the microphone can be started: {language}"
            );
            let (mute, unmute) = if language == "tr" {
                ("mikrofonu kapat", "mikrofonu aç")
            } else {
                ("mute me", "open mic")
            };
            let mut engine = engine::Engine::load(
                &root,
                Config {
                    language: language.into(),
                    mute: mute.into(),
                    unmute: unmute.into(),
                },
            )
            .unwrap();
            for (name, expected) in [
                ("mute", Some("mute")),
                ("unmute", Some("unmute")),
                ("negative", None),
                ("conversation", None),
            ] {
                let bytes = std::fs::read(fixtures.join(format!("{language}-{name}.pcm"))).unwrap();
                let samples: Vec<_> = bytes
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|s| i16::from_le_bytes([s[0], s[1]]))
                    .collect();
                assert_eq!(
                    engine.recognize(&samples),
                    expected,
                    "decoder: {language}-{name}"
                );
                let mut gate = audio::Gate::default();
                let mut actions = Vec::new();
                for frame in samples
                    .chunks(320)
                    .chain(std::iter::repeat_n(&[0_i16; 320][..], 60))
                {
                    if let Some(utterance) = gate.push(frame) {
                        if let Some(action) = engine.recognize(&utterance) {
                            actions.push(action);
                        }
                    }
                }
                assert_eq!(
                    actions,
                    expected.into_iter().collect::<Vec<_>>(),
                    "audio gate: {language}-{name}"
                );
            }
        }
    }
}
