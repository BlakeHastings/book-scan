# The launcher for the `stable` server, owned by this repository.
# `docs/the-stable-launcher.md` is the argument.
#
# No path in this file names a person, a machine or a catalogue. Everything
# site-specific arrives as a parameter or out of the settings file named below.
#
# No secret is in this file and none is read from the environment. The connection
# comes from the DPAPI-encrypted file the connection-writing script writes under
# `%LOCALAPPDATA%\book-scan\`, which is the same file, read the same way, as the
# nightly backup wrapper.
#
# The two `BOOKSCAN_BACKUP_*` names are deleted from this process before anything
# is resolved, so the connection cannot come from them even by accident and the
# server this starts never inherits them. That is the first thing below rather
# than a tidy-up at the end, so the log of an ordinary run is the evidence.
#
# `$env:` in PowerShell is this process and its children. Nothing set here
# outlives the server, and nothing here writes to User or Machine scope.
#
# It runs `npm run dev` rather than the build or the image because neither of
# those terminates TLS, the session cookie is set `Secure` always, and a browser
# will not store it over plain http on anything but localhost. `npm run dev` is
# the only thing in the tree that serves the LAN over HTTPS, which is what the
# camera needs. When something in front of the server terminates TLS, this
# becomes `npm start`.

[CmdletBinding()]
param(
    # Interpolated rather than Join-Path so an account with no LOCALAPPDATA gets
    # a path that does not exist instead of a parameter binding error, which is
    # what makes the refusals below drivable from a test on any platform.
    [string] $SettingsFile = "$env:LOCALAPPDATA\book-scan\stable-launcher.json",

    # The checkout to start, defaulting to the one this script is in. Resolved
    # below rather than here: `$PSScriptRoot` is empty while Windows PowerShell
    # 5.1 binds a parameter's default, and the scheduled task on this machine may
    # be running either host.
    [string] $Checkout,

    # The photographs. Deliberately without a default: a launcher that guessed it
    # could start a server serving an empty shelf and report success.
    [string] $DataDir,

    [string] $ConnectionFile,

    # Unset means nothing is watched and nothing is claimed.
    [string] $BackupDir,

    # The origin a browser reaches this on, needed only once a real sign-in
    # provider is configured.
    [string] $PublicOrigin,

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

# A parameter beats the settings file, and the settings file is not required: a
# run given every path on its command line needs none, which is what makes the
# refusals below reachable from a machine that has never seen this deployment.
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

$web = Join-Path $Checkout 'web'
if (-not (Test-Path -LiteralPath (Join-Path $web 'package.json'))) {
    Fail @("$web does not look like a book-scan checkout's web/ directory. Not starting.")
}

if (-not (Test-Path -LiteralPath $ConnectionFile)) {
    # Deliberately not "fall back to whatever is in the environment".
    Fail @(
        "no connection file at $ConnectionFile. Not starting.",
        "Write it with the connection-writing script in this repository's scripts/ directory."
    )
}

# Windows PowerShell 5.1 and PowerShell 7 ship different copies of
# Microsoft.PowerShell.Security, and their type data collides. If 5.1 runs with a
# PSModulePath inherited from a PowerShell 7 parent it finds 7's copy first,
# fails to load it with "The member AuditToString is already present", and
# ConvertTo-SecureString then does not exist at all, which reads exactly like a
# DPAPI problem. Importing by $PSHOME asks the running host for its own copy.
#
# It is here rather than at the top of the file so that everything above can
# refuse on a machine that has no DPAPI at all.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop

# Works on Windows PowerShell 5.1 as well as 7. ConvertFrom-SecureString
# -AsPlainText is 7 only, and the scheduled task may be running either.
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

# The second secret in the same store. Absent is an ordinary state and not a
# failure: the startup log and /api/health both say the second catalogue is
# unkeyed.
$googleKey = ''
if ($stored.PSObject.Properties.Name -contains 'googleBooksApiKey' -and $stored.googleBooksApiKey) {
    try {
        $googleKey = Unprotect-Value $stored.googleBooksApiKey
    } catch {
        Write-Line "WARNING: $ConnectionFile holds a Google Books key that would not decrypt; starting without it."
    }
}

$env:ConnectionStrings__bookscan = $connection
$env:BOOKSCAN_DATA = $DataDir
if ($BackupDir) { $env:BOOKSCAN_BACKUP_DIR = $BackupDir }
if ($PublicOrigin) { $env:BOOKSCAN_PUBLIC_ORIGIN = $PublicOrigin }
if ($googleKey) { $env:GOOGLE_BOOKS_API_KEY = $googleKey }

# Host, port and database, and none of the credentials.
#
# Written as a statement rather than `$x = try {}`, which is PowerShell 7 syntax
# only, and the scheduled task may be running Windows PowerShell 5.1.
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

# `deploy/check-config.mjs` says which of the contract's variables and refusals
# this environment gets wrong. Running it here is the reason the launcher belongs
# in the repository at all.
#
# --allow-development, because this deployment is on loopback behind a dev server
# and may legitimately be carrying the development door.
#
# A checkout older than the contract has no such file. That is a launcher
# committed at one revision starting an older one, so it says so rather than
# refusing.
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
