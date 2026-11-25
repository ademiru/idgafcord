param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$assetRoot = Join-Path $projectRoot 'src-tauri/target/voice-test-assets'
$downloadRoot = Join-Path $projectRoot 'src-tauri/target/voice-downloads'
$fixtures = Join-Path $projectRoot 'src-tauri/target/voice-fixtures'
New-Item -ItemType Directory -Force $assetRoot,$downloadRoot,$fixtures | Out-Null
$packs = @(
  @('runtime','runtime','vosk-win64-0.3.45','https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-win64-0.3.45.zip','f1dcc9cca460630f81ea8f71794f69c80bed6556d2a4e6237b5785e1d2dff34b'),
  @('tr','tr','vosk-model-small-tr-0.3','https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip','8c8d07cec1bce31add14967c16891c84152cdf76d391e33c08278119b9ea96e5'),
  @('en','en','vosk-model-small-en-us-0.15','https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip','30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498')
)
foreach ($pack in $packs) {
  $zipPath = Join-Path $downloadRoot "$($pack[0]).zip"
  if (-not (Test-Path -LiteralPath $zipPath)) { Invoke-WebRequest $pack[3] -OutFile $zipPath }
  if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pack[4]) { throw "Hash mismatch: $($pack[0])" }
  $extract = Join-Path $downloadRoot $pack[0]
  if (-not (Test-Path -LiteralPath (Join-Path $extract $pack[2]))) { Expand-Archive -LiteralPath $zipPath -DestinationPath $extract -Force }
  $dest = Join-Path $assetRoot $pack[1]
  New-Item -ItemType Directory -Force $dest | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $extract $pack[2]) -Force | Copy-Item -Destination $dest -Recurse -Force
  Set-Content -LiteralPath (Join-Path $dest '.verified') -Value $pack[4] -NoNewline
}
# Offline Windows TTS creates synthetic fixtures; no live microphone is opened.
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $phrases = @{
    tr = @{ mute='mikrofonu kapat'; unmute='mikrofonu aç'; negative='mikrofonu kapatma'; conversation='bugün hava çok güzel' }
    en = @{ mute='mute me'; unmute='open mic'; negative='do not mute me'; conversation='the weather is nice today' }
  }
  foreach ($language in @('tr','en')) {
    $culture = if ($language -eq 'tr') { 'tr-TR' } else { 'en-US' }
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq $culture } | Select-Object -First 1
    if (-not $voice) { throw "Offline Windows TTS voice missing: $culture" }
    $synth.SelectVoice($voice.VoiceInfo.Name)
    foreach ($item in $phrases[$language].GetEnumerator()) {
      $stream = New-Object System.IO.MemoryStream
      $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
      $synth.SetOutputToAudioStream($stream,$format)
      $synth.Speak($item.Value)
      $audio = $stream.ToArray()
      [System.IO.File]::WriteAllBytes((Join-Path $fixtures "$language-$($item.Key).pcm"), $audio)
      $synth.SetOutputToNull();$stream.Dispose()
    }
  }
} finally { $synth.Dispose() }
$env:IDGAFCORD_VOICE_TEST_ROOT = $assetRoot
$env:IDGAFCORD_VOICE_FIXTURES = $fixtures
if (-not $PrepareOnly) {
  Push-Location (Join-Path $projectRoot 'src-tauri')
  try {
    cargo test --locked offline_synthetic_commands -- --ignored --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Offline speech regression failed.' }
  } finally { Pop-Location }
}
