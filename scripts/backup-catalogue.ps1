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
# ## Where the connections come from
#
# From a file, named by path on the command line, encrypted with DPAPI for the
# account that wrote it. install-backup-task.ps1 writes it; this reads it and
# puts the two connections into the environment of the one child process that
# needs them, which is `npx tsx server/backup-catalogue.ts`.
#
#   BOOKSCAN_BACKUP_SOURCE   the catalogue to dump. Only ever read from.
#   BOOKSCAN_BACKUP_SCRATCH  a Postgres the verification may create and drop
#                            databases on. MUST NOT be the live server.
#
# `$env:` in PowerShell is the *current process and its children*. Nothing
# written here outlives this script, and nothing here writes to `User` or
# `Machine` scope.
#
# These two used to live at `Machine` scope, set by install-backup-task.ps1,
# because Task Scheduler has no per-task environment block and that looked like
# the nearest thing. It is not: `Machine` scope is not the task's environment,
# it is every process on the box. A live catalogue connection string was in the
# environment of every shell on this machine, and `npx tsx
# server/backup-catalogue.ts` with no arguments opened it. See #215.
#
# A path is harmless to have in a command line, in a process listing and in the
# task definition, which is why the secret is behind one rather than in one.
#
# DPAPI here is `CurrentUser` scope, so the file decrypts only for the account
# that wrote it, on this machine. The task is registered to run as that same
# account. If it is ever changed to run as SYSTEM, or as a different user, or
# with the S4U logon type ("do not store password"), the decrypt fails and this
# script says so and exits non-zero rather than backing up nothing quietly.
#
# ConnectionStrings__bookscan is deliberately not read. See AGENTS.md.

[CmdletBinding()]
param(
    # Where dumps and manifests go. This should be on a different disk from the
    # database, and ideally not on this machine at all. See the note at the end.
    [Parameter(Mandatory = $true)][string] $BackupDir,

    # The repository checkout to run the tool out of.
    [Parameter(Mandatory = $true)][string] $RepoRoot,

    # The DPAPI-encrypted file holding the two connections, written by
    # install-backup-task.ps1. Not marked Mandatory on purpose: a mandatory
    # parameter under -NonInteractive prompts into a scheduled task's non
    # existent console and dies without saying why. It is checked below with a
    # message instead.
    [string] $ConnectionFile = '',

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

# --- the connections, out of the encrypted file and nowhere else -----------

# Windows PowerShell 5.1 and PowerShell 7 ship different copies of
# Microsoft.PowerShell.Security, and their type data collides. If 5.1 runs with
# a PSModulePath inherited from a PowerShell 7 parent it loads 7's copy, fails
# with "The member AuditToString is already present", and ConvertTo-SecureString
# then does not exist, which reads exactly like a DPAPI failure. The registered
# task does not hit it, because the persisted PSModulePath holds only the
# Windows PowerShell entries; running this by hand out of a pwsh session does.
# Importing by $PSHOME asks the running host for its own copy. See #308.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop

# Works on Windows PowerShell 5.1 as well as PowerShell 7. ConvertFrom-SecureString
# -AsPlainText is 7-only, and install-backup-task.ps1 falls back to
# powershell.exe on a machine without pwsh, so the task can be running either.
function Unprotect-Connection {
    param([string] $Protected)
    $secure = ConvertTo-SecureString -String $Protected
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if (-not $ConnectionFile) {
    # Deliberately not "fall back to whatever is in the environment". Falling
    # back is how the machine-scope variables became load-bearing in the first
    # place. See the note at the top and #215.
    Write-Log "FAILED: no -ConnectionFile. This does not take connections from the ambient"
    Write-Log "FAILED: environment. Re-run scripts/install-backup-task.ps1 to write the file"
    Write-Log "FAILED: and re-register the task with its path. Nothing was dumped."
    exit 2
}

if (-not (Test-Path -LiteralPath $ConnectionFile)) {
    Write-Log "FAILED: no connection file at $ConnectionFile. Nothing was dumped."
    Write-Log "FAILED: Re-run scripts/install-backup-task.ps1 to write it."
    exit 2
}

try {
    $stored = Get-Content -LiteralPath $ConnectionFile -Raw | ConvertFrom-Json
    $sourceConnection = Unprotect-Connection $stored.source
    $scratchConnection = Unprotect-Connection $stored.scratch
} catch {
    # The likely causes, in the order they are likely, so whoever reads this log
    # at 07:00 does not have to go and find out what DPAPI is.
    Write-Log "FAILED: could not decrypt $ConnectionFile. Nothing was dumped."
    Write-Log "FAILED: It is encrypted with DPAPI for one account on one machine. This ran as"
    Write-Log "FAILED: $([Environment]::UserDomainName)\$([Environment]::UserName), and the file names $($stored.writtenBy)."
    Write-Log "FAILED: A task running as SYSTEM, or as another user, or with the S4U logon type"
    Write-Log "FAILED: ('do not store password'), cannot read it. Re-run install-backup-task.ps1"
    Write-Log "FAILED: as the account the task runs as."
    Write-Log "FAILED: $($_.Exception.Message)"
    exit 2
}

if (-not $sourceConnection) {
    Write-Log "FAILED: the connection file holds no source. Nothing was dumped."
    exit 2
}
if (-not $scratchConnection) {
    # Refused rather than run, because a dump this job did not restore is a
    # dump this job has no business reporting success for.
    Write-Log "FAILED: the connection file holds no scratch server. A dump nobody restored is a hypothesis."
    exit 2
}

# Process scope. This is the environment of this script and of the npx child it
# starts, and of nothing else, and it dies with this process. It also overwrites
# anything that happened to be inherited, so the file decides and a leftover
# machine-scope variable cannot.
$env:BOOKSCAN_BACKUP_SOURCE = $sourceConnection
$env:BOOKSCAN_BACKUP_SCRATCH = $scratchConnection
Write-Log "connections read from $ConnectionFile"

$web = Join-Path $RepoRoot 'web'
if (-not (Test-Path (Join-Path $web 'server/backup-catalogue.ts'))) {
    Write-Log "FAILED: $web does not look like this repository's web/ directory."
    exit 2
}

# --- the dump, retention, and the restore that proves it -------------------

Push-Location $web
try {
    # --source-from-env and --scratch-from-env are the whole point: the tool
    # refuses to inherit a connection unless it is asked to, so this is the only
    # invocation on the machine that gets one. A bare run in a shell refuses.
    $output = & npx tsx server/backup-catalogue.ts `
        --source-from-env `
        --scratch-from-env `
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
