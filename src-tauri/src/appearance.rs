use serde::{Deserialize, Serialize};
use tauri::{window::Color, Runtime, Theme, WebviewWindow};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Appearance {
    pub background: String,
    pub foreground: String,
    pub dark: bool,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            background: "#061321".into(),
            foreground: "#e0f5fb".into(),
            dark: true,
        }
    }
}
fn rgb(value: &str) -> Option<[u8; 3]> {
    if value.len() != 7
        || !value.starts_with('#')
        || !value[1..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return None;
    }
    Some([
        u8::from_str_radix(&value[1..3], 16).ok()?,
        u8::from_str_radix(&value[3..5], 16).ok()?,
        u8::from_str_radix(&value[5..7], 16).ok()?,
    ])
}
impl Appearance {
    pub fn valid(&self) -> bool {
        rgb(&self.background).is_some() && rgb(&self.foreground).is_some()
    }
    pub fn color(&self) -> Color {
        let [r, g, b] = rgb(&self.background).unwrap_or([6, 19, 33]);
        Color(r, g, b, 255)
    }
    pub fn theme(&self) -> Theme {
        if self.dark {
            Theme::Dark
        } else {
            Theme::Light
        }
    }
    pub fn apply<R: Runtime>(&self, window: &WebviewWindow<R>) {
        let _ = window.set_theme(Some(self.theme()));
        let _ = window.set_background_color(Some(self.color()));
        #[cfg(windows)]
        if let Ok(hwnd) = window.hwnd() {
            #[link(name = "dwmapi")]
            unsafe extern "system" {
                fn DwmSetWindowAttribute(
                    hwnd: *mut std::ffi::c_void,
                    attribute: u32,
                    value: *const u32,
                    size: u32,
                ) -> i32;
            }
            let caption = rgb(&self.background).unwrap_or([6, 19, 33]);
            let text = rgb(&self.foreground).unwrap_or([224, 245, 251]);
            let colorref =
                |c: [u8; 3]| u32::from(c[0]) | (u32::from(c[1]) << 8) | (u32::from(c[2]) << 16);
            // Windows 11 caption/text colors; unsupported attributes are ignored on Windows 10.
            for (attribute, value) in [
                (20, u32::from(self.dark)),
                (35, colorref(caption)),
                (36, colorref(text)),
            ] {
                unsafe {
                    DwmSetWindowAttribute(hwnd.0, attribute, &value, 4);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_complete_ascii_hex_colors_are_accepted() {
        assert!(Appearance::default().valid());
        for background in ["#fff", "#12345g", "#你好", "red", "#123456;display:none"] {
            assert!(!Appearance {
                background: background.into(),
                ..Default::default()
            }
            .valid());
        }
    }
}
