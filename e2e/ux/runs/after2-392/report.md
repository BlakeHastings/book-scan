# Task 2 before and after #392, 2026-08-18

Two passes of task 2 - "the comics should live on the bottom shelf of the hall
bookcase, and only comics" - run against the same seeded world, on a phone at
414x896, light theme, one driver each and neither having seen the app or the
other's run.

`before-392/` is the tree at `349f18b`. `after2-392/` is that tree with #392 on
it. Task 1 was run first in both, because task 2 needs the bookcase it puts up;
task 3 was not run, because nothing in this change touches it.

## The table

| | Before | After |
| --- | --- | --- |
| Completed | yes, by a workaround | **yes** |
| Presses | 53 | **9** |
| Fields typed | 2 | 1 |
| Presses that changed anything | 3 | 1 |
| Dead ends | 4 | **0** |
| Backtracks | 6 | **0** |
| Screens touched | 9 (30 visits) | **3** (4 visits) |
| Wall clock | 574s | **133s** |
| Time not pressing | 460s | 113s |
| Moments recorded as lost | 2 | **0** |

The #388 baseline (`baseline-light/`, commit `d49a004`) scored 20 presses and
**failed**. It belongs in the same column as the before pass and it is not the
same number, because a second driver takes a different route: that one gave up
where this one did not. Both hit the same wall, and it is the wall this change
is about.

## What "completed by a workaround" means

The before pass finished the task, and the way it finished is the finding:

> The only way to make the word Comics exist was to open an unrelated queued
> book, add the tag to it, then take it off again. Nothing on the fixtures or
> tags screens lets you name a category you do not yet own a book for.

That is fifty-three presses ending in somebody's book carrying a tag it never
had, so that a shelf could be told what it is for. A completion column saying
only "yes" would report that as a success.

The after pass typed the word where the rule is written:

> The only tags offered were Fiction and Non-fiction, so I typed "Comics" into
> "Which tag has to be on a book" and took the "Comics - New, under Subject"
> suggestion, then "Show me what would move" and "Write it down".

No book was touched.

## The number that is not an improvement

**Presses that changed anything went from 3 to 1**, and fewer of those is
usually the opposite of good. Here it is arithmetic rather than a loss: the
before pass wrote a tag onto a book, took it off again, and then wrote the rule,
which is three writes for one intention. The after pass writes once, because the
word and the rule are one press.

## What the second pass still got wrong, and this change does not fix

Recorded rather than tidied away, because a pass that lists only wins is not
honest:

- **Nothing says which of Hall A, B, C, D is the bottom one.** A driver recorded
  that as a lost moment and had to infer it from the fill order.
- **Every new shelf in the hall arrives reading "Non-fiction, carrying on"**,
  which made both drivers unsure whether they were editing an inherited rule or
  a real one. That is #388's own finding 6 and it is untouched here.
- **The rule editor has no Save**, only "Show me what would move", and a driver
  hesitated over whether that was the way forward or a detour. That is
  deliberate - nothing is written until a plan has been read - and it is still
  worth knowing that it reads as a detour.
- **"What it will be called" on a new fixture is a label with no field behind
  it.** #388's finding 5, still there, and it cost a dead end in task 1 in both
  passes.

## A pass was thrown away, and why

The first after pass scored 10 presses and **proved nothing**, because it never
had to name a word: `ux:prepare` truncates the books and leaves the `tag` table
alone, so `subject/comics`, invented by the before pass, was still in the
vocabulary and was simply offered to the next driver.

`web/scripts/seed-world.ts` now puts the vocabulary back to what migration
`0002` leaves, alongside the furniture it already restored, and the run above
was driven against a catalogue whose only tags were Fiction and Non-fiction.
**Any measured pass before that fix that turned on a tag was comparing two
different worlds.**

## What is in these directories

`before-392/` keeps its log, its summary and the two screenshots it recorded as
lost moments; the other 82 screenshots were dropped rather than commit 32 MB of
a journey whose only interesting frames are those two. `after2-392/` is whole.
