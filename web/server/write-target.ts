/**
 * The catalogue a command-line tool that writes rows is pointed at: the value
 * after `--target` on its own command line, and nothing else. Not
 * `ConnectionStrings__bookscan`, which is in scope wherever the app is, and not
 * any other variable: a shell that happens to name a catalogue must not decide
 * what gets written to, and a target typed on the command line is one
 * `scripts/guard-live-data.mjs` can read.
 */
export function targetIn(args: readonly string[]): string {
  const at = args.indexOf('--target')
  const value = at >= 0 ? args[at + 1] ?? '' : ''
  // `--target --apply` is a target left out, not a catalogue called --apply.
  return value.startsWith('-') ? '' : value
}

export const NO_TARGET =
  'No --target. This writes rows, so it will not take its catalogue from the ' +
  'environment, and that includes ConnectionStrings__bookscan, which is the ' +
  'one the app is running on.\n' +
  "Under Aspire, read the api resource's connection out of `aspire describe` " +
  "and pass it as --target '<connection>'."
