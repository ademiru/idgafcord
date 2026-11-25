# Gece Frutiger Aero: IDGAFCORD görsel referansları

İnceleme tarihi: 25 Kasım 2026. Kaynak tabanı Microsoft'un tarihsel Windows Vista/7 Aero tasarım rehberidir; bunlar güncel Windows tasarım kuralları olarak sunulmaz. Aşağıdaki renkler ve Discord'a uyarlama kararları projeye özel tasarım önerileridir, Microsoft'un belirlediği palet değildir.

## 1. Cam, sohbetin önüne geçmemeli

Microsoft camı pencere çerçevesine komşu, yazı taşımayan küçük bölgelerde seçici kullanmayı öneriyor. Güçlü gölgeler de yalnızca önemli nesnelere ayrılıyor. IDGAFCORD'da cam hissi üst çerçeve, başlık kenarı ve aktif küçük kontrollerle kurulmalı; her mesajı/kategoriyi parlak kutuya çevirmemeli. Üst-alt cyan şeritler ve içerikten bağımsız yüzen kapsül kaldırılmalı. Bunlar kullanıcı isteğinin ve kaynak ilkesinin projeye uyarlanmasıdır. [Microsoft: Graphic Elements](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-graphic)

## 2. Gece paleti: koyu mürekkep, ölçülü camgöbeği

Tarihsel rehber çerçevelerde cam/siyah/gri/beyazı nötr kabul ediyor; doygun renkleri anlam taşıyan durumlarla ilişkilendiriyor. Önerilen temel: gece `#061321`, yüzey `#0B2234`, yükseltilmiş panel `#102A3C`, yazı `#E3EDF5`, ikincil yazı `#9FB5C7`, vurgu `#68BFD5`. Vurgu, seçili kanal ve odak çizgisi gibi küçük alanlarda kullanılmalı; kaydırma/okunmamış kapsayıcısının tamamını boyamamalı. Açık tema da aynı anlamsal değişkenlerden türetilmeli. [Microsoft: Color](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-color)

## 3. Şehir arka planı, içerik alanını rahat bırakmalı

Öneri: koyu lacivert gökyüzü, su yansımaları, az miktarda yeşil, cam bina cepheleri; ışıklı şehir ayrıntıları kenarlarda ve alt ufukta. Sohbetin orta bölgesi düşük ayrıntılı ve koyu olmalı. Dolu metin yüzeyleri yüksek opaklıkta tutulmalı; tek ince üst kenar yansıması yeterli. Duvar kâğıdına yazı, logo, arayüz veya sahte buton gömülmemeli. Bu kompozisyon kararı, kaynak rehberin arka planların içerikle rekabet etmemesi ve gradient boyunca okunurluk ilkesinden çıkarılmıştır. [Microsoft: Graphic Elements](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-graphic)

## 4. Büyük logo ile küçük araç ikonları farklı işlenmeli

Aero ikonları nesne hissi ve gerçekçi malzeme kullanır; fotoğraf kopyası değildir. Ancak küçük araç ikonları önden, az ayrıntılı ve perspektifsizdir; 24 px ve altında ikon gölgesi önerilmez. IDGAFCORD logosunda cam/metal derinliği kullanılabilir; mikrofon, ayar, tema ve kapatma ikonları 16/20/24 px'de anlaşılır kalmalı. Işık yönü tüm sette yukarıdan ve hafif soldan gelmeli. Sunucu/kullanıcı avatarlarına zorunlu bevel veya parlak kaplama eklenmemeli. [Microsoft: Icons](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-icons)

Doğrudan birinci taraf görsel örnekleri: [Vista kilit ve anahtar](https://learn.microsoft.com/en-us/windows/win32/uxguide/images/vis-icons-image1.png), [büyük/küçük ikon karşılaştırması](https://learn.microsoft.com/en-us/windows/win32/uxguide/images/vis-icons-image9.png), [Photo Gallery cam kontrol alanı](https://learn.microsoft.com/en-us/windows/win32/uxguide/images/vis-graphic-image7.png). Bunlar referanstır; projeye ait özgün varlıkların yerine kopyalanmamalıdır.

## 5. Tema, etkileşim katmanını bozmamalı

Öneri: dekoratif duvar kâğıdı ve parlama katmanları `pointer-events: none` ile içerik altında kalmalı; profil kartları, menüler ve modal katmanlarının sırası korunmalı. Kanal/kişi satırları büyük yuvarlak pazarlama kartlarına dönüşmemeli. Ayarlar, görünür başlık ve doğal bölüm hiyerarşisiyle düzenlenmeli. Bunlar uygulamaya özgü mühendislik kararlarıdır; tarihsel Aero'nun görsel ilişki/hiyerarşi amacını destekler. [Microsoft: Visuals](https://learn.microsoft.com/en-us/windows/win32/uxguide/visuals)

## 6. Kontrast gerçek birleşik yüzeyde ölçülmeli

Normal metin için en az 4,5:1, büyük metin için 3:1; gerekli kontrol/odak işaretlerinde komşu renge karşı 3:1 hedeflenmeli. Şeffaf panel testi düz renk üzerinde değil, şehir görselinin en aydınlık bölgesiyle birlikte yapılmalı. Hata, mikrofon ve bağlantı durumları yalnız renk ile anlatılmamalı; ikon/etiket de bulunmalı. [W3C: Metin kontrastı](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C: Metin dışı kontrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [Microsoft: Color](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-color)

## 7. Açılış hızlı, hareket kısa olmalı

Microsoft sık işlemlerde yaklaşık 100 ms, diğer kısa geçişlerde 200 ms altını; kullanıcı etkileşiminin animasyonu beklememesini öneriyor. IDGAFCORD için yerel statik şehir görseli, 100–180 ms opacity/transform geçişleri ve azaltılmış hareket tercihi uygundur. Sürekli partikül, su animasyonu, bütün pencereyi tekrar tekrar bulanıklaştıran/paralaks katmanları kullanılmamalı. Açılış yüzeyi derhal tema renginde görünmeli; animasyon uygulamanın hazır olmasını geciktirmemeli. Performans kazancı ölçümle doğrulanmalıdır. [Microsoft: Animations and Transitions](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-animations)
