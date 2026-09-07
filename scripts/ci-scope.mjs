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
//
// TWO QUESTIONS, ONE LIST OF CHANGED FILES
// `docs_only` is the original one and every job asks it. `image` is the second
// (#549) and only `.github/workflows/image.yml` asks it: a 1.49 GB build is
// worth doing far less often than a test run, and it is answered from the same
// list rather than from a second API call. Pass `--image` to make the log line
// and the step summary talk about that question instead of the first one; both
// outputs are written either way, so nothing depends on the flag being passed.

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

// The paths that decide what the image is, or decide what building it proves
// (#549). A change touching one of these builds the image on the pull request;
// a change touching none of them does not.
//
// WHY THIS IS A DIFFERENT QUESTION FROM `docs_only`
// The image build is three minutes and 1.49 GB, against roughly one minute for
// everything `web (typecheck + tests)` does. Running it on every change that is
// not documentation would put it on almost every pull request here, and almost
// every one of those is a source change whose failure mode the other two checks
// already catch, in less time, with a better message.
//
// WHY A LIST OF WHAT MATTERS RATHER THAN A LIST OF WHAT DOES NOT
// The rest of this file names what is inert and treats everything else as live,
// because guessing wrong there costs a minute and guessing wrong the other way
// lands an untested change. This one is written the other way round, and it can
// be, for a reason that is a property of `.dockerignore` rather than a promise
// anybody has to keep: that file excludes `*` and re-includes `web` and
// `deploy`, so **a new build input cannot enter the image without a change to
// `.dockerignore` or the `Dockerfile`**, both of which are on this list. The
// list therefore cannot silently fall behind the image; it can only fall behind
// on purpose.
//
// What is deliberately NOT here is the application itself, `web/src/` and
// `web/server/`. They are copied into the image and built there by the same
// `npm run build` against the same lock file that `web (typecheck + tests)`
// runs, so a source change that cannot build fails that check first and this
// one would be a slower second copy of the same red. The gap that leaves,
// stated rather than hidden: a source file importing something `.dockerignore`
// excludes (`web/data`, `web/dist`, `web/dist-server`, `web/.scratch-*`) would
// build outside the image and fail inside it, and nothing imports from any of
// those today.
const DECIDES_THE_IMAGE = [
  /^Dockerfile$/, // the recipe
  /^\.dockerignore$/, // what the recipe is allowed to see
  /^\.gitattributes$/, // holds `deploy/**` at LF, which is what makes the byte comparison mean anything
  /^deploy\//, // the contract and the checker, both carried inside the image and both asserted about
  /^web\/package\.json$/, // what `npm ci` installs and `npm prune --omit=dev` keeps
  /^web\/package-lock\.json$/, // the same, exactly
  /^web\/scripts\//, // the build and the smoke check the image's own stages run
  /^scripts\/check-image\.mjs$/, // the assertions themselves
  /^scripts\/ci-scope\.mjs$/, // this decision
  /^\.github\/workflows\/image\.yml$/, // the job that asks
]

export function decidesTheImage(path) {
  return !isInert(path) && DECIDES_THE_IMAGE.some((pattern) => pattern.test(path))
}

// Safe direction here too, and it is the opposite word: unclear means `image`
// true, which means build it.
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

// Which question this run is being asked about, for the log line and the step
// summary only. Both outputs are written whatever this says, so a workflow that
// forgets the flag still gets the right answer, in a sentence about the other
// job.
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
  // Anything that is not a pull request gets the full run: the nightly browser
  // schedule, a manual dispatch, and any future push trigger. There is no
  // "changed files" question to ask about those, and answering it wrongly would
  // silently hollow out the nightly.
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
// firing a network call. Compared on the entry path rather than on
// `import.meta.url`, which needs a file:// URL dance to match on Windows.
if (process.argv[1]?.endsWith('ci-scope.mjs')) {
  await main()
}
