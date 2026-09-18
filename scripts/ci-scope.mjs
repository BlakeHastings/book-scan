// Decides whether a CI job needs to do its expensive work for the change in
// front of it, without ever letting the job disappear.
//
// `merge-pr.mjs` accepts only SUCCESS or NEUTRAL for a required check and reads
// an absent one as "never ran", so a workflow-level `paths:` filter (which takes
// the job out of the rollup) or a job-level `if:` (which reports SKIPPED) would
// make a documentation-only pull request permanently unmergeable. The job
// therefore always runs and always reports under its required name, and skips
// the expensive steps inside itself instead.
//
// `docs_only` is asked by every job; `image` is asked only by
// `.github/workflows/image.yml` and is answered from the same list of changed
// files rather than from a second API call.

import { appendFileSync } from 'node:fs'

// Paths that cannot change what any suite here proves. Everything not listed is
// treated as live code, including `.github/`, `scripts/`, `package.json` and
// lock files: guessing wrong in that direction costs a wasted minute, and
// guessing wrong the other way lands an untested change green.
const INERT = [
  /\.md$/,
  /^docs\//,
]

// No test or build step in this repository reads a markdown file. If one ever
// does, this list has to shrink.
export function isInert(path) {
  return INERT.some((pattern) => pattern.test(path))
}

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

// The paths that decide what the image is, or decide what building it proves.
//
// Unlike `INERT` above, this list names what matters and treats everything else
// as harmless. That is safe only because `.dockerignore` excludes `*` and
// re-includes `web` and `deploy`, so a new build input cannot enter the image
// without a change to `.dockerignore` or the `Dockerfile`, both of which are on
// this list.
//
// `web/src/` and `web/server/` are deliberately absent: the image builds them
// with the same `npm run build` against the same lock file that `web (typecheck
// + tests)` runs, so a source change that cannot build fails that check first.
// The gap that leaves is a source file importing something `.dockerignore`
// excludes (`web/data`, `web/dist`, `web/dist-server`, `web/.scratch-*`), which
// would build outside the image and fail inside it.
const DECIDES_THE_IMAGE = [
  /^Dockerfile$/,
  /^\.dockerignore$/,
  /^\.gitattributes$/, // holds `deploy/**` at LF, which is what makes the byte comparison mean anything
  /^deploy\//, // the contract and the checker, both carried inside the image
  /^web\/package\.json$/,
  /^web\/package-lock\.json$/,
  /^web\/scripts\//, // the build and the smoke check the image's own stages run
  /^scripts\/check-image\.mjs$/,
  /^scripts\/ci-scope\.mjs$/,
  /^\.github\/workflows\/image\.yml$/,
]

export function decidesTheImage(path) {
  return !isInert(path) && DECIDES_THE_IMAGE.some((pattern) => pattern.test(path))
}

export function classifyImage(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { image: true, why: 'no changed files could be read, so building it' }
  }

  const deciding = paths.filter(decidesTheImage)
  if (deciding.length > 0) {
    const shown = deciding.slice(0, 5).join(', ')
    const more = deciding.length > 5 ? ` and ${deciding.length - 5} more` : ''
    return { image: true, why: `what the image is made of changed: ${shown}${more}` }
  }

  return {
    image: false,
    why: `none of the ${paths.length} changed file(s) decide what the image is`,
  }
}

// GitHub truncates this endpoint at 3000 files, and a truncated list could hide
// a code change behind a wall of markdown, so stop asking and run everything.
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

// Which question this run is being asked about, for the log line and the step
// summary only. Both outputs are written whatever this says, so a workflow that
// forgets the flag still gets the right answer.
const ASKED_ABOUT_THE_IMAGE = process.argv.includes('--image')

function emit(docs, image) {
  let line
  if (ASKED_ABOUT_THE_IMAGE) {
    line = image.image
      ? `Building the image: ${image.why}.`
      : `Not building the image: ${image.why}.`
  } else {
    line = docs.docsOnly
      ? `Documentation only, so the expensive steps are skipped: ${docs.why}.`
      : `Full run: ${docs.why}.`
  }

  console.log(line)

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docs.docsOnly}\nimage=${image.image}\n`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
  }
}

// Every path that cannot answer either question properly answers both of them
// the expensive way.
function everything(why) {
  return [
    { docsOnly: false, why },
    { image: true, why },
  ]
}

async function main() {
  // There is no "changed files" question to ask outside a pull request, so the
  // nightly schedule and a manual dispatch get the full run.
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    emit(...everything(`event is ${process.env.GITHUB_EVENT_NAME ?? 'not a pull request'}`))
    return
  }

  const repo = process.env.GITHUB_REPOSITORY
  const prNumber = process.env.PR_NUMBER
  const token = process.env.GH_TOKEN

  if (!repo || !prNumber || !token) {
    emit(...everything('GITHUB_REPOSITORY, PR_NUMBER or GH_TOKEN was missing'))
    return
  }

  let paths = []
  try {
    paths = await changedFiles({ repo, prNumber, token })
  } catch (error) {
    // An API hiccup must not be able to skip a suite.
    emit(...everything(`could not list changed files (${error.message})`))
    return
  }

  emit(classify(paths), classifyImage(paths))
}

// Only when run directly, so the test can import the pure functions without
// firing a network call. Compared on the entry path because `import.meta.url`
// needs a file:// URL dance to match on Windows.
if (process.argv[1]?.endsWith('ci-scope.mjs')) {
  await main()
}
