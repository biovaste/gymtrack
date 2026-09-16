# Local emulator acceptance build. Uses the generated debug signing key, not store signing.
. (Join-Path $PSScriptRoot 'android-env.ps1')
$env:NODE_ENV = 'production'
Push-Location (Join-Path (Split-Path -Parent $PSScriptRoot) 'android')
try {
  & .\gradlew.bat :app:assembleRelease '-PreactNativeArchitectures=x86_64' --max-workers=2 --console=plain
  if ($LASTEXITCODE -ne 0) { throw 'Release-mode acceptance build failed.' }
} finally { Pop-Location }
