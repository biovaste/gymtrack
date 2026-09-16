# Run from any directory. Localhost only; Android connects through adb reverse.
. (Join-Path $PSScriptRoot 'android-env.ps1')
$env:NODE_OPTIONS = '--dns-result-order=ipv4first'
$env:DOTSLASH_CACHE = Join-Path $env:TEMP 'dotslash'
& (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') reverse tcp:8081 tcp:8081
Push-Location (Split-Path -Parent $PSScriptRoot)
try { npx expo start --dev-client --localhost --port 8081 --max-workers 2 }
finally { Pop-Location }
