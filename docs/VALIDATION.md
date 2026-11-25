# 0.2.2 doğrulaması — 25 Kasım 2026

## 0.2.2 düzeltmeleri

- Reply önizlemesinin yanlışlıkla ana mesaj balonu gibi `display:block` ve dolgu alması testte yeniden üretildi. Gerçek mesaj kimlikleriyle sınırlanan balon CSS'i ve ayrı inline alıntı düzeniyle düzeltildi.
- `hideMembers` ve Aero focus tercihi açıkken Discord'un kendi üye listesi düğmesi iki native başlangıç durumunda da başarısız oldu. Açık kullanıcı tıklaması artık uygulamanın gizleme tercihini kapatır; native durum zaten açıksa gereksiz kapatma eylemi engellenir.
- Discord'un gözlemlenen yeni `Settings pages` / `Settings sidebar` gezinmesine ve eski ayar yapısına idgafcord girişi eklendi. Aç/kapat, focus sınırı, Escape ile yalnız özel panelin kapanması, menü yenilenmesi ve kopan panelin geri alınması sınandı.
- Profil alanındaki sabit ses rozetleri kaldırıldı. Üst çubukta küçük simge, üzerine gelince açıklama ve ses ayarlarında tam hata metni kullanılır. Mikrofon seçimi bu simgeyi ve ayar panelini aday olarak almaz.
- Sunucu lens efektleri tıklamaları engellemez; azaltılmış hareket ve kapalı efekt tercihi desteklenir. Ana logo kutusuz ve daha büyüktür. Mesaj balonları statik cam gradyanı kullanır; her mesaja backdrop-filter eklenmez.
- Sağlam kurulu TR/EN modelleri normal yolla açılırken `\\?\` canonical Windows yolunda Vosk yüklemesi başarısız oldu. Yalnız Vosk'a verilen model yolu normalize edilince aynı gerçek motor testi geçti. DLL yolu güvenli UTF-16 yüklemesini korur. Regresyon testi artık Windows'ta canonical kaynak yolunu kullanır.
- Yeni yerel mikrofon/kamera izin penceresi gerçek WebView2 isteğinde reddetme yoluyla sınandı; canlı mikrofon açılmadı. İzin verme yolu otomatik olarak seçilmedi. Köken doğrulaması ve geçersiz bağlamın izin verememesi test edilir. Hatırlama varsayılan kapalıdır; pencereyi kapatma/Escape hatırlanan ret oluşturmaz.

Bu sürümün tarayıcı paketi 32 senaryoyu kapsar. Son native paket gerçek WebView2 içinde, Discord HTTPS kökenine yerleştirilen temsili DOM ile sınanır; canlı Discord sunucusunun yanıt süresine bağımlı değildir. Yerel motor sentetik sesle test edilir; gerçek konuşmacı, gürültü ve görüşme kalitesi ölçümü değildir.

## Sesli komutlar

Eski ses akışında 14 senaryodan 13'ü başarısız olarak yeniden üretildi: ara sonuçtan komut uygulama, zayıf alternatiften tetiklenme, olumsuz ifadeyi pozitif komut sanma, yanlış düğmeyi seçme, açık mikrofonu aç komutuyla tersine çevirme ve tanıyıcı yeniden başlatma kilitlenmeleri.

Yeni akış tarayıcı diktesini kaldırır. JS testleri mikrofon seçimi, gerçek durum doğrulaması, tekrar eden komutlar, yerel olayların oturum numarası, zaman aşımı ve kapatmayı kapsar. Rust testleri komut eşleştirme, çakışma, örnekleme ve sınırlı ses kapısını kapsar.

Türkçe ve İngilizce sentetik sesler gerçek Vosk motorunda hem doğrudan hem ses kapısından geçirilerek sınandı. Aç/kapat komutları kabul edildi; olumsuz cümle ve normal konuşma eylem üretmedi. Mikrofon açılmadı.

## Kaynak ölçümü

`offline_resource_probe`, bu makinede Türkçe modeli ve sabit sentetik örneği kullanır:

| Ölçüm | Sonuç |
|---|---:|
| Test süreci çalışma kümesi, model öncesi | 5 MB |
| Model ve motor yüklüyken | 98 MB |
| Model ve motor bırakıldıktan sonra | 8 MB |
| Model yükleme | 916 ms |
| Ortalama komut çözümleme, 20 tekrar | 44 ms |
| 60 saniyelik sentetik sessizliğin kapı işlemi | 20 ms |

Bu, ses motorunun izole ölçümüdür; bütün uygulamanın RAM'i veya resmî Discord ile karşılaştırma değildir. İşletim sistemi önbelleği, donanım ve gerçek mikrofon gecikmesi sonuçları değiştirir. Ses kapısı ayrıca yaklaşık 500 ms sessizlik bekleyerek ifadeyi tamamlar; 44 ms uçtan uca komut gecikmesi değildir.

## Aero, ayarlar ve açılış

21 Edge testi iki Aero görünümünü, tema geçişinin temizlenmesini, odak/cam kontrollerini, 800×600 düzenini, ayar kategorilerindeki yatay taşmayı, anahtar hizasını ve azaltılmış hareketi denetler. Yeni profil gece Aero ile açılır; eski açık/kapalı tema tercihi korunur. Çok satırlı bir mesaj tek blok balondur; gereksiz satır bölünmesi ve sonraki mesajla çakışma yoktur. Bağlantı kartında sağlayıcının kalın renkli şeridi yerine dört kenarı aynı ince çerçeve kullanılır. Yüzen kapsül Aero'da gizlidir; Ctrl+Shift+, ayarları açar.

Üç yeni regresyon önce hatalı uygulamada başarısız oldu: `unread` boş katmanları cyan oluyordu; 13 saniyede güvenli mod/yenileme tetikleniyordu; logo kapanınca boş sayfa beyaz kalıyordu. Daraltılan CSS ve elle başlatılan kurtarma akışıyla testler geçti. Kısa animasyondan sonra sayfa hazır değilse sabit bir bağlantı durumu kalır; yavaş ağ temayı ve telemetri korumasını kapatmaz.

Önizleme HTML'indeki konuşmalar yalnızca test verisidir. Pazarlama kartları, sloganlar veya sahte duyurular Discord sohbetine eklenmez.

## Native uygulama

Üretilen Windows exe ve kurulumla dağıtılan ses dosyaları ayrı portable veri klasöründe açıldı. Panel, native ayar köprüsü, iki modelin indirmesiz hazır oluşu ve eksik dosya geri bildirimi denetlendi. 0.2.1'de canlı giriş sayfası kullanılmıştı; 0.2.2'nin son native paketi aynı WebView2/HTTPS kökeninde temsili Discord DOM'u kullanır. Mikrofon kapalı kaldı; global Tauri IPC nesnesi uzak sayfada açılmadı. Model tanıma testleri kurulum kaynaklarını ve önceden üretilmiş yerel sentetik PCM örneklerini kullanır. Mevcut Windows PowerShell 5 TTS ortamı Türkçe sesi listelemediği için bu çalışmada örnekler yeniden sentezlenmedi.

Native görünüm denetiminde gerçek tema düğmelerinden açık/koyu geçişi yapıldı; Rust ayar dosyasına karşılık gelen başlık/zemin renklerinin kaydedildiği doğrulandı. Gerçek WebView2'de Discord yanıtı boş bırakılıp 16 saniye beklendi: koyu bekleme zemini kaldı, güvenli mod açılmadı ve science isteği ağa çıkmadan engellendi. Native köprünün iptal edilen özel şema yönlendirmesi Playwright locator beklemelerini yanıltabildiğinden bu kontroller doğrudan DOM sorguları ve sonuç yoklamalarıyla yürütülür.

Ayrıca açık kurulu uygulamada ses kanalındaki bir üyenin profil kartı normal tıklamayla açıldı. Ağ cevabı sonrası kısa gecikme görüldü; kartın hiç açılmadığı durum bu kontrolde yeniden üretilemedi. Bu gözlem bütün sunucular ve profil türleri için kabul testi yerine geçmez.

## Yayın sınırı

Optimizasyonlu exe ve normal Windows NSIS setup üretildi. Ayrı kurulum kimliğinde gerçek 0.2.1 → 0.2.2 yükseltmesi geçti: eski exe ve eski kaynak kaldırıldı, yeni exe hash'i doğrulandı; Roaming/Local temsili oturum, ayar ve model dosyalarının hash'leri aynı kaldı. Önceki 0.2.0 → 0.2.1 yükseltmesi de doğrulanmıştı. Test kurulum kayıtları temizlendi. İmzalı otomatik güncelleme paketi veya GitHub yayını yapılmadı. Giriş yapılmış sunucular, gerçek konuşmacılar, gürültülü mikrofonlar, görüşme ve ekran paylaşımı için kabul testi ayrıca gerekir.


## 0.2.3 doğrulaması

- 46 Edge arayüz senaryosu: kesilen SVG logosu, Discord role=link ayar girişi, 56/30 px panel çerçevesi, hareket etmeyen sunucu ikonları, dijital saat, bağımsız sunucu kısayolları, tema vurguları, paylaşım iptali/önizleme/son onay ve akışın bırakılması, fotoğraf dönüşümleri, Sinema yerleşimi ve geri dönüşü, yerel kart ve yanlış kullanıcıya kart eklenmesini engelleme.
- 21 Node testi: native ses olayları, idempotans, odadan ayrılma ve kulaklık komutları, bozuk/kasıtlı kart verileri, gerçek SQLite üzerinde OAuth durum kontrolü, oturum özeti, sahibine bağlı yayınlama, Origin doğrulama, silme ve çıkış.
- 14 normal Rust testi: dosya kaynağı doğrulaması, imzalı ek parametrelerinin korunması, kaynak baytlarının yeniden kodlanmadan yazılması, yarım indirmede mevcut dosyanın korunması, ekosistem adresi, yeni komutlar ve önceki ses/izin/renk kontrolleri. İki donanım/kaynak testi varsayılan olarak ignored durumundadır; gerçek Vosk TR/EN sentetik tanıma testi ayrıca çalıştırıldı.
- Yeni Türkçe komutların kelimeleri gerçek Vosk sözlüğünde sorgulandı. `ayrıl` ve `kulaklığı` kelimeleri bulunmadığı için kullanıcıya sunulan ifadeler `odadan çık / ses kanalından çık`, `sesi tamamen kapat`, `sesi geri aç` olarak seçildi. Ayrılma için ortalama güven eşiği %95, her kelime için %90'dır. Tanınan metin hâlâ tam komutla eşleşmelidir.
- Cloudflare Worker gerçek yerel workerd ve D1 üzerinde açıldı. Migration, genel kart sorgusu, oturumsuz yayının reddi ve CSP altında ESM kart düzenleyicisi geçti; dış ağa istek çıkmadı. Wrangler dry-run dağıtılabilir paketi oluşturdu; uzak dağıtım yapılmadı.

Paylaşım otomasyonu sentetik canvas akışı kullanır; fiziksel ekran veya mikrofon yakalamaz. Yeni konuşma komutlarının farklı gerçek konuşmacılarla ve HDR yayının karşı alıcıyla doğrulaması ayrıca gerekir. HDR sorunu çözüldü sayılmadı: [inceleme kapsamı](SCREEN-SHARING.md).

Paketleme ve yükseltme deneyi aynı NSIS çalışma klasörünü kullanır; aynı anda çalıştırılmamalıdır. İlk paralel çalıştırma bu nedenle dosya kilidi/eksik include ile başarısız oldu; son kontroller sırayla çalıştırılır.


## 0.2.4 Sinema düzeltmesi

Önceki test yalnızca body altında basit bir video kapsayıcısı kullanıyordu; Discord'un iç içe çağrı katmanlarını ve alttaki gerçek kontrol alanının yerini kapsamıyordu. Yeni regresyonlar düzeltmeden önce iki ayrı hata verdi: Sinema girişi alt çağrı düğmelerine çakışıyordu; Sinema açılınca üst katmanların `transform` ve `contain` değerleri değişiyordu.

Yeni görüntüleyici Discord'un DOM yerleşimini değiştirmez. Üst çubuk girişi, ayrı HTML dialog, aynı canlı video izinin sessiz gösterimi, açık kaynak seçimi ve yalnızca kendisine ait tam ekran kullanılır. Eski genel `cinema-path`/`cinema-video` CSS müdahaleleri kaldırıldı. Eski dialogdan gecikerek gelen close olayının yeni açılan görüntüleyiciyi kapatması da engellendi.

53 Edge senaryosu ve 21 JavaScript testi geçti. Yeni Sinema senaryoları iç içe transform/paint/clip katmanları, kontrol çakışması, aynı video izinin korunması, ikinci ses izi oluşturulmaması, birden çok kaynak, art arda açma/kapatma, odak geri dönüşü, kaynak değişmesi/kapanması, küçük pencere, tam ekran, Sinema açıkken mikrofon komutu ve ayar kısayolunu kapsar. Gereksiz üst paylaşım kutusu, ona ait ayar ve akışın stop metoduna yapılan müdahale kaldırıldı.

Windows kontrolü fiziksel ekran/mikrofon açmadan, native WebView2 içinde sentetik canlı video ile aynı katman ve iz ömrünü ayrıca sınar. Canlı Discord görüşmesinde kişisel hesap veya başka kişilerin yayını üzerinde otomatik işlem yapılmaz.
