#!/usr/bin/env bash
#
# Deliberately not `playwright test --repeat-each`: each run needs its own
# AppHost, started and stopped in global setup, or two runs would share a
# server and measure something else entirely.
set -u
cd "$(dirname "$0")/.."

tag="$1"
n="$2"
feature="${3:-leaving-books-where-they-are}"

mkdir -p "loop/$tag"
for i in $(seq 1 "$n"); do
  out="loop/$tag/run-$i"
  PLAYWRIGHT_JSON_OUTPUT_NAME="$out.json" \
    npx playwright test "$feature" --reporter=list,json > "$out.log" 2>&1
  code=$?
  # Only a failure writes anything here, and only until the next run starts.
  if [ -d test-results ] && [ -n "$(ls -A test-results 2>/dev/null)" ]; then
    cp -r test-results "$out-artifacts" 2>/dev/null
  fi
  echo "== $tag run $i  exit=$code" >> "loop/$tag/summary.txt"
  node loop/report.mjs "$out.json" >> "loop/$tag/summary.txt" 2>>"loop/$tag/summary.txt"
done
