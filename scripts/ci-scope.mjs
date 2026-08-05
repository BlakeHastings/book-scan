// Decides whether a CI job needs to do its expensive work for the change in
// front of it, without ever letting the job disappear.
//
// WHY THIS IS NOT A `paths:` FILTER
// `scripts/merge-pr.mjs` treats a required check that never appears in the
// rollup as "never ran" and refuses the merge. That is deliberate and it is the
// safe direction: "did not run" must not read as "passed". A workflow-level
// `paths:` filter removes the job from the rollup entirely, so a documentation
// only pull request would become permanently unmergeable rather than fast. That
// is exactly why the filter was left out when the browser suite started gating
// pull requests.
//
// So the job always runs and always reports under its required name. It asks
// this script whether the steps inside it are worth doing, and skips those
// steps rather than skipping itself. GitHub bills each job rounded up to a whole
// minute, so a job that always starts and exits in fifteen seconds costs one
// minute against the two or three a full run costs, and the name is there to be
// green either way.
//
// A job-level `if:` would not work either: a job skipped by `if:` reports
// SKIPPED, and `merge-pr.mjs` accepts only SUCCESS or NEUTRAL.
//
// Usage, from a workflow step:
//   - id: scope
//     run: node scripts/ci-scope.mjs
//     env:
//       GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
// then guard the expensive steps with
//   if: steps.scope.outputs.docs_only != 'true'

import { appendFileSync } from 'node:fs'

// Paths that cannot change what any suite here proves. Deliberately short.
// Everything not listed is treated as live code, because the failure mode of
// guessing wrong in that direction is a wasted minute, and the failure mode of
// guessing wrong the other way is an untested change landing green.
//
// Note what is NOT here: `.github/`, `scripts/`, `package.json`, lock files,
// `*.json`, `.gitignore`. A change to any of those can change what CI itself
// does, so it gets the full run.
const INERT = [
  /\.md$/, // any markdown, anywhere: README.md, AGENTS.md, web/README.md
  /^docs\//, // the whole documentation tree, including its images
]

// No test or build step in this repository reads a markdown file. Checked with
// `grep -rn "\.md['\"`]" web/ e2e/ --include=*.ts --include=*.tsx --include=*.mts`,
// which finds one prose comment in `web/src/lib/cascade.ts` and nothing else.
// If that ever changes, this list has to shrink.
export function isInert(path) {
  return INERT.some((pattern) => pattern.test(path))
}

// Safe direction throughout: anything unclear returns docsOnly false, which
// means "do the work".
export function classify(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { docsOnly: false, why: 'no changed files could be read, so running everything' }
  }

  const live = paths.filter((path) => !isInert(path))
  if (live.length > 0) {
    const shown = live.slice(0, 5).join(', ')
    const more = live.length > 5 ? ` and ${live.length - 5} more` : ''
    return { docsOnly: false, why: `code changed: ${shown}${more}` }
  }

  return {
    docsOnly: true,
    why: `all ${paths.length} changed file(s) are documentation`,
  }
}

// GitHub truncates this endpoint at 3000 files. A truncated list could hide a
// code change behind a wall of markdown, so stop asking and run everything.
const MAX_PAGES = 30
const PER_PAGE = 100

async function changedFiles({ repo, prNumber, token }) {
  const paths = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=${PER_PAGE}&page=${page}`
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    })
    if (!response.ok) {
      throw new Error(`GET ${url} returned ${response.status} ${response.statusText}`)
    }

    const batch = await response.json()
    for (const file of batch) {
      paths.push(file.filename)
      // A rename shows only its new name, but the old one leaving is a change
      // to that path too.
      if (file.previous_filename) paths.push(file.previous_filename)
    }

    if (batch.length < PER_PAGE) return paths
  }

  return [] // Truncated. classify() reads an empty list as "run everything".
}

function emit({ docsOnly, why }) {
  const line = docsOnly
    ? `Documentation only, so the expensive steps are skipped: ${why}.`
    : `Full run: ${why}.`

  console.log(line)

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
  }
}

async function main() {
  // Anything that is not a pull request gets the full run: the nightly browser
  // schedule, a manual dispatch, and any future push trigger. There is no
  // "changed files" question to ask about those, and answering it wrongly would
  // silently hollow out the nightly.
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    emit({ docsOnly: false, why: `event is ${process.env.GITHUB_EVENT_NAME ?? 'not a pull request'}` })
    return
  }

  const repo = process.env.GITHUB_REPOSITORY
  const prNumber = process.env.PR_NUMBER
  const token = process.env.GH_TOKEN

  if (!repo || !prNumber || !token) {
    emit({ docsOnly: false, why: 'GITHUB_REPOSITORY, PR_NUMBER or GH_TOKEN was missing' })
    return
  }

  let paths = []
  try {
    paths = await changedFiles({ repo, prNumber, token })
  } catch (error) {
    // An API hiccup must not be able to skip a suite.
    emit({ docsOnly: false, why: `could not list changed files (${error.message})` })
    return
  }

  emit(classify(paths))
}

// Only when run directly, so the test can import the two pure functions without
// firing a network call. Compared on the entry path rather than on
// `import.meta.url`, which needs a file:// URL dance to match on Windows.
if (process.argv[1]?.endsWith('ci-scope.mjs')) {
  await main()
}
