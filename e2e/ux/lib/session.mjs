/**
 * The run: where its files are, what has happened in it, and the arithmetic.
 *
 * Every step is appended to `log.jsonl` as it happens, so a run that is
 * abandoned halfway still has everything up to that point, and so the numbers
 * are recomputed from the record rather than accumulated in a variable somebody
 * could forget to increment.
 *
 * The counting rules live in `summarise` and are written out in
 * `e2e/ux/metrics.md`. Two of them are worth reading before trusting a number:
 * a press that navigated nowhere, changed no pixel and changed no row is a dead
 * end, and a visit to a screen that changed nothing and ended back somewhere
 * already seen is a backtrack.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { UX_ROOT } from './aspire.mjs'

export const RUNS_ROOT = join(UX_ROOT, 'runs')
/** Which run the next command belongs to. Written by `open`, deleted by `finish`. */
const CURRENT = join(RUNS_ROOT, '.current.json')

export function currentRun() {
  if (!existsSync(CURRENT)) {
    throw new Error('No run is open. Start one with:  npm run ux -- open --run <name>')
  }
  return JSON.parse(readFileSync(CURRENT, 'utf8'))
}

export function writeCurrent(state) {
  mkdirSync(RUNS_ROOT, { recursive: true })
  writeFileSync(CURRENT, `${JSON.stringify(state, null, 2)}\n`)
}

export function runDir(run) {
  return join(RUNS_ROOT, run.id)
}

export function logPath(run) {
  return join(runDir(run), 'log.jsonl')
}

export function append(run, entry) {
  mkdirSync(runDir(run), { recursive: true })
  appendFileSync(logPath(run), `${JSON.stringify(entry)}\n`)
}

export function readLog(run) {
  const path = logPath(run)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

/**
 * What a screen is, for the purpose of "did I go somewhere and come back".
 *
 * The route and the heading together, because one route can draw two screens
 * (a list and the same list with something open on top of it) and because a
 * heading alone would merge two routes that happen to say the same word.
 */
export function screenId(url, heading) {
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.hash}|${(heading ?? '').trim().slice(0, 60)}`
}

/**
 * The numbers for one task, computed from its steps.
 *
 * Nothing here is accumulated as the run goes: every count is derived from the
 * log, so a run can be re-summarised after the fact and two people summarising
 * the same log get the same answer.
 */
export function summarise(steps) {
  const presses = steps.filter((s) => s.action === 'press' || s.action === 'key')
  const typed = steps.filter((s) => s.action === 'type')
  const deadEnds = presses.filter((s) => !s.navigated && !s.domChanged && !s.worldChanged)
  const changed = presses.filter((s) => s.worldChanged)

  const started = steps.length ? steps[0].startedAt : null
  const ended = steps.length ? steps[steps.length - 1].endedAt : null
  const wallMs = started && ended ? ended - started : 0
  const pressingMs = presses.reduce((total, s) => total + (s.endedAt - s.startedAt), 0)

  // Visits: maximal consecutive runs of steps on one screen.
  const visits = []
  for (const step of steps) {
    // Grouped by where somebody was standing when they pressed, not by where
    // they landed: attributing a press to the screen after it puts the press
    // that finally did something on the next screen's account.
    const id = step.screenBefore ?? step.screenAfter
    if (!id) continue
    const last = visits[visits.length - 1]
    if (last && last.screen === id) last.steps.push(step)
    else visits.push({ screen: id, steps: [step] })
  }

  /*
   * A backtrack is going somewhere and leaving without doing anything: you
   * arrived from a screen, changed nothing, and went back to the one you came
   * from.
   *
   * **"Back where I came from" rather than "anywhere I have already been",
   * and the first run is why.** The looser rule counted every step of a
   * carrying wizard, because that flow visits "Where it goes" once per book
   * and a visit whose own press only moved the flow on had changed nothing
   * *yet*. Seven books produced six backtracks that were nothing of the sort.
   *
   * What the looser rule was reaching for is caught better by a number that
   * needs no visit modelling at all: how many of the presses changed anything
   * (`pressesThatChangedTheWorld`). One in twenty is a task somebody spent
   * twenty presses on and got one thing out of, and no definition of a visit
   * has to be argued about first.
   */
  let backtracks = 0
  const backtrackDetail = []
  for (const [index, visit] of visits.entries()) {
    const previous = visits[index - 1]
    const next = visits[index + 1]
    const didSomething = visit.steps.some((s) => s.worldChanged)
    if (previous && next && !didSomething && next.screen === previous.screen) {
      backtracks += 1
      backtrackDetail.push({
        screen: visit.screen,
        steps: visit.steps.length,
        cameFrom: previous.screen,
        firstStep: visit.steps[0].step,
      })
    }
  }

  return {
    presses: presses.length,
    typedFields: typed.length,
    deadEnds: deadEnds.length,
    deadEndDetail: deadEnds.map((s) => ({ step: s.step, target: s.target, screen: s.screenBefore })),
    backtracks,
    backtrackDetail,
    pressesThatChangedTheWorld: changed.length,
    screens: new Set(visits.map((v) => v.screen)).size,
    visits: visits.length,
    steps: steps.length,
    wallSeconds: Math.round(wallMs / 100) / 10,
    pressingSeconds: Math.round(pressingMs / 100) / 10,
    notPressingSeconds: Math.round((wallMs - pressingMs) / 100) / 10,
    lostMoments: steps.filter((s) => s.action === 'lost').map((s) => ({
      step: s.step, screenshot: s.screenshot, words: s.text, screen: s.screenBefore,
    })),
  }
}
