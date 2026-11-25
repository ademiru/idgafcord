# idgafcord

[English](README.md) · Türkçe

<img src="logo-1024.png" width="96" alt="idgafcord">

Windows için Tauri 2, Rust ve WebView2 ile çalışan Discord istemcisi.

[Windows 0.2.4 ön sürümünü indir](https://github.com/ademiru/idgafcord/releases/download/v0.2.4/idgafcord_0.2.4_x64-setup.exe)

## 0.2.4 geliştirme sürümü

- Frutiger Aero ve Dark Frutiger Aero (yeni profillerde varsayılan): sohbet, kanal listeleri, menüler, mesaj kutusu ve ayarlar için tutarlı yüzeyler. Açık/koyu geçişi, odak görünümü ve kapatılabilir cam efektleri.
- Yeni logo ve süresi sınırlı açılış animasyonu. Azaltılmış hareket tercihi desteklenir.
- Rust tarafında çevrimdışı mikrofon komutları. Türkçe: **mikrofonu kapat** / **mikrofonu aç**. İngilizce: **mute** / **open mic**.
- Bilinen telemetri uçları için fetch, XHR ve beacon engellemesi; canlı istek sayacı.
- Tepsi, global mikrofon kısayolu, performans profilleri, kurulu sürüm için güncelleyici ve portable çalışma.
- Discord Kullanıcı Ayarları → **idgafcord → İstemci ayarları** girişi; büyük bağımsız cam logo, sunucu parlamaları ve cam mesaj balonları. Reply önizlemesi balondan ayrı tutulur.
- Mikrofon durumu üst çubukta küçük bir simgedir. Hatalar ses ayarlarında açıklanır; profil alanında yüzen rozet yoktur. Discord mikrofon/kamera izinleri yerel, temaya uyumlu bir pencerede açık seçimle yönetilir.

- Üst çubukta yazılı **idgafcord** ayar düğmesi; ince 56/30 px panel başlığı ve alt çubuğu, SVG içinde kesilmeyen logo ve hareket etmeyen sunucu parlamaları.
- Tema rengini izleyen dijital ses saati, ses paneli, bahsetme ve mesaja gitme vurguları. Events, Members ve Server Boosts ayrı ayrı gizlenebilir.
- Paylaşım öncesi boyut/fps/içerik/ses menüsü ve canlı önizleme; gereksiz üst paylaşım kutusu kaldırıldı. **Sinema** üst çubuktan açılır; Discord yerleşimini değiştirmeyen ayrı görüntüleyici, kaynak seçimi, sığdır/doldur/esnet, yakınlık ve yerel parlaklık seçenekleri sunar.
- Fotoğraflarda döndürme/çevirme, yakınlaştırma, piksel inceleme, gerçek boyut ve Discord ekinin **orijinalini** native kaydetme penceresiyle indirme.
- **Kartım**: dört kaplama ve yerel kart düzenleyicisi. Cloudflare Workers/D1 için ücretsiz başlangıca uygun, isteğe bağlı ekosistem temeli; henüz herkese açık sunucu yoktur. İstemci rozetleri kullanıcı beyanıdır.

[Ekran paylaşımı kapsamı ve açık HDR konusu](docs/SCREEN-SHARING.md) · [Ekosistem kurulumu ve veri akışı](docs/ECOSYSTEM.md)

## Yerel ses komutları

Ayarlar → Ses bölümünden dili seçip sesli komutu aç. Türkçe ve İngilizce modeller kurulumla birlikte gelir; uygulama içinde ayrıca paket indirilmez. Ayarlar normal Discord dişlisinin içindeki **idgafcord** bölümünden, tepsi menüsünden veya **Ctrl + Shift + ,** ile açılır.

Ek komutlar: **odadan çık** / **ses kanalından çık**, **sesi tamamen kapat** ve **sesi geri aç**. Ayrılma komutu daha yüksek tanıma güveni ister; düğme belirsizse işlem yapılmaz.

Ses cihazdan çıkmaz ve dosyaya yazılmaz. Tarayıcı diktesi kullanılmaz. Hafif ses etkinliği kapısı sessizliği ayırır; kısa konuşmalar yerel Vosk modelinde sınırlı komut sözlüğüyle değerlendirilir. Uzun konuşmalar ve düşük güvenli sonuçlar uygulanmaz. Komutu tek başına söyle.

Özellik açıkken model ek RAM kullanır. Kapatınca mikrofon akışı, tanıyıcı ve model bırakılır. Sesli komut varsayılan olarak kapalıdır. Discord'un resmî istemcisine karşı ölçülmüş bir bellek üstünlüğü iddia edilmez.

Özel komutların kelimeleri seçilen modelin sözlüğünde bulunmalıdır. Desteklenmeyen kelimeler için hata gösterilir. Susturma işleminin başarı durumu Discord'un gerçek düğme durumundan doğrulanır.

## Gizlilik kapsamı

Hesap, mesajlar, görüşmeler ve dosyalar Discord'un kendi hizmetlerini kullanır. Engelleyici bilinen telemetri uçlarını sayfa istek katmanında durdurur; bütün ağ trafiğini filtreleyen bir güvenlik duvarı değildir. Bildirme ve mesaj uçları engellenmez. Eklentiler ve kullanıcının seçtiği uzak arka planlar ek ağ istekleri oluşturabilir.

## Geliştirme

Node.js, Rust MSVC, Visual C++ Build Tools ve WebView2 Runtime gerekir. Depodaki toolchain dosyası Windows MSVC'yi seçer.

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

Geliştirme profili kurulu uygulamanın ayar ve tarayıcı verilerinden ayrıdır. Portable sürüm `portable.flag` algılar; ayarlar, tarayıcı profili ve ses paketleri exe yanındaki `data` klasöründe kalır.

Ses testleri Windows'un yüklü Türkçe/İngilizce TTS sesleriyle sentetik örnekler üretir; canlı mikrofon açılmaz. Tarayıcı testleri temsili Discord HTML'i kullanır. Gerçek sunucularda, farklı mikrofon ve konuşmacılarda doğrulama ayrıca gerekir.

[Geliştirme notları](docs/DEVELOPMENT.md) · [Sürüm hazırlama](PUBLISH.md) · [Yayınlanmış sürümler](https://github.com/ademiru/idgafcord/releases)

Yerel motor: [Vosk API](https://github.com/alphacep/vosk-api), [modeller ve lisanslar](https://alphacephei.com/vosk/models). Derleme öncesinde arşivler sabit SHA-256 değerleriyle doğrulanır ve kurulum kaynaklarına eklenir. Lisans metinleri kurulumda `voice/` klasörüne dahildir.
