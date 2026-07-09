#!/usr/bin/env bash
# idgafcord — yeni sürüm derleyip yayınlanacak dosyaları hazırlar.
#
# Kullanım:
#   1) src-tauri/tauri.conf.json içindeki "version" değerini artır (ör. 0.1.1).
#   2) ./make-release.sh
#   3) Çıktı klasöründeki dosyaları (setup.exe + portable.zip + latest.json) GitHub Release'e yükle.
#
# Not: İmzalama için özel anahtar gerekir. Anahtarın parolası yok.
set -euo pipefail
cd "$(dirname "$0")"

REPO="ademiru/idgafcord"
KEY="src-tauri/updater-private.key"
NSIS_DIR="src-tauri/target/release/bundle/nsis"
PORTABLE_DIR="src-tauri/target/release/bundle/portable"
RELEASE_EXE="src-tauri/target/release/lightweight-discord-client.exe"

if [ ! -f "$KEY" ]; then echo "HATA: $KEY bulunamadı (imza anahtarı)."; exit 1; fi

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

echo ">> Derleniyor (imzalı NSIS kurulumu)..."
npm run tauri build -- --bundles nsis

VER="$(node -p "require('./src-tauri/tauri.conf.json').version")"
SETUP="$(ls "$NSIS_DIR"/*-setup.exe | head -1)"
BASENAME="$(basename "$SETUP")"
SIG="$(cat "$SETUP.sig")"
PORTABLE_ZIP="$PORTABLE_DIR/idgafcord_${VER}_x64-portable.zip"

if [ ! -f "$RELEASE_EXE" ]; then
  echo "HATA: Portable exe bulunamadı: $RELEASE_EXE"
  exit 1
fi

echo ">> Portable zip hazırlanıyor..."
rm -rf "$PORTABLE_DIR"
mkdir -p "$PORTABLE_DIR/idgafcord"
cp "$RELEASE_EXE" "$PORTABLE_DIR/idgafcord/idgafcord.exe"
cat > "$PORTABLE_DIR/idgafcord/README.txt" <<EOF
idgafcord $VER portable

Kurulum gerektirmez. idgafcord.exe dosyasını çalıştır.
Otomatik güncelleme için imzalı setup sürümünü kullan.
EOF

if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command "\$ErrorActionPreference='Stop'; Compress-Archive -Path '$PORTABLE_DIR/idgafcord/*' -DestinationPath '$PORTABLE_ZIP' -Force" >/dev/null
elif command -v zip >/dev/null 2>&1; then
  (cd "$PORTABLE_DIR/idgafcord" && zip -qr "../$(basename "$PORTABLE_ZIP")" .)
else
  echo "HATA: Portable zip oluşturmak için powershell.exe veya zip gerekli."
  exit 1
fi

cat > "$NSIS_DIR/latest.json" <<EOF
{
  "version": "$VER",
  "notes": "idgafcord $VER",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "windows-x86_64": {
      "signature": "$SIG",
      "url": "https://github.com/$REPO/releases/download/v$VER/$BASENAME"
    }
  }
}
EOF

echo ""
echo ">> HAZIR. Şu dosyaları $REPO deposunda 'v$VER' etiketli bir Release'e yükle:"
echo "   1) $SETUP"
echo "   2) $PORTABLE_ZIP"
echo "   3) $NSIS_DIR/latest.json"
echo ""
echo "   Release etiketi TAM olarak: v$VER"
