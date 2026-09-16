param([string]$Avd = 'Pixel_10a', [switch]$Headless)
. (Join-Path $PSScriptRoot 'android-env.ps1')
$projectAvds = Join-Path $prototypeRoot 'tmp\android-avd'
if (Test-Path (Join-Path $projectAvds "$Avd.ini")) { $env:ANDROID_AVD_HOME = $projectAvds }
# Keep the large emulator data image on the project drive, not the Windows drive.
$prototypeData = Join-Path $prototypeRoot 'tmp\pixel-data'
New-Item -ItemType Directory -Force $prototypeData | Out-Null
$prototypeArgs = @('-avd', $Avd, '-datadir', $prototypeData, '-data', (Join-Path $prototypeData 'userdata-qemu.img'), '-no-snapshot', '-gpu', 'swiftshader_indirect')
if ($Headless) { $prototypeArgs += '-no-window' }
& (Join-Path $env:ANDROID_HOME 'emulator\emulator.exe') @prototypeArgs
