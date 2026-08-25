#!/usr/bin/env bash
# One run of the one feature, recorded, with the machine's free commit beside
# it. $1 = tag, $2 = how many runs.
set -u
cd "$(dirname "$0")/.."
tag="$1"
n="$2"
mkdir -p "loop/$tag"
for i in $(seq 1 "$n"); do
  out="loop/$tag/run-$i"
  free=$(powershell -NoProfile -Command '"{0:N1}" -f ((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory/1MB)' | tr -d '\r')
  PLAYWRIGHT_JSON_OUTPUT_NAME="$out.json" \
    npx playwright test leaving-books-where-they-are --reporter=list,json > "$out.log" 2>&1
  code=$?
  echo "== $tag run $i  exit=$code  free-commit-before=${free}GB" >> "loop/$tag/summary.txt"
  node loop/report.mjs "$out.json" >> "loop/$tag/summary.txt" 2>>"loop/$tag/summary.txt"
done
