# Reading status

The specification for #395, which is the answerable half of #139. It decides
whether this app can say what somebody's relationship to a book is, and it does
that without deciding who somebody is.

**Nothing here is built.** This document is the argument, and it is written to be
argued with. Every decision below carries its reasoning, because a decision
stated without one cannot be reviewed, only agreed with.

What the owner asked for:

> The ability to mark books as read, and a percentage even. A very easy way for a
> user to filter by books that are not read, or show all books that are read, or
> mark a book as read, or mark a book as a percentage read. This is where we
> start moving away from that book scan focus into also a library, or kind of
> book list focus as well.

## The short version

| Question | Answer |
| --- | --- |
| Whose status? | The collection's, with nobody named. One record, no person column, and the whole table is implicitly the owner's. |
| What it costs when #171 lands | A `reader_id` backfilled by a guess over every row written before then, a widened unique index, a per-reader view, and a filter that has to say whose. |
| The states | Three verbs a person presses: started, finished, gave up. Unread is the absence of a row. |
| Is it a tag? | No, and the reason is that a tag is a lever on the shelf. |
| A percentage | Derived at read time from a page number over `books.pages`. Never stored. |
| The quarter with no page count | Shows the page it is on and no percentage, and offers the page count for filling in. |
| Does it touch placement? | No. Not a kind, not a state, not a rule field, not a sort key. |
| What the first screen says | Nothing, in v1. There is a test that says the counts are five. |
| New tables | One, `book_reading`, plus one view over it. |
| New columns on `books` | None. |
| Rows the migration writes | Zero. |

## 1. Whose reading status

**Decision: one reading record for the collection, with no person named anywhere
in it.**

This is the fork #139 says everything else is downstream of, so it is settled
first.

### Why not per person, now

Per person needs a person, and there is no person. `claimed_by` and `edited_by`
are free text somebody typed, and #171 question 3 is what to do about exactly
those two columns when accounts arrive. **Adding a third free-text name is adding
to a bill that is already itemised.** The alternative, a real `reader` row now,
is #171's easy half done early and its hard half left undone: "every route is
unauthenticated", and requiring identity on every path is the work. A
`reader_id` on every row set to the same value forever is the failure mode #395
names by name, a user column nobody fills in.

### Why not wait for #171

#171 is `shaping`, sequenced after #170, and gated on five questions nobody has
answered. Reading status is wanted now, is small, and is not blocked by the thing
the epic thought blocked it. #139 said "design this now, implement it after
Postgres lands"; Postgres landed on 2026-08-06 and #232 finished the cut-over, so
that condition is spent.

### What the household argument actually says

#139 says three people touch this catalogue and concludes "if two people read the
same book, 'read' is not a property of the book". That is true and it is not
quite the case at hand. The three roles in `docs/domain-model.md` are Scanner,
Corrector and Shelver. **They are three people cataloguing, not three people
reading.** The request is one person's ("how can I keep track of my reading
status of my books"), and the collection has one row with one owner on it.

So the honest position is not "reading is a property of the book". It is: **this
record belongs to one person, the schema does not say which, and the app says so
out loud rather than pretending the question was not asked.** The interface word
is a first-person one ("You have read this"), which is a claim about the person
holding the phone and is true today because there is only one such person's
record to hold.

### What it costs when #171 lands

Not zero. Five things, in descending order of how much they hurt.

1. **Every row written before that day has to be attributed to somebody, and the
   attribution is a guess.** `book_reading` gains `reader_id NOT NULL`, and the
   backfill can only set it to the collection's owner. If somebody else in the
   house marked twenty books read, the record will say the owner read them and
   nothing anywhere will record that the value was inferred rather than stated.
   The size of the guess is however many readings exist on that day, which after
   a year of use is plausibly several hundred. The mitigation is this
   repository's existing habit and not a new mechanism: the migration counts what
   it attributed and says so, the way `0016` counted how many of the rows it
   rewrote were a person's. **It is a one-time misattribution of a soft fact, and
   it is not recoverable from the data.**
2. **The partial unique index widens.** `unique (book_id) where state = 'reading'`
   becomes `unique (book_id, reader_id) where state = 'reading'`, because two
   people genuinely can have two bookmarks in one house.
3. **`current_reading` becomes one row per book per reader**, so every caller
   that treats it as one row per book changes. The fold itself does not: it
   already folds many rows into one standing and would fold within a reader
   instead of within a book.
4. **The two wire fields become the requesting person's**, which makes a book's
   JSON depend on who asked. Anything that caches a book by id alone is wrong from
   that moment. Nothing does today, and that is a thing to check rather than
   assume.
5. **The filter has to say whose.** "Read" becomes "read by me", and a household
   will immediately want "read by anybody". That is a wording change on one
   screen and a second predicate in one query.

Costs 2 through 5 are a day's work between them. Cost 1 is the one that cannot be
bought back, and it is the price of not inventing accounts in order to record
that somebody finished a novel.

### One thing this decision buys cheaply, and it is not a reason for it

The reading record is its own table rather than columns on `books`, which is
argued in section 7 on its own merits (re-reads, and not widening the aggregate
root). It has the side effect that #171's cost 1 is a column added to a small
table rather than a reshaping of the catalogue. **That is a consequence, not the
justification.** If the only reason for a separate table were the multi-user
world, the table would be designing for the multi-user world, which this document
is told not to do.

## 2. Reading is not checkout, and the model must keep them apart

`checked_out` is a fact about a room. `docs/shelving.md`: a checked-out book "is
off the shelf and holds no position to disagree with", it is excluded from the
misfile list, and it is drawn in the library with the word `Checked out` where
its plank would be. Going out writes one `checked_out` row in `book_placement`
and coming back writes `checked_in` and then `placed` at the plank it came off.

Reading is a fact about a person. The two coincide most of the time and are
different facts, and there are two everyday cases where they come apart:

- a book lent to a friend, which is checked out and not being read;
- a book read in an armchair beside the shelf, which is being read and is not
  checked out.

**So: reading status writes nothing into `book_placement`, adds no placement
kind, adds no `books.state` value, and adds no `rule_condition.field`.** That last
one is not a formality; see section 5.

### The consequence people will not like

**Starting a reading does not check a book out, and checking a book out does not
start a reading.** Two separate presses when both are true.

The temptation is to make one press do both. The reason not to is the model's
oldest rule: only a person carrying a book changes where a book is. A button that
quietly removed a book from a plank because somebody said they were reading it
would make the shelf lie about a room, and the misfile list is built out of the
shelf telling the truth. `docs/process/designing-a-screen.md` records the same
correction being made once already: a drawing implied books move when somebody
confirms, they do not, and the invariant won.

What the interface may do is **offer** the second press. On the book screen, a
book that has just been started and is currently shelved may show `Take it with
you` beside the reading control, which is the existing check-out call, labelled,
skippable, and a press of its own. One press does one thing.

### The reverse case

Checking a book in does not finish a reading, for the same reason in reverse: a
book comes home half read all the time.

## 3. The states, and why there are three

**Three verbs a person presses, and one state nobody maintains.**

| The person presses | The row says | The interface word |
| --- | --- | --- |
| nothing, ever | no row exists | Not read yet |
| I am reading this | `reading` | Reading |
| I have read this | `finished` | Read |
| I gave up on this | `abandoned` | Gave up |

Each one has to earn a place, because every state is a tax somebody pays by hand
forever.

**Unread is not a state and must not be one.** It is the absence of any row. This
is the single most consequential small decision in the document, and section 10
is why: if unread were a stored state, shipping this would mean writing 238 rows
asserting something nobody has ever said, over somebody's real catalogue. As an
absence it means the migration writes nothing at all.

**`reading` earns its place** because it is the only state that answers "what is
on the go", which is the question asked from the sofa and the one the owner
described a percentage against.

**`finished` earns its place** because it is the thing that was asked for, and
because it is the one press that has to work while holding a book at a shelf.

**`abandoned` earns its place for an indirect reason, and it is the interesting
one.** Nobody wants a "gave up" list. What they want is for the "reading" list to
be honest, and without a way to stop a reading, every book somebody started and
put down stays on that list forever until the list is worthless. The only other
way to stop it is to delete the reading, which costs the same press and loses the
fact that the book was tried. **It is not a state people want, it is the state
that stops another state rotting**, and it costs one extra word in one sheet.

### What is refused

**`want-to-read` is refused as a state.** It is a different axis: #139 lists it
beside a wishlist for books not owned, and a wishlist is about books that are not
in this catalogue at all, which is a different feature with a different table. For
a book that *is* owned, the intention has no duration, no progress and no
outcome, so it is one bit of content, and section 5's test says a fact with one
bit of content and no duration is a tag. `mine/want-to-read` can be made by hand
today, needs no schema, and `book_tag.added_at` already records when the wish
started. If it turns out to be pressed constantly it can be promoted later, and
promoting a tag to a state is a smaller change than demoting a state to a tag.

**`owned-but-not-mine`, `lent to`, `re-reading` are all refused.** The first two
are #171 and lending. The third is not a state: a re-read is a second row in the
same three states, which is what section 7's shape is for.

### The standing, and why it is a fold rather than the latest row

A book with several readings needs one word. The word is a fold with a
precedence, defined once in `web/domain/reading/`:

1. **Reading**, if any reading is open.
2. otherwise **Read**, if any reading finished.
3. otherwise **Gave up**, if any reading was abandoned.
4. otherwise **Not read yet**.

**It is deliberately not "the latest row".** A book finished in 2019 and
abandoned halfway through a re-read in 2026 has been read, and "latest row wins"
would say the person never got through it. This is where the fold differs from
`current_photograph`, which really is the newest row, because a newer photograph
supersedes an older one and a newer reading does not supersede an older one.

## 4. What a percentage means

The owner asked to "mark a book as a percentage read". Two different percentages
are hiding in that sentence and they are separated here.

### Through a book

**A page number is stored. A percentage is derived at read time and never
stored.**

Three reasons, and the third is the one that matters.

1. **A page is what a person can read off the object in their hand.** On the sofa,
   halfway through a chapter, "I am on 212" is a number you can see. "I am 43
   percent through" is arithmetic nobody does.
2. **A page number survives a correction.** Page counts in this catalogue come
   from Google Books and some of them are wrong. A stored percentage computed
   against a wrong page count is wrong forever and silently; a stored page becomes
   right the moment the count is fixed.
3. **This repository already settled the general form of this question.** Labels
   are derived at read time because "a stored label goes stale the moment a
   fixture is renamed". A percentage is a label over a page count and it goes
   stale the same way.

The derivation lives in one place in `web/shared/`, so the client and the server
compute it identically, the way filing rules already do.

### Through the collection

"Forty of two hundred and thirty-eight books read" is a completely different
number and has nothing to do with page counts. It is left out of v1 entirely; see
section 12 for why, and it is not the number the owner was describing.

### The quarter with no page count

`books.pages` holds the count, and it is a **text** column defaulting to the empty
string, written from Google Books' `pageCount` when there is one. #395 measures
it at 183 of 238, about 77 percent. So roughly a quarter of the catalogue cannot
produce a percentage, and because the column is text with nothing validating it,
there are three cases and not two:

| `books.pages` | What the screen shows |
| --- | --- |
| a number | `p. 212 of 496` and `43%`, and a bar |
| empty | `p. 212`, and no percentage and no bar |
| not a number | `p. 212`, and no percentage and no bar |

**What the other quarter does is show the page it is on and nothing else.** Not
zero percent, not a guess, not a bar drawn against an invented denominator. The
book records progress exactly as well as any other book; the only thing it cannot
draw is the ratio.

**And it is one number away from being fixed by the person holding the object
with the number printed in the back of it.** Where the percentage would have been,
the screen offers `Say how many pages it has`, which writes `books.pages` through
the existing edit path. That is worth more than a percentage: it repairs the
catalogue rather than the reading record, and it repairs it for the spine widths
too, which are drawn from the same column.

Two smaller rules that follow:

- **A page above the page count is not refused.** Front matter is numbered
  separately and catalogue page counts are wrong often enough. The stored page is
  what the person said, the displayed percentage is capped at 100, and the screen
  offers the page count for correction. Writing a guess over what somebody stated
  is the thing `docs/shelving.md` refuses to do with a location, for the same
  reason.
- **Page zero is not a page.** "Not said" is the null, and there is no way to
  press it.

## 5. Is reading status a tag

**No.** This is the question #395 says has to be argued rather than assumed, and
the case for yes is genuinely strong, so it goes first.

### The case for yes, which is better than it looks

- **The filter is free.** The library's filter row has exactly three controls
  (the tag summary, the find button, the view switcher), and the tag summary
  already opens a whole screen of groups with book counts on each. `mine/read`
  and `mine/reading` would appear there with no design work, no new query
  parameter, no new route, and no fourth control. #395 correctly names a fourth
  control as a design cost, and the tag route pays none of it.
- **The vocabulary already nests, and slugs like `mine/lent-out` are the
  example in `docs/data-model.md`.** So the namespace was arguably built with
  exactly this in mind.
- **A person can already make one by hand** since #372, which means somebody
  could have this feature this afternoon without anyone writing any code.
- **Zero schema.** No table, no migration, no view, nothing over 238 books.

### Why it is refused anyway

**1. A tag is a lever on the shelf, and reading status would move books.**

`rule_condition` matches on tags with `is` and `under`, and `placement_rule`
decides where a book belongs. The moment reading status is a tag, somebody can
write the perfectly reasonable rule "unread books go on the bookcase by the
door", and then **finishing a chapter re-files a book**. The misfile list, which
is where somebody goes to find out what to carry, fills up with books that need
carrying because of something that happened in an armchair. Nothing in the schema
can stop this: `rule_condition.value` is any slug, and refusing particular slugs
in the rule builder is a convention rather than a constraint, one namespace away
from being forgotten.

The whole discipline of this model is that rules claim books by what a book **is**
and a placement is a fact about a **room**. Reading status is a fact about a
person and belongs to neither. This objection alone is decisive.

**2. A tag is set membership, not a state machine.** Nothing stops a book
carrying `mine/read` and `mine/reading` at once, and this repository has already
paid for that exact mistake once: #194 left books carrying both `genre/fiction`
and `genre/non-fiction`, and `0016` is the migration that repaired it, at the cost
of rewriting some rows a person had written. Choosing the same shape again
knowingly is choosing to buy that repair a second time.

**3. Re-reads cannot be expressed, and the model has already refused the fix.**
`book_tag` has one `added_at` per row, and the owner settled on 2026-08-07 that a
removed tag leaves no trace. So the second reading overwrites the first, "read
twice" is unrepresentable, and there is no history to consult. #139 lists
re-reads as a thing that "make a single status insufficient and imply a history".

**4. Progress has nowhere to go.** A page number is a payload, and `book_tag`'s
columns are `source`, `confidence` and `added_at`. `confidence` is not a page
number. The alternatives are a hundred slugs or a payload column on the tag join,
and a payload column on `book_tag` would be the tag vocabulary growing a second
job.

### The test this draws, so the next feature does not have to re-argue it

**A fact with no duration and one bit of content is a tag. A fact with a start, an
end, an outcome and a position inside it is not.**

By that test: signed copy, first edition, want-to-read, borrowed-from-the-library
are all tags. Reading is not. Lending is not either, which means the example slug
`mine/lent-out` in `docs/data-model.md` is the same mistake in miniature: it can
say a book is out, but not when, to whom, or that it came back. Lending is out of
scope here and the test says where it will land when somebody asks for it.

### What is kept from the tag route

The filter still lives behind the tag summary control. See section 9: the
narrowing screen gains a section, the filter row keeps three controls, and the
model stays separate. **The elegant part of the reuse is reused. The dangerous
part is not.**

## 6. Does it touch placement, or anything else

Plainly, and this is the list a reviewer should check against:

| Thing | Touched? |
| --- | --- |
| `book_placement`, and its six kinds | No. No new kind, no new actor, no new row. |
| `books.state`, and its seven values | No. |
| `books.current_area_id` and its projection check | No. |
| `books.sort_key`, `shelf_range`, filing | No. |
| `rule_condition.field` | **No, and it must never gain a reading value.** |
| The misfile list, `Shelves.review`, the carry list | No. |
| The three views over `books` | No. Nothing on `books` changes, so nothing drops and recreates them. |
| `shelved_books`, `queued_books`, `catalogued_books` | Unchanged. |
| Spine widths (`pagesOf`) | Unchanged, and made more likely to be right, because section 4 gives people a reason to fill in `books.pages`. |

Two interactions that do exist and need stating:

- **Deleting a book deletes its readings.** `book_reading.book_id` is
  `ON DELETE CASCADE`, the same as `book_placement.book_id`. A discarded scan
  taking its readings with it is right, and a discarded scan will not have any.
- **Re-identifying a book keeps its readings, and this is a deliberate departure
  from the tag rule.** `web/application/tagging/reidentify-book.ts` strips tags
  about the *work* when somebody corrects an ISBN, on the grounds that "this row
  is a different book". Readings survive it anyway, for an asymmetry: a stale
  genre tag causes an **action**, because it files a book on the wrong bookcase,
  while a stale reading is a wrong sentence on one screen that its owner can
  delete in one press. Silently deleting somebody's reading history because a
  catalogue lookup was corrected is much worse than leaving one wrong.

## 7. The schema

One table, one view, one index and one partial unique index. **No column is added
to `books` and no row of `books` is touched.**

### `book_reading`

```
book_reading(
  id          integer identity primary key
  book_id     integer  not null   references books(id) on delete cascade
  state       text     not null   check (state in ('reading','finished','abandoned'))
  started_on  text     null
  ended_on    text     null
  page        integer  null
  created_at  text     not null
)
```

Constraints:

```
check (ended_on is null or state <> 'reading')
check (started_on is null or ended_on is null or ended_on >= started_on)
check (page is null or page > 0)
unique (book_id) where state = 'reading'
index (book_id, id)
```

**It is not append only, and that is the one place it departs from
`book_placement`.** Finishing a reading updates the open row rather than writing
a second one, recording a page updates `page`, and deleting a reading is allowed
and is the undo. The reason `book_placement` cannot unsay anything is that a
placement is a claim about a physical room that somebody else will act on; a
reading is a claim about one person's own past and the only reader of it is the
person who wrote it. A mis-press on the wrong book has to be undoable, and
"append a correction" is a worse answer than "delete the row" when nobody is
auditing.

### Every null, and why it is allowed

`docs/data-model.md` says no absence in this schema means anything, which is why
`inherit` is a row rather than a null. Each null here is measured against that.

- **`state` is not nullable**, and "currently reading" is a **value** rather than
  the absence of an outcome. That is the rule being obeyed rather than dodged: it
  is a check constraint over three names, exactly the shape `books.state` has,
  with the vocabulary in `web/domain/reading/`.
- **`started_on` is nullable, and it means nobody said when.** This is the null
  that matters most. The commonest first press is retrospective ("I read this
  years ago"), and requiring a start date would fabricate one on every such row,
  which makes "how long did that take" a lie across the whole catalogue. A date
  nobody stated is not a date.
- **`ended_on` is nullable** for two different reasons, which the check
  constraint keeps apart: a reading that is open has not ended, and a reading that
  finished may still have no date because nobody said. The first is the same class
  of genuine absence as `books.current_area_id`, where "a book on no shelf is a
  genuine absence rather than a state with a name".
- **`page` is nullable, and null is not page zero.** Never having said where you
  are is different from being at the beginning, which is the distinction
  `capture.examined` already draws between having looked and declined and never
  having looked.
- **`created_at` is not nullable.** It is when the row was written, which is a
  different fact from `started_on`, which is when the person says they started. A
  reading recorded in August for a book finished in March needs both.

**Dates are text ISO strings**, because every other time in this schema is
(`book_placement.created_at`, `books.scanned_at`, `book_tag.added_at`). `started_on`
and `ended_on` are `YYYY-MM-DD`, which sorts correctly as text. A lone `date`
column would be the only typed time in the database and would need its own reader.

**`page` is an integer even though `books.pages` is text.** The text column is
what a catalogue answered and this repository has not repaired it; the page a
person types is stated by a person through a route that can refuse, so there is no
reason to accept a non-number into a new column.

### The view

```
current_reading(book_id, standing, page, reading_id, readings, last_ended_on)
```

One row per book **that has at least one reading**, carrying the fold from
section 3. Named after `current_photograph`, which is the same idea: a domain
rule said in SQL so that a listing does not have to fold in the application for
every row of a page.

**It is a view over `book_reading` alone and deliberately does not mention
`books`.** Every view that references `books` has to be dropped and recreated by
any migration that changes a `books` column, which is why `0026` drops and
recreates three of them to remove one column. A fourth would make every future
`books` migration slightly more expensive forever. Joining `current_reading` on
the left of whichever listing view a query already reads costs nothing and taxes
nobody, and a book with no readings comes back as a null that the fold maps to
"not read yet".

**It is not a fourth listing view.** AGENTS.md says there are three views over
`books` and a query reads one of them, and that stays true.

### What the migration does

Following `0026` and `0028`'s form: a prose header saying what changes and why, a
`DO $$` guard, then the generated DDL, statements separated by the breakpoint
marker.

**It writes no rows.** The guard is therefore short and slightly unusual:

- it counts the catalogued books and says the number in a `RAISE NOTICE`, because
  that number is the size of what stays untouched;
- it asserts `book_reading` is empty afterwards;
- it takes the shelf order hash either side of itself and refuses if it moved,
  the way `0008` and `0011` do.

The last one is a tautology for a migration that touches no book, and that is
exactly why it is worth having: it is the cheapest possible proof that this change
did not move anybody's books, and it costs two queries.

The Drizzle schema in `web/infrastructure/db/schema.ts` is what is edited,
`npm run db:generate` writes the migration, the header and guard are added by
hand, and `SCHEMA` in `web/server/db.pg.ts` gains the transcription with a comment
per column so that `migrate.test.ts` keeps proving the two agree.

### Where the code goes

A new table gets a new slice, built hexagonally from the start the way `tag`,
`author` and `capture` were, and **`Store` gets no reading method**, exactly as it
has no tag method:

- `web/domain/reading/`: the three state names, the standing fold, the page and
  percentage rules that `web/shared/` re-exports to the client.
- `web/application/reading/`: `StartReading`, `FinishReading`, `GiveUpReading`,
  `RecordPage`, `ForgetReading`, and the port they depend on.
- `web/infrastructure/reading/`: the Drizzle repository.
- `web/server/index.ts`: the routes, in a new banner section.

## 8. The API surface

Four routes. Every id is read with `idIn` and every refusal is a `Refused`, per
the conventions.

**`POST /api/books/:id/readings`**

Body: `{ state?: 'reading' | 'finished' | 'abandoned', started_on?, ended_on?, page? }`,
defaulting to `finished`, because the commonest press is somebody saying they have
read a book they are holding.

Answers `{ outcome, reading, book }` where `outcome` is one of `started`,
`recorded`, `already-reading`. **Three words rather than an error**, following
`checkoutOutcome`, which has four "so a no-op isn't reported as a failure".
Starting a reading on a book that already has one open is `already-reading` and a
200, not a constraint violation surfacing as a 500.

**`PATCH /api/books/:id/readings/:readingId`**

Body: any of `{ state, started_on, ended_on, page }`. This is where finishing,
giving up, back-dating and "I am on page 212" all land. Refuses a `state` change
that would open a second reading of the same book. Answers `{ reading, book }`.

**`DELETE /api/books/:id/readings/:readingId`**

The undo. Answers `{ book }`.

**`GET /api/books/:id/readings`**

The history, newest first, in the shape `GET /api/books/:id/placements` already
answers: `{ readings: [...], total }`, capped the same way. Slice 3.

### What changes on existing routes

**`GET /api/books` gains one query parameter**, `reading`, taking
`unread | reading | read | gave-up`, AND-ed with `range`, `q`, `isbn` and the
repeatable `tag` exactly as those are with each other. An unknown value is a 400
naming it, the way an unparseable tag slug is. There is no sort parameter today
and this adds none: the order stays shelf range then sort key.

**Every book on the wire gains two derived fields**, snake_case like the other
derived fields (`checked_out_at`, `front_image`):

- `reading_standing`: `'unread' | 'reading' | 'read' | 'gave-up'`
- `reading_page`: `number | null`

Derived in the same place and manner as `checked_out_at` is derived in
`web/server/placement-ledger.ts`, from a left join onto `current_reading`. Two
flat fields keep a list of sixty rows from needing sixty requests, and the
percentage is not among them because the client already has `books.pages` and one
shared function does the division.

**`GET /api/reading/counts`** answers `{ unread, reading, read, gaveUp }` and is
read by the narrowing screen only, the way `GET /api/tags` is.

**`Store.counts()` is deliberately not widened.** That object rides on four
responses including `GET /api/health`, which the client re-reads on every route
change. A count that nothing draws is a join nobody asked for on the hottest read
in the app.

## 9. The screens

**This feature adds no screen.** Four existing ones change, and the drawings are
not in this document: `docs/process/designing-a-screen.md` is the process, and
these get drawn in `web/src/design/gallery/` and walked on a phone before
anything is built. What is settled here is where each thing lives and what the
drawing has to survive.

### The book screen (`book`, `BookPane.tsx`) is where it is set while holding it

The `Actions` row already carries up to four buttons (`Check it out`, `It moved`,
`Say what it is`, `Put it back`). **It must not become six.** So reading gets one
button in that row whose word depends on the standing, with the rest behind it:

| Standing | The button says | Behind it |
| --- | --- | --- |
| Not read yet | `I have read this` | `I am reading it now` |
| Reading | `Finished it` | `Gave up on it`, `I am on page…` |
| Read | (nothing in the row) | `Reading it again`, `Undo` |
| Gave up | (nothing in the row) | `Picking it up again`, `Undo` |

**The one press is "read" and not "reading"**, which is the opposite of what a
state machine suggests. Marking a book you have already read is the common act,
particularly at first; starting a reading is rare, because a person starts maybe
thirty books a year.

Below the fold, beside `Where`, the screen says the standing in a sentence, and
for a book being read it draws the progress from section 4. Slice 3 adds the
history under it ("Read twice. Finished in March 2019.").

### The narrowing screen (`tags`, `TagsPane.tsx`) is where filtering lives

**The filter row keeps three controls.** #395 is right that a fourth is a design
cost, and it is avoidable: the `Picked` control is already a full-width summary
button that opens a whole screen. That screen gains a section above the tag
groups, with the four standings and their counts, exactly the shape `TagPick`
rows already have. A chosen standing joins the chips in the `Picked` summary, so
the library's top line reads the way it does today.

The screen is titled `Your tags` and would then hold something that is not a tag,
so it needs a name covering both and two section headings. The words are the
owner's to settle in a wireframe round; the requirement is that **the model's
words never reach the screen**: `book_reading`, `standing`, `abandoned` and
`finished` appear nowhere, and the four words a person sees are `Not read yet`,
`Reading`, `Read` and `Gave up`.

### The first screen (`home`, `HomePane.tsx`) says nothing about reading, in v1

The counts are five: `catalogued`, `checked out`, `ready to shelve`, `to carry`,
`stuck`. They were cut back to those five in round eight (#361) in the owner's own
words, and `HomePane.test.tsx` pins that there is no sixth tile. **Adding a count
is not a design cost here, it is overturning a decision the owner made
explicitly**, and this specification is not the place to do that.

What the screen does gain, in slice 3, is a **door and not a count**. Doors sit
below the counts, are drawn only when they can do something, and there are three
(`Find the book in your hand`, `Carry books where they belong`, `Say what the
books nothing files are`). A fourth, `Pick up where you left off`, drawn only when
at least one book is being read, opens the library narrowed to Reading. **That is
the sofa moment**: open the app, one press, one press, and the page field is in
front of you. It reads `GET /api/books?reading=reading&limit=3`, which both tells
it whether to draw and gives it what to open, the way the carry count is read
today.

### The record screen (`review`, `BookDetail.tsx`) gains nothing

A save is about identifying a book. Reading status is not part of confirming what
a book is, and the check-the-details screen is already the busiest surface in the
app.

### What the drawings have to survive

Per the process doc, the states that are not the happy path:

- **238 books, none of them read**, which is what the library looks like on the
  day this ships;
- **nought books being read**, which is what the reading filter and the door look
  like most weeks;
- **one book being read**, which is the normal case and must not look like an
  error;
- **a book with no page count**, which is a quarter of them, and must not draw an
  empty bar;
- **a book read four times**, which is one row of the history repeated;
- **a page number larger than the page count**, which is a real book with roman
  front matter or a wrong catalogue count.

## 10. What this looks like on the day it ships, for 238 books at once

**Nothing changes, and that is the whole answer.**

- The migration creates one table, one view and two indexes, and **writes no
  rows**. It touches no column of `books`, so it does not drop and recreate the
  three views the way `0019`, `0021`, `0024`, `0025` and `0026` all had to.
- Every book's standing is `not read yet`, derived from the absence of a row.
  There is no backfill, nothing to count, nothing to refuse, and no book to name.
  This is the first change in this remodel that has nothing to verify, because it
  asserts nothing about the existing catalogue.
- The shelf order hash is unchanged, and the migration proves it rather than
  claiming it.
- **The library's "not read yet" filter selects all 238 books.** That is correct
  and it is also useless, and saying so is more honest than pretending otherwise.
  The default library view stays "everything", the reading filter is a filter and
  not a to-do list, and the number under it is a number, not a backlog.

### The uncomfortable part

The record only becomes useful as it fills in, and filling it in is manual. The
library's rows have **no per-row actions at all**, deliberately: every book in all
three views is a single button that opens the book and does nothing else. So
marking a book read costs three presses (open, press, back), and marking forty
books costs a hundred and twenty.

**v1 accepts that**, for two reasons. The one-behaviour-per-row rule was arrived
at deliberately and breaking it to serve a one-time backfill is poor value. And
realistically the backfill does not happen in an afternoon: the owner marks books
as he finishes them, and the historical catalogue fills in slowly or not at all.

**If it turns out the backfill matters, the answer is a screen and not an inline
action**, and it already has a shape to copy: the carry list is a list of books
with one act per row, and a shelf-walking marking screen is that with a different
verb. It is sized in section 11 and it is not in v1 because nobody yet knows
whether the walk will happen.

## 11. What it costs, and what ships first

Sizes are in this repository's own unit, which is an issue an agent can finish
and a person can review.

### Slice 1: mark a book read, and find the ones that are not

**The whole of what the owner asked for first, and useful entirely alone.**

- the migration, the Drizzle schema, the `SCHEMA` transcription, the view
- `web/domain/reading/` with the fold and its tests
- `web/application/reading/` with four handlers and a port
- `web/infrastructure/reading/` with the repository
- three routes, plus `reading` on `GET /api/books`, plus the two wire fields
- the book screen's reading control
- the narrowing screen's section, and `GET /api/reading/counts`
- tests: a domain test file, a repository test, a `readings.routes.test.ts`, a
  `migrate` diff that stays green, and the component tests for two screens

**Two issues.** One for the model and the routes, one for the two screens, with a
wireframe round between them.

### Slice 2: progress

- `page` on the route bodies (the column ships in slice 1 and goes unused, because
  adding a column later means a second migration over the same table for no
  reason)
- the shared percentage function, and the three-case rendering of section 4
- the page entry control, and the `Say how many pages it has` path for the quarter

**One issue.** It is the smallest of the three and it is the one the owner named
second.

### Slice 3: history, and the sofa door

- `GET /api/books/:id/readings`, and the history on the book screen
- back-dating a reading, which is what makes a retrospective record honest
- the `Pick up where you left off` door on the first screen

**One issue**, and the door is the part most likely to be argued about, because
the first screen is the most contested surface in the app.

### Not sized, because it is conditional

A shelf-walking marking screen, if the backfill turns out to matter. Roughly the
size of the carry list, which exists, so it is one issue with a wireframe round in
front of it.

### Where the risk actually is

Not in the schema, which touches nothing. It is in two places:

1. **The narrowing screen holding two vocabularies.** If that reads badly on a
   phone, the fallback is a fourth control in the filter row and the design cost
   #395 named. That is found out in the wireframe round, before anything is built,
   which is what the round is for.
2. **The word on the book screen's one button.** Getting `I have read this` versus
   `I am reading it now` the wrong way round makes the common act cost two presses
   instead of one, forever, and nobody will report it as a defect.

## 12. What this deliberately leaves out

- **Multi-user reading.** The whole of section 1. Deferred to #171 with the cost
  written down rather than hidden.
- **Want-to-read, and a wishlist.** A hand tag today, and a wishlist for books not
  owned is a different feature over a table that does not exist.
- **Ratings, reviews and notes.** There is no `note` column on `book_reading`, and
  that is on purpose: the moment there is a text box, somebody wants stars beside
  it, and then an average, and then a "books like this". That is a different
  product and it should be asked for on its own.
- **Lending, and who has it.** The most obviously missing thing, and it is
  `checked_out` plus a person, and a person is #171. Section 5's test says where
  it lands when it is asked for, which is not the tag vocabulary.
- **Reading pace, charts, and a progress history.** `page` is overwritten, so
  there is no record of where you were last Tuesday. Nobody asked for a graph, a
  row per evening is a row per evening, and if it is ever wanted it is a second
  table rather than a reshaping of this one.
- **Goals.** "Fifty-two books this year" is a number that makes an app nag.
- **Percentage of the collection read**, anywhere. On the day this ships it is
  zero percent of 238 and it stays near zero for a long time, so its whole
  contribution is to tell somebody they have not read their own books. It becomes
  a fair number only once the historical record has been filled in, which is
  slice 3 plus a decision that has not been made.
- **Importing from Goodreads or StoryGraph.** "Moving into a book list focus"
  invites it and it is a catalogue integration, not a reading feature.
- **Series completion**, which #139 lists and which the shelving code already
  understands. It is a fact about a collection, not about a person.
- **A `reading` field on `rule_condition`.** Not deferred. Refused, for section
  5's first reason.
- **Anything reaching `book_placement`.** Not deferred. Refused, for section 2.

## 13. What only the owner can settle

Three things, and they are all words rather than shapes.

1. **The four words a person reads.** `Not read yet`, `Reading`, `Read`, `Gave up`
   are the proposal. `Gave up` is the one most likely to be wrong, and the
   alternatives are all worse in a different way.
2. **What the narrowing screen is called** once it holds something that is not a
   tag.
3. **Whether the first screen ever gains a sixth count.** This document says it
   does not, on the grounds that the five were cut back to five in his own words.
   If he wants `not read yet` up there, that is his call to overturn and not this
   document's.
