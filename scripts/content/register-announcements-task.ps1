#Requires -Version 7.0
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Register')]
param(
    [Parameter(ParameterSetName = 'Register')]
    [string]$RunnerPath = "$env:LOCALAPPDATA\DarkTide-Announcements\announcements-daily.ps1",
    [Parameter(ParameterSetName = 'Register')]
    [string]$RepoPath = 'F:\GitFile\Persion - Games\DarkTide-Web',
    [Parameter(ParameterSetName = 'Register')][switch]$InstallRunner,
    [Parameter(ParameterSetName = 'Register')][switch]$Force,
    [Parameter(Mandatory, ParameterSetName = 'Unregister')][switch]$Unregister
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$taskName = 'DarkTide-Announcements-Daily'
$taskPath = '\'
$existingTask = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue

if ($Unregister) {
    if ($existingTask -and $PSCmdlet.ShouldProcess($taskName, 'Unregister scheduled task')) {
        Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false
    }
    return
}

if ($existingTask -and -not $Force) { throw "Task '$taskName' already exists. Use -Force to update it." }
$RunnerPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($RunnerPath)
$operation = if ($InstallRunner) {
    "Install runner from origin/main at $RunnerPath and register daily scheduled task"
} else {
    "Register daily scheduled task with runner $RunnerPath"
}
if (-not $PSCmdlet.ShouldProcess($taskName, $operation)) { return }

if ($InstallRunner) {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $source = @(& git -C $RepoPath show 'origin/main:scripts/content/announcements-daily.ps1' 2>&1)
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "git show exited with code ${code}: $($source -join ' ')" }
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $RunnerPath) -Force
    Set-Content -LiteralPath $RunnerPath -Value $source -Encoding utf8
}
if (-not (Test-Path -LiteralPath $RunnerPath -PathType Leaf)) {
    throw "Runner not found at '$RunnerPath'. Use -InstallRunner or supply an existing -RunnerPath."
}

$pwsh = Join-Path $PSHOME 'pwsh.exe'
$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunnerPath`""
$at = [datetime]::Today.Add([TimeSpan]::ParseExact('19:30', 'hh\:mm', [Globalization.CultureInfo]::InvariantCulture))
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive
$null = Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force:$Force
Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Get-ScheduledTaskInfo
