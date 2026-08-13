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
# ## Where it puts the connections
#
# In a file, encrypted with DPAPI for the account running this script, at
# -ConnectionFile. The task's command line carries the *path*, which is
# harmless to have in a process listing, and backup-catalogue.ps1 decrypts it
# and hands the connections to the one child process that needs them.
#
# The writing is `write-connection-file.ps1` beside this, not code in here, so
# that the connections can be rotated without re-registering a schedule and so
# that the stable server's launcher has somewhere to get the same connection
# from without inventing a second store. See #308.
#
# ### What this used to do, and why it is not that
#
# Windows Task Scheduler has no per-task environment block. An action is a
# command, arguments and a working directory, and there is nowhere on a task to
# hang a variable that only that task sees. This script used to answer that by
# writing the two connections to `Machine` scope, which reads like "the task's
# environment" and is not: it is every process on the machine. A live catalogue
# connection string, password and all, was in every shell and every agent
# session on the box, and `npx tsx server/backup-catalogue.ts` with no arguments
# opened the live catalogue. That is #215.
#
# The honest statement of what a DPAPI file buys, since it is not "only the task
# can read it": anything running as this user can read the file if it knows the
# path and chooses to. What it removes is the *accident*. A machine variable is
# inherited by everything with no action taken and no path known; a file has to
# be found and opened on purpose. Literal per-task isolation on Windows needs a
# separate service account for the task, with the file encrypted under that
# account, which is a bigger change to the machine than this problem is worth.
#
# ## Removing it
#
#     Unregister-ScheduledTask -TaskName 'book-scan catalogue backup' -Confirm:$false
#     Remove-Item <the -ConnectionFile path>
#
# Note the second line takes the stable server's connection with it, since #308
# gave that launcher the same file to read. Unregistering the backup task on its
# own does not.
#
# And, once, the two variables the old version of this script persisted. It
# wrote them at Machine scope; on the owner's machine they are at User scope,
# so look in both. User needs no elevation, Machine does:
#
#     foreach ($n in 'BOOKSCAN_BACKUP_SOURCE','BOOKSCAN_BACKUP_SCRATCH') {
#       foreach ($s in 'Machine','User') {
#         [Environment]::SetEnvironmentVariable($n, $null, $s)
#       }
#     }
#
# or pass -RemoveLegacyEnvironment to this script, which does both scopes and
# says which ones it managed.

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

    # Where the two connections are written, encrypted with DPAPI for this
    # account. Under LOCALAPPDATA rather than in the repository or in BackupDir:
    # the repository is a place things get committed from, and BackupDir is the
    # thing that is supposed to be copied to another disk.
    [string] $ConnectionFile = (Join-Path $env:LOCALAPPDATA 'book-scan\backup-connections.json'),

    # Delete the BOOKSCAN_BACKUP_SOURCE and BOOKSCAN_BACKUP_SCRATCH variables an
    # older version of this script persisted, in whichever of User and Machine
    # scope they are in. Off by default and opt-in, because removing a persisted
    # variable is not a thing to do to somebody as a side effect of registering
    # a task. Machine scope needs elevation; User scope does not.
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

# --- the connections, encrypted for this account ---------------------------

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
    # A path, not a secret. This is the whole reason the connections are in a
    # file: what goes in the task definition and every process listing is
    # something it costs nothing to show.
    '-ConnectionFile', "`"$ConnectionFile`""
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

# --- the variables the old version of this script left behind --------------

# Both scopes, because the observed state does not match what the old code did.
# It called SetEnvironmentVariable with 'Machine', and on the owner's machine
# the two names are at 'User'. Whichever way that happened, "still in every
# process this account starts" is the same problem, so look in both places
# rather than in the one the code says.
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
        # per variable rather than assumed, so a half-elevated run reports what
        # it actually managed.
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
