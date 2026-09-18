# Register the daily catalogue backup with Windows Task Scheduler.
#
# The owner runs this once, on the machine the catalogue lives on. It is not run
# by an agent and it is not run by CI: it needs the live connection string, and
# nothing else in this repository is allowed to hold one.
#
# Task Scheduler rather than a long-running Node process because it survives a
# reboot, runs with no session logged in, and has `-StartWhenAvailable`, which
# runs a missed occurrence once the machine is back rather than skipping the day.
#
# The connections go in a file, encrypted with DPAPI for the account running
# this script, and the task's command line carries only the path. Windows Task
# Scheduler has no per-task environment block: an action is a command, arguments
# and a working directory, and a variable at a scope the scheduler can see is a
# variable in every process on the machine. The file is not per-task isolation
# either, since anything running as this account can read it if it knows the
# path; what it removes is the accident.
#
# `write-connection-file.ps1` beside this does the writing, so the connections
# can be rotated without re-registering a schedule. See docs/backup-runbook.md.

[CmdletBinding()]
param(
    # The live catalogue, read-only as far as this job is concerned.
    [Parameter(Mandatory = $true)][string] $Source,

    # MUST NOT be the live server: the verification creates a database, restores
    # into it and drops it.
    [Parameter(Mandatory = $true)][string] $Scratch,

    # Where dumps go. Put this on a different disk from the database if there is
    # one, and copy it off the machine. See docs/backup-runbook.md.
    [Parameter(Mandatory = $true)][string] $BackupDir,

    [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,

    [string] $At = '03:30',

    [int] $Keep = 14,
    [int] $MaxMb = 512,
    [int] $MinFreeMb = 1024,

    [string] $CoversSource = '',
    [string] $CoversDestination = '',

    # Under LOCALAPPDATA rather than in the repository or in BackupDir: the
    # repository is a place things get committed from, and BackupDir is the thing
    # that is supposed to be copied to another disk.
    [string] $ConnectionFile = (Join-Path $env:LOCALAPPDATA 'book-scan\backup-connections.json'),

    # Opt-in, because removing a persisted variable is not a thing to do to
    # somebody as a side effect of registering a task. Machine scope needs
    # elevation; User scope does not.
    [switch] $RemoveLegacyEnvironment,

    [string] $TaskName = 'book-scan catalogue backup'
)

$ErrorActionPreference = 'Stop'

if ($Source -eq $Scratch) {
    throw "The scratch server must not be the live catalogue. The verification creates and drops databases on it."
}

$runner = Join-Path $PSScriptRoot 'backup-catalogue.ps1'
if (-not (Test-Path $runner)) { throw "Cannot find $runner" }

$writer = Join-Path $PSScriptRoot 'write-connection-file.ps1'
if (-not (Test-Path $writer)) { throw "Cannot find $writer" }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# Written before the task is registered, so a machine that cannot store the
# secret does not end up with a schedule that will fail every night at 03:30.
$whoami = "$([Environment]::UserDomainName)\$([Environment]::UserName)"

& $writer -Source $Source -Scratch $Scratch -Path $ConnectionFile | Out-Null

$arguments = @(
    '-NoProfile'
    '-NonInteractive'
    '-ExecutionPolicy', 'Bypass'
    '-File', "`"$runner`""
    '-BackupDir', "`"$BackupDir`""
    '-RepoRoot', "`"$RepoRoot`""
    # A path, not a secret: this goes in the task definition and in every
    # process listing.
    '-ConnectionFile', "`"$ConnectionFile`""
    '-Keep', $Keep
    '-MaxMb', $MaxMb
    '-MinFreeMb', $MinFreeMb
)
if ($CoversSource) { $arguments += @('-CoversSource', "`"$CoversSource`"") }
if ($CoversDestination) { $arguments += @('-CoversDestination', "`"$CoversDestination`"") }

# PowerShell 7 when it is installed, Windows PowerShell otherwise. The wrapper
# runs on either.
$shell = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $shell) { $shell = 'powershell.exe' }

$action = New-ScheduledTaskAction `
    -Execute $shell `
    -Argument ($arguments -join ' ') `
    -WorkingDirectory $RepoRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $At

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Daily pg_dump of the book-scan catalogue, with retention and a verified restore into a scratch database. See docs/backup-runbook.md.' `
    -Force | Out-Null

# Both scopes, because these have been observed at either one.
$legacy = foreach ($name in 'BOOKSCAN_BACKUP_SOURCE', 'BOOKSCAN_BACKUP_SCRATCH') {
    foreach ($scope in 'Machine', 'User') {
        if ([Environment]::GetEnvironmentVariable($name, $scope)) {
            [pscustomobject]@{ Name = $name; Scope = $scope }
        }
    }
}

if ($legacy -and $RemoveLegacyEnvironment) {
    foreach ($item in $legacy) {
        # Machine scope is HKLM and needs elevation; User scope does not. Said
        # per variable, so a half-elevated run reports what it managed.
        try {
            [Environment]::SetEnvironmentVariable($item.Name, $null, $item.Scope)
            Write-Output "Removed $($item.Scope)-scope $($item.Name)."
        } catch {
            Write-Warning "Could not remove $($item.Scope)-scope $($item.Name): $($_.Exception.Message)"
            Write-Warning "Machine scope needs an elevated PowerShell."
        }
    }
    Write-Output "Open a new shell for that to be visible; existing processes keep the old block."
}

Write-Output "Registered '$TaskName', daily at $At, starting when available if the machine was off."
Write-Output "Backups go to $BackupDir, keeping $Keep dumps or ${MaxMb} MiB, whichever bites first."
Write-Output "The connections are in $ConnectionFile, encrypted for $whoami."
Write-Output "The task runs as $whoami, which is the only account that can decrypt it."
Write-Output ""

if ($legacy -and -not $RemoveLegacyEnvironment) {
    Write-Warning "Left over from an older version of this script, and still handing the live"
    Write-Warning "catalogue to every process that inherits them:"
    foreach ($item in $legacy) {
        Write-Warning "    $($item.Name) at $($item.Scope) scope"
    }
    Write-Warning "Remove them, then open a NEW shell to check. Machine scope needs elevation;"
    Write-Warning "User scope does not:"
    foreach ($item in $legacy) {
        Write-Warning "    [Environment]::SetEnvironmentVariable('$($item.Name)', `$null, '$($item.Scope)')"
    }
    Write-Warning "Nothing reads them any more, so removing them cannot break the schedule."
    Write-Warning "The stable server's launcher did read BOOKSCAN_BACKUP_SOURCE until #308, which"
    Write-Warning "is why they were still here. It reads the connection file now."
    Write-Output ""
}

Write-Output "Run it once now, and read what it prints, before trusting it:"
Write-Output "    Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "    Get-Content (Join-Path '$BackupDir' 'logs\backup-*.log') -Tail 40"
Write-Output ""
Write-Output "The cover photographs are NOT in the dump. See docs/backup-runbook.md."
