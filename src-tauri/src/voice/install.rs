use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    time::Duration,
};

const RUNTIME: (&str, &str, &str) = (
    "https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-win64-0.3.45.zip",
    "f1dcc9cca460630f81ea8f71794f69c80bed6556d2a4e6237b5785e1d2dff34b",
    "vosk-win64-0.3.45",
);

pub fn ready(root: &Path, language: &str) -> bool {
    matches!(language, "tr" | "en")
        && [
            "libvosk.dll",
            "libgcc_s_seh-1.dll",
            "libstdc++-6.dll",
            "libwinpthread-1.dll",
        ]
        .iter()
        .all(|name| root.join("runtime").join(name).is_file())
        && root.join(language).join(".verified").is_file()
        && if language == "tr" {
            ["final.mdl", "mfcc.conf", "HCLr.fst", "Gr.fst"]
                .iter()
                .all(|name| root.join(language).join(name).is_file())
        } else {
            [
                "am/final.mdl",
                "conf/model.conf",
                "graph/HCLr.fst",
                "graph/Gr.fst",
            ]
            .iter()
            .all(|name| root.join(language).join(name).is_file())
        }
}

pub fn install(root: &Path, language: &str) -> Result<(), String> {
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        return Err("Yerel ses paketi şu anda Windows x64 destekliyor.".into());
    }
    let model = match language {
        "tr" => (
            "https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip",
            "8c8d07cec1bce31add14967c16891c84152cdf76d391e33c08278119b9ea96e5",
            "vosk-model-small-tr-0.3",
        ),
        "en" => (
            "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
            "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498",
            "vosk-model-small-en-us-0.15",
        ),
        _ => return Err("Geçersiz ses dili.".into()),
    };
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    for (pack, target) in [(RUNTIME, "runtime"), (model, language)] {
        if root.join(target).join(".verified").is_file() {
            continue;
        }
        let stage = root.join(format!(".download-{target}"));
        fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            let response = client
                .get(pack.0)
                .send()
                .map_err(|_| "Ses paketi indirilemedi. İnternet bağlantısını kontrol et.")?
                .error_for_status()
                .map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            response
                .take(80 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 80 * 1024 * 1024 || format!("{:x}", Sha256::digest(&bytes)) != pack.1 {
                return Err("Ses paketinin bütünlük kontrolü başarısız.".into());
            }
            let mut archive =
                zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
            let mut total = 0_u64;
            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                let relative = file.enclosed_name().ok_or("Geçersiz arşiv yolu.")?;
                let relative = relative
                    .strip_prefix(pack.2)
                    .map_err(|_| "Geçersiz paket kökü.")?;
                if relative.as_os_str().is_empty() || file.is_dir() {
                    continue;
                }
                if file
                    .unix_mode()
                    .is_some_and(|mode| mode & 0o170000 == 0o120000)
                {
                    return Err("Paket bağlantı içeremez.".into());
                }
                total += file.size();
                if total > 300 * 1024 * 1024 {
                    return Err("Ses paketi boyut sınırını aşıyor.".into());
                }
                let dest = stage.join(relative);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut out = fs::File::create(dest).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
                out.flush().map_err(|e| e.to_string())?;
            }
            fs::write(stage.join(".verified"), pack.1).map_err(|e| e.to_string())?;
            let dest = root.join(target);
            if dest.exists() {
                fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
            }
            fs::rename(&stage, dest).map_err(|e| e.to_string())?;
            Ok(())
        })();
        if stage.exists() {
            let _ = fs::remove_dir_all(stage);
        }
        result?;
    }
    Ok(())
}
