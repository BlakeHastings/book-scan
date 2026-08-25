// Dump the console errors and the failed requests out of a Playwright trace.
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const zip = process.argv[2]
const dir = mkdtempSync(join(tmpdir(), 'trace-'))
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`])

for (const file of readdirSync(dir)) {
  if (!file.endsWith('.trace') && !file.endsWith('.network')) continue
  for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'console' && e.messageType === 'error') {
      console.log('CONSOLE-ERROR', JSON.stringify(e.text))
    }
    if (e.type === 'event' && e.method === 'pageError') {
      console.log('PAGE-ERROR', JSON.stringify(e.params).slice(0, 400))
    }
    if (e.type === 'resource-snapshot') {
      const status = e.snapshot.response?.status
      if (status === undefined || status < 0 || status >= 400) {
        console.log('FAILED-REQUEST', status, e.snapshot.request.url.slice(0, 160))
      }
    }
  }
}
rmSync(dir, { recursive: true, force: true })
