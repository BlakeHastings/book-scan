# Second pass, 2026-08-18

The same three tasks, in the same order, against the same seeded world, on the
same phone at 414x896. Light theme throughout, then the same screens
photographed dark at the end. Commit under test: `b5337e8`.

The baseline it is compared against is `../baseline-light/report.md`, recorded on
`d622679`, the commit that landed the harness. Between the two, #391 (a move
deleted a bookcase), #392 (you could not prepare a shelf before the books
existed) and #393 (the corner menu opened off-screen) were all closed, and a
great deal else moved besides.

Every number below is recomputed from `log.jsonl` by `npm run ux -- summary`.
The definitions are in `../../metrics.md` and what is weak about them is in
`../../README.md` and at the end of this file.

## Nothing about the harness had to change to run it

Said first, because it is what makes the rest of the page mean anything. Same
`tasks.mjs`, same wording, same checks, same `summarise`, same seed script, no
edits of any kind. The only file that moved is `baseline.json`, and it moved
only in row ids: this pass seeded a database that had never been seeded before,
so the ids come out lower. The world it built is the same world, piece for piece
and book for book: three bookcases, seven areas, twenty-seven catalogued books,
eighteen in the queue, two rules, no bookcase 3.

## The table

Baseline first, this pass second.

| | Task 1: get the hall bookcase in | Task 2: comics on its bottom shelf | Task 3: non-fiction from 4 to 3 |
| --- | --- | --- | --- |
| Completed | yes, yes | **no, then yes** | yes, yes |
| Presses | 9, 9 | 20, **7** | 21, 21 |
| Fields typed | 1, 1 | 2, 2 | 0, 0 |
| Presses that changed anything | 6, 6 | 1, 2 | 8, 8 |
| Dead ends | 0, 0 | 0, 0 | 0, 0 |
| Backtracks | 0, 0 | 1, 0 | 0, 0 |
| Screens touched | 4, 4 | 8, **3** | 11, 11 |
| Visits | 5, 5 | 12, 3 | 16, 16 |
| Wall clock | 168s, 201s | 284s, **76s** | 171s, 165s |
| Time not pressing | 147s, 163s | 237s, 62s | 120s, 121s |
| Moments of being lost | 2, 2 | 2, **0** | 0, 0 |

Task 3 also gained two parts to its check since the baseline, both about
furniture, and both passed: five pieces still standing, fifteen area rows still
there. **Read the next section before believing them.**

## What got worse, and it is the headline

### The move no longer deletes the hall bookcase. It hides it.

At the baseline, applying "bookcase 4 to bookcase 3" deleted the Hall, its four
shelves and the name written on one of them, and said nothing (#391). That much
is fixed: the Hall is still a row afterwards, and the plan screen now has a
section headed **"Six areas move with them"** naming what happens to the
neighbours, which the baseline had nothing like.

What the person is left with is still not their bookcase.

`task3-step27-press.png`, `task3-step28-press.png`. After the move the fixtures
screen draws the Hall as one line with **no shelves at all**, and its own page
reads "0 areas, 0 books" under the heading "Nothing yet: it has no areas on it".
The four shelves built in task 1, including the one named Comics that task 2
told to hold comics, are on no screen anywhere in the app.

They are still in the database, and that is what makes this worse rather than
better:

```
fixture 4 "Hall" position 5   area 11 "Comics"  area_position -4
fixture 4 "Hall" position 5   area 10           area_position -3
fixture 4 "Hall" position 5   area  9           area_position -2
fixture 4 "Hall" position 5   area  8           area_position -1
```

Four rows at negative positions, in reversed order, drawn by nothing. Rule 3,
`tag is subject/comics`, still points at area 11. The app is holding a rule that
files books onto a shelf it will not show you.

Meanwhile the old bookcase 4, now standing empty, has **four** areas on it: 4A,
4B, 4C and a **4D** that nobody added (area 15, a new row). The baseline
recorded exactly that extra area and it is still being made.

**The harness's own check cannot see any of this**, and the check was added for
this defect. It asks whether the rows still exist, and they do, so
"no piece of furniture was destroyed on the way" and "no shelf and no name
written on one was destroyed" both reported ok against a world where four
shelves are unreachable. The rows survived; the furniture did not.

### Which means task 3 silently undoes task 2

Task 2 passed when it ended. Re-judging the same check against the world as it
stands **after** task 3, by hand, with nothing else changed:

```
there is a bottom shelf on the hall bookcase   ok    area 8 at position -1
the app records that comics belong there       FAIL  0 rule(s) point at it
nothing that is not a comic stands there       ok    0 book(s) there
```

The arrangement somebody set up in task 2 does not survive task 3. It is
recorded as a failure nowhere in this pass's numbers, because no task is ever
judged again after a later one has run, and that is a hole in the measurement
rather than a subtlety.

### Task 1 did not move at all

Same nine presses, same one field, same two moments of not knowing what to do
next, and 33 seconds longer on a clock that is the worst number in the set. Both
of the baseline's sentences about it can still be written word for word, and I
wrote them again before looking at the old ones.

## Where somebody still gets lost, ranked

### 1. The only door to the furniture is a round icon drawn as a person

`task1-step03-lost.png`. Unchanged from the baseline, and the fix that landed
between the two passes was about somewhere else. #393 pinned the sheet to the
glass, so it now appears where you pressed rather than at the top of the
document, and that is real: pressed from the bottom of a scrolled library it
opened on screen (`task1-step05-press.png`), where at the baseline the screen
dimmed and nothing appeared. **What the icon says did not change.** It is a head
and shoulders in the top corner, on Today and on Library, and nothing on either
screen mentions adding a bookcase.

Its accessible name is now "Your fixtures", which is why the harness walked
straight to it and a person would not. That is the "outline is a help nobody
has" weakness doing more damage this pass than last.

Two things noticed in passing. The sheet's own row and the banner button carry
**the same name**, "Your fixtures", which the harness recorded as an ambiguity
it had to resolve by matching a longer string. And "fixtures" is still not a
word anybody uses about their own bookcases, while every other surface in the
app says bookcase.

### 2. On a new bookcase, one Save, belonging to no field

`task1-step09-lost.png`. Unchanged. Typing a name into "What you call it" gives
that field no button, and neither does "What it is" below it. The only Save on
the screen sits two cards down, inside the card headed
"Nothing yet: it has no areas on it", above a line reading
"What it will be called". It does save the name in the field above, **and it
also leaves the screen**, which is the part I could not have guessed: I expected
either a shelf or nothing.

The good pattern is three screens away and unchanged too: type into an area's
name and a button appears saying "Call it Comics". That one is unmistakable.

### 3. What a move does to the furniture it was not about

`task3-step07-note.png`, then `task3-step29-note.png`. The plan does now say
"Hall A becomes 4A, Hall B becomes 4B, Hall C becomes 4C", which is far more
than the baseline said. It does not say what becomes of the fourth shelf, the
one named Comics, and it does not say in words what becomes of the piece called
Hall. I pressed Apply not knowing, and what happened was something the plan did
not describe.

## What got better, with the size of it

- **Task 2 went from impossible to seven presses.** #392 is properly fixed and
  the wording is the best in the app. Typing a word the catalogue has never seen
  into "Which tag has to be on a book" now offers
  **"Comics, New, under Subject"** with the sentence "A new one goes under
  Subject, where your catalogue's own words go, so a rule can ask for it.
  Nothing carries it yet, so this waits rather than files." Twenty presses to
  seven, eight screens to three, two moments of being lost to none, and a task
  the baseline called impossible completed. **Note what did not happen: the
  press count fell because a wall came down, not because a step was hidden.**
  The one press in twenty that used to change something is now two in seven.
- **The confirmation that reported success and wrote nothing now writes.**
  Second half of #391. "Write it down" changed the world, and the shelf
  afterwards reads "Anything tagged Comics" and "The books start here, so
  nothing overflows into it from the area before". The baseline's sentence about
  this cannot be written any more.
- **The corner sheet opens where you are.** #393. Described under "lost" above,
  because the icon it hangs off did not change.
- **The move keeps the pieces.** #391. Nothing was deleted this time, and the
  plan gained a section about the neighbours. It is the shape of the answer even
  though the outcome is still wrong.
- **Zero dead ends again**, across 37 presses. Every button in this app still
  does something when you press it.

## Smaller things, noted not ranked

- Today's counters went from "7 stuck" at the start of the pass to "8 stuck" at
  the end, and nothing said what became stuck or why.
- The fixtures sheet says "Five pieces, eleven areas" where the database holds
  fifteen area rows. The difference is exactly the Hall's four hidden shelves,
  so the count is honest about what it draws and silent about what it is not
  drawing.
- One 404 in the console on the first load of Today, same as the baseline.
- The first paint is still blank for about a second: the run's first screenshot
  caught an empty page again (`task0-step01-look.png`).
- The carrying flow is still the best thing here. Three trips named in walking
  order, "One checked out" left alone by name, a per-book "does it fit?", and
  nothing moves until you say you carried it. Twenty-one presses to move seven
  books is the right twenty-one presses.

## What the source says afterwards, read only once the pass was over

Not a fix and not a design, but a reader of a finding should be able to tell
whether it is one defect or two. It is one.

`web/infrastructure/shelving/areas.ts`. `relocateRunTo` (line 959) retires every
area of every fixture standing in the band, not only the fixture being moved
(line 970), through `retiredPosition` at line 734, which is `-(position + 1)`
and accounts exactly for -1, -2, -3, -4 and for the reversal. `writeBoundaries`
(line 1019) then restores a retired plank only when the re-walked derived list
lands on that same fixture position and plank (lines 866 to 875). After the run
moves down one bookcase nothing is derived at position 5 any more, so the Hall's
four planks are never restored, and the fixture falls through the loop at lines
911 to 914 as a no-op. The same shift puts a fourth derived plank on the fixture
at position 4, which never had one to restore, so it takes the insert branch at
lines 877 to 885: that is 4D.

So the extra area and the vanished shelves are the same event seen from two
ends, and a fix that treats them separately is fixing it twice.

## Where this measurement is weaker than the first pass

Everything under "Where the measurement is weak" in `../../README.md` still
holds. Three things are worse this time and they are worth more than the table.

- **The driver had read the baseline report.** This is the big one. I knew
  before pressing anything that the door to the furniture is the corner icon, so
  task 1's nine presses is a number from somebody who had been told the answer
  to the question task 1 exists to ask. A genuinely fresh person would have
  spent more, and the count being identical to the baseline's is therefore not
  evidence that nothing changed, only that nothing got faster.
  **Task 1's press count is the least trustworthy number in the table.** Tasks 2
  and 3 are less affected: task 2 was impossible at the baseline so there was no
  route to remember, and task 3's route is drawn on the screen it starts from.
- **The furniture check counts rows, not reachability.** It was added after the
  first pass precisely so a destroyed bookcase could not score the same as an
  intact one, and this pass walked straight through it: four shelves no screen
  will draw are four rows, and it said ok. Any number derived from it should be
  read as "nothing was deleted" and not as "the furniture is fine".
- **No task is judged again after a later one runs.** Task 2 passed and is now
  false. The harness has no notion of a task being undone, so the summary shows
  three completions where a person would say they got two and then lost one.

One thing is stronger:

- **The same seed, the same tasks, the same definitions, and no edits.** The
  comparison above is like for like, which is the whole point of the loop and is
  not something the first pass could claim about anything.
