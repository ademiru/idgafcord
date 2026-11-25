$ErrorActionPreference = 'Stop'
# A Tauri build launched from PowerShell 7 can pass its module path to Windows PowerShell.
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + $env:PSModulePath
$projectRoot = Split-Path $PSScriptRoot -Parent
$cacheRoot = Join-Path $projectRoot 'src-tauri/target/voice-downloads'
$resourceRoot = Join-Path $projectRoot 'src-tauri/resources/voice'
New-Item -ItemType Directory -Force $cacheRoot,$resourceRoot | Out-Null
$packs = @(
  @('runtime','vosk-win64-0.3.45','https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-win64-0.3.45.zip','f1dcc9cca460630f81ea8f71794f69c80bed6556d2a4e6237b5785e1d2dff34b'),
  @('tr','vosk-model-small-tr-0.3','https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip','8c8d07cec1bce31add14967c16891c84152cdf76d391e33c08278119b9ea96e5'),
  @('en','vosk-model-small-en-us-0.15','https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip','30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498')
)
foreach ($pack in $packs) {
  $zipPath = Join-Path $cacheRoot "$($pack[0]).zip"
  if (-not (Test-Path -LiteralPath $zipPath)) { Invoke-WebRequest $pack[2] -OutFile $zipPath }
  if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pack[3]) { throw "Voice package hash mismatch: $($pack[0])" }
  $extractRoot = Join-Path $cacheRoot $pack[0]
  # Extract the verified archive each time: a stale extracted cache is not trusted.
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
  $source = Join-Path $extractRoot $pack[1]
  $destination = Join-Path $resourceRoot $pack[0]
  New-Item -ItemType Directory -Force $destination | Out-Null
  if ($pack[0] -eq 'runtime') {
    foreach ($dll in @('libvosk.dll','libgcc_s_seh-1.dll','libstdc++-6.dll','libwinpthread-1.dll')) { Copy-Item -LiteralPath (Join-Path $source $dll) -Destination $destination -Force }
  } else { Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force }
  [IO.File]::WriteAllText((Join-Path $destination '.verified'),$pack[3])
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets/voice/THIRD-PARTY-NOTICES.txt') -Destination $resourceRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets/voice/APACHE-2.0.txt') -Destination $resourceRoot -Force
foreach ($license in @('GPL-3.0.txt','GCC-RUNTIME-EXCEPTION.txt','WINPTHREADS-LICENSE.txt')) { Copy-Item -LiteralPath (Join-Path $projectRoot "assets/voice/$license") -Destination $resourceRoot -Force }
Write-Host 'Verified Turkish and English offline voice resources are ready.'
