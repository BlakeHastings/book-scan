// Print every scenario result out of a Playwright JSON report, with the first
// lines of any error, so a loop's answer can be read as a table.
import { readFileSync } from 'node:fs'

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'))

function walk(suite) {
  for (const child of suite.suites ?? []) walk(child)
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      for (const result of test.results) {
        const message = (result.error?.message ?? '')
          .replace(/\x1b\[[0-9;]*m/g, '')
          .split('\n').filter((l) => l.trim()).slice(0, 3).join(' | ')
        console.log(
          `${result.status.padEnd(7)} ${spec.title}` +
          (result.status === 'passed' ? '' : `\n        ${message}`),
        )
      }
    }
  }
}

for (const suite of report.suites) walk(suite)
if (report.errors?.length) {
  for (const error of report.errors) {
    console.log(`RUN-ERROR ${(error.message ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0]}`)
  }
}
