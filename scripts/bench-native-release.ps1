param([string]$Baseline='3b643935b03be807654b05237d36768de20faf29', [int]$Records=400, [string[]]$Modes=@('A','B','B','A'))
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
$tmp=Join-Path $env:TEMP ('axiom-release-ab-'+[guid]::NewGuid().ToString('N'))
$data=Join-Path $env:LOCALAPPDATA 'io.github.qiyuhuating.axiom.pi-release-bench'
if(Test-Path $data){throw 'Isolated app data already exists'}
if(!$env:AXIOM_TEST_PLAYWRIGHT_MODULE){throw 'Set AXIOM_TEST_PLAYWRIGHT_MODULE'}
$release=Join-Path $root 'src-tauri/target/release/axiom-desktop.exe'
if(!(Test-Path $release) -or ![Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($release)).Contains('io.github.qiyuhuating.axiom.pi-release-bench')){
  throw 'Build the isolated release benchmark identifier first'
}
$old=Join-Path $tmp 'baseline'
$bundle=Join-Path $tmp 'bundle'
$fixture=Join-Path $tmp 'fixture'
$workspace=Join-Path $tmp 'workspace'
$desktop=$null
$junction=$null
$sharedLinks=@()
function FreePort {
  $l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
  try{$l.Start();$l.LocalEndpoint.Port}finally{$l.Stop()}
}
function CleanupRun {
  if($desktop -and !$desktop.HasExited){
    if(!$desktop.CloseMainWindow() -or !$desktop.WaitForExit(14000)){$desktop.Kill();$desktop.WaitForExit()}
  }
  $configFile=Join-Path $data 'axiom.config.json'
  $tokenFile=Join-Path $data 'sessions/runtime.token'
  if((Test-Path $configFile) -and (Test-Path $tokenFile)){
    $config=Get-Content $configFile -Raw|ConvertFrom-Json
    try{Invoke-RestMethod -Uri "http://127.0.0.1:$($config.runtimePort)/api/runtime-stop" -Method Post -Headers @{Authorization='Bearer '+(Get-Content $tokenFile -Raw)} -ContentType 'application/json' -Body '{}' -TimeoutSec 2 -NoProxy | Out-Null}catch{}
  }
  Start-Sleep -Milliseconds 600
  $owned=Get-CimInstance Win32_Process | Where-Object {($_.ExecutablePath -and $_.ExecutablePath.StartsWith($bundle+'\',[StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.Contains($data,[StringComparison]::OrdinalIgnoreCase))}
  foreach($proc in $owned){Stop-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue}
  for($i=0;$i -lt 8 -and (Test-Path $data);$i++){
    Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue
    if(Test-Path $data){Start-Sleep -Milliseconds 300}
  }
  if(Test-Path $data){throw 'Isolated profile cleanup failed'}
}
try {
  New-Item -ItemType Directory -Path $old,$bundle,$fixture,$workspace -Force | Out-Null
  $zip=Join-Path $tmp 'baseline.zip'
  git archive --format=zip -o $zip $Baseline
  if($LASTEXITCODE -ne 0){throw 'Baseline archive failed'}
  Expand-Archive -LiteralPath $zip -DestinationPath $old
  $junction=Join-Path $old 'node_modules'
  New-Item -ItemType Junction -Path $junction -Target (Join-Path $root 'node_modules') | Out-Null
  Push-Location $old
  try{node scripts/build-ui.mjs;if($LASTEXITCODE -ne 0){throw 'Baseline UI build failed'}}finally{Pop-Location}
  Copy-Item -LiteralPath (Join-Path $root 'src-tauri/target/release/axiom-desktop.exe') -Destination $bundle
  $staged=Join-Path $root 'src-tauri/target/release/runtime'
  $runtime=Join-Path $bundle 'runtime'
  New-Item -ItemType Directory -Path $runtime,(Join-Path $runtime 'bin'),(Join-Path $runtime 'src'),(Join-Path $runtime 'public') | Out-Null
  foreach($part in 'node_modules','vendor','bin/node_modules'){
    $target=Join-Path $staged $part
    $link=Join-Path $runtime $part
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    $sharedLinks+= $link
  }
  Get-ChildItem (Join-Path $staged 'bin') -File | Copy-Item -Destination (Join-Path $runtime 'bin')
  Get-ChildItem $staged -File | Copy-Item -Destination $runtime
  $exe=Join-Path $bundle 'axiom-desktop.exe'
  $runtime=Join-Path $bundle 'runtime'
  $env:AXIOM_BENCH_RECORDS=[string]$Records
  $env:AXIOM_BENCH_FIXTURE=$fixture
  $env:AXIOM_BENCH_WORKSPACE=$workspace
  node scripts/bench-native-fixture.mjs
  if($LASTEXITCODE -ne 0){throw 'Fixture creation failed'}
  foreach($mode in $Modes){
    $source=if($mode -eq 'A'){$old}else{$root}
    foreach($part in 'src','public'){
      $dest=Join-Path $runtime $part
      Remove-Item -LiteralPath $dest -Recurse -Force
      Copy-Item -LiteralPath (Join-Path $source $part) -Destination $dest -Recurse
    }
    Remove-Item -LiteralPath (Join-Path $runtime 'src/terminal.mjs') -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $data,(Join-Path $data 'sessions') | Out-Null
    Copy-Item -Path (Join-Path $fixture '*') -Destination (Join-Path $data 'sessions')
    $port=FreePort;$terminalPort=FreePort;$debugPort=FreePort
    @{workspace=$workspace;sessionDir=(Join-Path $data 'sessions');runtimePort=$port;nativeGateway=$true;terminalBackend='rust';rustTerminalPort=$terminalPort;discoverContext=$false} | ConvertTo-Json | Set-Content (Join-Path $data 'axiom.config.json') -Encoding utf8
    $env:PI_CODING_AGENT_DIR=Join-Path $data 'pi-agent'
    $env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $data 'webview'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$debugPort --remote-debugging-address=127.0.0.1"
    try {
      $desktop=Start-Process -FilePath $exe -PassThru
      $deadline=[DateTime]::UtcNow.AddSeconds(30)
      $baseUrl=$null;$targets=$null
      do {
        $desktop.Refresh()
        if($desktop.HasExited){throw "Benchmark desktop exited: $($desktop.ExitCode)"}
        $log=Join-Path $data 'desktop-host.log'
        if(Test-Path $log){
          $ready=Select-String -Path $log -Pattern '^AXIOM_READY ([1-9][0-9]*)$' | Select-Object -Last 1
          if($ready){
            $baseUrl="http://127.0.0.1:$($ready.Matches[0].Groups[1].Value)"
            try{$targets=Invoke-RestMethod "http://127.0.0.1:$debugPort/json/list" -NoProxy -TimeoutSec 1;if($targets.url -contains "$baseUrl/"){break}}catch{}
          }
        }
        Start-Sleep -Milliseconds 200
      }while([DateTime]::UtcNow -lt $deadline)
      if(!$baseUrl -or $targets.url -notcontains "$baseUrl/"){throw 'Release WebView2 target unavailable'}
      node scripts/bench-native-release.mjs $debugPort $baseUrl $mode $Records
      if($LASTEXITCODE -ne 0){throw 'Release benchmark failed'}
      $all=Get-CimInstance Win32_Process
      $parents=@($desktop.Id);$found=@($desktop.Id)
      while($parents.Count){$next=@($all|Where-Object {$_.ParentProcessId -in $parents});$parents=@($next|ForEach-Object ProcessId);$found+=$parents}
      $native=$all|Where-Object {$_.ProcessId -in $found -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($bundle+'\',[StringComparison]::OrdinalIgnoreCase)}
      $sum=($native|ForEach-Object {Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}|Measure-Object -Property PrivateMemorySize64 -Sum).Sum
      "PI_RELEASE_PRIVATE_BYTES $mode $sum"
    }finally{
      if(Test-Path (Join-Path $data 'desktop-host.log')){Get-Content (Join-Path $data 'desktop-host.log') -Tail 4}
      CleanupRun
    }
  }
} finally {
  if(Test-Path $data){CleanupRun}
  foreach($link in $sharedLinks){if(Test-Path $link){[IO.Directory]::Delete($link)}}
  if($junction -and (Test-Path $junction)){[IO.Directory]::Delete($junction)}
  if(Test-Path $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force}
}
