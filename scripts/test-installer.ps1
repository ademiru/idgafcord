$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + $env:PSModulePath
$projectRoot = Split-Path $PSScriptRoot -Parent
$oldVersion = '0.2.3'
$newVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($newVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid installer test version.' }
$generatedRoot = Join-Path $projectRoot 'src-tauri/target/release/nsis/x64'
$template = [IO.File]::ReadAllText((Join-Path $generatedRoot 'installer.nsi'))
if (-not $template.Contains('idgafcord: upgrades are handled')) { throw 'Run npm run build:setup first; the preserving template must be generated.' }
$testId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
$product = "idgafcord-upgrade-test-$testId"
$bundleId = "com.ademiru.idgafcord.upgrade-test.t$testId"
$testRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "src-tauri/target/installer-tests/$testId"))
$installRoot = Join-Path $testRoot 'installed'
$compiler = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
$registryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
$productKey = "HKCU:\Software\ademiru\$product"
$profiles = @((Join-Path $env:APPDATA $bundleId),(Join-Path $env:LOCALAPPDATA $bundleId))
if (Test-Path -LiteralPath $registryPath) { throw 'Test identity already exists; refusing to touch it.' }
New-Item -ItemType Directory -Force $testRoot | Out-Null

function Set-Define([string]$text,[string]$name,[string]$value) {
  $pattern = '(?m)^!define ' + [regex]::Escape($name) + ' "[^"\r\n]*"'
  if (-not [regex]::IsMatch($text,$pattern)) { throw "Missing NSIS define: $name" }
  [regex]::Replace($text,$pattern,([System.Text.RegularExpressions.MatchEvaluator]{param($m) '!define ' + $name + ' "' + $value + '"'}))
}
function Build-TestInstaller([string]$version,[bool]$oldResource) {
  $output = Join-Path $testRoot "$version-setup.exe"
  $sourceRoot = Join-Path $testRoot "$version-source"
  New-Item -ItemType Directory -Force $sourceRoot | Out-Null
  $fixtureSource = Join-Path $sourceRoot 'fixture.rs'
  $fixtureExe = Join-Path $sourceRoot 'lightweight-discord-client.exe'
  [IO.File]::WriteAllText($fixtureSource,('fn main() { std::hint::black_box("fixture-' + $version + '"); }'))
  & rustc --crate-name installer_fixture $fixtureSource -o $fixtureExe | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed.' }
  $text = Set-Define $template 'MAINBINARYSRCPATH' $fixtureExe
  foreach ($item in @(@('PRODUCTNAME',$product),@('BUNDLEID',$bundleId),@('VERSION',$version),@('VERSIONWITHBUILD',"$version.0"),@('STARTMENUFOLDER',$product),@('OUTFILE',$output))) {
    $text = Set-Define $text $item[0] $item[1]
  }
  if ($oldResource) {
    $oldFile = Join-Path $testRoot 'old-only.dat'
    [IO.File]::WriteAllText($oldFile,'old application resource')
    $resourcePosition = $text.IndexOf('  ; Copy main executable')
    if ($resourcePosition -lt 0) { throw 'Install resource seam was not found.' }
    $text = $text.Insert($resourcePosition,('  File /oname=old-only.dat "' + $oldFile + '"' + "`n"))
    $text = $text.Replace('Section Uninstall',('Section Uninstall' + "`n" + '  Delete "$INSTDIR\old-only.dat"'))
  }
  $script = Join-Path $generatedRoot "$product-$version.nsi"
  [IO.File]::WriteAllText($script,$text,[Text.UTF8Encoding]::new($false))
  Push-Location $generatedRoot
  try { & $compiler '/V2' $script | Out-Host; if ($LASTEXITCODE -ne 0) { throw "NSIS test compilation failed: $version" } }
  finally { Pop-Location }
  return $output
}
function Run-Installer([string]$path,[string[]]$arguments) {
  $process = Start-Process -FilePath $path -ArgumentList $arguments -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(120000)) { $process.Kill();throw 'Installer timed out.' }
  if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)" }
}
function Assert([bool]$condition,[string]$message) { if (-not $condition) { throw $message } }

$oldInstaller = Build-TestInstaller $oldVersion $true
$newInstaller = Build-TestInstaller $newVersion $false
$expectedExeHash = (Get-FileHash -LiteralPath (Join-Path $testRoot "$newVersion-source/lightweight-discord-client.exe") -Algorithm SHA256).Hash
$hashes = @{}
try {
  Run-Installer $oldInstaller @('/S','/NS',"/D=$installRoot")
  Assert ((Get-ItemProperty -LiteralPath $registryPath).DisplayVersion -eq $oldVersion) 'Old version registration missing.'
  Assert (Test-Path -LiteralPath (Join-Path $installRoot 'old-only.dat')) 'Old resource was not installed.'
  # Simulated session stores and settings. No real Discord account is opened.
  foreach ($profile in $profiles) {
    New-Item -ItemType Directory -Force (Join-Path $profile 'EBWebView/Default/Local Storage/leveldb') | Out-Null
    New-Item -ItemType Directory -Force (Join-Path $profile 'voice/tr') | Out-Null
    [IO.File]::WriteAllText((Join-Path $profile '.installer-test-owner'),$testId)
    foreach ($file in @('EBWebView/Default/Local Storage/leveldb/000001.ldb','settings.json','voice/tr/.verified')) {
      $path = Join-Path $profile $file
      [IO.File]::WriteAllText($path,"preserve-$testId-$file")
      $hashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    }
  }
  # Prove replacement rather than merely accepting the new registry version.
  Assert ((Get-FileHash -LiteralPath (Join-Path $installRoot 'lightweight-discord-client.exe') -Algorithm SHA256).Hash -ne $expectedExeHash) 'Fixture versions must have different executable bytes.'
  Run-Installer $newInstaller @('/S','/NS',"/D=$installRoot")
  Assert ((Get-ItemProperty -LiteralPath $registryPath).DisplayVersion -eq $newVersion) 'New version registration missing.'
  Assert (-not (Test-Path -LiteralPath (Join-Path $installRoot 'old-only.dat'))) 'Obsolete application resource was left behind.'
  Assert ((Get-FileHash -LiteralPath (Join-Path $installRoot 'lightweight-discord-client.exe') -Algorithm SHA256).Hash -eq $expectedExeHash) 'Executable was not replaced.'
  foreach ($path in $hashes.Keys) {
    Assert ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -eq $hashes[$path]) "Profile data changed: $path"
  }
  Write-Output "PASS: $oldVersion -> $newVersion; old files removed, new executable installed, session/settings/models preserved byte-for-byte."
} finally {
  $uninstaller = Join-Path $installRoot 'uninstall.exe'
  if (Test-Path -LiteralPath $uninstaller) { Run-Installer $uninstaller @('/S') }
  # Resolve and verify the exact test-owned targets before recursive cleanup.
  $workspaceTarget = [IO.Path]::GetFullPath((Join-Path $projectRoot 'src-tauri/target/installer-tests'))
  Assert ($testRoot.StartsWith($workspaceTarget + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) 'Unsafe test cleanup root.'
  foreach ($profile in $profiles) {
    $resolved = [IO.Path]::GetFullPath($profile)
    $owner = Join-Path $resolved '.installer-test-owner'
    if ((Test-Path -LiteralPath $owner) -and [IO.File]::ReadAllText($owner) -eq $testId -and $resolved.EndsWith([IO.Path]::DirectorySeparatorChar + $bundleId,[StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
  foreach ($key in @($registryPath,$productKey)) { if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force } }
}
