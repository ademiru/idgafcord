param(
  [string]$Repo = "ademiru/idgafcord"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$key = "src-tauri/updater-private.key"
$nsisDir = "src-tauri/target/release/bundle/nsis"
$portableDir = "src-tauri/target/release/bundle/portable"
$releaseExe = "src-tauri/target/release/lightweight-discord-client.exe"

if (-not (Test-Path $key)) {
  throw "HATA: $key bulunamadi (imza anahtari)."
}

$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

Write-Host ">> Derleniyor (imzali NSIS kurulumu)..."
npm run tauri build -- --bundles nsis

$conf = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$ver = $conf.version
$setup = Get-ChildItem $nsisDir -Filter "*-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) {
  throw "HATA: Setup exe bulunamadi: $nsisDir"
}

$sigPath = "$($setup.FullName).sig"
if (-not (Test-Path $sigPath)) {
  throw "HATA: Imza dosyasi bulunamadi: $sigPath"
}

if (-not (Test-Path $releaseExe)) {
  throw "HATA: Portable exe bulunamadi: $releaseExe"
}

Write-Host ">> Portable zip hazirlaniyor..."
Remove-Item $portableDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$portableDir/idgafcord" | Out-Null
Copy-Item $releaseExe "$portableDir/idgafcord/idgafcord.exe" -Force
New-Item -ItemType File -Force "$portableDir/idgafcord/portable.flag" | Out-Null
@"
idgafcord $ver portable

Kurulum gerektirmez. idgafcord.exe dosyasini calistir.
Ayarlari bu klasorun icindeki data klasorunde saklar.
Otomatik guncelleme icin imzali setup surumunu kullan.
"@ | Set-Content "$portableDir/idgafcord/README.txt" -Encoding UTF8

$portableZip = "$portableDir/idgafcord_${ver}_x64-portable.zip"
Compress-Archive -Path "$portableDir/idgafcord/*" -DestinationPath $portableZip -Force

$latest = [ordered]@{
  version = $ver
  notes = "idgafcord $ver"
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content $sigPath -Raw).Trim()
      url = "https://github.com/$Repo/releases/download/v$ver/$($setup.Name)"
    }
  }
}

$latest | ConvertTo-Json -Depth 8 | Set-Content "$nsisDir/latest.json" -Encoding UTF8

Write-Host ""
Write-Host ">> HAZIR. Su dosyalari $Repo deposunda 'v$ver' etiketli bir Release'e yukle:"
Write-Host "   1) $($setup.FullName)"
Write-Host "   2) $((Resolve-Path $portableZip).Path)"
Write-Host "   3) $((Resolve-Path "$nsisDir/latest.json").Path)"
Write-Host ""
Write-Host "   Release etiketi TAM olarak: v$ver"
