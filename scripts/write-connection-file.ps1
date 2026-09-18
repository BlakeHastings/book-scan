# Write the DPAPI-encrypted file that holds this machine's book-scan secrets.
# The owner runs this, and it is the only thing that writes that file.
#
# A file rather than persisted environment variables because Windows Task
# Scheduler has no per-task environment block: an action is a command, arguments
# and a working directory, and a variable at a scope the scheduler can see is a
# variable in every process this account starts.
#
# It holds three values, each encrypted separately so a reader takes only the one
# it needs: `source`, the live catalogue; `scratch`, a Postgres the backup
# verification may create and drop databases on; and `googleBooksApiKey`, which
# may be absent.
#
# Anything not given on a re-run is carried forward from the file as it stands,
# so rotating the key does not mean re-typing the connections.

[CmdletBinding()]
param(
    # Not mandatory, so the key can be rotated on its own. Omitting it carries
    # the stored value forward.
    [string] $Source = '',

    # MUST NOT be the live server: the backup verification creates and drops
    # databases on it. Carried forward when omitted, as above.
    [string] $Scratch = '',

    # A switch and a prompt rather than a value on the command line, because a
    # parameter would put the key in the process listing and in PowerShell's own
    # history file.
    [switch] $SetGoogleBooksApiKey,

    [switch] $ClearGoogleBooksApiKey,

    # Under LOCALAPPDATA rather than in the repository or beside the backups: the
    # repository is a place things get committed from, and the backup directory
    # is the thing that is supposed to be copied to another disk.
    [string] $Path = (Join-Path $env:LOCALAPPDATA 'book-scan\backup-connections.json')
)

$ErrorActionPreference = 'Stop'

if ($SetGoogleBooksApiKey -and $ClearGoogleBooksApiKey) {
    throw "Give -SetGoogleBooksApiKey or -ClearGoogleBooksApiKey, not both."
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$whoami = "$([Environment]::UserDomainName)\$([Environment]::UserName)"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null

# Windows PowerShell 5.1 and PowerShell 7 ship different copies of
# Microsoft.PowerShell.Security, and their type data collides, so 5.1 with a
# PSModulePath inherited from a pwsh parent cannot load either and the
# SecureString cmdlets vanish. Importing by $PSHOME asks the running host for
# its own copy. Both readers of this file do the same.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop

# ConvertFrom-SecureString with no -Key is DPAPI, CurrentUser scope: the output
# decrypts only for this account, on this machine. Both readers decrypt it with
# ConvertTo-SecureString, which is in the box in 5.1 as well as 7.
$protect = {
    param([string] $Value)
    ConvertFrom-SecureString -SecureString (ConvertTo-SecureString -String $Value -AsPlainText -Force)
}

# Needed only to carry a connection forward through a run that is not changing
# it. The key is never decrypted: carrying it forward copies the ciphertext
# across, so a run that rotates a connection never has the key in this process.
$unprotect = {
    param([string] $Protected)
    $secure = ConvertTo-SecureString -String $Protected
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$stored = $null
if (Test-Path -LiteralPath $Path) {
    try {
        $stored = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        throw "There is a file at $Path and it could not be read as JSON. Move it aside and re-run with -Source and -Scratch."
    }
}

function Get-Stored {
    param([string] $Name)
    if (-not $stored) { return '' }
    if ($stored.PSObject.Properties.Name -notcontains $Name) { return '' }
    return [string] $stored.$Name
}

if (-not $Source) {
    $held = Get-Stored 'source'
    if (-not $held) {
        throw "No -Source, and no stored one to carry forward. The first run has to give -Source and -Scratch."
    }
    $Source = & $unprotect $held
}

if (-not $Scratch) {
    $held = Get-Stored 'scratch'
    if (-not $held) {
        throw "No -Scratch, and no stored one to carry forward. The first run has to give -Source and -Scratch."
    }
    $Scratch = & $unprotect $held
}

if ($Source -eq $Scratch) {
    throw "The scratch server must not be the live catalogue. The backup verification creates and drops databases on it."
}

# The outcome that changes nothing is the default: a run that forgot to say
# -SetGoogleBooksApiKey must not silently clear a working key.
$googleWas = if (Get-Stored 'googleBooksApiKey') { 'a key' } else { 'no key' }
if ($ClearGoogleBooksApiKey) {
    $googleProtected = ''
    $googleSaid = "Google Books key: cleared. The server will make anonymous requests and say so on every start."
} elseif ($SetGoogleBooksApiKey) {
    $typed = Read-Host -Prompt 'Google Books API key' -AsSecureString
    if (-not $typed -or $typed.Length -eq 0) {
        throw "Nothing was typed. The stored key is unchanged: there was $googleWas before this run and there is $googleWas now."
    }
    # Straight from the prompt to DPAPI. It is never a [string] in this process.
    $googleProtected = ConvertFrom-SecureString -SecureString $typed
    $googleSaid = "Google Books key: stored. Restart the stable server for it to be read."
} else {
    $googleProtected = Get-Stored 'googleBooksApiKey'
    $googleSaid = "Google Books key: unchanged, and there is $googleWas in the file."
}

[pscustomobject]@{
    writtenBy         = $whoami
    writtenAt         = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    source            = & $protect $Source
    scratch           = & $protect $Scratch
    googleBooksApiKey = $googleProtected
} | ConvertTo-Json | Set-Content -LiteralPath $Path -Encoding utf8

# On top of DPAPI, so another account cannot read the ciphertext either.
# `/inheritance:r` drops inherited ACEs, or a permissive parent directory would
# undo it.
& icacls "$Path" /inheritance:r /grant:r "*$($identity.User.Value):(R,W)" /grant:r '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not tighten the ACL on $Path (icacls exited $LASTEXITCODE). DPAPI still protects the contents."
}

Write-Output "Wrote $Path, encrypted for $whoami."
Write-Output "That account, on this machine, is the only one that can decrypt it."
# Whether there is a key, never the key.
Write-Output $googleSaid
