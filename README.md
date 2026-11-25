# idgafcord

English · [Türkçe](README.tr.md)

<img src="logo-1024.png" width="96" alt="idgafcord">

A Windows Discord desktop client built with Tauri 2, Rust and WebView2.

[Download Windows 0.2.4 preview](https://github.com/ademiru/idgafcord/releases/download/v0.2.4/idgafcord_0.2.4_x64-setup.exe)

## 0.2.4 development build

- Frutiger Aero and Dark Frutiger Aero (the default for new profiles) cover chat, channel lists, menus, the composer and settings. Includes light/dark switching, focus view and optional glass effects.
- New logo and bounded startup animation with reduced-motion support.
- Offline microphone commands handled by Rust: **mute** / **open mic**, or **mikrofonu kapat** / **mikrofonu aç** in Turkish.
- Known telemetry endpoint blocking for fetch, XHR and beacon, with a request counter.
- Tray support, global mute shortcut, performance profiles, installed-build updater and portable mode.
- Discord User Settings → **idgafcord → Client settings**, a larger standalone glass logo, server lens highlights and glass message bubbles with separate reply previews.
- A compact voice indicator in the top bar replaces floating profile-area badges. Device consent uses a bundled themed window; microphone/camera access still requires an explicit choice.

- Explicit **idgafcord** header settings button, compact 56/30 px panel chrome and a home logo that fits Discord’s SVG viewport.
- Theme-aware digital voice timers, voice controls and message highlights; independent Events/Members/Server Boosts hiding.
- Screen-share capture preferences and a live preview; the redundant sharing banner was removed. **Cinema** opens from the header in a separate viewer, preserving Discord’s layout and audio; includes source selection, fit/fill/stretch, zoom and local brightness.
- Photo rotation/flipping, zoom, pixel inspection, actual size and original Discord attachment downloads through a native save dialog.
- **My card**: four skins and a local profile-card editor. An optional Cloudflare Workers/D1 ecosystem implementation is included; no public backend is deployed yet. Client badges are self-reported.

[Screen-sharing scope and unresolved HDR issue](docs/SCREEN-SHARING.md) · [Ecosystem setup and data flow](docs/ECOSYSTEM.md)

## Offline voice control

In Settings → Voice, choose a language and enable voice control. Turkish and English models are included in the installer; no separate in-app download is needed. Open settings from the **idgafcord** section in Discord's normal user settings, the tray menu, or **Ctrl + Shift + ,**.

Additional commands: **leave voice**, **mute all audio**, and **restore audio**. Leaving voice uses a higher recognition confidence threshold and is confirmed from Discord’s actual disconnect control.

Audio stays on the device and is never saved. Browser dictation is not used. A small activity gate discards silence. The local Vosk model processes short utterances with a restricted command vocabulary. Long speech and low-confidence results are discarded. Say each command on its own.

The model uses additional RAM while enabled. Disabling voice control releases the microphone stream, recognizer and model. Voice control is off by default. No measured memory advantage over the official Discord client is claimed.

Custom words must exist in the selected model's vocabulary. Unsupported words produce an error. Microphone actions are confirmed from Discord's actual button state.

## Privacy scope

Accounts, messages, calls and attachments continue to use Discord's services. The blocker intercepts known telemetry in page-level requests; it is not a system-wide network firewall. Reporting and messaging endpoints remain available. Plugins and user-selected remote backgrounds can make additional requests.

## Development

Requires Node.js, Rust MSVC, Visual C++ Build Tools and WebView2 Runtime. The repository toolchain file selects Windows MSVC.

```powershell
npm ci
npm run voice:prepare
npm run dev
npm test
npm run test:ui
cargo test --locked --manifest-path src-tauri/Cargo.toml
.\scripts\test-voice.ps1
npm run tauri -- build --no-bundle
```

Development uses separate settings and browser data. Portable builds detect `portable.flag` and keep settings, WebView2 data and voice packs in `data` beside the executable.

Voice tests generate synthetic speech with installed Turkish/English Windows TTS voices without opening a microphone. Browser tests use representative Discord HTML. Logged-in server layouts, real microphones and different speakers require further validation.

[Development notes](docs/DEVELOPMENT.md) · [Release guide](PUBLISH.md) · [Published releases](https://github.com/ademiru/idgafcord/releases)

Offline engine: [Vosk API](https://github.com/alphacep/vosk-api), [models and licenses](https://alphacephei.com/vosk/models). Archives are checked against pinned SHA-256 hashes before building and bundled with the installer. License notices are included in the installed `voice/` directory.
