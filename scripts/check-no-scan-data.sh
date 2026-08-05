#!/usr/bin/env bash
# Refuses a database file or a scan image tracked anywhere in the tree.
#
# Detection, not prevention. `web/.gitignore` already excludes `data/`, but an
# ignore rule is silent when someone forces past it. This runs on the result,
# which a bypass cannot avoid producing.
#
# It is a step rather than a job of its own. It takes about three seconds, and
# GitHub bills a job rounded up to the whole minute, so as a separate job those
# three seconds cost the same as a full minute of work. Run from two places:
# inside the pull request job in `ci.yml`, and after a merge in
# `provenance.yml`, where it rides along inside a minute that is already billed.
#
# This check never depends on which files a change touched. It always runs, even
# when everything else in its job is skipped as documentation only, because the
# thing it looks for could be committed by any change at all.
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
