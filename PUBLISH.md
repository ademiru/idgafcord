# idgafcord — Yayınlama & Güncelleme Rehberi

## Standart Windows setup

```powershell
npm run version:set -- 0.2.4
npm run build:setup
```

Çıktı: `src-tauri/target/release/bundle/nsis/idgafcord_<versiyon>_x64-setup.exe`.

Yeni setup eski sürümü aynı konumdan `/UPDATE /S` ile kaldırıp yeni program dosyalarını kurar. Discord'un kullanıcı veri klasörleri, ayarlar ve eski indirilen ses modelleri korunur. Kurulumla gelen `voice/` program kaynakları yeni sürümle değiştirilir. Uygulama kimliği `com.ademiru.idgafcord`, ürün adı ve ana exe adı değiştirilmemelidir. Kurulum yolu sürüm numarası içermez.

`scripts/test-installer.ps1`, ayrı bir test kimliğiyle 0.2.3 → package.json sürümü yükseltmesini gerçek NSIS kurulumları üzerinden sınar. Eski kaynak dosyasının silinmesini, farklı exe'nin yüklenmesini ve temsili oturum/ayar/model verilerinin hash'lerinin korunmasını doğrular. Gerçek kullanıcı hesabı kullanılmaz.

Bu komut özel anahtar gerektirmeyen normal setup üretir. Arka planda imzalı otomatik güncelleme yayını için aşağıdaki özel anahtarlı release akışı kullanılır. Windows yayıncı imzası ve Tauri güncelleme imzası ayrı işlemlerdir.

Uygulama, GitHub Releases üzerinden otomatik güncellenir. Güncelleme adresi
uygulamaya gömülüdür:

```
https://github.com/ademiru/idgafcord/releases/latest/download/latest.json
```

Uygulama, **tepsi menüsü → "Güncellemeleri otomatik denetle"** seçeneği açıkken
başlangıçta ve 6 saatte bir kontrol eder; yeni sürüm varsa indirir, kurar ve
yeniden başlatır. Aynı menüdeki **"Güncellemeleri denetle"** komutu manuel
kontrol için durur.

---

## İmza anahtarı olmadan ön sürüm

Normal setup, GitHub Releases üzerinde `--prerelease --latest=false` ile yayınlanabilir. Bu durumda kurulum elle indirilir; `latest.json` üretilmez ve mevcut imzalı otomatik güncelleme kanalı değiştirilmez. Özel anahtar olmadan sahte veya boş imzalı güncelleme manifesti yükleme.

## Tek seferlik kurulum (GitHub deposu)

1. https://github.com/new adresinden **idgafcord** adlı bir depo aç (public).
2. **`src-tauri/updater-private.key` dosyasını GİZLİ tut** — commit ETME, kimseyle
   paylaşma. Bu anahtar olmadan güncelleme yayınlayamazsın. (`.gitignore`'da.)

## Arkadaşına gönderme (ilk kurulum)

Derlenen kurulum dosyası:

```
src-tauri/target/release/bundle/nsis/idgafcord_0.1.0_x64-setup.exe
```

Bu dosyayı arkadaşına gönder. Çift tıklayıp kurar. (Windows "bilinmeyen yayıncı"
uyarısı verebilir → "Yine de çalıştır". İmzalı bir kod-imzalama sertifikan
olmadığı için normal.)

Kurulum istemeyenler için portable paket de üretilir:

```
src-tauri/target/release/bundle/portable/idgafcord_0.1.0_x64-portable.zip
```

Portable pakette `idgafcord.exe` doğrudan çalışır. Otomatik güncelleme akışı
imzalı setup dosyasını kullanır; portable zip elle indirme alternatifi olarak
Release assets içinde durur.

---

## Yeni sürüm yayınlama (güncelleme çıkarma)

Her yeni sürümde:

1. `npm run version:set -- 0.2.1` çalıştır. Bu komut npm, Cargo, iki kilit dosyası ve Tauri sürümlerini birlikte günceller. Panel sürümü Cargo'dan otomatik gelir.
2. Proje kökünde çalıştır:
   ```powershell
   .\make-release.ps1
   ```
   Bu, imzalı kurulumu derler ve `latest.json` üretir. Sonda hangi dosyaları
   yükleyeceğini yazar.
3. GitHub'da **Releases → Draft a new release**:
   - **Tag**: `v0.1.1` (versiyonla aynı, başında `v`)
   - Aşağıdaki üç dosyayı **assets** olarak yükle:
     - `idgafcord_0.1.1_x64-setup.exe`
     - `idgafcord_0.1.1_x64-portable.zip`
     - `latest.json`
   - **Publish release**.
4. Bitti. Otomatik kontrol açık kullanıcılar yeni sürümü arka planda alır;
   isteyen kullanıcılar "Güncellemeleri denetle" komutuyla elle de kontrol eder.

> Neden `latest.json`? Uygulama önce bu dosyayı okur; içinde en yeni sürüm
> numarası, imza ve kurulum dosyasının indirme linki vardır. `latest.json`'daki
> `url` alanı, o release'e yüklediğin setup.exe'yi göstermelidir — `make-release.sh`
> bunu otomatik doğru üretir (tag `v<versiyon>` olduğu sürece).

## Elle latest.json (script kullanmadan)

`make-release.sh` çalışmazsa, `..._x64-setup.exe.sig` dosyasının içeriğini alıp
şöyle bir `latest.json` yaz:

```json
{
  "version": "0.1.1",
  "notes": "idgafcord 0.1.1",
  "pub_date": "2026-01-01T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<.sig dosyasının içeriği>",
      "url": "https://github.com/ademiru/idgafcord/releases/download/v0.1.1/idgafcord_0.1.1_x64-setup.exe"
    }
  }
}
```

## Anahtarı kaybedersen

`updater-private.key` kaybolursa artık mevcut kullanıcılara güncelleme
gönderemezsin (imza tutmaz). Yeni anahtar üretip (`npm run tauri signer generate`)
`tauri.conf.json > plugins.updater.pubkey` değerini güncellersin, ama eski
sürümdeki kullanıcılar elle yeni kurulumu indirmek zorunda kalır. Yani **anahtarı
sakla.**
