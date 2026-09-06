# The launcher for the `stable` server, owned by this repository.
#
# WHY THIS IS HERE RATHER THAN BESIDE THE CATALOGUE
#
# It used to be two files in the owner's data directory, in no version control,
# in the same directory as the irreplaceable data, backed up by nothing. On
# 2026-08-26 this machine was reset; it kept the user profile, so
# they survived by luck rather than by design. #475 asked which of three things
# they were: this repository's, a machine artefact, or something to delete when
# the deployment in #471 lands. `docs/the-stable-launcher.md` is the argument.
# The short version is that the answer is a seam rather than one of the three:
# what a launcher does is this repository's and what it points at is the
# machine's, and the file that had them mixed together carried the machine's
# three paths and the repository's whole hard-won argument in the same 180 lines.
#
# So: no path in this file names a person, a machine or a catalogue. Everything
# site-specific arrives as a parameter or out of the settings file named below,
# which sits beside the encrypted connection file that already holds this
# machine's other secrets.
#
# WHERE THE CONNECTION COMES FROM
#
# From the DPAPI-encrypted file this repository's connection-writing script
# writes under `%LOCALAPPDATA%\book-scan\`, which is the same file, read the same
# way, as the nightly backup wrapper. One store, one writer, two readers.
#
# NO SECRET IS IN THIS FILE, AND NONE IS READ FROM THE ENVIRONMENT. What is
# written here is a path. The predecessor of this file used to copy
# `%BOOKSCAN_BACKUP_SOURCE%` into `ConnectionStrings__bookscan`, which is why
# that variable had to keep existing at User scope, which meant a connection
# string naming the live catalogue was in the environment of every shell and
# every agent session on this machine. #215 removed the variable and the
# launcher brought it back, from outside this repository where no test and no
# linter could see it. See #308 and AGENTS.md.
#
# The two names are deleted from this process before anything is resolved, so
# the connection cannot come from them even by accident, and so the server this
# starts never inherits them either. That is the first thing below rather than a
# tidy-up at the end, on purpose: it is what makes the log of an ordinary run
# the evidence that the variable is not what is being used.
#
# `$env:` in PowerShell is this process and its children. Nothing set here
# outlives the server, and nothing here writes to User or Machine scope.
#
# WHY IT STILL RUNS `npm run dev` IN 2026-09
#
# Not inertia, and it was checked rather than assumed. Since #512 there is a
# build and `npm start`, and since #531 there is an image; neither of them can
# serve this deployment, and the reason is TLS rather than the bind. #543 made
# the bind a choice, so the built server can be reached from the LAN now. It
# still cannot serve a phone: neither the build nor the image terminates TLS, the
# session cookie is set `Secure` always, and a browser will not store it over
# plain http on anything but localhost. `npm run dev` is the only thing in the
# tree that binds `0.0.0.0:5173` over HTTPS, which is what the camera needs. When
# #471 puts something in front of the server that terminates TLS, this becomes
# `npm start` and this comment is the thing to delete.

[CmdletBinding()]
param(
    # Where this machine's facts live. Beside the encrypted connection file, in
    # the per-account directory this app already uses, so this default names a
    # location rather than a person.
    # Interpolated rather than Join-Path so an account with no LOCALAPPDATA gets
    # a path that does not exist instead of a parameter binding error, which is
    # what makes the refusals below drivable from a test on any platform.
    [string] $SettingsFile = "$env:LOCALAPPDATA\book-scan\stable-launcher.json",

    # The checkout to start. Defaults to the one this script is in, which is the
    # point of committing it: the launcher is deployed by the same fast-forward
    # as the code it launches, so it cannot drift behind what it starts.
    #
    # Resolved below rather than here. `$PSScriptRoot` is empty while Windows
    # PowerShell 5.1 binds a parameter's default, and the scheduled task on this
    # machine may be running either host.
    [string] $Checkout,

    # The photographs. Required, and deliberately without a default: it is the
    # one path that names somebody's data, and a launcher that guessed it could
    # start a server serving an empty shelf and report success.
    [string] $DataDir,

    [string] $ConnectionFile,

    # Watched by the app so a stopped backup is noticed by something other than
    # a log (#311). Optional, and unset means nothing is watched and nothing is
    # claimed.
    [string] $BackupDir,

    # The origin a browser reaches this on, needed only once a real sign-in
    # provider is configured (#521).
    [string] $PublicOrigin,

    # Refuse to start if the checkout's own contract checker complains. On by
    # default: see the block that runs it.
    [switch] $NoContractCheck
)

$ErrorActionPreference = 'Stop'

if (-not $Checkout) {
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
    $Checkout = Split-Path -Parent $here
}

function Write-Line {
    param([string] $Message)
    Write-Output ("{0}  [launch] {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $Message)
}

function Fail {
    param([string[]] $Lines)
    foreach ($line in $Lines) { Write-Line "FAILED: $line" }
    exit 2
}

# --- the variables this refuses to use, gone before anything else ----------

$strays = @()
foreach ($name in 'BOOKSCAN_BACKUP_SOURCE', 'BOOKSCAN_BACKUP_SCRATCH') {
    if (Test-Path "Env:$name") {
        $strays += $name
        Remove-Item "Env:$name"
    }
}
if ($strays) {
    Write-Line "inherited $($strays -join ' and '); deleted from this process before resolving anything"
} else {
    Write-Line "no BOOKSCAN_BACKUP_* variables inherited"
}

# --- this machine's facts, from the settings file and the command line -----
#
# A parameter beats the settings file, so a one-off run can point somewhere else
# without editing anything. The settings file is not required: a run given every
# path on its command line needs none, which is what makes the refusals below
# reachable from a test on a machine that has never seen this deployment.

$settings = $null
if (Test-Path -LiteralPath $SettingsFile) {
    try {
        $settings = Get-Content -LiteralPath $SettingsFile -Raw | ConvertFrom-Json
    } catch {
        Fail @(
            "could not read $SettingsFile as JSON. Not starting.",
            $_.Exception.Message
        )
    }
    Write-Line "settings read from $SettingsFile"
} else {
    Write-Line "no settings file at $SettingsFile; every path must be on the command line"
}

function Setting {
    param([string] $Given, [string] $Key)
    if ($Given) { return $Given }
    if ($settings -and $settings.PSObject.Properties.Name -contains $Key) { return [string] $settings.$Key }
    return ''
}

$DataDir = Setting $DataDir 'dataDir'
$ConnectionFile = Setting $ConnectionFile 'connectionFile'
$BackupDir = Setting $BackupDir 'backupDir'
$PublicOrigin = Setting $PublicOrigin 'publicOrigin'

if (-not $ConnectionFile) {
    $ConnectionFile = "$env:LOCALAPPDATA\book-scan\backup-connections.json"
}

if (-not $DataDir) {
    Fail @(
        "no data directory. It holds the photographs, and there is deliberately no default for it.",
        "Give -DataDir, or put `"dataDir`" in $SettingsFile.",
        "A server started against the wrong one comes up reporting success and serves an empty shelf."
    )
}

# --- the checkout ----------------------------------------------------------

$web = Join-Path $Checkout 'web'
if (-not (Test-Path -LiteralPath (Join-Path $web 'package.json'))) {
    Fail @("$web does not look like a book-scan checkout's web/ directory. Not starting.")
}

# --- the connection, out of the encrypted file and nowhere else ------------

if (-not (Test-Path -LiteralPath $ConnectionFile)) {
    # Deliberately not "fall back to whatever is in the environment". Falling
    # back is how the persisted variable became load-bearing in the first place.
    Fail @(
        "no connection file at $ConnectionFile. Not starting.",
        "Write it with the connection-writing script in this repository's scripts/ directory."
    )
}

# Windows PowerShell 5.1 and PowerShell 7 ship different copies of
# Microsoft.PowerShell.Security, and their type data collides. If 5.1 runs with a
# PSModulePath inherited from a PowerShell 7 parent, it finds 7's copy first,
# fails to load it with "The member AuditToString is already present", and
# ConvertTo-SecureString then does not exist at all. The connection reads as
# undecryptable and the server does not start.
#
# The scheduled task does not hit this: the persisted PSModulePath holds only the
# Windows PowerShell entries. Anything launched from a pwsh session does, and
# that is every agent session on this machine, so testing this launcher by hand
# failed in a way that looked exactly like a DPAPI problem. Observed 2026-08-13.
# Importing by $PSHOME asks the running host for its own copy and does not care
# what the parent's module path says.
#
# It is here rather than at the top of the file on purpose. Everything above
# refuses without needing it, which is what lets the refusals be driven on a
# machine that has no DPAPI at all.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop

# Works on Windows PowerShell 5.1 as well as PowerShell 7, the same way the
# backup wrapper does it. ConvertFrom-SecureString -AsPlainText is 7 only, and a
# scheduled task on this machine may be running either.
function Unprotect-Value {
    param([string] $Protected)
    $secure = ConvertTo-SecureString -String $Protected
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$stored = $null
try {
    $stored = Get-Content -LiteralPath $ConnectionFile -Raw | ConvertFrom-Json
    $connection = Unprotect-Value $stored.source
} catch {
    Fail @(
        "could not decrypt $ConnectionFile. Not starting.",
        "It is encrypted with DPAPI for one account on one machine. This ran as",
        "$([Environment]::UserDomainName)\$([Environment]::UserName), and the file names $($stored.writtenBy).",
        "Re-run the connection-writing script as the account the task runs as.",
        $_.Exception.Message
    )
}

if (-not $connection) {
    Fail @("the connection file holds no source. Not starting.")
}

# The second secret in the same store, since #348. Absent is an ordinary state
# and not a failure: Open Library still does the real work and both the startup
# log and /api/health say plainly that the second catalogue is unkeyed. What is
# new is that the launcher reads it rather than the owner remembering to add a
# line to a file nobody had a copy of, which is how it stayed unset while 238
# books were looked up anonymously against an exhausted shared quota.
$googleKey = ''
if ($stored.PSObject.Properties.Name -contains 'googleBooksApiKey' -and $stored.googleBooksApiKey) {
    try {
        $googleKey = Unprotect-Value $stored.googleBooksApiKey
    } catch {
        Write-Line "WARNING: $ConnectionFile holds a Google Books key that would not decrypt; starting without it."
    }
}

# --- the environment the server gets ---------------------------------------

$env:ConnectionStrings__bookscan = $connection
$env:BOOKSCAN_DATA = $DataDir
if ($BackupDir) { $env:BOOKSCAN_BACKUP_DIR = $BackupDir }
if ($PublicOrigin) { $env:BOOKSCAN_PUBLIC_ORIGIN = $PublicOrigin }
if ($googleKey) { $env:GOOGLE_BOOKS_API_KEY = $googleKey }

# Host, port and database, and none of the credentials. The server logs the same
# three on the line after `[api] listening`, so the log says on its own face
# which catalogue was opened and where the connection to it came from.
#
# Written as a statement rather than `$x = try {}`, which is PowerShell 7 syntax
# only, and the scheduled task on this machine may be running Windows PowerShell
# 5.1.
$where = 'unparseable'
try {
    $u = [uri] $connection
    $where = "$($u.Host):$($u.Port)$($u.AbsolutePath)"
} catch {
    # A connection string that is not a URI is still a connection string the
    # driver may accept. Say so and start.
}
Write-Line "connection read from $ConnectionFile"
Write-Line "catalogue $where"
Write-Line "data directory $DataDir"
if ($BackupDir) { Write-Line "backup directory $BackupDir, so a stopped backup is noticed by the app" }
else { Write-Line "no backup directory given, so nothing is watched and nothing is claimed" }
if ($googleKey) { Write-Line "Google Books key read from the same encrypted file" }
else { Write-Line "no Google Books key in the encrypted file; the second catalogue will answer unkeyed" }

# --- what the checkout itself says about this environment ------------------
#
# `deploy/check-config.mjs` reads an environment and says which of the contract's
# variables and refusals a configuration gets wrong. It ships inside the image
# for exactly this purpose, it opens no connection, and it prints names and never
# values. Running it here is the whole reason the launcher belongs in the
# repository: this deployment was the one deployment of this app that nothing
# could check, and so it fell three variables behind the tree without anybody
# being able to see it.
#
# --allow-development, because this deployment is on loopback behind a dev
# server and may legitimately be carrying the development door.
#
# A checkout older than the contract has no such file. That is not an error: it
# is a launcher committed at one revision starting an older one, and it says so
# rather than refusing.

$checker = Join-Path $Checkout 'deploy\check-config.mjs'
if (-not (Test-Path -LiteralPath $checker)) {
    Write-Line "this checkout has no deploy/check-config.mjs, so the environment was not checked against a contract"
} elseif ($NoContractCheck) {
    Write-Line "contract check skipped by -NoContractCheck"
} else {
    Write-Line "checking this environment against $Checkout\deploy\contract.json"
    & node $checker --allow-development
    if ($LASTEXITCODE -ne 0) {
        Fail @(
            "the checkout's own contract checker refused this environment. Not starting.",
            "It printed names and no values above. Fix them, or re-run with -NoContractCheck if you are certain."
        )
    }
}

Write-Line "starting npm run dev in $web"
Set-Location -LiteralPath $web
& npm run dev
exit $LASTEXITCODE
