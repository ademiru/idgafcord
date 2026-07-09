# Lightweight Discord Client

Discord'un web arayüzünü saran, hafif ve gizlilik odaklı bir Tauri masaüstü istemcisi.

## Özellikler

Tüm ayarlar **uygulama içindeki ayar panelinden** yönetilir: Discord penceresinin
sağ alt köşesindeki **dişli düğmeye** tıklayın (ya da tepsi menüsünden "Ayarlar").
Panel Discord temasına uygun; anahtarlar (toggle), tema (CSS) düzenleyici ve
bakım düğmeleri içerir. Ayarlar `settings.json` içinde kalıcı saklanır.
Tepsi menüsü sadeleştirildi: **Göster / Ayarlar / Çıkış** (sol tık = pencereyi göster).

- **Sistem tepsisi**: Kapatınca uygulama tamamen kapanmaz, tepsiye küçülür (opsiyonel).
- **Windows ile başlat**: Açılışta otomatik başlatma (opsiyonel).
- **Tepside sessiz başlat**: Pencereyi açmadan doğrudan tepside başlar (opsiyonel).
- **Telemetri engelleme**: `science`, `metrics`, `track`, `sentry`, `analytics` gibi
  izleme isteklerini istemci içinde düşürür (opsiyonel, canlı aç/kapa).
- **Nitro/reklam gizleme**: Upsell/hediye öğelerini CSS ile gizler (opsiyonel).
- **Donanım hızlandırmayı kapat**: RAM/GPU kullanımını azaltır (yeniden başlatma gerektirir).
- **Özel tema (theme.css)**: Kendi CSS'inizi enjekte eder. "Tema klasörünü aç" ile
  düzenleyebilirsiniz.
- **Önbelleği temizle** ve **okunmamış rozeti** (görev çubuğu + tepsi ipucu).
- **Küresel kısayol**: `Ctrl/Cmd+Shift+M` ile mikrofonu sustur.
- **Otomatik güncelleme kontrolü**: Tepsi menüsündeki seçenek açıkken başlangıçta
  ve arka planda periyodik olarak yeni sürümü denetler.

## Geliştirme

```bash
npm install
npm run tauri dev
```

## Otomatik güncelleme kurulumu (önemli)

Güncelleyici için gerçek bir imza anahtarı `src-tauri/updater-private.key` içinde
üretildi ve public key `tauri.conf.json > plugins.updater.pubkey` içine yazıldı.
Çalışır hale getirmek için:

1. **Özel anahtarı gizli tutun.** `updater-private.key` (ve `.pub`) `.gitignore`
   içindedir, commit etmeyin. Kaybederseniz yeni sürümleri imzalayamazsınız.
2. **Endpoint'i ayarlayın.** `tauri.conf.json` içindeki
   `plugins.updater.endpoints` değerini kendi sunucunuzla değiştirin
   (şu an yer tutucu: `SUNUCUNUZU-BURAYA-YAZIN.example.com`). Endpoint,
   `{{target}}`, `{{arch}}`, `{{current_version}}` şablonlarını destekleyen ve
   bir `latest.json` döndüren bir URL olmalıdır.
3. **Sürümü imzalayarak derleyin.** Özel anahtarı ortam değişkeni olarak verin:
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat src-tauri/updater-private.key)"
   # anahtarın parolası yok, bu yüzden password değişkeni gerekmez
   npm run tauri build
   ```
   `createUpdaterArtifacts` açık olduğu için imzalı güncelleme paketleri üretilir.
4. Üretilen paketleri ve `latest.json` dosyasını endpoint'inize yükleyin.

Endpoint ayarlanana kadar "Güncellemeleri denetle" güvenle çalışır; sadece
güncelleme bulamaz (uygulama çökmemez).

## Not: telemetri engelleme yöntemi

WebView2, keyfi HTTPS isteklerini native katmanda kesecek genel bir API sunmaz.
Bu yüzden engelleme, Discord'un scriptlerinden önce enjekte edilen bir başlatma
scriptiyle `fetch`/`XMLHttpRequest`/`sendBeacon` sarmalanarak yapılır — istek
ağa çıkmadan istemci içinde düşürülür. Vesktop/ArmCord gibi hafif istemcilerin
kullandığı yöntemin aynısıdır.
