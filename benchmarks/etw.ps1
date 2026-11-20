param([string]$Output = "benchmarks/results")
$ErrorActionPreference = 'Stop'
$Output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
New-Item -ItemType Directory -Force $Output | Out-Null
$status = wpr -status | Out-String
if ($LASTEXITCODE -ne 0 -or $status -notmatch 'WPR is not recording') { throw 'WPR already recording or status unavailable; do not interrupt another trace' }
wpr -start CPU -filemode
if ($LASTEXITCODE -ne 0) { throw 'CPU ETW recording failed (run in an elevated PowerShell 7)' }
try {
  $env:AXIOM_BENCH_OUT = $Output
  node benchmarks/http.mjs --profile
  if ($LASTEXITCODE -ne 0) { throw 'Benchmark failed' }
} finally {
  wpr -stop (Join-Path $Output 'cpu.etl')
  if ($LASTEXITCODE -ne 0) { throw 'ETW stop failed' }
}
