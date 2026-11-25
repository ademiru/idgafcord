use super::commands::{normalize, Config};
use libloading::Library;
use std::{
    ffi::{c_char, c_float, c_int, c_void, CStr, CString},
    path::Path,
};

type NewModel = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type Free = unsafe extern "C" fn(*mut c_void);
type NewRecognizer = unsafe extern "C" fn(*mut c_void, c_float, *const c_char) -> *mut c_void;
type Accept = unsafe extern "C" fn(*mut c_void, *const i16, c_int) -> c_int;
type ResultText = unsafe extern "C" fn(*mut c_void) -> *const c_char;

fn model_path(path: &Path) -> Result<CString, String> {
    // Tauri's installed resource directory can use a verbatim Windows prefix.
    // Vosk/Kaldi's narrow file API does not understand that prefix. Keep UTF-16
    // paths for DLL loading; normalize only the path passed to Vosk's C API.
    #[cfg(windows)]
    let path = dunce::simplified(path);
    CString::new(
        path.to_str()
            .ok_or("Ses modeli yolu UTF-8 olarak okunamadı.")?,
    )
    .map_err(|e| e.to_string())
}

/// All native handles stay on one worker. Library outlives recognizer and model.
pub struct Engine {
    _library: Library,
    model: *mut c_void,
    recognizer: *mut c_void,
    free_model: Free,
    free_recognizer: Free,
    accept: Accept,
    final_result: ResultText,
    reset: Free,
    config: Config,
}

impl Engine {
    pub fn load(root: &Path, config: Config) -> Result<Self, String> {
        config.validate()?;
        #[cfg(windows)]
        let library: Library = unsafe {
            // Resolve dependent DLLs only beside the verified runtime or in system dirs.
            libloading::os::windows::Library::load_with_flags(
                root.join("runtime").join("libvosk.dll"),
                0x100 | 0x1000,
            )
            .map_err(|e| format!("Yerel ses motoru yüklenemedi: {e:?}"))?
            .into()
        };
        #[cfg(not(windows))]
        let library =
            unsafe { Library::new(root.join("runtime/libvosk.so")) }.map_err(|e| e.to_string())?;
        // SAFETY: ABI definitions match the pinned Vosk 0.3.45 vosk_api.h. Every
        // pointer is checked and owned here; the library is held until Drop finishes.
        unsafe {
            let new_model: NewModel = *library
                .get(b"vosk_model_new\0")
                .map_err(|e| e.to_string())?;
            let free_model: Free = *library
                .get(b"vosk_model_free\0")
                .map_err(|e| e.to_string())?;
            let free_recognizer: Free = *library
                .get(b"vosk_recognizer_free\0")
                .map_err(|e| e.to_string())?;
            let new_recognizer: NewRecognizer = *library
                .get(b"vosk_recognizer_new_grm\0")
                .map_err(|e| e.to_string())?;
            let accept: Accept = *library
                .get(b"vosk_recognizer_accept_waveform_s\0")
                .map_err(|e| e.to_string())?;
            let final_result: ResultText = *library
                .get(b"vosk_recognizer_final_result\0")
                .map_err(|e| e.to_string())?;
            let reset: Free = *library
                .get(b"vosk_recognizer_reset\0")
                .map_err(|e| e.to_string())?;
            let find_word: unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int = *library
                .get(b"vosk_model_find_word\0")
                .map_err(|e| e.to_string())?;
            let set_words: unsafe extern "C" fn(*mut c_void, c_int) = *library
                .get(b"vosk_recognizer_set_words\0")
                .map_err(|e| e.to_string())?;
            let set_log: unsafe extern "C" fn(c_int) = *library
                .get(b"vosk_set_log_level\0")
                .map_err(|e| e.to_string())?;
            set_log(-1);
            let model_path = model_path(&root.join(&config.language))?;
            let model = new_model(model_path.as_ptr());
            if model.is_null() {
                return Err(
                    "Ses modeli bulunamadı veya bozuk. Güncel kurulumla uygulamayı onar.".into(),
                );
            }
            let known = |phrase: &str| {
                phrase.split_whitespace().all(|word| {
                    CString::new(word)
                        .ok()
                        .is_some_and(|word| find_word(model, word.as_ptr()) >= 0)
                })
            };
            for phrase in [&config.mute, &config.unmute] {
                if !known(&phrase.to_lowercase()) {
                    free_model(model);
                    return Err(format!(
                        "Ses modelinin tanımadığı kelime var: “{phrase}”. Farklı bir komut seç."
                    ));
                }
            }
            let mut grammar: Vec<String> = config
                .phrases()
                .into_iter()
                .map(|(p, _)| p)
                .filter(|p| known(p))
                .collect();
            // Rejection phrases prevent a negative sentence being forced into a
            // positive command by the constrained decoder.
            let negatives = if config.language == "tr" {
                vec![
                    "mikrofonu kapatma",
                    "mikrofonu açma",
                    "beni susturma",
                    "mikrofonu kapat demedim",
                    "odadan çıkma",
                    "odadan çık demedim",
                    "ses kanalından çıkma",
                    "sesi tamamen kapatma",
                    "sesi geri açma",
                    "kulaklığı kapatma",
                    "kulaklığı açma",
                ]
            } else {
                vec![
                    "do not mute",
                    "do not unmute",
                    "do not mute me",
                    "do not open mic",
                    "do not leave voice",
                    "do not disconnect voice",
                    "do not deafen audio",
                    "do not restore audio",
                ]
            };
            grammar.extend(negatives.into_iter().filter(|p| known(p)).map(String::from));
            grammar.push("[unk]".into());
            grammar.sort();
            grammar.dedup();
            let grammar = CString::new(
                serde_json::to_string(&grammar).expect("string array is serializable"),
            )
            .map_err(|e| e.to_string())?;
            let recognizer = new_recognizer(model, super::audio::RATE as f32, grammar.as_ptr());
            if recognizer.is_null() {
                free_model(model);
                return Err("Komut tanıyıcı oluşturulamadı.".into());
            }
            set_words(recognizer, 1);
            Ok(Self {
                _library: library,
                model,
                recognizer,
                free_model,
                free_recognizer,
                accept,
                final_result,
                reset,
                config,
            })
        }
    }

    /// Only a validated command leaves this module. Audio and unrelated speech
    /// are dropped in memory; they never enter the webview, disk, logs or network.
    pub fn recognize(&mut self, samples: &[i16]) -> Option<&'static str> {
        if samples.len() < 3200 || samples.len() > 16_000 * 4 {
            return None;
        }
        unsafe {
            (self.reset)(self.recognizer);
            let accepted = (self.accept)(self.recognizer, samples.as_ptr(), samples.len() as c_int);
            if accepted < 0 {
                return None;
            }
            let ptr = (self.final_result)(self.recognizer);
            if ptr.is_null() {
                return None;
            }
            let result: serde_json::Value =
                serde_json::from_slice(CStr::from_ptr(ptr).to_bytes()).ok()?;
            let text = result.get("text")?.as_str()?;
            let words = result.get("result")?.as_array()?;
            if words.is_empty() || text.contains("[unk]") {
                return None;
            }
            let mut confidence = 0.0;
            for word in words {
                let conf = word.get("conf")?.as_f64()?;
                if conf < 0.80 {
                    return None;
                }
                confidence += conf;
            }
            if confidence / (words.len() as f64) < 0.90 {
                return None;
            }
            // A full utterance must equal one command; substring matches cannot
            // turn conversational speech or negative instructions into actions.
            let action = self.config.action(&normalize(text));
            if action == Some("leave")
                && (confidence / (words.len() as f64) < 0.95
                    || words.iter().any(|word| {
                        word.get("conf")
                            .and_then(|value| value.as_f64())
                            .unwrap_or(0.)
                            < 0.90
                    }))
            {
                return None;
            }
            action
        }
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        unsafe {
            (self.free_recognizer)(self.recognizer);
            (self.free_model)(self.model);
        }
    }
}
