# Geliştirme notları — 0.2.2

## Yapı

- `src-tauri/src/lib.rs`: uygulama, pencere, tepsi, ayarlar, güncelleyici ve betik birleştirme.
- `src-tauri/src/permissions.rs`: yalnız Discord HTTPS kökeninin mikrofon/kamera istekleri için WebView2 deferral kuyruğu. Karar ayrı, paketlenen yerel pencerede verilir. Uzak sayfanın native köprüsü izin verme yanıtı kabul etmez. Pencere kapanması, gezinme ve zaman aşımı izin vermez. Hatırlama seçimi varsayılan kapalıdır; ses ayarlarındaki sıfırlama yalnız izinleri DEFAULT durumuna alır.
- `src-tauri/src/voice/`: Rust mikrofon yakalama, mono 16 kHz örnekleme, ses etkinliği kapısı, komut sözlüğü, Vosk bağlayıcısı ve doğrulanmış paket kurulumu.
- `src-tauri/src/client/`: mikrofon durum adaptörü, yerel ses denetimi, gizlilik, Aero, açılış ve ayar düzeni.
- `client/settings-entry.js`: gözlemlenen `Settings pages` / `Settings sidebar` yapısına ve eski `standardSidebarView` yapısına idgafcord girişi ekler. React bileşenlerini değiştirmez. Panel aynı focus sınırı içinde açılır; Escape yalnız özel paneli kapatır. Dar kapsamlı MutationObserver yenilenen menüyü ve kopan paneli onarır.
- `tests/`: gerçek birleştirilmiş betik için JavaScript ve Edge tarayıcı testleri. HTML örnekleri temsili veridir; Discord sohbetine içerik eklenmez.
- `logo-1024.png`, `src-tauri/icons/`: yeni marka kaynağı ve platform çıktıları. UI yalnızca 256 px sürümünü base64 olarak gömer. Üretim istemi `assets/brand/logo-generation.json` dosyasındadır.

Ana pencere önce `src/` altındaki yerel bekleme sayfasını gösterir, ardından `https://discord.com/app` adresine geçer. Pencere ve webview zemini kayıtlı görünümle ilk boyamadan önce ayarlanır. `appearance.rs` Windows başlık çubuğunu temayla eşler; Windows 11'de başlık/metin rengi DWM ile ayarlanır, Windows 10'da açık/koyu native tema kullanılır. Ayar paneli, tema ve istek engelleyici Rust tarafından eklenir. Ana UI belge kökü oluşunca bir defa başlatılır; farklı köken ve alt çerçevelerde çalışmaz. Telemetri sarmalayıcıları belge başlangıcında kurulur.

## Ses akışı

Varsayılan giriş aygıtı → CPAL → 20 ms mono PCM16 kareler → sınırlı kuyruk → ses etkinliği kapısı → en fazla dört saniyelik ifade → kısıtlı Vosk sözlüğü → kesin komut eşleştirmesi → Discord düğme durumunun doğrulanması.

Sessizlik tanıyıcıya gönderilmez. Ses ve ilgisiz metinler webview'e, diske veya ağa iletilmez. Yalnızca doğrulanmış `mute` / `unmute` eylemi sayfaya geçer. Kuyruk taşması ifadeyi sıfırlar. Uzun konuşma, düşük güven ve belirsiz mikrofon durumu eylem üretmez. Aynı hedef durumu isteyen komutlar ikinci kez tıklamaz.

Vosk 0.3.45 Windows x64 kitaplığı ve küçük TR/EN modelleri `prepare-voice-resources.ps1` ile sabit SHA-256 değerleri doğrulanarak derleme öncesinde hazırlanır. Kaynaklar kurulumdaki `voice/` klasöründen kullanılır; eski kullanıcı paketleri yedek konum olarak desteklenir. Kapalıyken dosyalar RAM'e yüklenmez. Türkçe model eski düz dosya düzenini, İngilizce model `am/conf/graph` düzenini kullanır. Kaynaklar: [Vosk C başlığı](https://github.com/alphacep/vosk-api/blob/v0.3.45/src/vosk_api.h), [model listesi ve lisanslar](https://alphacephei.com/vosk/models).

Sesli komut kapalıyken mikrofon akışı veya model tutulmaz. Açıkken küçük model de ek bellek kullanır. Sabit düşük RAM veya resmî Discord'a karşı üstünlük garantisi verilmez. Model sözlüğünde `unmute` bulunmadığından İngilizce varsayılan açma ifadesi `open mic` kullanılır.

Kurulu Windows kaynak yolu `\\?\` öneki taşıyabilir. Vosk/Kaldi'nin dosya API'si bu yolu okuyamadığı için yalnız modelin C API'ye verilen yolu `dunce::simplified` ile normalize edilir. DLL yükleme UTF-16 ve güvenli arama bayraklarıyla kalır. Gerçek motor testi Windows'ta canonical yolu kullanarak bu regresyonu kapsar.

Balon CSS'i yalnız gerçek `message-content-*` kimliklerini boyar; reply içindeki metin normal inline önizlemedir. Cam hissi statik gradyan ve ince iç yansımayla oluşturulur; her mesaja backdrop-filter eklenmez. Üye listesi için Discord'un düğmesine açıkça basılması `hideMembers` / Aero focus tercihlerine üstün gelir.

## Kontroller

Yeni klonda `npm run voice:prepare` kaynakları hazırlar; büyük modeller Git'e eklenmez. `npm run dev`, `npm run check` ve setup derlemesi hazırlığı otomatik çalıştırır. Önbellekteki ZIP'ler her seferinde yeniden hash kontrolünden geçirilir.

```powershell
npm test
npm run test:ui
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D clippy::all
.\scripts\test-voice.ps1
npm run tauri -- build --no-bundle
npm run test:native
```

`test-voice.ps1` doğrulanmış test paketlerini `src-tauri/target/` içine koyar ve Windows'un yüklü TR/EN TTS seslerinden örnek üretir. Gerçek Vosk motoru ve ses kapısı birlikte; sustur, aç, olumsuz komut ve normal konuşma için sınanır. Canlı mikrofon açılmaz.

`test:native` üretilen exe ve paketlenen ses kaynaklarını ayrı bir portable klasörde çalıştırır. Gerçek WebView2 içinde temsili Discord DOM'u kullanarak paneli, kapalı IPC yüzeyini ve iki modelin hazır olduğunu denetler; mikrofonu açmaz. Aygıt izni gerçek PermissionRequested olayıyla istenir ve yalnız ret yolu seçilir. İzin sıfırlama DEFAULT durumuna döner; testte izin verme yolu otomatik seçilmez. Yalnızca bu test sürecine geçici localhost hata ayıklama portu verilir; uygulamanın normal açılışına eklenmez. [WebView2 hata ayıklama belgesi](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code).

Gece Aero görseli `assets/aero/night-city.jpg` dosyasından bir kez gömülür (yaklaşık 155 KiB JPEG); uzak görsel isteği ve sürekli duvar kâğıdı animasyonu yoktur. Orijinal kaynak ve üretim istemi aynı klasördedir. Renk ve ikon kararları `AERO-REFERENCES.md` içinde kaynaklıdır.

Yavaş bağlantı güvenli mod tetiklemez. `ldc_safe_reason=manual` yalnız kullanıcının tepsi menüsündeki sorun giderme eylemiyle yazılır; önceki otomatik güvenli mod bayrağı geçersiz sayılır. Kısa açılış animasyonundan sonra sabit bağlantı durumu gösterilir.

## Düzeltmeler

Eski başlangıç betiğinde eksik sözlük virgülü, hatalı getter sonlandırıcısı ve kapanmayan panel `try` bloğu vardı. Artık paketlenen betiğin tamamı sözdizimi testinden geçer. Belge kökü oluşmadan tema uygulama da engellendi.

Sekmeler ayar satırlarının `display:flex` düzenini sıfırlıyordu. Özgün düzen korunur; dikey gezinme ve tek içerik kaydırma alanı kullanılır. Native anahtar değişiklikleri mevcut kaydırma konumunu sıfırlamaz.

Gizlilik engelleyicisi URL nesnelerini de kapsar. Engellenen XHR tamamlanma olaylarını üretir; bildirme uçları ve dosya adında `sentry` geçen sıradan ekler engellenmez. Kısayol değişikliği önce yeni kaydı dener; başarısızsa eski kısayol korunur. Ayarlar geçici dosyadan yeniden adlandırılarak yazılır.

Geliştirme ve portable profilleri kurulu uygulamanın tarayıcı oturumundan ayrıdır. Bu profiller açılırken Windows başlangıç kaydı değiştirilmez; güncelleyici otomatik kurulum yapmaz. Güvenli yenileme özel CSS ve tema ayarlarını silmez.

## Sınırlar

Tarayıcı testleri giriş yapılmış canlı sunucuların bütün DOM varyasyonlarını kapsamaz. Discord seçicileri değişebilir. Gerçek mikrofonlar, gürültü, farklı sesler, görüşme sırasında komutlar, ekran paylaşımı ve oyun modu ayrıca kullanıcı kabul testi gerektirir. Eklenti uyumluluk katmanı deneysel ve kısmi kalır; tüm BetterDiscord/Vencord eklentilerinin çalıştığı iddia edilmez. İmzalı NSIS yayını için depoda tutulmayan özel anahtar gerekir.
