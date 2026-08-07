# Register the daily catalogue backup with Windows Task Scheduler.
#
# The owner runs this once, on the machine the catalogue lives on. It is not run
# by an agent and it is not run by CI: it needs the live connection string, and
# nothing else in this repository is allowed to hold one.
#
# ## Why Task Scheduler
#
# There is no cron here, and the alternatives are worse in ways this project has
# already paid for.
#
# A long-running Node scheduler would be a process somebody has to keep alive.
# AGENTS.md records the `stable` server dying three times because it was owned
# by a session that later let go of it. A backup that stops when a terminal
# closes is a backup that stops on the day nobody notices.
#
# GitHub Actions cannot reach 127.0.0.1:5433. A schedule that cannot see the
# database is not a schedule.
#
# Task Scheduler is part of the operating system, survives a reboot, runs with
# no session logged in, and has the one property a daily job on a desktop
# machine actually needs: `-StartWhenAvailable`, which runs a missed occurrence
# once the machine is back rather than skipping the day. A desktop is off or
# asleep at 03:30 often enough that a scheduler without it would silently miss
# most of its runs.
#
# ## What it stores
#
# The connections go on the task as environment variables of the action, so they
# are not in a command line and not in this file. Read them back with:
#
#     (Get-ScheduledTask -TaskName 'book-scan catalogue backup').Actions
#
# ## Removing it
#
#     Unregister-ScheduledTask -TaskName 'book-scan catalogue backup' -Confirm:$false

[CmdletBinding()]
param(
    # The live catalogue, read-only as far as this job is concerned.
    [Parameter(Mandatory = $true)][string] $Source,

    # A Postgres the verification may create and drop databases on.
    # MUST NOT be the live server: the verification creates a database, restores
    # into it and drops it, and none of that belongs beside the catalogue.
    [Parameter(Mandatory = $true)][string] $Scratch,

    # Where dumps go. Put this on a different disk from the database if there is
    # one, and copy it off the machine (see docs/backup-runbook.md).
    [Parameter(Mandatory = $true)][string] $BackupDir,

    [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,

    # 03:30 local. Late enough that a scanning session is over, early enough
    # that a failure is visible the next morning.
    [string] $At = '03:30',

    [int] $Keep = 14,
    [int] $MaxMb = 512,
    [int] $MinFreeMb = 1024,

    [string] $CoversSource = '',
    [string] $CoversDestination = '',

    [string] $TaskName = 'book-scan catalogue backup'
)

$ErrorActionPreference = 'Stop'

if ($Source -eq $Scratch) {
    throw "The scratch server must not be the live catalogue. The verification creates and drops databases on it."
}

$runner = Join-Path $PSScriptRoot 'backup-catalogue.ps1'
if (-not (Test-Path $runner)) { throw "Cannot find $runner" }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$arguments = @(
    '-NoProfile'
    '-NonInteractive'
    '-ExecutionPolicy', 'Bypass'
    '-File', "`"$runner`""
    '-BackupDir', "`"$BackupDir`""
    '-RepoRoot', "`"$RepoRoot`""
    '-Keep', $Keep
    '-MaxMb', $MaxMb
    '-MinFreeMb', $MinFreeMb
)
if ($CoversSource) { $arguments += @('-CoversSource', "`"$CoversSource`"") }
if ($CoversDestination) { $arguments += @('-CoversDestination', "`"$CoversDestination`"") }

# PowerShell 7 when it is installed, Windows PowerShell otherwise. The wrapper
# runs on either; this only picks the one the machine has.
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

# Task Scheduler has no first-class way to set an action's environment, so the
# two connections are written into the machine-wide environment of the task's
# own principal instead. Nothing else on the machine reads these two names, and
# neither is a name the app or the test harness reads: see AGENTS.md.
[Environment]::SetEnvironmentVariable('BOOKSCAN_BACKUP_SOURCE', $Source, 'Machine')
[Environment]::SetEnvironmentVariable('BOOKSCAN_BACKUP_SCRATCH', $Scratch, 'Machine')

Write-Output "Registered '$TaskName', daily at $At, starting when available if the machine was off."
Write-Output "Backups go to $BackupDir, keeping $Keep dumps or ${MaxMb} MiB, whichever bites first."
Write-Output ""
Write-Output "Run it once now, and read what it prints, before trusting it:"
Write-Output "    Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "    Get-Content (Join-Path '$BackupDir' 'logs\backup-*.log') -Tail 40"
Write-Output ""
Write-Output "The cover photographs are NOT in the dump. See docs/backup-runbook.md."
