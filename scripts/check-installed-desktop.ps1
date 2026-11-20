$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$installers = @(Get-ChildItem (Join-Path $root 'dist') -File -Filter '*.exe')
if ($installers.Count -ne 1) { throw 'Expected one Windows x64 NSIS installer in dist' }

$dataDir = Join-Path $env:LOCALAPPDATA 'io.github.qiyuhuating.axiom'
if (Test-Path $dataDir) { throw "The app data directory already exists: $dataDir" }
$installDir = Join-Path $env:RUNNER_TEMP 'Axiom Installer Smoke'
$legacyPackage = Join-Path $installDir 'runtime/node_modules/node-pty'
$legacySource = Join-Path $installDir 'runtime/src/terminal.mjs'
New-Item -ItemType Directory -Path $legacyPackage, (Split-Path -Parent $legacySource) -Force | Out-Null
Set-Content (Join-Path $legacyPackage 'package.json') '{}'
Set-Content $legacySource '// Retired terminal module fixture'

$setup = Start-Process -FilePath $installers[0].FullName -ArgumentList "/S /D=$installDir" -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw "NSIS installer exited with code $($setup.ExitCode)" }
if ((Test-Path $legacyPackage) -or (Test-Path $legacySource)) {
    throw 'The installer left files from the legacy terminal backend'
}

$debugPort = 18764
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort --remote-debugging-address=127.0.0.1"
$desktop = Start-Process -FilePath (Join-Path $installDir 'axiom-desktop.exe') -PassThru
try {
    $logFile = Join-Path $dataDir 'desktop-host.log'
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $targetsUrl = "http://127.0.0.1:$debugPort/json/list"
    $baseUrl = $null
    do {
        if ($desktop.HasExited) { throw "Desktop exited with code $($desktop.ExitCode)" }
        if (Test-Path $logFile) {
            $ready = Select-String -LiteralPath $logFile -Pattern '^AXIOM_READY ([1-9][0-9]*)$' | Select-Object -Last 1
            if ($ready) {
                $baseUrl = "http://127.0.0.1:$($ready.Matches[0].Groups[1].Value)"
                try {
                    $targets = Invoke-RestMethod $targetsUrl -NoProxy -TimeoutSec 2
                } catch [System.Net.Http.HttpRequestException], [System.Threading.Tasks.TaskCanceledException] {
                    $targets = $null
                }
                if ($targets.url -contains "$baseUrl/") { break }
            }
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    if (!$baseUrl -or $targets.url -notcontains "$baseUrl/") { throw 'Installed WebView2 page did not start' }

    & node (Join-Path $PSScriptRoot 'check-installed-terminal.mjs') $debugPort $baseUrl
    if ($LASTEXITCODE -ne 0) { throw 'Installed WebView2 terminal smoke test failed' }

    Set-Content (Join-Path $dataDir 'workspace/axiom-fixture.txt') 'Axiom UI smoke fixture'
    & node (Join-Path $PSScriptRoot 'check-installed-appearance.mjs') $debugPort $baseUrl
    if ($LASTEXITCODE -ne 0) { throw 'Installed WebView2 appearance smoke test failed' }
} finally {
    if (!$desktop.HasExited) {
        if (!$desktop.CloseMainWindow() -or !$desktop.WaitForExit(10000)) { $desktop.Kill() }
    }
    if (Test-Path (Join-Path $dataDir 'desktop-host.log')) {
        Get-Content (Join-Path $dataDir 'desktop-host.log') -Tail 20
    }
}
