# Baseline pass, 2026-08-17

One driver, who had not seen the app, three tasks in order against one seeded
world, on a phone at 414x896. Light theme throughout, then the same screens
photographed dark at the end. Commit under test: `d49a004`.

Every number below is recomputed from `log.jsonl` by `npm run ux -- summary`.
The definitions are in `../../metrics.md` and what is weak about them is in
`../../README.md`.

## The table

| | Task 1: get the hall bookcase in | Task 2: comics on its bottom shelf | Task 3: non-fiction from 4 to 3 |
| --- | --- | --- | --- |
| Completed | yes | **no** | yes |
| Presses | 9 | 20 | 21 |
| Fields typed | 1 | 2 | 0 |
| Presses that changed anything | 6 | **1** | 8 |
| Dead ends | 0 | 0 | 0 |
| Backtracks | 0 | 1 | 0 |
| Screens touched | 4 | 8 | 11 |
| Wall clock | 168s | 284s | 171s |
| Time not pressing | 147s | 237s | 120s |

**Task 2 is the worst and it is not close.** It is the only one that failed, it
cost the most presses, and one press in twenty changed anything at all. The
other nineteen were somebody walking the app looking for a door that is not
there.

Note what the dead end column does **not** say. Zero dead ends across fifty
presses means every button in this app does something when you press it. What
went wrong was never a button that did nothing; it was not knowing which button,
and once being told a thing had been written down when nothing had.

## Where somebody got lost, ranked by what it cost

### 1. You cannot say "comics go here" until you already own a comic

`task2-step06-lost.png`. On the bottom shelf of the new bookcase, "Change what
belongs here" then "Allow something here" asks *which tag has to be on a book*.
Typing `Comics` answers:

> Nothing you have goes by that. A rule can only ask for a tag some book already
> carries, so tag a book with it first.

The whole point of the task is to set the shelf up **before** carrying the
comics to it. The one place found that can invent a tag is the review pane of a
book still waiting in the queue: `Tags`, then `Add a tag`. The edit screen of a
book already on a shelf offers Fiction and Non-fiction and nothing else, and the
shelf that is asking for the tag cannot make one. So the app can hold the
arrangement somebody wants and there is no way to tell it, and the nearest thing
available was naming the shelf `Comics`, which files nothing.

**This task is impossible in this world as stated**, and that is a finding about
the app rather than a failure of the harness.

### 2. The move deleted the bookcase the first task put up

`task3-step34-look.png`. Before task 3 the furniture was bookcase 1, bookcase 2,
bookcase 4 and Hall, four pieces and eleven areas, with Hall carrying four
shelves and one of them named Comics. Applying "Bookcase 4 to bookcase 3" and
carrying the seven books left: bookcase 1, bookcase 2, a new bookcase 3 holding
the seven books on three areas, and bookcase 4 standing empty with a **fourth**
area on it that nobody added.

The Hall is gone. Its four areas are gone from the database, the shelf named
Comics with them, and nothing on screen said so at any point: the plan named
seven books and three trips, and every confirmation afterwards was about books.

An hour of somebody's afternoon disappeared silently inside an operation about
something else.

### 3. A confirmation that reported success and wrote nothing

`task2-step31-lost.png`. On the bottom shelf, the preview said plainly:

> Nothing has filed here by rule before, so this area stops taking what
> overflows from the area before it and begins a stretch of its own.

Pressing "Write it down" answered "Nothing changed about where the books
belong", and the card above it still read "Non-fiction, carrying on. Tagged
Non-fiction". The database agrees: no rule, no change of any kind. The one thing
the person was trying to fix, a brand new shelf in the hall quietly accepting
non-fiction overflow, was left exactly as it was, by a screen that had just
promised otherwise and then reported "Done".

### 4. The only door to the furniture is a button drawn as a person

`task1-step05-lost.png`. Both screens that draw the bookcases, Today and
Library, offer nothing that mentions adding one. The way through is a round
icon in the top corner drawn as a head and shoulders, which reads as an account
or a profile, and behind it a menu whose first row is "Your fixtures".

Two things make it worse than one wrong icon:

- **"Fixtures" is not a word somebody uses about their own shelves.** Every
  other surface in the app says bookcase.
- **The menu is anchored to the top of the page rather than the screen**
  (`task1-step06-press.png`). Pressed at the bottom of a long library, the
  screen dims and nothing appears. It only becomes visible after scrolling back
  to the top, which reads as the app being broken.

### 5. Two different patterns for saving a name, three screens apart

On a new bookcase there is one "Save", and it sits inside a card headed
"Nothing yet: it has no areas on it" with a line reading "What it will be
called" (`task1-step13-lost.png`). It does save the name in the field above it,
which is two cards away and has no button of its own. On an area, typing a name
makes a button appear that says "Call it Comics", which is unmistakable. The
second pattern is good and the first is a guess.

### 6. A new bookcase in the hall silently joins the non-fiction run

Every shelf added to it came up reading "Non-fiction, carrying on", because the
new piece stands after bookcase 4 and the run flows on. Nothing was said about
this while the bookcase was being made, and it is the reason "and only comics"
needed work in the first place.

### 7. Pressing Edit lands you in a different application

`task2-step12-press.png`. From a book, "Edit" leaves the cream, rounded, softly
lit app and arrives somewhere dark and square with blue buttons, a different
header and a different bottom navigation, **while the phone is set to light**.
It is legible and it works, and it does not look like the same product.

## Smaller things, noted not ranked

- The first paint of the Today screen is blank for over a second after load and
  after a hard navigation, long enough that the first screenshot of the run
  caught an empty page (`task0-step01-look.png`).
- One 404 in the console on the first load of Today. Nothing visible followed
  from it.
- The plan screen handled the checked-out book exactly right: "One checked out,
  left alone", named, before anybody set off carrying. The completion check had
  to be corrected to agree with it.

## What went well, because a pass that only lists faults is not honest

Task 3 is a genuinely good piece of work. "Move these books to another bookcase"
offered "Bookcase 3, a bookcase you do not have yet" without being asked, the
plan named every trip in the order somebody would walk them, and the flow
insisted that nothing moves until you say you carried it. Twenty-one presses to
move seven books across a room, with a per-book "does it fit?", is the right
number of presses rather than too many: each one is somebody's hands on a book.
