// The case that decides the design is `disjoint file sets`: the base gained a
// commit touching a file this branch never touched, and it still has to refuse,
// because the coupling can be a type across one TypeScript program rather than
// a line in a shared file. Any rule built on "do the changed files overlap"
// passes that case and is worthless.
import { judgeBase, judgeChecks, REQUIRED, COMPARE_FILE_LIMIT } from './merge-pr.mjs'

const named = (...paths) => paths.map((filename) => ({ filename }))

/**
 * A rollup as `gh pr view --json statusCheckRollup` reports one: every required
 * name green, then whatever the case overrides. An override of `null` takes the
 * name off the board entirely, which is a different failure from a red one.
 */
const board = (overrides = {}) =>
  REQUIRED.map((name) => [name, name in overrides ? overrides[name] : 'SUCCESS'])
    .filter(([, conclusion]) => conclusion !== null)
    .map(([name, conclusion]) => ({ name, conclusion }))

const cases = [
  {
    what: 'the base has not moved since the checks ran',
    compared: { ahead_by: 0, files: [] },
    expect: 'allow',
  },
  {
    what: 'the base gained a commit that changed only markdown',
    compared: { ahead_by: 1, files: named('README.md', 'AGENTS.md') },
    expect: 'allow',
  },
  {
    what: 'the base gained several commits, all inside docs/, images included',
    compared: {
      ahead_by: 4,
      files: named('docs/shelving.md', 'docs/process/working-an-issue.md', 'docs/img/shelf.png'),
    },
    expect: 'allow',
  },
  {
    what: 'markdown that is not at the repository root',
    compared: { ahead_by: 1, files: named('web/README.md', 'e2e/NOTES.md') },
    expect: 'allow',
  },
  {
    what: 'the base moved but its tree did not, so the diff is empty',
    compared: { ahead_by: 1, files: [] },
    expect: 'allow',
  },
  {
    what: 'a file list just short of the cap, all of it documentation',
    compared: {
      ahead_by: 1,
      files: named(...Array.from({ length: COMPARE_FILE_LIMIT - 1 }, (_, i) => `docs/n${i}.md`)),
    },
    expect: 'allow',
  },

  {
    what: 'disjoint file sets: the base gained code this branch never touched',
    compared: { ahead_by: 1, files: named('web/server/db.ts', 'web/server/driver.ts') },
    expect: 'deny',
  },
  {
    what: 'one code file hidden among documentation',
    compared: {
      ahead_by: 2,
      files: named('docs/shelving.md', 'README.md', 'web/shared/layout.ts', 'docs/a.md'),
    },
    expect: 'deny',
  },
  {
    what: 'the tooling that decides what CI does',
    compared: { ahead_by: 1, files: named('scripts/ci-scope.mjs') },
    expect: 'deny',
  },
  {
    what: 'a workflow file',
    compared: { ahead_by: 1, files: named('.github/workflows/ci.yml') },
    expect: 'deny',
  },
  {
    what: 'a lock file, which is not markdown and can change every dependency',
    compared: { ahead_by: 1, files: named('web/package-lock.json') },
    expect: 'deny',
  },
  {
    what: 'a file list at the cap, so it may be truncated and cannot be cleared',
    compared: {
      ahead_by: 1,
      files: named(...Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) => `docs/n${i}.md`)),
    },
    expect: 'deny',
  },
  {
    what: 'the API answered without saying what the new commits changed',
    compared: { ahead_by: 3 },
    expect: 'deny',
  },
  // Neither of these knows the base is stale, so neither says "rebase": they
  // refuse because "could not tell" must not read as "green".
  {
    what: 'the API answered without saying how far the base has moved',
    compared: {},
    expect: 'deny',
    says: ['master', 'try again'],
  },
  {
    what: 'the compare call failed outright, so nothing is known',
    compared: null,
    expect: 'deny',
    says: ['master', 'try again'],
  },
]

let failed = 0

for (const { what, compared, expect, says = ['master', 'rebase'] } of cases) {
  const verdict = judgeBase(compared, 'master')
  const actual = verdict.fresh ? 'allow' : 'deny'

  if (actual !== expect) {
    failed++
    console.error(`FAIL  expected ${expect}, got ${actual}:  ${what}`)
    continue
  }

  if (actual === 'deny') {
    const why = verdict.why ?? ''
    for (const wanted of says) {
      if (!why.toLowerCase().includes(wanted)) {
        failed++
        console.error(`FAIL  refusal never says "${wanted}":  ${what}\n${why}`)
      }
    }
  } else if (!verdict.note) {
    failed++
    console.error(`FAIL  allowed without saying why it looked:  ${what}`)
  }
}

const long = judgeBase(
  { ahead_by: 1, files: named('web/server/db.ts', 'web/server/store.ts') },
  'master',
)
for (const wanted of ['web/server/db.ts', 'web/server/store.ts']) {
  if (!(long.why ?? '').includes(wanted)) {
    failed++
    console.error(`FAIL  refusal does not name ${wanted}`)
  }
}

const other = judgeBase({ ahead_by: 1, files: named('web/server/db.ts') }, 'release/3')
if (!(other.why ?? '').includes('release/3') || (other.why ?? '').includes('master has gained')) {
  failed++
  console.error('FAIL  refusal hardcodes master instead of the pull request\'s base')
}

const IMAGE = 'image (build + contract)'

// Named rather than derived, so that dropping one from `REQUIRED` fails here
// instead of quietly shrinking what the tests below assert about.
for (const name of ['web (typecheck + tests)', 'browser journeys', IMAGE]) {
  if (!REQUIRED.includes(name)) {
    failed++
    console.error(`FAIL  REQUIRED no longer names "${name}"`)
  }
}
if (new Set(REQUIRED).size !== REQUIRED.length) {
  failed++
  console.error('FAIL  REQUIRED lists a name twice')
}

const checkCases = [
  {
    // The board a documentation-only pull request gets: all three jobs start,
    // `ci-scope.mjs` tells each of them there is nothing to prove, and all
    // three report green. If this case ever denies, the repository is
    // unmergeable for documentation changes.
    what: 'a documentation-only board: every required name present and green',
    rollup: board(),
    expect: 'allow',
  },
  {
    what: 'NEUTRAL passes, which is what a job that did nothing reports',
    rollup: board({ [IMAGE]: 'NEUTRAL' }),
    expect: 'allow',
  },
  {
    what: 'checks nobody requires are ignored, however they went',
    rollup: [...board(), { name: 'some other status', conclusion: 'FAILURE' }],
    expect: 'allow',
  },
  {
    // The rollup lists a rerun after the run it replaces, so the last entry for
    // a name wins.
    what: 'a rerun: the image check failed, was re-run, and is green now',
    rollup: [
      ...board({ [IMAGE]: 'FAILURE' }),
      { name: IMAGE, conclusion: 'SUCCESS' },
    ],
    expect: 'allow',
  },
  {
    what: 'an entry with no name at all is skipped rather than throwing',
    rollup: [...board(), { conclusion: 'FAILURE' }],
    expect: 'allow',
  },

  {
    what: 'the image check is red',
    rollup: board({ [IMAGE]: 'FAILURE' }),
    expect: 'deny',
    says: [IMAGE, 'failure'],
  },
  {
    // A `paths:` filter on `image.yml` produces this board, which is why
    // `ci-scope.mjs` skips steps and never the job.
    what: 'the image check is absent from the rollup entirely',
    rollup: board({ [IMAGE]: null }),
    expect: 'deny',
    says: [IMAGE, 'never ran'],
  },
  {
    // What a job-level `if:` reports. Accepting it would make every guard on
    // `image.yml` optional.
    what: 'the image check reports SKIPPED',
    rollup: board({ [IMAGE]: 'SKIPPED' }),
    expect: 'deny',
    says: [IMAGE, 'skipped'],
  },
  {
    what: 'the image check has not finished yet',
    rollup: board({ [IMAGE]: null }).concat({ name: IMAGE, status: 'IN_PROGRESS' }),
    expect: 'deny',
    says: [IMAGE, 'pending'],
  },
  {
    what: 'the image build was cancelled, which is how a force-push leaves it',
    rollup: board({ [IMAGE]: 'CANCELLED' }),
    expect: 'deny',
    says: [IMAGE, 'cancelled'],
  },
  {
    what: 'the image build hit its 30 minute timeout',
    rollup: board({ [IMAGE]: 'TIMED_OUT' }),
    expect: 'deny',
    says: [IMAGE, 'timed_out'],
  },
  {
    what: 'no rollup at all, so nothing ran',
    rollup: [],
    expect: 'deny',
    says: [IMAGE, 'web (typecheck + tests)', 'browser journeys', 'never ran'],
  },
  {
    what: 'the field came back missing rather than empty',
    rollup: undefined,
    expect: 'deny',
    says: ['never ran'],
  },
  {
    what: 'the two older checks are green and only the new one is red',
    rollup: board({ [IMAGE]: 'FAILURE' }),
    expect: 'deny',
    says: [IMAGE, 'do not merge around it'],
  },
]

for (const { what, rollup: given, expect, says = [] } of checkCases) {
  const verdict = judgeChecks(given)
  const actual = verdict.green ? 'allow' : 'deny'

  if (actual !== expect) {
    failed++
    console.error(`FAIL  expected ${expect}, got ${actual}:  ${what}`)
    continue
  }

  if (actual === 'deny') {
    const why = (verdict.why ?? '').toLowerCase()
    for (const wanted of says) {
      if (!why.includes(wanted.toLowerCase())) {
        failed++
        console.error(`FAIL  refusal never says "${wanted}":  ${what}\n${verdict.why}`)
      }
    }
  }
}

// No name in the list is advisory: taken off the board one at a time, each must
// refuse by name, and a fourth name inherits that.
for (const name of REQUIRED) {
  const verdict = judgeChecks(board({ [name]: null }))
  if (verdict.green || !(verdict.why ?? '').includes(`${name}: never ran`)) {
    failed++
    console.error(`FAIL  a missing "${name}" did not refuse by name`)
  }
  const red = judgeChecks(board({ [name]: 'FAILURE' }))
  if (red.green || !(red.why ?? '').includes(`${name}: FAILURE`)) {
    failed++
    console.error(`FAIL  a red "${name}" did not refuse by name`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) behaved wrongly.`)
  process.exit(1)
}

console.log(
  `merge-pr: ${cases.length} base cases and ${checkCases.length} check cases behaved as expected.`,
)
