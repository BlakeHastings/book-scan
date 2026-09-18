#!/usr/bin/env bash
# Refuses a database file or a scan image tracked anywhere in the tree.
#
# Detection, not prevention. `web/.gitignore` already excludes `data/`, but an
# ignore rule is silent when someone forces past it. This runs on the result,
# which a bypass cannot avoid producing.
#
# It never depends on which files a change touched, and always runs even when
# everything else in its job is skipped as documentation only, because the thing
# it looks for could be committed by any change at all.
set -euo pipefail

hits=$(git ls-files \
  | grep -Ei '\.(db|db-wal|db-shm|sqlite|sqlite3)$|(^|/)(covers|captures)/' \
  || true)

if [ -n "$hits" ]; then
  echo "::error::Scan data must never be committed. Found:"
  echo "$hits"
  exit 1
fi

echo "No databases or scan images tracked."
