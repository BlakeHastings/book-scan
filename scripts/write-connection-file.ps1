# Write the DPAPI-encrypted file that holds this machine's book-scan secrets.
#
# The owner runs this. It needs the live connection string, and nothing in this
# repository is allowed to hold one.
#
# ## Why a file at all
#
# Windows Task Scheduler has no per-task environment block. An action is a
# command, arguments and a working directory, and there is nowhere on a task to
# hang a variable that only that task sees. The first answer to that was to
# persist `BOOKSCAN_BACKUP_SOURCE` and `BOOKSCAN_BACKUP_SCRATCH` at a scope the
# scheduler could see, which reads like "the task's environment" and is not: it
# is every process this account starts, so a connection string naming the live
# catalogue sat in every shell and every agent session on the box. That is #215.
#
# A file fixes the *accident*, which is the part worth fixing. Anything running
# as this account can read it if it knows the path and chooses to; nothing gets
# it by doing nothing. What travels in a command line, a process listing and a
# task definition is the path, which costs nothing to show.
#
# ## Who reads it
#
# Two things, and this is the only thing that writes it:
#
#   scripts/backup-catalogue.ps1                     the nightly backup wrapper
#   C:\Users\Blake\book-scan-production-data\run-stable.ps1   the stable server
#
# The second is why this is its own script rather than a step inside
# install-backup-task.ps1. Rotating the connection the stable server runs on
# should not require re-registering a backup schedule, and the two consumers
# should not each grow their own way of storing a secret. See #308: the stable
# launcher was written to read `BOOKSCAN_BACKUP_SOURCE` out of the environment,
# which is how the persisted variable came back after #215 removed it.
#
# ## What is in it
#
#   source              the live catalogue, for the backup and the stable server
#   scratch             a Postgres the backup verification may create and drop on
#   googleBooksApiKey   the second catalogue's key, added by #348. May be absent
#
# Every value is encrypted separately, so a reader takes only the one it needs.
#
# ## The Google Books API key, and why it is in here rather than anywhere else
#
# `web/server/lookup.ts` asks two catalogues. Google Books is the second, and
# `docs/catalogue-sources.md` measured what it has contributed to the real
# catalogue: nothing, to none of 238 books, ever. Every request has gone out
# anonymously, into a shared quota that is permanently exhausted, and come back
# 429. The failure was absorbed and nothing said so.
#
# A key fixes that, and a key is a secret, so it goes where this machine already
# keeps a secret rather than into a new mechanism. Everything the connection
# gets it gets: DPAPI for one account on one machine, an ACL on top, one writer,
# and a launcher that decrypts it into its own process environment and nowhere
# else. It never appears on a command line, which is why setting it is a switch
# and a prompt rather than a parameter with a value.
#
#     pwsh -File scripts/write-connection-file.ps1 -SetGoogleBooksApiKey
#
# The launcher then hands it to the server as `GOOGLE_BOOKS_API_KEY`, which is
# the one name `web/server/secrets.ts` reads and the one it has always read.
# That is one line in `run-stable.ps1`, beside the two it already has:
#
#     $env:GOOGLE_BOOKS_API_KEY = Unprotect-Value $stored.googleBooksApiKey
#
# With no key the server still works. Open Library does the real work, and the
# startup log and `/api/health` both say plainly that the second catalogue is
# unkeyed, which is the part that was missing.
#
# ## Rotating
#
# Re-run this with whichever values changed. Anything not given is carried
# forward from the file as it stands, so rotating the key does not mean
# re-typing the connections and rotating a connection does not disturb the key.
# Both readers pick up whatever is there the next time they start.
#
#     -Source <string>            replace the live catalogue connection
#     -Scratch <string>           replace the scratch connection
#     -SetGoogleBooksApiKey       prompt for a new key, not echoed
#     -ClearGoogleBooksApiKey     remove the key and go back to anonymous
#
# The first run has to give -Source and -Scratch, because there is nothing yet
# to carry forward.
#
# ## Removing
#
#     Remove-Item (Join-Path $env:LOCALAPPDATA 'book-scan\backup-connections.json')
#
# The nightly backup then fails loudly with `FAILED: no connection file`, and
# the stable server refuses to start and says the same. Both are recoverable in
# one command, which is the point of failing rather than falling back.

[CmdletBinding()]
param(
    # The live catalogue. The backup only reads from it; the stable server
    # serves from it.
    #
    # Not Mandatory since #348, so the key can be rotated on its own. Omitting
    # it carries the stored value forward, and there is a refusal below for the
    # case where there is nothing stored to carry.
    [string] $Source = '',

    # A Postgres the backup verification may create and drop databases on.
    # MUST NOT be the live server. Carried forward when omitted, as above.
    [string] $Scratch = '',

    # Prompt for the Google Books API key and store it. Deliberately a switch
    # and a prompt rather than a value on the command line: a parameter would
    # put the key in the process listing and in PowerShell's own history file.
    [switch] $SetGoogleBooksApiKey,

    # Forget the stored Google Books key. The server then goes back to
    # anonymous requests, and says so on every start.
    [switch] $ClearGoogleBooksApiKey,

    # Under LOCALAPPDATA rather than in the repository or beside the backups:
    # the repository is a place things get committed from, and the backup
    # directory is the thing that is supposed to be copied to another disk.
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
# its own copy. Both readers of this file do the same. See #308.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop

# ConvertFrom-SecureString with no -Key is DPAPI, CurrentUser scope: the output
# decrypts only for this account, on this machine. Both readers decrypt it with
# ConvertTo-SecureString, which is in the box in Windows PowerShell 5.1 as well
# as PowerShell 7, so neither of them depends on a module somebody installed.
$protect = {
    param([string] $Value)
    ConvertFrom-SecureString -SecureString (ConvertTo-SecureString -String $Value -AsPlainText -Force)
}

# The same decrypt the two readers do, needed here only to carry a connection
# forward through a run that is not changing it. The key is never decrypted:
# carrying it forward means copying the ciphertext across, so a run that rotates
# a connection never has the key in this process at all.
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

# Three outcomes, and the one that changes nothing is the default. A run that
# forgot to say -SetGoogleBooksApiKey must not silently clear a working key.
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

# Belt and braces on top of DPAPI. DPAPI already means another account cannot
# decrypt it; this means another account cannot read the ciphertext either, and
# it drops inherited ACEs so a permissive parent directory does not undo it.
& icacls "$Path" /inheritance:r /grant:r "*$($identity.User.Value):(R,W)" /grant:r '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not tighten the ACL on $Path (icacls exited $LASTEXITCODE). DPAPI still protects the contents."
}

Write-Output "Wrote $Path, encrypted for $whoami."
Write-Output "That account, on this machine, is the only one that can decrypt it."
# Whether there is a key, never the key, which is the same rule /api/health and
# the server's startup log follow. See web/server/secrets.ts.
Write-Output $googleSaid
