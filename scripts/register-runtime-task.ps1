# Run explicitly when automatic startup on Windows login is desired.
param([switch]$Unregister)
$ErrorActionPreference='Stop'
$task='Axiom Agent Runtime'
if($Unregister){Unregister-ScheduledTask -TaskName $task -Confirm:$false; return}
$root=Split-Path $PSScriptRoot -Parent
$node=(Get-Command node.exe -ErrorAction Stop).Source
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$action=New-ScheduledTaskAction -Execute $node -Argument ('"'+(Join-Path $root 'src/runtime.mjs')+'"') -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Axiom Pi task and terminal runtime' -Force
