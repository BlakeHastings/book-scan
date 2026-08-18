/**
 * One phone, kept alive between commands.
 *
 * Every command in this harness is a separate process, because the thing
 * driving it is an agent taking one decision at a time and a long-lived REPL
 * would hide how long each decision took. So the browser is launched detached,
 * with a debugging port, and each command attaches to it over CDP, does one
 * thing, and lets go. The page, its history and its scroll position survive
 * between commands exactly as a phone in somebody's hand would.
 *
 * The viewport is 414x896 and touch is on, which is the phone this app is for.
 * It is applied through CDP on every attach rather than once at launch: the
 * overrides belong to the debugging session, so they go when the session does.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

export const PHONE = { width: 414, height: 896 }

/** Launch a browser nothing owns, so the next command can find it again. */
export async function launchDetached({ port, profileDir, url }) {
  mkdirSync(profileDir, { recursive: true })
  const executable = chromium.executablePath()
  if (!existsSync(executable)) {
    throw new Error(`No Chromium at ${executable}. Run: npx playwright install chromium`)
  }
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    // The dev server speaks HTTPS with a self-signed certificate, because
    // Safari will not hand a camera stream to a page that does not.
    '--ignore-certificate-errors',
    `--window-size=${PHONE.width},${PHONE.height + 120}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    url ?? 'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  await waitForPort(port)
  return child.pid
}

async function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`Chromium never opened port ${port}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

/** Attach to the phone already in somebody's hand. */
export async function attach({ port, theme }) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  const page = context.pages().find((p) => !p.url().startsWith('devtools://')) ?? context.pages()[0]
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: PHONE.width,
    height: PHONE.height,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  if (theme) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: theme }],
    })
  }
  return { browser, context, page, cdp }
}

/** What the page says right now, as a person would read it off the screen. */
export async function readScreen(page) {
  const url = page.url()
  const heading = await page.evaluate(() => {
    const first = document.querySelector('h1, h2, [role="heading"]')
    return first?.textContent?.trim() ?? document.title ?? ''
  }).catch(() => '')
  const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
  return { url, heading, text: text.replace(/\s+/g, ' ').trim() }
}

/** The roles and names on screen, which is the closest thing to "what I can see". */
export async function outline(page) {
  try {
    return await page.locator('body').ariaSnapshot()
  } catch (error) {
    return `(no outline: ${error.message})`
  }
}

export function shotPath(dir, task, step, action) {
  mkdirSync(dir, { recursive: true })
  const safe = String(action).replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 24)
  return join(dir, `task${task}-step${String(step).padStart(2, '0')}-${safe}.png`)
}
