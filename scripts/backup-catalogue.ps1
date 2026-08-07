# The thing the scheduled task runs. One dump, retention, one verified restore.
#
# Kept as a wrapper rather than pointing Task Scheduler at npx directly, because
# a scheduled task has no shell, no profile, no working directory worth having
# and nowhere to put its output. All four of those are set here, once, where
# they can be read.
#
# It does not decide anything the tool decides. Retention, the digest and the
# verification all live in web/server/backup-catalogue.ts. This adds a log, an
# exit code, and the covers, which pg_dump does not cover.
#
# The connections are read from the environment rather than taken as arguments,
# so a password is not in the task definition, in a command line, or in a
# process listing. install-backup-task.ps1 stores them on the task itself.
#
#   BOOKSCAN_BACKUP_SOURCE   the catalogue to dump. Only ever read from.
#   BOOKSCAN_BACKUP_SCRATCH  a Postgres the verification may create and drop
#                            databases on. MUST NOT be the live server.
#
# ConnectionStrings__bookscan is deliberately not read. See AGENTS.md.

[CmdletBinding()]
param(
    # Where dumps and manifests go. This should be on a different disk from the
    # database, and ideally not on this machine at all. See the note at the end.
    [Parameter(Mandatory = $true)][string] $BackupDir,

    # The repository checkout to run the tool out of.
    [Parameter(Mandatory = $true)][string] $RepoRoot,

    [int] $Keep = 14,
    [int] $MaxMb = 512,
    [int] $MinFreeMb = 1024,

    # The cover photographs. pg_dump does not touch files, so these are copied
    # separately or not at all. Both left empty means not at all, which is the
    # default and is stated in the log rather than passed over.
    [string] $CoversSource = '',
    [string] $CoversDestination = '',

    [string] $LogDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $LogDir) { $LogDir = Join-Path $BackupDir 'logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$log = Join-Path $LogDir ("backup-{0}.log" -f (Get-Date).ToUniversalTime().ToString('yyyyMMdd'))

function Write-Log {
    param([string] $Message)
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $line = "$stamp  $Message"
    Write-Output $line
    Add-Content -Path $log -Value $line
}

Write-Log "starting"

if (-not $env:BOOKSCAN_BACKUP_SOURCE) {
    Write-Log "FAILED: BOOKSCAN_BACKUP_SOURCE is not set. Nothing was dumped."
    exit 2
}
if (-not $env:BOOKSCAN_BACKUP_SCRATCH) {
    # Refused rather than run, because a dump this job did not restore is a
    # dump this job has no business reporting success for.
    Write-Log "FAILED: BOOKSCAN_BACKUP_SCRATCH is not set. A dump nobody restored is a hypothesis."
    exit 2
}

$web = Join-Path $RepoRoot 'web'
if (-not (Test-Path (Join-Path $web 'server/backup-catalogue.ts'))) {
    Write-Log "FAILED: $web does not look like this repository's web/ directory."
    exit 2
}

# --- the dump, retention, and the restore that proves it -------------------

Push-Location $web
try {
    $output = & npx tsx server/backup-catalogue.ts `
        --dir $BackupDir `
        --keep $Keep `
        --max-mb $MaxMb `
        --min-free-mb $MinFreeMb 2>&1
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

foreach ($line in $output) { Write-Log $line }

if ($code -ne 0) {
    Write-Log "FAILED: backup-catalogue.ts exited $code. The catalogue is NOT backed up today."
    exit $code
}

# --- the photographs, which the dump does not cover ------------------------

if (-not $CoversSource -or -not $CoversDestination) {
    Write-Log "covers: NOT COPIED. pg_dump moves rows, not files. Pass -CoversSource and"
    Write-Log "covers: -CoversDestination to copy them, or accept that they are covered elsewhere."
} else {
    $sourceRoot = (Get-Item $CoversSource).PSDrive.Name
    $destRoot = if (Test-Path $CoversDestination) { (Get-Item $CoversDestination).PSDrive.Name } else { (Split-Path -Qualifier $CoversDestination).TrimEnd(':') }

    if ($sourceRoot -eq $destRoot) {
        # Refused, not warned. A second copy on the same disk survives a
        # `docker volume rm` and an accidental delete, and does not survive the
        # disk or the machine, which is what the photographs need protecting
        # from. Reporting it as a backup would claim safety that is not there.
        Write-Log "covers: REFUSED. $CoversDestination is on the same volume ($destRoot) as"
        Write-Log "covers: $CoversSource. A copy beside the original is not a backup of it."
        exit 3
    }

    Write-Log "covers: mirroring $CoversSource to $CoversDestination"
    # /MIR would delete on the destination anything deleted at the source,
    # which turns one accidental delete into two. New and changed files only.
    & robocopy $CoversSource $CoversDestination /E /XO /R:2 /W:5 /NP /NFL /NDL | Out-Null
    # robocopy uses 0-7 for success. 8 and above is a real failure.
    if ($LASTEXITCODE -ge 8) {
        Write-Log "covers: FAILED, robocopy exited $LASTEXITCODE"
        exit 4
    }
    Write-Log "covers: copied (robocopy $LASTEXITCODE)"
}

Write-Log "done"
exit 0
