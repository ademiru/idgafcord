# idgafcord ekosistemi

Kart düzenleyicisi ve Cloudflare Workers/D1 modülü bu depodadır. Henüz herkese açık bir idgafcord sunucusu kurulmadı; varsayılan bağlantı boştur ve keşif kapalıdır. Bu durumda kartlar yalnızca yerelde saklanır.

## Ücretsiz başlangıç

Cloudflare Workers Free, günlük 100.000 istek; D1 Free, günlük 5 milyon satır okuma, 100.000 satır yazma ve toplam 5 GB depolama içerir. Cloudflare hesabındaki `workers.dev` adresiyle alan adı satın almadan başlanabilir. Bunlar sınırlı ücretsiz kotalardır. Büyük kullanım için kapasite, kötüye kullanım koruması ve yedekleme ayrıca değerlendirilmelidir.

Kaynaklar (25 Kasım 2026): [Workers fiyatlandırma](https://www.cloudflare.com/plans/developer-platform/), [D1 fiyatlandırma](https://developers.cloudflare.com/d1/platform/pricing/), [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Çalıştırma ve yayınlama

Cloudflare hesabı ve Discord Developer Portal uygulaması gerekir. Kullanıcı hesabının Discord oturum anahtarı veya bot tokeni gerekmez. Discord girişi sadece OAuth2 `identify` iznini kullanır: [resmî OAuth2 belgesi](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx).

1. `npm ci --prefix ecosystem` ve `npm run ecosystem:prepare` çalıştır.
2. `ecosystem/wrangler.example.jsonc` dosyasını aynı klasörde `wrangler.jsonc` olarak kopyala. Bu dosya Git tarafından yok sayılır. `send_metrics: false` CLI kullanım ölçümlerini kapatır.
3. `ecosystem` klasöründe `npx wrangler login` ile kendi Cloudflare hesabına giriş yap.
4. `npx wrangler d1 create idgafcord` ile veritabanı oluştur; dönen kimliği `d1_databases[0].database_id` alanına yaz.
5. Cloudflare hesabındaki alt alanına göre `vars.PUBLIC_ORIGIN` değerini ayarla: `https://idgafcord-ecosystem.HESABIN.workers.dev`. Sonda `/` kullanma. Discord uygulama kimliğini `DISCORD_CLIENT_ID` alanına yaz.
6. Discord uygulamasının OAuth2 yönlendirme adresine tam olarak `PUBLIC_ORIGIN/auth/callback` adresini ekle. Uygulamanın Client Secret değerini `npx wrangler secret put DISCORD_CLIENT_SECRET --config wrangler.jsonc` ile gizli olarak sakla. Anahtarı sohbete veya depoya yapıştırma.
7. `npx wrangler d1 migrations apply idgafcord --remote --config wrangler.jsonc`, ardından `npm run deploy` çalıştır. Bu iki komut uzak hesaba değişiklik yapar.
8. Adresin `/health` yanıtını kontrol et. idgafcord → Kartım bölümüne bu HTTPS `workers.dev` adresini yaz. Başkalarının kartlarını görmek için isteğe bağlı keşfi aç.

Yerel geliştirme için aynı ayar dosyasıyla `npm run dev`; yerel D1 tablolarını hazırlamak için `npx wrangler d1 migrations apply idgafcord --local --config wrangler.jsonc` kullanılabilir. Yerel denemede `PUBLIC_ORIGIN` değerini Wrangler'ın yerel adresiyle eşleştir. Gerçek OAuth2 için Discord'a kaydedilmiş yönlendirme adresiyle eşleşen HTTPS dağıtımını kullan. `.dev.vars` ve `.wrangler` dizinleri Git'e alınmaz.

Hesap olmadan derleme kontrolü: `npm run bundle:check --prefix ecosystem`. Bu komut dağıtım yapmaz.

## Kimlik ve veri akışı

Uygulamadaki kart taslağı, açık yayınlama isteğinde tarayıcıdaki ekosistem sayfasına URL parçasıyla (`#card=`) aktarılır; bu parça HTTP isteğiyle sunucuya gönderilmez. Tarayıcıda Discord girişi yapıldıktan sonra kullanıcı kartını ayrıca kaydeder. Sunucu, kartın sahibini OAuth2 ile belirler; gönderilen bir `user_id` alanına güvenmez.

Discord OAuth erişim/yenileme anahtarları saklanmaz. Tarayıcı için ayrı, rastgele bir ekosistem oturumu oluşturulur; veritabanında bu oturumun yalnızca SHA-256 özeti tutulur. Oturum çerezi HttpOnly, Secure ve SameSite=Lax'tır. Değişikliklerde Origin kontrolü yapılır. Kullanıcı kendi kartını yayından kaldırabilir veya çıkış yapabilir.

Masaüstü uygulaması profili açılan kişinin kimliğini, sadece kullanıcı keşfi açtıysa ve adres yapılandırıldıysa modüle iletir. Mesajlar, sunucu listeleri, ses ve Discord oturum anahtarları gönderilmez. Profil sorguları sınırlı boyuttadır, zaman aşımına sahiptir, yönlendirme izlemez ve çerez taşımaz. Yerel kart önbelleği en çok 128 kayıt/2 dakika tutar. Genel yanıtın tarayıcı önbelleği 30 saniyedir.

## Rozetlerin anlamı

**Ekosistem profili**, Discord kimliği doğrulanarak yayınlanmış bir karta işaret eder. Karttaki **idgafcord / Vencord / Vesktop / Equicord** alanı profil sahibinin beyanıdır. Bir kişinin şu anda hangi programı çalıştırdığı Discord'un normal profil verisinden güvenilir biçimde tespit edilemez. Görünmeyen bir kart, kişinin bu uygulamaları kullanmadığı anlamına gelmez. Nitro yetkileri taklit edilmez.

Kartlar HTML/CSS/JavaScript çalıştırmaz. Paylaşılan şema alanları, uzunlukları, renkleri, yazı tiplerini ve kaplamaları sınırlar. Önizleme ve sunucu aynı şemayı kullanır.
