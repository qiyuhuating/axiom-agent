$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
if(-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64'){throw 'Desktop staging currently targets Windows x64'}
$stage=Join-Path $root '.desktop-runtime'
if(Test-Path $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
New-Item -ItemType Directory -Force $stage,(Join-Path $stage 'public'),(Join-Path $stage 'scripts')|Out-Null
foreach($path in 'src','vendor-manifest.json','package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md','axiom.config.example.json'){Copy-Item -LiteralPath (Join-Path $root $path) -Destination $stage -Recurse -Force}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'vendor-manifest.json') | ConvertFrom-Json
foreach ($file in $manifest.runtimeFiles) {
    $relative = Join-Path 'vendor/dsh' $file
    $destination = Join-Path $stage $relative
    New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $destination
}
foreach($path in 'index.html','style.css'){Copy-Item -LiteralPath (Join-Path $root "public/$path") -Destination (Join-Path $stage 'public')}
foreach($path in 'pi.mjs','runtime-stop.mjs','desktop-node.ps1'){Copy-Item -LiteralPath (Join-Path $root "scripts/$path") -Destination (Join-Path $stage 'scripts')}
node scripts/build-ui.mjs (Join-Path $stage 'public')
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
Push-Location $stage
try{npm ci --omit=dev --no-audit --no-fund;if($LASTEXITCODE -ne 0){throw 'Production dependency installation failed'}}finally{Pop-Location}
if(Test-Path (Join-Path $stage 'node_modules/node-pty')){throw 'Legacy node-pty must not be included in the desktop payload'}
$bin=Join-Path $stage 'bin'
New-Item -ItemType Directory -Force $bin | Out-Null
# Ship the native PTY with the desktop runtime.
cargo build --release --locked --manifest-path (Join-Path $root 'daemon/Cargo.toml') --target-dir (Join-Path $root 'daemon/target')
if($LASTEXITCODE -ne 0){throw 'Rust daemon build failed'}
Copy-Item -LiteralPath (Join-Path $root 'daemon/target/release/axiom-daemon.exe') -Destination $bin
Write-Output ('Runtime payload: '+[Math]::Round((Get-ChildItem $stage -File -Recurse|Measure-Object Length -Sum).Sum/1MB,2)+' MiB (uncompressed)')
