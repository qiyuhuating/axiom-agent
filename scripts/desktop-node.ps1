param([Parameter(Mandatory)][string]$DataDir)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Test-Node([string]$Exe) {
    if (!(Test-Path -LiteralPath $Exe -PathType Leaf)) { return $false }
    $bin = Split-Path -Parent $Exe
    if (!(Test-Path -LiteralPath (Join-Path $bin 'npm.cmd') -PathType Leaf) -or
        !(Test-Path -LiteralPath (Join-Path $bin 'node_modules/npm/bin/npm-cli.js') -PathType Leaf)) { return $false }
    $version = & $Exe -p "process.versions.node + '/' + process.arch" 2>$null
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^(\d+)\.(\d+)\.(\d+)/x64$') { return $false }
    return [int]$Matches[1] -eq 24 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 19)
}

foreach ($candidate in @(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue)) {
    if (Test-Node $candidate.Source) { Write-Output $candidate.Source; return }
}

$version = '24.16.0'
$archiveName = "node-v$version-win-x64"
$cache = Join-Path $DataDir 'runtime-cache'
$runtime = Join-Path $cache $archiveName
$node = Join-Path $runtime 'node.exe'
if (Test-Node $node) { Write-Output $node; return }
if (Test-Path -LiteralPath $runtime) { throw "Incomplete cached Node runtime at $runtime" }
$tmp = Join-Path $cache ([guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $tmp -Force
try {
    $zip = Join-Path $tmp 'node.zip'
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$version/$archiveName.zip" -OutFile $zip -TimeoutSec 120
    $expected = 'edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56'
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected) { throw 'Portable Node archive checksum mismatch' }
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp
    $staged = Join-Path $tmp $archiveName
    if (!(Test-Node (Join-Path $staged 'node.exe'))) { throw 'Invalid portable Node distribution' }
    try { [IO.Directory]::Move($staged, $runtime) }
    catch [IO.IOException] { if (!(Test-Node $node)) { throw } }
    Write-Output $node
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force
}
