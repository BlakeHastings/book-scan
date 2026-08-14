# Designing a screen

How a screen in this app gets designed. Written down because it has now run six
rounds and produced an interface the owner is happy with, and because the parts
that make it work are not the obvious ones.

The short version: **draw it before you build it, put the drawing somewhere it
can be walked on a phone, and let the owner react to it rather than to a
description.**

## Why it is done this way

The owner said it, and it is the whole justification:

> Let's not move forward with actually implementing the UI yet. We're just gonna
> keep going back and forth a bit, make sure it's in a better state before we
> start that implementation. It's easier to change this mock up than it is to
> change our source code.

Six rounds of feedback cost a handful of wireframe changes. The same six rounds
against real screens would have cost six rewrites of working code, each with
tests, and each tempting somebody to defend what was already built.

## The loop

1. **The owner reacts to something he can see.** Not a description, not a list of
   options. A drawing, on his phone, at the size he will really use it.
2. **His words become an issue, quoted rather than paraphrased.** The phrasing
   carries what actually annoys him. "That looks very AI to me" and "they're not
   book cases, they are fixtures" are both more useful than a tidied-up version
   would be.
3. **An agent draws it in the gallery**, then opens every screen it touched at
   414x896 in both themes, screenshots them, and iterates before asking for
   review.
4. **It reports what it changed after looking**, which is a different list from
   what it set out to do, every time.
5. **The owner walks it and reacts again.** Back to 1.
6. **Only when he is happy does it get built**, as its own issue, against the
   drawing.

## The gallery

`web/src/design/` is the design system; `web/src/design/gallery/` is the
wireframe drawn with it. It is reachable in the running app so the owner can walk
it on his phone, and it stays after a screen is built, because the next round of
feedback needs somewhere to happen.

One definition, two callers: when the app needs a component the gallery has, the
component moves somewhere both import from. It is never copied. A component
copied into the app is two components that agree until one of them is edited.

## The rules file

`web/src/design/design.test.tsx` holds ten rules as tests. **Every one came from
a real correction or a real defect**, and each carries the reason in its own
comment:

- no emoji, anywhere
- no coloured rail down the side of a card
- the shelf has one edge
- no word out of the model reaches the interface
- the one action in a corner is an icon with a name
- a book screen is about the book, not about where it sits
- a spine is only as big as the catalogue can justify
- no two things in the library share a name
- the first screen is counts, and every count goes somewhere
- one row of books is one area

These are load-bearing. An agent that finds a rule awkward is told the rule wins,
because the alternative is relearning the same correction in three months. They
are also why the owner does not have to give the same note twice.

## What actually catches things

**Looking at it in sequence.** Screen by screen, a flow reads fine. Walked in
order, a bookend disappears between two screens showing the same shelf, a count
goes negative after carrying two books, and a screen offers itself at a moment
when it has nothing to say. None of those were visible one screen at a time.

**Drawing the states that are not the happy path.** Nothing to do, one item,
forty items, stopped halfway, and the answer changed while you were away. A
design that only draws the middle case is a design that will be rebuilt.

**Making the drawing survive real numbers.** The gallery draws a plausible
library; the app draws his. Zero, four digits, a book no catalogue has named, a
list of fifty-three when the drawing assumed three.

## Writing the brief

The parts that matter, beyond the obvious:

- **Quote the owner.** Do not summarise him.
- **Name what already exists**, so the same thing is not invented twice.
- **State the hard questions and say they must be answered deliberately**, rather
  than settled by whatever is easiest to draw. Say that a reasoned answer you
  disagree with is better than an unexamined one.
- **Say what not to get wrong**, and why, with the incident attached where there
  is one.
- **Say it is a wireframe**: static content, no wiring.
- **Ask what changed after looking.** This single question is why the flows are
  any good.

## When the drawing turns out to be wrong

It happens, and the drawing is not the authority the model is. A dialog drawn as
"2B holds 42 afterwards" implied books move when somebody confirms, and they do
not: only a person moving a book changes where a book is. The screen was built to
tell the truth and the departure was reported.

**Where a drawing and an invariant disagree, the invariant wins and somebody
says so out loud.**
