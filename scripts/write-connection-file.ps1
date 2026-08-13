# Write the DPAPI-encrypted file that holds this machine's book-scan connections.
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
# ## Rotating
#
# Re-run this with the new values. It overwrites the file in place, and both
# readers pick it up the next time they start.
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
    [Parameter(Mandatory = $true)][string] $Source,

    # A Postgres the backup verification may create and drop databases on.
    # MUST NOT be the live server.
    [Parameter(Mandatory = $true)][string] $Scratch,

    # Under LOCALAPPDATA rather than in the repository or beside the backups:
    # the repository is a place things get committed from, and the backup
    # directory is the thing that is supposed to be copied to another disk.
    [string] $Path = (Join-Path $env:LOCALAPPDATA 'book-scan\backup-connections.json')
)

$ErrorActionPreference = 'Stop'

if ($Source -eq $Scratch) {
    throw "The scratch server must not be the live catalogue. The backup verification creates and drops databases on it."
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

[pscustomobject]@{
    writtenBy = $whoami
    writtenAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    source    = & $protect $Source
    scratch   = & $protect $Scratch
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
