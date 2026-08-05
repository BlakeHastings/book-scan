// What the merge gate must let through, and what it must stop.
//
//   node scripts/merge-pr.test.mjs
//
// `merge-pr.mjs` used to check only that every required check was green. It did
// not check what those checks ran against. GitHub computes a pull request's
// checks from a merge of the branch and the base at that moment, so a green
// tick can describe a tree that stopped existing when something else landed.
// #151 and #152 both merged green, an hour apart, touching no file in common,
// and master stopped compiling (#154).
//
// The allow cases matter more than the deny cases, and here more than usually.
// This gate fires at merge time on somebody who has already done the work, and
// every refusal costs a rebase and a full re-run in billed minutes. A gate that
// refuses a documentation merge gets switched off, and a switched-off gate is
// every gap at once.
//
// The case that decides the design is `disjoint file sets`. It is the shape of
// #151 and #152: the base gained a commit touching a file this branch never
// touched, and it still has to refuse, because the coupling was a type across
// one TypeScript program rather than a line in a shared file. Any rule built on
// "do the changed files overlap" passes that case and is worthless.
import { judgeBase, COMPARE_FILE_LIMIT } from './merge-pr.mjs'

const named = (...paths) => paths.map((filename) => ({ filename }))

const cases = [
  // ---------------------------------------------------------------- allow --
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

  // ----------------------------------------------------------------- deny --
  {
    // #151 changed web/server/db.ts. #152 added web/server/dividers.test.ts and
    // touched nothing db.ts touched. This is that pair, and it must refuse.
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
  // Neither of these knows the base is stale, so neither says "rebase". They
  // refuse because "could not tell" must not read as "green", which is the same
  // direction a required check that never ran is already read in.
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

  // A refusal nobody can act on gets worked around. Every deny must name the
  // branch it is talking about and say what to do about it.
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

// The list is shown, not just counted: a refusal that named only "3 files" is
// one the reader cannot check.
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

// A base branch that is not called master is said by its own name.
const other = judgeBase({ ahead_by: 1, files: named('web/server/db.ts') }, 'release/3')
if (!(other.why ?? '').includes('release/3') || (other.why ?? '').includes('master has gained')) {
  failed++
  console.error('FAIL  refusal hardcodes master instead of the pull request\'s base')
}

if (failed > 0) {
  console.error(`\n${failed} check(s) behaved wrongly.`)
  process.exit(1)
}

console.log(`merge-pr: ${cases.length} cases behaved as expected.`)
