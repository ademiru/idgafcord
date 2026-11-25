# Windows yükseltmesi

`installer.nsi`, Tauri CLI 2.11.4'ün [resmî NSIS şablonudur](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi). Kaynak MIT / Apache-2.0 lisanslıdır. CLI sürümü bu şablonla birlikte sabitlenir; CLI yükseltilirken şablon farkı da gözden geçirilmelidir.

Yerel değişiklikler: yeni sürüm algılandığında normal kaldırma sayfası gösterilmez; kurulum dizini korunur; eski sürüm `hooks.nsh` içinden `/UPDATE /S` ile kaldırılır. Bu kip kullanıcı verilerini ve otomatik başlatma kaydını korur. Ardından aynı dizine yeni dosyalar kurulur. Eski sürüme dönme engellenir.

Kimlik `com.ademiru.idgafcord`, ürün adı `idgafcord` ve ana exe adı sabit kalmalıdır. Sürüm numarası kullanıcı veri yoluna eklenmez. Güncelleme sırasında `/DELETEAPPDATA` kullanılmaz. Normal, kullanıcı tarafından başlatılan kaldırma işlemindeki veri silme seçeneği ayrı kalır.

`npm run build:setup` normal setup üretir. İmzalı otomatik güncelleme paketi için mevcut özel anahtarla `make-release.ps1` kullanılır; bu yol `createUpdaterArtifacts` ayarını ayrıca açar. Özel anahtar depoda bulunmaz.
