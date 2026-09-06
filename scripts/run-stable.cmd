@echo off
REM Launch the stable book-scan server, detached from whatever started it.
REM
REM WHY THIS FILE EXISTS
REM AGENTS.md records the stable server dying three times because the process
REM was owned by a session that later let go of it. It happened again on
REM 2026-08-11: an agent session started it and it went when the session did.
REM So this runs as the scheduled task 'book-scan stable server', which parents
REM the process to the service host rather than to a shell, and it outlives the
REM thing that ran it.
REM
REM WHAT IT DOES
REM Nothing but redirect the log and hand off to run-stable.ps1 beside it. The
REM connection is DPAPI-encrypted and decrypting it needs PowerShell; batch
REM would have to capture a secret through `for /f`, which mangles a password
REM containing % or ! or ^.
REM
REM NO PATH HERE NAMES A PERSON OR A MACHINE. %~dp0 is this file's own
REM directory, so the task's entry point and the script it runs travel together
REM in the checkout, and %BOOKSCAN_STABLE_LOG% or the per-account directory
REM decides where the log goes. Everything else this deployment needs is in
REM %LOCALAPPDATA%\book-scan\stable-launcher.json. See
REM docs/the-stable-launcher.md and #475.
REM
REM NO SECRET IS WRITTEN HERE, AND NONE IS READ FROM THE ENVIRONMENT. The file
REM this replaces used to copy %BOOKSCAN_BACKUP_SOURCE% into
REM ConnectionStrings__bookscan, which is why that variable had to keep existing
REM at User scope, which put a connection string naming the live catalogue into
REM every shell and every agent session on this machine. See #308, #215, and
REM AGENTS.md on why a connection string does not belong in a file, a command
REM line or a persisted variable.

setlocal

if "%BOOKSCAN_STABLE_LOG%"=="" set "BOOKSCAN_STABLE_LOG=%LOCALAPPDATA%\book-scan\stable-server.log"

for %%D in ("%BOOKSCAN_STABLE_LOG%") do if not exist "%%~dpD" mkdir "%%~dpD"

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0run-stable.ps1" %* >> "%BOOKSCAN_STABLE_LOG%" 2>&1

exit /b %ERRORLEVEL%
