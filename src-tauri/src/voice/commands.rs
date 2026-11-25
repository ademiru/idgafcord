use serde::Deserialize;

#[derive(Clone, Deserialize)]
pub struct Config {
    pub language: String,
    pub mute: String,
    pub unmute: String,
}

pub fn normalize(text: &str) -> String {
    text.chars()
        .flat_map(|c| match c {
            'İ' | 'ı' => 'i'.to_lowercase(),
            _ => c.to_lowercase(),
        })
        .map(|c| match c {
            'ğ' => 'g',
            'ü' => 'u',
            'ş' => 's',
            'ö' => 'o',
            'ç' => 'c',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.language.as_str(), "tr" | "en") {
            return Err("Desteklenen ses dilleri: Türkçe ve İngilizce.".into());
        }
        for phrase in [&self.mute, &self.unmute] {
            if phrase.trim().is_empty()
                || phrase.len() > 100
                || phrase.split_whitespace().count() > 6
                || phrase
                    .chars()
                    .any(|c| !c.is_alphabetic() && !c.is_whitespace())
            {
                return Err("Komut 1–6 kelimeden oluşmalı; yalnızca harf ve boşluk kullan.".into());
            }
        }
        if normalize(&self.mute) == normalize(&self.unmute) {
            return Err("Aç ve kapat komutları farklı olmalı.".into());
        }
        if self.action(&self.mute) != Some("mute") || self.action(&self.unmute) != Some("unmute") {
            return Err("Komutlar birbirleriyle veya yerleşik komutlarla çakışıyor.".into());
        }
        Ok(())
    }

    pub fn phrases(&self) -> Vec<(String, &'static str)> {
        let mut phrases = vec![
            (self.mute.trim().to_lowercase(), "mute"),
            (self.unmute.trim().to_lowercase(), "unmute"),
        ];
        let aliases: &[(&str, &str)] = if self.language == "en" {
            &[
                ("mute", "mute"),
                ("mute me", "mute"),
                ("mute microphone", "mute"),
                ("unmute", "unmute"),
                ("unmute me", "unmute"),
                ("open mic", "unmute"),
                ("leave voice", "leave"),
                ("leave voice channel", "leave"),
                ("disconnect voice", "leave"),
                ("deafen audio", "deafen"),
                ("mute all audio", "deafen"),
                ("undeafen audio", "undeafen"),
                ("restore audio", "undeafen"),
            ]
        } else {
            &[
                ("sustur", "mute"),
                ("beni sustur", "mute"),
                ("mikrofonu kapat", "mute"),
                ("mikrofonu kapatır mısın", "mute"),
                ("mikrofonu aç", "unmute"),
                ("mikrofonu açar mısın", "unmute"),
                ("sesimi aç", "unmute"),
                ("odadan çık", "leave"),
                ("ses kanalından çık", "leave"),
                ("kanaldan çık", "leave"),
                ("sesi tamamen kapat", "deafen"),
                ("sesi geri aç", "undeafen"),
            ]
        };
        phrases.extend(aliases.iter().map(|(p, a)| (p.to_string(), *a)));
        phrases
    }

    pub fn action(&self, text: &str) -> Option<&'static str> {
        let text = normalize(text);
        let mut action = None;
        for (phrase, candidate) in self.phrases() {
            if text == normalize(&phrase) {
                if action.is_some_and(|a| a != candidate) {
                    return None;
                }
                action = Some(candidate);
            }
        }
        action
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Config {
        Config {
            language: "tr".into(),
            mute: "mikrofonu kapat".into(),
            unmute: "mikrofonu aç".into(),
        }
    }
    #[test]
    fn only_complete_commands_are_accepted() {
        let c = config();
        assert_eq!(c.action("MİKROFONU AÇ"), Some("unmute"));
        assert_eq!(c.action("mikrofonu kapatır mısın"), Some("mute"));
        for text in [
            "mikrofonu kapatma",
            "mikrofonu açma",
            "mikrofonu aç kapat",
            "mikrofonu kapat sonra aç",
            "susturma",
            "commuter",
            "mikrofonu kapat demedim",
        ] {
            assert_eq!(c.action(text), None, "{text}");
        }
    }
    #[test]
    fn conflicting_and_invalid_commands_are_rejected() {
        let mut c = config();
        c.unmute = c.mute.clone();
        assert!(c.validate().is_err());
        c.unmute = "sustur".into();
        assert!(c.validate().is_err());
        c.unmute = "aç;()".into();
        assert!(c.validate().is_err());
    }
    #[test]
    fn custom_commands_match_exact_words() {
        let c = Config {
            language: "en".into(),
            mute: "go quiet".into(),
            unmute: "let me talk".into(),
        };
        assert!(c.validate().is_ok());
        assert_eq!(c.action("go quiet"), Some("mute"));
        assert_eq!(c.action("please do not go quiet"), None);
        assert_eq!(c.action("commuter"), None);
    }
    #[test]
    fn room_and_audio_commands_never_match_negatives_or_conversation() {
        let c = config();
        for (phrase, action) in [
            ("odadan çık", "leave"),
            ("ses kanalından çık", "leave"),
            ("sesi tamamen kapat", "deafen"),
            ("sesi geri aç", "undeafen"),
        ] {
            assert_eq!(c.action(phrase), Some(action));
        }
        for phrase in [
            "odadan çıkma",
            "odadan çık demedim",
            "odadan çık diye söyle",
            "kulaklığı kapatma",
            "kulaklığı açma",
            "ses kanalından ayrılma",
        ] {
            assert_eq!(c.action(phrase), None, "{phrase}");
        }
        let mut conflicting = config();
        conflicting.mute = "odadan çık".into();
        assert!(conflicting.validate().is_err());
    }
}
