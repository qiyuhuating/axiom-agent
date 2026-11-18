param([switch]$SkipRuntimeDownload)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
if(-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64'){throw 'Desktop staging currently targets Windows x64'}
$stage=Join-Path $root '.desktop-runtime'
if(Test-Path $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Force $stage,(Join-Path $stage 'public'),(Join-Path $stage 'scripts')|Out-Null
foreach($path in 'src','vendor','package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md','axiom.config.example.json'){Copy-Item -LiteralPath (Join-Path $root $path) -Destination $stage -Recurse -Force}
foreach($path in 'app.js','index.html','style.css'){Copy-Item -LiteralPath (Join-Path $root "public/$path") -Destination (Join-Path $stage 'public')}
foreach($path in 'pi.mjs','runtime-stop.mjs'){Copy-Item -LiteralPath (Join-Path $root "scripts/$path") -Destination (Join-Path $stage 'scripts')}
node scripts/build-ui.mjs (Join-Path $stage 'public')
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
Push-Location $stage
try{npm ci --omit=dev --no-audit --no-fund;if($LASTEXITCODE -ne 0){throw 'Production dependency installation failed'}}finally{Pop-Location}
# The pinned node-pty release ships prebuilds for multiple targets.
# NSIS is x64-only here: retain native Win32 x64 runtime files; symbols
# and non-target binaries are not required for execution.
$ptyPrebuilds=Join-Path $stage 'node_modules/node-pty/prebuilds'
if(-not (Test-Path (Join-Path $ptyPrebuilds 'win32-x64'))){throw 'Expected node-pty x64 prebuild unavailable'}
Get-ChildItem $ptyPrebuilds -Directory | Where-Object Name -ne 'win32-x64' | Remove-Item -Recurse -Force
Get-ChildItem (Join-Path $ptyPrebuilds 'win32-x64') -Recurse -File -Filter '*.pdb' | Remove-Item -Force
# Node and the native npm CLI are required for Pi and its package installation.
# Only the runtime is installed; no Electron or build-only node_modules.
$v='24.16.0'
$zipName="node-v$v-win-x64.zip"
$cache=Join-Path $root '.desktop-cache'
New-Item -ItemType Directory -Force $cache|Out-Null
$zip=Join-Path $cache $zipName
$expected='edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56'
if(-not (Test-Path $zip)){
 if($SkipRuntimeDownload){throw 'Pinned Node distribution not cached'}
 Invoke-WebRequest "https://nodejs.org/dist/v$v/$zipName" -OutFile $zip
}
if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Node archive checksum mismatch'}
$unpack=Join-Path $cache "node-v$v-win-x64"
if(Test-Path $unpack){Remove-Item -LiteralPath $unpack -Recurse -Force}
Expand-Archive -LiteralPath $zip -DestinationPath $cache -Force
$bin=Join-Path $stage 'bin'
New-Item -ItemType Directory -Force $bin,(Join-Path $bin 'node_modules')|Out-Null
foreach($path in 'node.exe','npm.cmd','npx.cmd','LICENSE'){Copy-Item -LiteralPath (Join-Path $unpack $path) -Destination $bin}
Copy-Item -LiteralPath (Join-Path $unpack 'node_modules/npm') -Destination (Join-Path $bin 'node_modules/npm') -Recurse -Force
Write-Output ('Runtime payload: '+[Math]::Round((Get-ChildItem $stage -File -Recurse|Measure-Object Length -Sum).Sum/1MB,2)+' MiB (uncompressed)')
