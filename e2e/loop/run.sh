#!/usr/bin/env bash
#
# Run one feature N times and write down what each run answered.
#
# The point of this harness is that a flake is a rate, not an anecdote. One
# green run proves nothing about a suite that fails one time in ten, and the
# only way to tell a fix from a lucky afternoon is to run the same loop before
# and after and compare two rates.
#
#   ./loop/run.sh before 12                        # the default feature
#   ./loop/run.sh before 12 carrying-a-book        # any other one
#
# $1 = a tag naming the measurement, $2 = how many runs, $3 = which feature.
#
# Each run gets its own AppHost: the suite starts and stops one in global setup,
# so this is deliberately not `playwright test --repeat-each`, which would reuse
# a single app and measure something else entirely.
#
# `loop/<tag>/summary.txt` is the answer. `loop/<tag>/run-N.log` is what the run
# printed, which since #448 includes the browser's own account of a failure, and
# `loop/<tag>/run-N-artifacts/` is the screenshot, the aria snapshot and the
# trace, moved out of `test-results/` because the next run deletes that.
#
# Nothing here reads the machine's memory: `global-setup.ts` prints the commit
# headroom into every run's log, which is one place rather than two and works on
# both platforms this suite runs on.
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
