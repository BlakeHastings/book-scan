# What a second catalogue would actually buy (#305)

#305 asks for more than one catalogue to be consulted and the answers reconciled,
and it asks for the measurement first:

> **Measure before building.** Take the books already in the catalogue, ask each
> candidate source about them, and report how many gained a genre, a page count
> or an author that we do not already have.

This is that measurement and nothing else. **No application code was changed and
no reconciliation was built.** Every number below came from asking a real
catalogue about the real books, and the harness that produced each one is
described at the end so it can be re-run.

## The short answer

**Worth building for the page count and the genre. Not worth building for the
author.**

Against the 238 books in the catalogue:

| | Books with none today | Gained from a new source | Gained from sources whose match was verified |
| --- | --- | --- | --- |
| Page count | 55 | **46** | 33 |
| Genre | 19 | **15** | 15 |
| Author | 1 | **1** | 1 |

The page count is the strongest case and the genre is the clearest one: nearly
four in five of the books drawn at a guessed spine width would get a real one,
and fifteen of the nineteen books that no source has classified would get filed
by a rule instead of waiting for a person.

**The author is not a reason to build anything.** The raw count of "a source
named somebody we do not credit" is 34 of 238, and reading all 34 by hand, it is
one real gain and thirty-three false ones. The #235 case, an uncredited
co-author, does not occur once.

There is also a cheaper finding that arrives before any of this. See "The second
source already in the code has never once answered".

## What was measured, and how much to trust it

**The books are the real ones.** 238 books, every row of `catalogued_books`,
restored from the nightly backup `bookscan-20260814T033250Z.dump`, taken
2026-08-14T03:32:50Z. 236 carry an ISBN-13, 231 an ISBN-10, and 2 carry neither
and could not be looked up at all.

**Nothing connected to the live catalogue.** The dump was restored into a
throwaway `postgres:18` container with no published port, queried for the ISBNs
and the fields being counted, and the container was removed. `127.0.0.1:5433`
was never opened, and `E:\book-scan-backups` was read and not written.

**The seeded world could not have answered this question.**
`web/scripts/seed-world.ts` mints its ISBNs from a counter, so every one of them
is a number no catalogue has ever heard of. A sweep against the seed would have
reported that every source knows nothing, which is true and useless.

So the cohort is exactly right, and the one thing to hold loosely is that it is a
snapshot: the catalogue is added to most days, and these are the books as of that
morning. The baseline it reproduces is the same one the earlier page-count
measurement reported, **183 of 238**, which is how the two are known to be about
the same thing.

### The baseline, as the catalogue stands

| | Count |
| --- | --- |
| Books | 238 |
| With a page count | 183 (55 without) |
| With a genre no source stated | 19 |
| With no author credited | 1 |

The 19 is the cohort #304 created. A genre is now written only when a lookup
states one, and the last rung of `classify` answers no genre rather than
fiction, so a book saved today whose sources say nothing carries no genre tag at
all. Those 19 are the books already in that position: `classification_source =
'auto'` with `classification_confidence = 'unknown'`, which is exactly that rung
having been reached. **None of them can have come from the "sources disagree"
branch**, because that branch needs two sources to have answered and, as the next
section shows, only one ever has.

## The second source already in the code has never once answered

`lookup.ts` calls Open Library and Google Books and records which of them
answered in `books.lookup_source`. Across all 238 books:

| `lookup_source` | Books |
| --- | --- |
| `Open Library` | 231 |
| (empty, typed in by hand) | 7 |
| `Open Library + Google Books` | **0** |

**Google Books has contributed to no book in this catalogue, ever.** The reason
is visible immediately. One request, made by hand during this measurement:

```
HTTP 429
Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of
service 'books.googleapis.com' for consumer 'project_number:624717413613'
```

That project number is Google's shared pool for callers with no API key, and the
comment at the top of `lookup.ts` already predicted this: "its anonymous quota is
per-IP and starts returning 429 well before you finish a shelf". What is new is
that it is not "well before you finish a shelf", it is always.

This matters twice over. It is a real thing to fix, and it is cheaper than
anything else on this page: `server/index.ts` already reads
`GOOGLE_BOOKS_API_KEY`, and nothing more than setting it is required. It also
means **every number in this document is measured against a baseline of one
source**, so a share of what the new catalogues are credited with here is really
what Google Books would have said if it had been asked. Google Books is not in
the sweep below for that reason: 238 requests would have been 238 429s, and
adding to an exhausted quota is not a polite way to measure it.

## What each source said

Six sources, asked about all 238 books, ISBN-13 first and ISBN-10 second, exactly
as `lookupIsbn` orders them. "States a genre" is `classify()` from
`web/server/classify.ts` returning a genre rather than null, so it is the same
question #304 made the write path ask rather than a second opinion about it.

| Source | Has a record | States a genre | States pages | Names an author |
| --- | --- | --- | --- | --- |
| Open Library, as the app asks it today | 232 | 197 | 185 | 232 |
| Open Library `search.json`, the work rather than the edition | 232 | 201 | 218 | 232 |
| Library of Congress | 131 | 128 | 114 | 124 |
| K10plus | 138 | 104 | 96 | 131 |
| Deutsche Nationalbibliothek | 14 | 9 | 2 | 11 |
| Wikidata | 43 | 21 | 36 | 42 |

And what each adds **over what the catalogue already holds**, which is the number
the issue asked for:

| Source | Genre gained (of 19) | Page count gained (of 55) | Author gained (of 238) |
| --- | --- | --- | --- |
| Open Library, re-asked today | 0 | 2 | 9 |
| Open Library `search.json` | 4 | 35 | 7 |
| Library of Congress | **11** | **25** | 13 |
| K10plus | **10** | **20** | 10 |
| Deutsche Nationalbibliothek | 1 | 0 | 9 |
| Wikidata | 3 | 7 | 3 |
| **All five new sources together** | **15** | **46** | 34 |
| Library of Congress and K10plus only | 15 | 33 | 20 |

The last two rows are the new sources only. Open Library is the baseline, so its
row above is what re-asking the source we already use turns up, which is two page
counts somebody's copy lost and no genres at all.

Three things in that table are worth reading twice.

**The two free national catalogues do almost all of the work.** Library of
Congress and K10plus between them reach all 15 of the genres and 33 of the 46
page counts. Adding the other three sources buys 13 more page counts and no more
genres.

**Four books are gained by nobody.** Nineteen books have no stated genre and
fifteen of them get one. The remaining four are not a source being slow or a
lookup being wrong: no catalogue asked has anything to say about them, and a
person is the only thing that will ever settle them. A reconciliation does not
make that number zero and should not be sold as if it will.

**Open Library already knows more than we ask it.** Asked through
`search.json` rather than `/api/books`, the same catalogue states 35 of the 55
missing page counts and 4 of the 19 missing genres. That is a real gain with no
new dependency, no new terms and no new thing that can hang. It is also the least
trustworthy of the gains, and the reason is in the field name:
`number_of_pages_median` is the median across every edition of the work, not the
copy on the shelf. Of the 46 page counts gained, **13 come only from that
median**, which for spine width means drawing the average of a hardback, a
paperback and a large-print edition. It is better than the collection-wide median
the book is drawn at now, and it is not the book.

## The three fields, one at a time

### The page count is the real prize

55 books are drawn at a guessed spine width and 46 of them need not be. 33 of
those come from Library of Congress or K10plus, where the number is a specific
edition's extent statement rather than an average, and those are the ones to
want.

### The genre is a smaller number that matters more

15 of 19. In absolute terms it is fifteen books, which is small. In terms of what
it does it is the difference between a book a rule can file and a book that sits
waiting for somebody to classify it, and #304 was written precisely so that
second state would be visible rather than quietly filed into non-fiction. Fifteen
fewer of those is the whole of what #304 asked the next change to do.

### The author is not worth building for

The raw number is 34 of 238, and every one was read. It breaks down like this:

| What the "new" name actually was | Books |
| --- | --- |
| The same person spelled differently: `Френк Герберт` for Frank Herbert, `Shelley, Mary Wollstonecraft` for Mary Shelley, `Schwab, Victoria` for V. E. Schwab, `Stoker` for the `Stroker` somebody typed | 18 |
| A translator, illustrator or writer of an introduction, from MARC 700, correctly recorded and not the author | 5 |
| Plainly the wrong person, from a record that is not this book | 10 |
| **A book with no author at all, which gained one** | **1** |

**Zero are an uncredited co-author**, which is the #235 case the issue names. One
book in the collection has nobody credited, and one source names somebody
plausible for it.

Two of those rows are warnings rather than counts. Applying the first row blindly
would be a regression: it would credit two people where there is one, and
`author_alias` exists to hold exactly that kind of variant against one author
rather than to multiply them. And one book's `search.json` answer returned
**fifty-five** names for a single Dracula, because the work aggregates every
contributor to every edition, including publishers and a Mary Shelley. Any
reconciliation that touches credits has to treat the work-level author list as
unusable.

## Is it even the same book?

A page count taken off the wrong record is worse than no page count, because
nothing reports it and the spine is drawn wrong on purpose. So the 53 books a
gain was claimed for were asked again, this time capturing the record's own title
(MARC 245) and comparing it with ours:

| Source | Records | Titles agree | Do not |
| --- | --- | --- | --- |
| Library of Congress | 34 | 34 | 0 |
| K10plus | 31 | 29 | 2 |

Both K10plus disagreements are the same book under a different title form, one a
subtitle we do not carry and one a Russian translation. **So the ISBN match
against those two is sound, 65 records out of 65.** That is what makes their 15
genres and 33 page counts the figure to plan against.

The wrong records are all in the other three. The Deutsche Nationalbibliothek's
`dnb.num=` index answered for 14 books and most of those answers are a different
book entirely, so its apparent contribution of 9 authors is 9 mistakes. **Do not
add it.**

## What each source requires

None of the three sources worth adding needs a key. That is not a small point:
`AGENTS.md` is explicit that a key or a connection string does not belong in a
file or on a command line, and the only mechanism this machine has for one is the
DPAPI-encrypted file the launcher is handed the path to. A source needing no key
needs none of that.

| Source | Key | Documented limit | Rate used here | Terms |
| --- | --- | --- | --- | --- |
| Open Library (`/api/books`, `/isbn/`, `/search.json`) | None | 1 req/s anonymous, 3 req/s with a User-Agent naming the app and a contact. Bulk harvesting is prohibited and the data dumps are the sanctioned route for it | ~2.7 req/s across both endpoints, with that User-Agent | The Internet Archive disclaims new proprietary rights but names no licence. **Do not record it as CC0** |
| Library of Congress SRU (`lx2.loc.gov:210/lcdb`) | None | The `loc.gov` JSON API documents 20 req/min with a one-hour block past it. The SRU endpoint documents no limit | 1 request per 3.2 s, ~0.3 req/s | "Free to use and reuse" is stated per collection rather than blanket, and is not confirmed for the MARC catalogue |
| K10plus SRU (`sru.k10plus.de/opac-de-627`) | None | None documented | 1 request per 1.1 s | CC0, per K10plus Open Data |
| Deutsche Nationalbibliothek SRU | None | 100 records per request | 1 request per 1.1 s | CC0 since 2015. **Recommended against on accuracy, not terms** |
| Wikidata SPARQL | None | 60 s query timeout, 60 s processing per 60 s window, 5 parallel queries per IP. A descriptive User-Agent is required by policy | 9 POSTs, 1.5 s apart, one at a time | CC0 |
| Google Books | Not required, but in practice yes: the anonymous pool is exhausted | Not published by Google | Not swept, one request only | Already wired: `GOOGLE_BOOKS_API_KEY` in `server/index.ts` |

Two candidates were researched and not measured, both because they cannot be
reached without an arrangement somebody has to make.

- **ISBNdb** is paid and self-serve, from about $15/month. Its terms permit
  caching **only while the subscription is live** and require cached data to be
  deleted if it lapses, which is a poor fit for a catalogue meant to outlive a
  subscription.
- **OCLC WorldCat** requires an institutional subscription. The individual
  route closed at the end of 2024. It is not available here.

## The honest read

**Build it for the page count and the genre, from Library of Congress and
K10plus, and leave the author alone.**

The case is 15 genres and 33 page counts, and if the median is accepted for the
rest, 46 page counts. That is real, and it is smaller than "more sources, fewer
of those" suggests. It is worth knowing before the reconciliation is designed
that the design has to earn 48 fields.

Three things about the shape of the work follow from the numbers rather than
from taste:

1. **Two of the six sources are the whole gain.** A reconciliation that starts
   with Library of Congress and K10plus and stops there loses nothing except 13
   cross-edition medians.
2. **The disagreement problem is smaller than expected and the wrong-record
   problem is bigger.** 65 of 65 verified records were the right book for the
   two sources worth using, and near enough none for a third. So the rule for
   "what if two sources disagree" matters less than a rule for "is this even the
   book", and the second one is not mentioned in #305.
3. **Credits must be left out of scope.** One book gains an author. Everything
   else a source offers about authorship is a variant spelling that would double
   a credit, a translator, or a mistake.

And before any of it: **set `GOOGLE_BOOKS_API_KEY`.** The second source is
already written, already wired and already reconciled with the first, and it has
answered zero times in the life of this catalogue. That is a smaller change than
this issue by two orders of magnitude, and until it is done nobody knows what
the two-source baseline actually looks like.

#348 gave the key somewhere to live and gave the silence a voice. The key goes
in the DPAPI-encrypted file this machine already keeps its catalogue connection
in, put there by `pwsh -File scripts/write-connection-file.ps1
-SetGoogleBooksApiKey` and read by the server as `GOOGLE_BOOKS_API_KEY`; a
source that does not answer is now counted under `lookups` on `/api/health` and
said once in the log rather than absorbed. Supplying the key is the owner's, and
the re-measurement that follows it is this document's third act. **Until then
every number above is one source**, which is now a thing a running server will
tell you rather than a thing somebody had to go and find.

## Re-running it

Nothing here is checked in: the harness was four throwaway scripts, deliberately
not added to `web/scripts/`, because a measurement that runs against a restored
production backup is not a thing to leave lying next to `seed-world.ts`. What
follows is enough to rebuild it.

1. Restore the newest dump from `E:\book-scan-backups` into a scratch
   `postgres:18` container with no published port. Never point anything at
   `127.0.0.1:5433`.
2. Export `id, isbn13, isbn10, title, pages, classification_source,
   classification_confidence`, the credits joined from `book_author` and
   `author_alias`, and the genre tags, for every row of `catalogued_books`.
3. For each book ask each source, ISBN-13 first and ISBN-10 second, honouring the
   rate in the table above and sending a User-Agent that names the app and a
   contact address. The SRU sources answer MARCXML: 650 and 655 are the subject
   headings, 082 the Dewey, 050 the LC class, 300 subfield a the extent, 100 and
   700 the names.
4. Count a genre as stated when `classify()` from `web/server/classify.ts`
   returns a genre rather than null. Do not write a second opinion about what
   counts: that function is the gate #304 built.
5. Wikidata needs two things doing that are not obvious. Its ISBNs are stored
   hyphenated, by an agency split with no range table to hand, so ask for every
   split the standard allows (about 25 spellings per ISBN, matched as an indexed
   literal) rather than normalising the stored value, which is a scan of every
   `P212` statement and times out. And the ISBN sits on the edition while the
   genre sits on the work, so `wdt:P629*` has to be traversed or Wikidata reads
   as stating no genres at all, which is what it appeared to do on the first
   pass here.
6. Verify before believing. Re-ask for the books a gain was claimed for, capture
   MARC 245 and compare it with our title. That step is what turned "34 authors
   gained" into "1", and it is the step to keep.
