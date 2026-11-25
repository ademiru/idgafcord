# Ekran paylaşımı ve görüntü araçları

idgafcord ekran paylaşımından önce boyut, 30/60 fps, kaynak sesi ve film/oyun–masaüstü/yazı tercihleri sunar. Kaynak seçimi WebView2'nin güvenli seçicisinde kalır. Gerçek `getDisplayMedia` çağrısı Kaynak seç düğmesinin tıklamasında yapılır; iptal etme yakalama başlatmaz. Seçimden sonra aynı akışın sessiz, canlı önizlemesi gösterilir; Paylaşımı başlat onayından önce akış Discord’a döndürülmez. Önizlemede vazgeçmek video/ses kanallarını kapatır. Video akışı yeniden canvas üzerinden örneklenmez veya ikinci kez kodlanmaz. `contentHint` yalnızca ekran videosuna uygulanır; mikrofon/kamera akışları değiştirilmez.

Gösterilen çözünürlük/fps, video kanalının `getSettings()` yakalama değerleridir. Bunlar gönderilen yayın çözünürlüğü/bit hızı garantisi değildir. Discord, hesap sınırları, bağlantı ve kodlayıcıya göre ayrıca ölçeklendirebilir. Ekran sesi, seçilen kaynak ve WebView2 desteğine bağlıdır.

0.2.4'te üstteki uygulamaya ait paylaşım/durdur kutusu kaldırıldı. Eski `ssControls` tercihi arayüzü geri getirmez. Paylaşımın normal kontrolleri Discord tarafından yönetilir. Başlatılan akışın `stop()` metodu artık değiştirilmez.

## HDR incelemesi: henüz kapanmamış konu

25 Kasım 2026'da yerel DxDiag çıktısı 2560×1440 ekranda `AdvancedColorEnabled` ve `DISPLAYCONFIG_ADVANCED_COLOR_MODE_HDR` bildirdi. WebView2 157/158 kurulumları mevcut. Kullanıcının paylaştığı görüntüde fazla parlaklık ve ayrıntı kaybı var; bu tek başına hangi aşamada kayıp oluştuğunu kanıtlamaz.

Gerçek bir HDR kaynak → yakalama → Discord gönderici → alıcı piksel karşılaştırması yapılmadığı için HDR renk sorunu **çözüldü olarak işaretlenmedi**. Windows HDR ayarı değiştirilmedi. Parlaklığı rastgele düşürme, sahte 1080p/60 etiketi veya etkisi doğrulanmamış GPU bayrakları eklenmedi. Görüntü rengi için WebView2/Windows yakalama dönüşümü, çözünürlük için kaynak ve Discord iletim aşamaları ayrı ölçülmelidir. Sonraki gerçek yayın denemesinde kaynak boyutu, yakalama değerleri, Discord yayın ayarı ve karşı taraftaki sonuç birlikte kaydedilmelidir.

WebView2'nin [ScreenCaptureStarting arayüzü](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2screencapturestartingeventargs) başlatmayı ertelemeye veya iptal etmeye izin verir; pencere/ekran listesini uygulamanın çizdiği bir listeyle değiştirmez. [WebRTC Windows yakalama kaynak kodu](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/desktop_capture/win/wgc_capture_session.cc) platformun renk dönüşümünün ayrı incelenmesi gereken yerdir.

## Sinema ve fotoğraf

Sinema girişi üst çubuktadır; alt çağrı düğmelerinin üzerine yerleştirilmez. Ayrı bir modal görüntüleyici, Discord’un mevcut canlı video izini kullanır. Yeni ekran yakalama veya ağ bağlantısı oluşturulmaz. Görüntüleyicide ses izi yoktur ve video sessizdir; asıl ses Discord'dan gelmeye devam eder. Kapatırken asıl video izi durdurulmaz.

Sığdır oranı korur, Doldur kenarları kırpabilir, Esnet oranı değiştirir. %100–200 yakınlaştırma ve %50–120 yerel parlaklık ayarı vardır. Birden çok görüntü varsa Görüntü → Görüntü kaynağı bölümünden seçim yapılır. Seçili kaynak kapanır, kaldırılır veya değiştirilirse Sinema kapanır. Tam ekran yalnızca uygulamanın kendi görüntüleyicisine uygulanır. Escape düzeni ve klavye odağını geri getirir. 0.2.3'teki eski yerleşim ayarları ilk geçişte Sığdır/%100 olarak sıfırlanır.

Önceki uygulama, videonun bütün üst öğelerinde transform/contain/overflow değerlerini sıfırlıyordu. Bu, Discord’un iç içe çağrı katmanlarının yerleşimini bozabiliyordu. 0.2.4, Discord düğümlerine görünüm niteliği veya stil yazmaz; HTML dialog üst katmanı kullanır.

Fotoğraf araçları mevcut görüntüleyicide yakınlaştırma, sürükleyerek gezinme, iki yöne döndürme, iki eksende çevirme, piksel görünümü, gerçek piksel boyutu ve sıfırlama sunar. Dosya değiştirilmez.

Orijinali indir, Discord eklerinde `media.discordapp.net` bağlantısını `cdn.discordapp.com` kaynak bağlantısına çevirir, yalnızca boyut/kalite/format parametrelerini kaldırır, gerekli imza parametrelerini korur. Native kaydetme penceresi açılır. İndirme 64 KB tamponla dosyaya akar, 100 MB ile sınırlıdır, yönlendirme izlemez, Discord çerezi/oturum anahtarı kullanmaz ve yeniden kodlama yapmaz. Tamamlanmadan hedef dosyanın üzerine yazılmaz. Harici/proxy görsellerde orijinal dosya doğrulanamadığı için bu düğme etkinleştirilmez.
