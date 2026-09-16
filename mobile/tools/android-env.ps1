# Dot-source before Android builds. Changes only this shell's environment.
$prototypeRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$localJdk = Get-ChildItem -LiteralPath (Join-Path $prototypeRoot 'tmp\jdk17') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$prototypeJava = if ($localJdk) { $localJdk } else { $env:JAVA_HOME }
if (-not $prototypeJava -or -not (Test-Path (Join-Path $prototypeJava 'bin\java.exe'))) {
  throw 'Install JDK 17 and set JAVA_HOME, or restore the local tmp/jdk17 toolchain.'
}
$javaVersion = & (Join-Path $prototypeJava 'bin\java.exe') -version 2>&1 | Out-String
if ($javaVersion -notmatch 'version "17\.') { throw 'This prototype build requires JDK 17. Set JAVA_HOME to a JDK 17 installation.' }
$env:JAVA_HOME = $prototypeJava
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
$env:TEMP = Join-Path $prototypeRoot 'tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
