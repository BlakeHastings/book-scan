/**
 * The harness somebody who has never seen this app drives it through.
 *
 * One command, one thing: attach to the phone, do it, screenshot it, write down
 * what it cost, let go. Everything is measured as a side effect of doing it, so
 * there is nothing to remember to count and nothing to argue about afterwards.
 *
 * The two rules that make the numbers mean anything:
 *
 *  - **Press what you can see.** Targets are named by their visible text, never
 *    by a CSS selector or a test id. A person cannot type `[data-testid=...]`,
 *    so neither can this. If a thing on screen has no name, that is a finding
 *    and not something to work around.
 *  - **Never navigate by URL.** `open` goes to the front door once. After that
 *    the only way anywhere is pressing something, which is the same constraint
 *    the person is under.
 *
 * Usage, from e2e/:
 *
 *     npm run ux -- open --run baseline-light --theme light
 *     npm run ux -- task 1
 *     npm run ux -- look
 *     npm run ux -- press "Shelves"
 *     npm run ux -- type "Name" "Hall"
 *     npm run ux -- scroll down
 *     npm run ux -- lost "Nothing here says how to add a bookcase."
 *     npm run ux -- endtask completed
 *     npm run ux -- finish
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { UX_ROOT, whereIsTheApp } from './lib/aspire.mjs'
import { attach, launchDetached, outline, readScreen, shotPath } from './lib/browser.mjs'
import { append, currentRun, readLog, runDir, screenId, summarise, writeCurrent, RUNS_ROOT } from './lib/session.mjs'
import { fingerprint, withClient } from './lib/world.mjs'
import { judge, taskById, TASKS } from './tasks.mjs'

const [command, ...rest] = process.argv.slice(2)

/** Flags, in the one form this file accepts: --name value. */
function flag(name, fallback = undefined) {
  const at = rest.indexOf(`--${name}`)
  return at === -1 ? fallback : rest[at + 1]
}

/** The positional arguments, which is everything that is not a flag or its value. */
function positional() {
  const out = []
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) { i += 1; continue }
    out.push(rest[i])
  }
  return out
}

const BASELINE = join(UX_ROOT, 'baseline.json')

async function worldFingerprint(connection) {
  return withClient(connection, (client) => fingerprint(client))
}

/** How long to let the app answer before deciding a press did nothing. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(1200)
}

/**
 * Find the thing on screen with this name.
 *
 * The order is the order somebody's eye would take: something you press before
 * something you read, an exact name before a name that merely contains it. The
 * number of matches is recorded, because two things with the same name is a
 * finding about the screen rather than a detail of the search.
 */
async function findTarget(page, name, role) {
  const strategies = []
  const roles = role ? [role] : ['button', 'link', 'tab', 'menuitem', 'option', 'radio', 'checkbox', 'switch']
  for (const exact of [true, false]) {
    for (const r of roles) strategies.push({ how: `role=${r}${exact ? ' exact' : ''}`, make: () => page.getByRole(r, { name, exact }) })
    strategies.push({ how: `label${exact ? ' exact' : ''}`, make: () => page.getByLabel(name, { exact }) })
    strategies.push({ how: `text${exact ? ' exact' : ''}`, make: () => page.getByText(name, { exact }) })
    strategies.push({ how: `title${exact ? ' exact' : ''}`, make: () => page.getByTitle(name, { exact }) })
    strategies.push({ how: `placeholder${exact ? ' exact' : ''}`, make: () => page.getByPlaceholder(name, { exact }) })
  }

  for (const strategy of strategies) {
    const locator = strategy.make().locator('visible=true')
    const count = await locator.count().catch(() => 0)
    if (count > 0) return { locator, how: strategy.how, count }
  }
  return null
}

/**
 * One step: what it cost, what it changed, and a picture of the screen after it.
 *
 * Every action goes through here, including the ones that are not presses, so
 * the log is a complete account of the session rather than a list of clicks
 * with the thinking cut out of it.
 */
async function step(run, action, { target, text, act, counts = false }) {
  const log = readLog(run)
  const previous = log.filter((entry) => entry.endedAt).at(-1)
  const startedAt = Date.now()

  const { browser, page } = await attach({ port: run.port, theme: run.theme })
  const consoleErrors = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)) })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 200)}`))

  try {
    const before = await readScreen(page)
    const worldBefore = counts && run.connection ? await worldFingerprint(run.connection) : null

    let failed = false
    let error = null
    let how = null
    let matches = null
    if (act) {
      const result = await act(page).catch((e) => ({ failed: true, error: e.message.split('\n')[0] }))
      if (result?.failed) { failed = true; error = result.error }
      how = result?.how ?? null
      matches = result?.count ?? null
      await settle(page)
    }

    const after = await readScreen(page)
    const worldAfter = counts && run.connection ? await worldFingerprint(run.connection) : null

    run.step += 1
    const shot = shotPath(runDir(run), run.task, run.step, action)
    await page.screenshot({ path: shot }).catch(() => {})

    const entry = {
      step: run.step,
      task: run.task,
      action,
      target: target ?? null,
      text: text ?? null,
      how,
      matches,
      startedAt,
      endedAt: Date.now(),
      gapMs: previous ? startedAt - previous.endedAt : 0,
      url: after.url,
      heading: after.heading,
      screenBefore: screenId(before.url, before.heading),
      screenAfter: screenId(after.url, after.heading),
      navigated: before.url !== after.url,
      domChanged: before.text !== after.text,
      worldChanged: worldBefore !== null ? worldBefore !== worldAfter : null,
      failed,
      error,
      consoleErrors: consoleErrors.slice(0, 5),
      screenshot: shot.replace(`${runDir(run)}\\`, '').replace(`${runDir(run)}/`, ''),
    }
    append(run, entry)
    writeCurrent(run)

    const body = await outline(page)
    console.log(JSON.stringify({
      step: entry.step, task: entry.task, action, target: entry.target,
      matchedBy: how, matches, failed, error,
      navigated: entry.navigated, domChanged: entry.domChanged, worldChanged: entry.worldChanged,
      deadEnd: counts && !entry.navigated && !entry.domChanged && !entry.worldChanged,
      url: entry.url, heading: entry.heading,
      gapSeconds: Math.round(entry.gapMs / 100) / 10,
      screenshot: entry.screenshot,
      consoleErrors: entry.consoleErrors,
    }, null, 2))
    console.log('--- what is on screen ---')
    console.log(body.length > 6000 ? `${body.slice(0, 6000)}\n... (outline truncated)` : body)
  } finally {
    await browser.close().catch(() => {})
  }
}

switch (command) {
  case 'open': {
    const id = flag('run') ?? `run-${Date.now().toString(36)}`
    const theme = flag('theme', 'light')
    const port = Number(flag('port', '9333'))
    const { web, connection } = await whereIsTheApp()
    const url = flag('url', web)

    const dir = join(RUNS_ROOT, id)
    mkdirSync(dir, { recursive: true })
    const profile = join(dir, '.profile')
    rmSync(profile, { recursive: true, force: true })
    const pid = await launchDetached({ port, profileDir: profile, url })

    const run = { id, theme, port, pid, connection, web: url, task: 0, step: 0, startedAt: Date.now() }
    writeCurrent(run)
    append(run, { step: 0, task: 0, action: 'open', url, theme, startedAt: Date.now(), endedAt: Date.now() })
    console.log(`[ux] run ${id} on ${url} in ${theme} theme, chromium pid ${pid}`)
    await step(run, 'look', {})
    break
  }

  case 'task': {
    const run = currentRun()
    const task = taskById(positional()[0])
    run.task = task.id
    run.step = 0
    writeCurrent(run)

    /*
     * The furniture as it stands when the task begins, recorded so the check at
     * the end can ask whether any of it is gone.
     *
     * `baseline.json` cannot answer that: it is the world the seed built, and
     * what the second and third tasks have to be judged against is what the
     * person had **after the first one**. #391 is why it is here. Applying a
     * move in task 3 deleted the bookcase task 1 put up, and the check passed,
     * because every part of it was about books and the furniture nobody carried
     * anything to was nobody's number.
     */
    const standing = (await (await import('./lib/world.mjs')).worldState(run.connection)).furniture

    append(run, {
      step: 0, task: task.id, action: 'task-start', text: task.goal, standing,
      startedAt: Date.now(), endedAt: Date.now(),
    })
    console.log(`[ux] task ${task.id}: ${task.goal}`)
    await step(run, 'look', {})
    break
  }

  case 'look': {
    await step(currentRun(), 'look', {})
    break
  }

  /**
   * Turn the phone's own light or dark setting over.
   *
   * Not a press: nothing in the app was touched, and somebody changing their
   * phone's theme has not spent an interaction on this app. It re-looks
   * afterwards so the run holds a picture of the same screen in both.
   */
  case 'theme': {
    const run = currentRun()
    run.theme = positional()[0] === 'dark' ? 'dark' : 'light'
    writeCurrent(run)
    await step(run, 'look', {})
    break
  }

  case 'scroll': {
    const where = positional()[0] ?? 'down'
    await step(currentRun(), 'scroll', {
      target: where,
      act: async (page) => {
        await page.evaluate((direction) => {
          const by = { down: 600, up: -600, top: -1e6, bottom: 1e6 }[direction] ?? 600
          const scroller = [...document.querySelectorAll('*')].find((el) => {
            const style = getComputedStyle(el)
            return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 40
          })
          if (scroller && scroller !== document.body) scroller.scrollBy({ top: by })
          else window.scrollBy({ top: by })
        }, where)
        return {}
      },
    })
    break
  }

  case 'press': {
    const run = currentRun()
    const name = positional()[0]
    if (!name) throw new Error('press what? npm run ux -- press "<the words on it>"')
    const nth = Number(flag('nth', '0'))
    const role = flag('role')
    await step(run, 'press', {
      target: name,
      counts: true,
      act: async (page) => {
        const found = await findTarget(page, name, role)
        if (!found) return { failed: true, error: `nothing on screen says "${name}"` }
        const element = found.locator.nth(nth)
        await element.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
        try {
          await element.click({ timeout: 5000 })
        } catch (e) {
          return { failed: true, error: e.message.split('\n')[0], how: found.how, count: found.count }
        }
        return { how: found.how, count: found.count }
      },
    })
    break
  }

  case 'type': {
    const run = currentRun()
    const [field, value] = positional()
    await step(run, 'type', {
      target: field,
      text: value,
      counts: true,
      act: async (page) => {
        const found = await findTarget(page, field, 'textbox')
          ?? await findTarget(page, field, 'spinbutton')
          ?? await findTarget(page, field)
        if (!found) return { failed: true, error: `no field called "${field}"` }
        try {
          await found.locator.nth(Number(flag('nth', '0'))).fill(value)
        } catch (e) {
          return { failed: true, error: e.message.split('\n')[0], how: found.how, count: found.count }
        }
        return { how: found.how, count: found.count }
      },
    })
    break
  }

  case 'key': {
    const run = currentRun()
    const key = positional()[0] ?? 'Enter'
    await step(run, 'key', {
      target: key,
      counts: true,
      act: async (page) => { await page.keyboard.press(key); return {} },
    })
    break
  }

  case 'back': {
    const run = currentRun()
    await step(run, 'press', {
      target: 'browser back',
      counts: true,
      act: async (page) => { await page.goBack().catch(() => {}); return { how: 'browser back' } },
    })
    break
  }

  case 'note':
  case 'lost': {
    const run = currentRun()
    const words = positional().join(' ')
    await step(run, command, { text: words })
    break
  }

  case 'endtask': {
    const run = currentRun()
    const [outcome, ...why] = positional()
    const task = taskById(run.task)
    const steps = readLog(run).filter((entry) => entry.task === run.task && entry.action !== 'task-start')
    const numbers = summarise(steps)

    const world = await (await import('./lib/world.mjs')).worldState(run.connection)
    const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { furniture: [] }
    // What was standing when this task began, off its own task-start entry. An
    // older log has none, and an empty list makes the check say nothing rather
    // than fail a run it cannot judge.
    const standing = readLog(run)
      .find((entry) => entry.task === run.task && entry.action === 'task-start')?.standing ?? []
    const verdict = judge(task, world, baseline, standing)

    const record = {
      step: run.step + 1, task: run.task, action: 'task-end',
      outcome: outcome ?? 'unknown', why: why.join(' '),
      numbers, verdict,
      startedAt: Date.now(), endedAt: Date.now(),
    }
    append(run, record)
    console.log(JSON.stringify({ outcome: record.outcome, numbers, verdict }, null, 2))
    break
  }

  case 'summary': {
    const run = currentRun()
    const out = TASKS.map((task) => {
      /*
       * The task's own steps and nothing after it. Anything logged against a
       * task id once it has ended (a theme swapped over to photograph the same
       * screens dark, say) is evidence, not effort, and adding it to the wall
       * clock would make the numbers depend on what somebody did afterwards.
       */
      const mine = readLog(run).filter((entry) => entry.task === task.id && entry.action !== 'task-start')
      const ended = mine.findIndex((entry) => entry.action === 'task-end')
      const steps = (ended === -1 ? mine : mine.slice(0, ended))
      const end = mine.find((entry) => entry.action === 'task-end')
      return { task: task.id, goal: task.goal, outcome: end?.outcome ?? 'not attempted', numbers: summarise(steps), verdict: end?.verdict ?? null }
    })
    const path = join(runDir(run), 'summary.json')
    writeFileSync(path, `${JSON.stringify({ run: run.id, theme: run.theme, tasks: out }, null, 2)}\n`)
    console.log(JSON.stringify(out, null, 2))
    console.log(`[ux] written ${path}`)
    break
  }

  case 'finish': {
    const run = currentRun()
    try {
      const { browser } = await attach({ port: run.port })
      await browser.close()
    } catch {
      // Already gone.
    }
    try { process.kill(run.pid) } catch { /* already gone */ }
    // The profile is gitignored and Windows holds its files open for a while
    // after the process goes, so a failure to delete it is not worth an exit
    // code that reads as "the run did not finish".
    await new Promise((r) => setTimeout(r, 1500))
    try { rmSync(join(runDir(run), '.profile'), { recursive: true, force: true }) } catch { /* held open */ }
    console.log(`[ux] closed run ${run.id}`)
    break
  }

  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0])
    process.exitCode = 1
}
