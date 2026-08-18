# Somebody who has never seen this app tries to arrange their books

A harness for measuring how hard it is to arrange books here, so that a change
meant to make it easier has a number to move. See issue #388.

**This is not the end to end suite and it is not a gate.** `e2e/features/` proves
the app does what it is supposed to; this measures what it costs somebody to
work out how. The two share a package because they drive the same browser
against the same AppHost, and nothing else.

## The three tasks

They live in `tasks.mjs`, worded as somebody's goal, and **none of them names a
screen, a button or a route**. Naming one would be telling the driver the answer
and measuring nothing.

1. You have a new bookcase in the hall with four shelves. Get it into the app.
2. The comics should live on the bottom shelf of the hall bookcase, and only
   comics.
3. Move every non-fiction book off bookcase 4 and onto bookcase 3, and record
   that you have carried them.

They are run in that order against one world, because the second needs the
bookcase the first put up.

## Running a pass

From the repo root, then from `e2e/`:

```
aspire start --non-interactive     # the app, on ports Aspire chooses
aspire wait api && aspire wait web
cd e2e
npm ci                             # once
npm run ux:prepare                 # seed the baseline world, write baseline.json
npm run ux -- open --run <name> --theme light
```

Then, one command per thing the person does:

```
npm run ux -- task 1
npm run ux -- look
npm run ux -- press "Library"
npm run ux -- press "Add an area to this bookcase" --nth 3
npm run ux -- type "What you call it" "Hall"
npm run ux -- scroll down|up|top|bottom
npm run ux -- key Enter
npm run ux -- back
npm run ux -- note "..."
npm run ux -- lost "..."
npm run ux -- theme dark
npm run ux -- endtask completed|failed|abandoned "why"
npm run ux -- summary
npm run ux -- finish
```

Every command screenshots the phone afterwards, appends a step to
`runs/<name>/log.jsonl`, and prints what is on screen as roles and names, which
is the closest thing to "what I can see" that a machine can be given.

## The rules the driver is under

These are what make the numbers mean anything, and they are enforced by the
harness rather than promised in a prompt:

- **Press what you can see.** A target is named by its visible text. There is no
  way to pass a CSS selector or a test id, because a person cannot type one. A
  thing on screen with no name is a finding, not something to work around.
- **Never navigate by URL.** `open` goes to the front door once and after that
  the only way anywhere is pressing something.
- **Do not read `web/src/` first.** Whoever drives this is standing in for
  somebody who has never seen the app, and reading a component to find out where
  the furniture lives is exactly the knowledge a real person does not have. Read
  it afterwards, when explaining what happened.
- **The same seeded world every time.** `npm run ux:prepare` runs
  `web/scripts/seed-world.ts --reset` and writes what it built to
  `baseline.json`. Two runs against different worlds are two numbers that cannot
  be compared, and "I think I reset it" is not a seed.

The baseline world stands three bookcases: fiction on 1 and 2, non-fiction on 4,
twenty-seven catalogued books and eighteen in the queue. **There is no bookcase
3**, which is why task 3 is worth asking.

## Where the measurement is weak

Said here rather than discovered later, because a number nobody has qualified is
a number somebody will quote.

- **An agent is not a person.** It reads the whole screen at once and never gets
  bored, so nothing here measures fatigue or a person's eye sliding past the one
  line that mattered. It is also not confused by a word being slightly wrong in
  the way somebody would be; where it did get lost, the wall was total rather
  than merely discouraging.
- **The clock is the worst number in the set.** Time not pressing is mostly the
  driver thinking in a language model, plus about a second of harness on every
  command. Compare it between runs of the same harness and never against what a
  person would take.
- **The outline is a help nobody has.** The driver is given the roles and names
  on screen, so an unlabelled icon is legible to it and would be a wall for
  somebody. That makes every count here a **floor**: a person's numbers would be
  worse, never better.
- **`--nth` is the harness pointing.** Four buttons that all say "Add an area to
  this bookcase" are unambiguous on a screen, where the one under the Hall is
  plainly the one you want, and ambiguous to a text matcher. The flag is how the
  driver says "the fourth one", and the count of matches is recorded so that
  ambiguity stays visible.
- **One driver, one pass.** These are not averages. A second person would take a
  different route, and the value of a single pass is in the walls it hits rather
  than in the exact height of a bar.
- **Knowing the tasks in advance.** All three were read before the first press,
  which is truer to somebody with a job to do than to somebody browsing, but it
  does mean nothing here measures discovering that the app can do these things
  at all.

## Where the files are

| Path | What it is |
| --- | --- |
| `tasks.mjs` | The three goals, and the checks that decide from rows whether each was done |
| `metrics.md` | What each number means, exactly |
| `prepare.mjs` | Seeds the baseline world and records it in `baseline.json` |
| `drive.mjs` | The commands above |
| `lib/browser.mjs` | One detached phone at 414x896, attached to over CDP per command |
| `lib/world.mjs` | The fingerprint that says whether a press changed anything, and the completion queries |
| `lib/session.mjs` | The log, and all of the arithmetic |
| `runs/<name>/` | The screenshots, `log.jsonl`, `summary.json` and the written report |
