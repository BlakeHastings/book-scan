# What is measured, and exactly what each number means

Every number here is computed from `log.jsonl` by `summarise` in
`e2e/ux/lib/session.mjs`. Nothing is counted by hand and nothing is accumulated
while the run goes: the log is the record, and re-summarising an old log gives
the same answer as the day it was written. That matters more than it sounds,
because a definition **will** be corrected between passes, and when it is, every
earlier run can be recomputed under the new one instead of being stranded.

## The counts

**Presses.** Every click and tap, which is the count somebody would feel. A
`press` or a `key`. Looking, scrolling, writing a note and swapping the phone's
theme are not presses: nothing in the app was touched.

**Typed fields.** Filling a field is not a press and is not free either, so it
is counted separately rather than folded in.

**Presses that changed the world.** How many of those presses changed anything
in the database. This is the ratio that says most: twenty presses and one change
is a task somebody spent twenty presses on and got one thing out of.

**Dead ends.** A press that did nothing at all: it did not navigate, the text on
the page did not change, and no row changed. All three are recorded for every
press, so this needs no judgement.

**Backtracks.** Going somewhere and leaving without doing anything: a visit to a
screen where nothing changed, which ends by going back to the screen it was
entered from.

A *visit* is a run of consecutive steps on one screen, and a *screen* is the
route plus the heading, so one route drawing a list and then a sheet on top of
the list is two screens.

Two corrections the first run earned, both kept in the code where they were
made:

- the visit is grouped by **where somebody was standing when they pressed**,
  not where they landed. Attributing a press to the screen after it puts the
  press that finally did something on the next screen's account.
- the exit test is **back to where I came from**, not "anywhere I have already
  been". The looser rule counted six backtracks in a carrying flow that visits
  one screen once per book and was working perfectly.

**Wall clock, and time not pressing.** Wall clock is the last step's end minus
the first step's start. Pressing time is the time inside the press commands
themselves, and everything else is time not pressing, which is reading and
deciding. **This is the weakest number here** and the reasons are under
"Where the measurement is weak" in `README.md`.

**Screens and visits.** How many distinct screens the task touched and how many
times it moved between them. A journey that crosses eleven screens to move seven
books is saying something even when every press worked.

**Completed.** Decided by `check` in `e2e/ux/tasks.mjs`, from rows, never from
the driver's own account of itself. Each task's check is several claims that
fail separately, because "the books are off bookcase 4" and "the app is not
still waiting to be told they were carried" are different outcomes and one
boolean would lose the difference.

## The one thing that is not a number

**The moment it was not obvious what to do next**, in the driver's own words,
with the screenshot it was looking at. `npm run ux -- lost "..."` records one.
It is usually worth more than the counts, and it is the thing a second pass
should be able to read and say "that sentence cannot be written any more".

## What is deliberately not measured

**Nothing here rewards fewer presses.** A screen that collapses six presses into
one unlabelled gesture would score better on every count above and be worse, so
no fix should be argued for on press count alone. The question a fix has to
answer is which measurement it expects to move **and why that means somebody
understood the screen**: a dead end going away because the button now says what
it does is progress, and a dead end going away because the button was removed is
not.

## Screenshots

One per step, at 414x896 with touch on, named `task<N>-step<NN>-<action>.png`.
They are the evidence and they are committed. Both themes appear at least once
in a pass; the phone's theme is swapped with `npm run ux -- theme dark`, which
is not a press.
