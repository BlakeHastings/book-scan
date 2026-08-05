# book-scan web

A phone-first app for cataloguing a physical book collection. Photograph a
book's cover, back and spine and it reads the ISBN, tells you which two books
to put it between, and walks you through the shelf-by-shelf shuffle if there
is no room. Once a book is catalogued, holding it back up to the camera checks
it out or back in.

The shelving rules it implements are specified in [`../docs/shelving.md`](../docs/shelving.md).

## Quick start

```bash
cd web
npm install
npm run dev
```

That starts two processes: the API on `http://127.0.0.1:3001` and the Vite dev
server on `https://0.0.0.0:5173`.

On the phone, open the **Network** HTTPS address Vite prints, for example
`https://192.168.0.12:5173`. Both devices need to be on the same wifi.

## The certificate warning

Safari will show "This Connection Is Not Private". Tap **Show Details**, then
**visit this website**. This is expected and it is the one piece of friction in
the setup.

It cannot be skipped by using plain HTTP. `getUserMedia` only works in a secure
context, and `http://192.168.x.x` is not one, so without HTTPS Safari refuses
to hand over the camera at all. The self-signed certificate from
`@vitejs/plugin-basic-ssl` is what makes the origin count as secure.

If tapping through the warning gets annoying, switch to
[mkcert](https://github.com/FiloSottile/mkcert): generate a certificate for
your LAN IP, install the root CA on the phone, and trust it under Settings,
General, About, Certificate Trust Settings. Then point `server.https` in
`vite.config.ts` at the generated files and drop `basicSsl()`. That removes the
warning permanently.

## How it fits together

```
src/                    React UI (phone-first, dark, 44px tap targets)
  App.tsx                 top-level state machine: home, capture, review, shelve, library, queue
  components/
    HomePane              the home screen: Add, Scan, Library, plus the queue
    ScanCamera             full-screen camera that identifies a catalogued book by cover or barcode
    IsbnCamera             point-and-read ISBN capture
    IsbnPrompt              the "Change ISBN" dialog that wraps IsbnCamera
    BookDetail             record view and edit form, shared by a new book and a shelved one
    ShelfView              the library, grouped by physical shelf, with the books to move
    ShelveView             the guided placement shuffle
    ShelfStrip              the neighbours drawn end on, as a shelf
    QueuePane               the capture queue
  lib/
    scanner.ts             getUserMedia, manual still capture, lens pinning, torch. No decoding.
    steady.ts              burst capture and sharpest-frame selection, for shaky hands
    api.ts                 typed fetch wrapper, the only client-to-server path
server/                 Express API on loopback only
  index.ts                routes, data directory resolution
  identify.ts             barcode decoding, then OCR of the printed ISBN
  paddle.ts               PaddleOCR, the primary OCR engine
  covers.ts                fetches and stores the publisher's cover
  imagehash.ts            perceptual hashing, for recognising a book by its cover
  bookcrop.ts              finds the book in a photograph, or declines to
  crop.ts                  stores a crop beside the photograph it came from
  capturecrop.ts           the same crops and a front hash, for a queued capture
  queue.ts                 the capture queue and its background worker
  lookup.ts               Open Library primary, Google Books top-up
  classify.ts             fiction vs non-fiction ladder
  store.ts                 all SQL for books
  shelves.ts               separators, the shelf geography derived from them, misfile review
  db.ts                    schema, and migrations for an existing database
shared/                 pure logic used by both sides
  shelving.ts              sort keys, filing names, placement, misfile detection
  layout.ts                turns separators into physical shelf/area labels
  isbn.ts                  validation, ISBN-10 to 13, OCR extraction, add-on rejection
```

## The home screen

The app opens on a home screen, not the camera. **Add** photographs a book the
catalogue has never seen. **Scan** is for one it already has: hold the book up
and it opens the book's own page, where what you can do with it is whatever
its current state allows. **Library** browses. A queue banner appears
underneath, badged with a count, only when something is waiting to be
confirmed.

There used to be two more tiles, Check out and Shelve, and they were the same
camera pointed in opposite directions. That made you decide what you were
about to do before you had picked the book up, and it meant the app had two
ways in to the same book. One door, and the book's state decides what is
behind it.

## Capture flow

Three photos per book, taken manually with a shutter button, in this order:

| Order | Slot | What it is for |
| --- | --- | --- |
| 1 | Back cover | The barcode and printed ISBN. Shot first so identification starts immediately |
| 2 | Front cover | The record, and an OCR title guess if no ISBN turns up |
| 3 | Spine | How the book looks on the shelf |

**The back cover goes first on purpose.** It carries the identifier, so the
lookup runs while the other two photos are being taken instead of the user
waiting at the end.

**Once the book is identified, the remaining photos skip the round trip
entirely.** Re-running barcode decoding and OCR on the front and spine costs
seconds and cannot improve an answer we already have, so those shots are kept
and stored without being analysed. The client also tells the server whether it
still needs a title, which is what forces the expensive full OCR pass.

Tap any slot to make it the shutter's target and retake it. A photo is kept
whether or not an ISBN is found.

**Every slot has an on-screen guide, but only the spine's is a crop.** The
spine guide is solid, and what it frames is exactly what is saved. The front
and back guides are dashed and alignment-only: the full frame is always kept
there, because the printed ISBN often sits close to an edge and a crop that
clips its last character costs the check digit. That failure has already
happened here once.

Library thumbnails frame a spine and a cover differently, since the useful
part of each is somewhere else: a spine carries its title at the top, a cover
reads from the middle.

### Steadying the shot

**The shutter takes a short burst and keeps the sharpest frame**, rather than
whichever frame happened to be on screen at the tap. This is an accessibility
feature, not a refinement: somebody with shaky hands could not reliably
capture a spine, and the spine is the hardest shot, held on its side at arm's
length by somebody already straining.

Hand tremor is periodic, from about 4Hz up, and reverses direction twice a
cycle, so a window of at least half the slowest period contains a moment where
the hand is turning round and is briefly almost still. Five frames at 30fps
spans about 165ms and clears that. Frames are scored by variance of the
Laplacian on a 240px copy, and only the winner is JPEG encoded.

**It costs a measured 199ms per shot** (Chromium, 2160x3840 stream, spine
crop; 203ms for the full frame). Almost all of that is waiting for the camera
rather than working, which is why the crop makes no difference to it. The old
claim below that the shutter returns in single-digit milliseconds referred to
not waiting for the *server*, and that is still true; the burst is local.

**The resolution is not negotiable.** The spine crop is a narrow slice of an
already-cropped frame and reaches the OCR only a few hundred source pixels
across, which is why the spine is the shot blur ruins. Trading pixels for
steadiness would cost the ISBN.

**There is no steadiness gate.** A shutter that refuses to fire until the
phone is still is a shutter that never fires for exactly the person this is
for. Picking the best of what arrived cannot fail that way, and it needs no
DeviceMotion permission prompt.

**A torch is offered on the spine slot** where the phone has one, off by
default and remembered. More light means a shorter exposure means less blur,
and a video frame's exposure is capped by the frame interval, so light is the
only physical lever available. It follows the slot rather than being a mode,
so it costs no extra tap, and it goes out on the covers and on the way out.

**The camera settings sheet reports what the camera actually granted**: the
lens in use, the picture size and frame rate, whether a torch exists, the
closest the lens can focus, and how many pixels wide the spine strip really
is. Written to be read out loud, with a button that copies the lot. Most of
what remains unknown about steadying a shot can only be settled on a real
iPhone, and this is how that phone answers.

**Lens pinning is deliberate and costs nothing in steadiness.** An iPhone
offers a virtual "Back Dual/Triple Camera" that switches lens mid-shot and
makes the framing jump while a book is being lined up, so a plain physical
lens is pinned instead. WebKit's capture source never asks AVFoundation for
video stabilisation on any device, and the multi-frame fusion a virtual device
can do is a still-photo setting that a getUserMedia video track never reaches.
Stabilisation on an iPhone is optical and lives on the wide lens, which is the
one that gets pinned. Where no lens is labelled "Back Camera", the ultra wide
is the last resort rather than an early guess: it has no optical stabilisation
on a non-Pro model and puts a spine on far fewer pixels.

**Correcting a book happens in the detail view, not at the camera.** Opening a
queued book shows its photos, every editable field, and the ISBN it was matched
on. **Change ISBN** prompts for the right digits, either typed or read with the
camera (see [In-app ISBN capture](#in-app-isbn-capture) below), validates them
before spending a request, then refetches the whole record from the catalogue.

Tapping a book in the Library opens the same view, so a shelved book can be
corrected later. Saving an existing book updates it in place and rebuilds
everything derived from it, since changing a title, author or the fiction flag
moves it on the shelf. It is also excluded from its own neighbour search, or
it would be told to sit next to itself.

That is deliberately the only place an ISBN can be typed. The ISBN is the key
every other field hangs off, so correcting one means refetching rather than
retyping metadata, and you need the photos on screen to read the digits off the
cover. Location and notes survive a refetch; the catalogue is not the authority
on those.

The phone only ever talks to Vite over HTTPS. Vite proxies `/api` to the
Express process server-side, which is what keeps the page free of the
mixed-content errors Safari would otherwise block.

## Scanning a book you already have

Once a book is catalogued, `ScanCamera` finds out which book you are holding
and opens it. That is all it does. `POST /api/books/scan` takes a photograph
and no direction, and writes nothing on any branch; the detail view it lands
on reads the book's `checked_out_at` and offers **Check out** or **Check in**
accordingly. Checking one in goes through the same guided shuffle as a new
book, because a book coming back has to go somewhere and only the person
holding it knows whether it fits.

**Nothing infers the action from the state.** A checked-out book held up to
the camera does not check itself back in, tempting as that is. Cover matching
still puts the wrong book first about one lookup in ten, and the catalogue is
somebody's afternoons; the gate on revisiting this is a measured wrong-match
rate, not appetite (#49).

The detail view opens by itself only when the identification is worth it: a
barcode, which is self-validating, or a single candidate in the `close`
confidence band (`src/lib/confidence.ts`, distance 0 to 8, "looks the same").
Two close candidates cannot both be the book in your hands, so that goes back
as a shortlist, as does anything weaker. Opening a page is not a write, which
is why a good guess is allowed to do it and is still not allowed to check a
book out.

Identification here is ordered by cost, cheapest first, because someone is
standing at a shelf holding the book:

1. **Barcode only**, and the fast decoder alone (see
   [Reading a barcode](#reading-a-barcode-then-ocr) below): a fifth of a second
   when it works.
2. If there is no barcode, the photo is **hashed and compared against every
   book's stored cover**. Matching by cover, not identifier, is what makes
   holding up a book front-out work at all, and it costs about fifty
   milliseconds. Candidates are a shortlist, never an answer: they are shown
   with their own photo where one exists, and a person taps to open one.
3. Only if neither of those finds anything does it fall back to a **full OCR
   pass**, which used to run on every single scan and cost five to ten
   seconds, almost always for nothing, since a book held front-out to the
   camera has no barcode to read.

The matching is a **difference hash** (`server/imagehash.ts`): shrink the
photo to an 8x8 grid and record whether each pixel is brighter than the one to
its right, which survives changes in lighting, distance and angle far better
than the pixels themselves. It is deliberately not scale- or rotation-invariant
and is not meant to be; it exists to produce a short, ranked list of
candidates, and a person always makes the final call. The hash is taken from
the middle 80% of the frame, so table, hands and wall around the edges do not
count against a match.

Two images are hashed and stored per book: the front cover photo taken while
scanning it in, and the publisher's cover fetched afterwards from Open Library
or Google Books (`server/covers.ts`). A held-up book is compared against
whichever of the two is the better likeness, and the candidate list shows your
own photo of the book in preference to the catalogue's, since an unfamiliar
publisher cover design reads as a wrong match rather than a different
printing.

## In-app ISBN capture

`IsbnCamera` points the phone at a barcode or a printed ISBN and reads it,
rather than requiring it to be typed digit by digit. It is reached from the
**Change ISBN** dialog (`IsbnPrompt`), which is the one place an ISBN can be
entered at all. A result fills the field rather than submitting it
immediately: OCR can misread a digit, and a wrong ISBN silently fetches a
different book, so a barcode read is marked as trustworthy while a text read
is flagged for a second look before it is used.

## Shelf boundaries

You can see that a shelf is full; the software cannot. So you tell it, from
the shelving step, the first time a book will not fit.

**The vocabulary is furniture, not geometry.** A **shelf** is a whole
bookcase, numbered `1`, `2`, `3`. An **area** is one physical plank inside it,
lettered `A`, `B`, `C`. So `1A` is the top plank of the first bookcase, `1B` the
plank below it, `2A` the top plank of the second bookcase. Saying "no room" on
that plank offers two different steps: **move one along**, which starts a new
plank in the same bookcase, or **start a new bookcase**, which resets the
letter. Fiction starts at `1A`; non-fiction has its own bookcase and starts at
`4A`.

**A boundary records where a shelf starts, not a bookmark or a capacity.**
That distinction is the whole design, and the obvious implementation gets it
wrong. Anchoring a boundary to the book it was added after means inserting
anything earlier leaves that shelf holding one more book than when you
declared it full, which is exactly what a real shelf cannot do. Recording
which book starts the next one instead means an insertion earlier in the
alphabet pushes the last book off the end and onto the front of that one, and
that displacement cascades the way it does in the room.

Locations are therefore **derived, not typed in**. Every boundary change
reports the books that physically have to move, because a catalogue that
quietly stops matching the shelves is worse than no catalogue. An earlier
version of the schema stored a capacity number per shelf instead; an existing
database with that table is migrated automatically the first time the server
opens it, converting each stored capacity into the sort key of the book that
used to start the next shelf.

Only the last, open-ended shelf can be closed. Closing an earlier one would
mean renumbering every boundary after it, and removing the existing marker
first is the honest way to do that.

## The queue, and two people scanning at once

Photographing a book takes seconds; reading it takes longer. So **each photo
goes to the queue the moment it is taken** and is read in the background. The
shutter never waits on the server, only on its own burst (see [Steadying the
shot](#steadying-the-shot)). **Next book** just clears the
camera, since the photos are already with the queue, and the Queue tab is
where books are confirmed and shelved.

The queue is the only thing that reads a photo. An earlier version identified
each shot synchronously for on-screen feedback and then let the queue read the
same image again, so every book paid for the expensive pass twice. The camera's
feedback is now a view of the queue's progress rather than separate work.

Reading is per slot and incremental. The back is read first because it carries
the identifier, and **the front and spine are usually never read at all**: once
the barcode has answered there is nothing they can add. They are only opened
when the book is still unidentified, and then only the front, for its cover
text.

The queue lives in the database, not the browser, so it survives a refresh and
both people see the same list.

### What was actually wrong for two people

| Problem | Status |
| --- | --- |
| Two simultaneous identifications hitting one tesseract worker, which handles a single job at a time, and zbar-wasm's module-level scanner | Fixed. All identification is serialised process-wide |
| Placement previewed, then a neighbour inserted by the other person before saving, so the book is filed into a gap that no longer exists | Fixed. The server recomputes placement at save time and the client now shows *that*, not its stale preview |
| Both people opening the same queued book and filling it in twice | Fixed. Claiming a capture is a single conditional UPDATE, so only one wins. It is a lease, not a lock, so a claim left open does not block the book forever |
| A contended SQLite write failing instead of waiting | Fixed with `busy_timeout` |
| The same book scanned twice, once by barcode and once by typed ISBN-10 | Already handled: duplicate detection matches on either column |

**Still true, and worth knowing:** two people can be told to put different
books into the *same* gap at the same time. Both instructions are correct when
issued, and the order of those two books relative to each other is then
whatever the shelf ends up with. The misfile check catches it afterwards
rather than preventing it, which for a home shelf is the right trade.

## Why it is built this way

**Identification happens on the server, not the phone.** The first version
decoded live video in the browser with ZXing and could not read real books.
Video frames are motion-blurred and well below sensor resolution, and Safari
has no `BarcodeDetector` to fall back on. The server decodes a full-resolution
still instead, and it works for reasons a video frame cannot match:

1. It decodes a **full-resolution still**, not a video frame.
2. It reads a barcode through **two decoders**, not one (see below), and
   **falls back to OCR** of the printed ISBN when neither finds one, which is
   the case the original browser version could never handle at all.
3. Its OCR **retries with preprocessed variants** rather than giving up on the
   first look, and runs a dedicated model ahead of that ladder (see
   [Reading the ISBN by text](#reading-the-isbn-by-text) below).

It also keeps several megabytes of WASM off the phone. The client bundle no
longer contains a barcode library at all.

### Reading a barcode

Two decoders run in a deliberate order, not one:

1. **zxing-cpp, compiled to WASM, goes first.** It does in one call what a
   preprocessing ladder does in several passes: rotation, inversion,
   downscaling and a harder search are all its own options, and it decodes the
   JPEG itself, so nothing has to be prepared for it first. Measured over the
   back covers in the library at the resolution the phone sends, it answers in
   about 160ms and reads roughly three in five of them.
2. **zbar runs underneath it, only when zxing finds nothing.** zbar is handed
   several preprocessed variants in turn: normalised, upscaled, thresholded,
   and rotated 90 and 270 degrees, each built while the previous one is being
   scanned so the wall-clock cost is close to the slowest single pass rather
   than the sum of all of them. It finds barcodes zxing does not, at a cost of
   about 2.6 seconds to discover it has found nothing on a cover with no
   barcode at all, which is why it only runs second.

Whichever decoder answers, the reading still has to pass the Bookland test
described below before it is trusted as an ISBN.

### Reading the ISBN by text

When there is no barcode, OCR is tried in a similarly deliberate order:

1. **PaddleOCR runs first, and often alone.** Detection and recognition are
   separate models, so unlike a preprocessing ladder it finds the text regions
   itself rather than being handed a fixed crop and asked to assume a layout;
   one pass does the work several tesseract passes exist to approximate.
   Measured against the back covers in the library whose barcode could not be
   read, it finds the printed ISBN in roughly a second each and reads more of
   them than the ladder below does, so when it produces a reading nothing else
   is worth waiting for.
2. **A pool of tesseract workers runs the preprocessing ladder behind it**,
   started in parallel and used only if Paddle's pass does not settle the
   answer. Multiple preprocessed variants (a wide normalised crop, the lower
   third of the cover, a CLAHE pass for glossy covers, and a crop around
   wherever the barcode decoder located a symbol, if it found one) are read at
   once, one per worker, rather than tried one at a time and stopped at the
   first success, which is what made the ladder slow before there was a pool.

Only two kinds of OCR'd number are trusted, regardless of which engine read
them:

- **Digits following an explicit `ISBN` label.** Books print one, and the label
  is the only thing that makes a bare 10-digit run interpretable.
- **A 978/979 prefixed run anywhere.** Bookland prefixes are self-identifying.

An **unlabelled 10-digit run is refused**, even with a valid check digit.
Roughly one in eleven random 10-digit sequences satisfies the ISBN-10
checksum, and a back cover is covered in long numbers: UPC digits, price
add-ons, order codes. Trusting them read `5176714485` off a photo of a UPC
barcode and confidently filed the wrong book.

**Letter-for-digit repair is applied inside a labelled run**, because OCR
returns `ISBN O-b7l-52543-3` for `ISBN 0-671-52543-3`. It is safe only because
the check digit still has to pass afterwards, so a wrong substitution is
discarded rather than believed. A run of one repeated digit is refused
outright: `0000000000` passes the checksum and is what OCR returns for a blank
patch.

**ISBN-10 and ISBN-13 are two data points, not one.** `resolveIsbnPair` is the
single place that decides whether something is a book identifier, so barcode
decoding, OCR and manual entry cannot disagree. Both forms are derived, both
are stored, both are searched:

- A **valid checksum is not enough**. EAN-13 product barcodes use the identical
  check-digit algorithm, so `isValidIsbn13('4006381333931')` is true for a jar
  of coffee. Only the 978/979 Bookland prefix separates a book from a retail
  code, and back covers routinely carry a second, non-Bookland barcode right
  beside the ISBN. Testing the checksum alone accepts the wrong one and
  produces a confident lookup for entirely the wrong book.
- **Lookups try both forms.** A catalogue indexes an edition under whichever
  ISBN it was issued with, so an older book registered only under its 10-digit
  ISBN is invisible to a 13-only search.
- **Duplicate detection searches both columns**, so the same book scanned once
  from its barcode and once from a printed ISBN-10 still matches.
- **979 ISBNs have no 10-digit form.** That field is correctly left empty
  rather than filled with something derived and wrong.

**Pre-ISBN-13 paperbacks need all of this.** They carry a retail **UPC-A**, not
a Bookland EAN, so the barcode is not the book and the only ISBN present is the
printed line. zbar and zxing both promote UPC-A to EAN-13 with a leading zero,
which has a valid checksum and is still not an ISBN.

**Canvas stills rather than `ImageCapture`.** Safari does not implement
`ImageCapture`, so a still is a canvas draw of the video frame. That makes the
requested track resolution the only real lever on quality, so the app asks for
4K, captures at up to 2400px wide at JPEG 0.92, and shows the resolution it
actually got in the camera HUD. Both barcode decoding and OCR lose accuracy
quickly on a downscaled or blocky source.

**Location is recorded, not allocated.** The app never claims a book must go in
a given section. It names the two neighbours and pre-fills a suggested
location, which you change to wherever the book actually went. That is why a
full shelf is a non-event and why there is no gap management or shift
computation anywhere in the code.

**The `author_filing` override table.** `filingName` files `Le Guin, Ursula K.`
correctly and files `Gabriel García Márquez` as `Márquez` incorrectly. Compound
surnames are not separable from middle names by heuristic, so the override
exists to be used. Editing "Files under" in the review pane saves it for that
author permanently.

## Data

Written to `web/data/` by default, override with `BOOKSCAN_DATA`:

- `books.db`, SQLite
- `covers/`, captured photos as JPEGs, plus a re-encoded publisher cover per
  book where one was found

Both OCR engines cache their downloaded models under the user's home
directory instead, independent of `BOOKSCAN_DATA`, since a model download is
not scan data: PaddleOCR under `~/.cache/ppu-paddle-ocr` (the library's
default) and tesseract's language data under `~/.cache/bookscan/tessdata`
(about 15 MB). Both are downloaded once on first use.

### Rehashing the stored covers

Cover hashes are derived from the images, so they can be recomputed whenever
the algorithm changes. It has changed once, and a hash the matcher no longer
recognises reports no likeness to anything rather than guessing, so until a
catalogue is rehashed, holding an already-scanned book up to the camera
matches nothing.

```bash
npx tsx server/rehash-covers.ts            # dry run, writes nothing
npx tsx server/rehash-covers.ts --apply    # write the new hashes
```

It reads `BOOKSCAN_DATA` the same way the server does and prints the directory
it resolved before doing anything. A dry run is the default, re-running it is
harmless, and it can be interrupted and started again. Add `--force` to
recompute hashes that are already current. A cover file that is missing or
unreadable is counted, named and stepped over, leaving the hash it had rather
than blanking it, and the run finishes the rest.

Back up `books.db` before a run with `--apply`.

### Cropping the photographs to the book

A photograph taken with a book held up to a phone has a room in it. Each of
the three photos is therefore cut down to the book itself and the crop saved
as a second file, so the gallery, the spine row and the detail view can show
the book while the photograph somebody actually took stays exactly as it was.

It runs on the server, unawaited, straight after a book is saved. The phone is
the wrong place for it: the shutter path already takes a burst and scores it
for sharpness on a device somebody is straining to hold steady, sharp is
already a dependency here, and the photograph has to reach the disk whole
before anything crops from it.

**Nothing is cropped in place, ever.** `front_crop`, `back_crop` and
`edge_crop` name new files beside the originals; `cropped` lists the slots the
detector has been shown. A slot listed there with an empty crop column was
looked at and declined, and the detail view captions that photo as shown
whole. That is a different state from a photo taken before any of this
existed, which is captioned as nothing at all.

`server/bookcrop.ts` would rather find nothing than find the wrong rectangle,
because a crop that cuts a cover in half is worse than the room being in
shot. It insists on four straight edges that each stand out from their
surroundings and step the same way in brightness, which is what tells a book
lying on a rug from the rug's own pattern. Measured against generated scenes
whose true rectangle is known (`server/bookcrop.test.ts`): the book is found
in 23 of 24, and none of the crops cut into it.

Photographs taken before this shipped are left alone. There is a tool, and
running it is the owner's decision:

```bash
npx tsx server/crop-books.ts                 # dry run, writes nothing
npx tsx server/crop-books.ts --apply
npx tsx server/crop-books.ts --apply --limit 20
```

Same shape as the rehash above: it reads `BOOKSCAN_DATA` the way the server
does, prints the directory before touching it, waits five seconds before a
write, and is resumable because a slot it finished is recorded. `--force`
re-examines slots already looked at, which is what to use after a change to
the detector.

### Cropping and hashing a queued capture

A capture in the queue gets exactly what a catalogued book gets: `front_crop`,
`back_crop`, `edge_crop` and `cropped` on the `captures` table, meaning what
they mean on `books`, plus `front_hash`, written by the same `imagehash.ts`
with the same `p1` format tag. The two are therefore comparable, which is what
lets a book held up to the camera be recognised as one already waiting to be
shelved rather than only as one already on a shelf.

It happens on the queue's own background pass, straight after the photographs
are read for an ISBN, so nobody waits for it: `POST /api/captures` fires
`drain()` and does not await it, and the derivation runs per capture inside
that loop. A capture that is re-photographed crops only the slot that is new.

Hashing fails closed. `coverHash` refuses a frame with no detail in it, and a
refusal leaves `front_hash` empty rather than storing a number that would go on
to be compared and offered to somebody as the book in their hands. An
unreadable file leaves whatever was there alone.

Discarding a capture deletes its files, and the crops go with the photographs
through the same orphan check (`Store.imageInUse`), never a second mechanism.
That check matters: a capture hands its filenames to the book it becomes and a
crop is named after the photograph it came from, so a capture's crop and the
resulting book's crop are one file on disk.

A discard is deferred by ten seconds in the client (`src/lib/discardWindow.ts`),
so the delete arrives long after the swipe and can land in the second the
worker spends cropping. A crop finished after its capture has gone is handed
back to that same sweep rather than left on disk, so the narrow race does not
leave a picture nothing can be traced to.

Captures photographed before this shipped are left alone. As with the books
above, there is a tool and running it is the owner's decision:

```bash
npx tsx server/crop-captures.ts                 # dry run, writes nothing
npx tsx server/crop-captures.ts --apply
npx tsx server/crop-captures.ts --apply --limit 20
```

Same shape again: `BOOKSCAN_DATA` as the server resolves it, the directory
printed before anything is touched, five seconds before a write, resumable
because a slot it finished is recorded and a hash it wrote is kept. `--force`
re-examines slots already looked at and re-hashes fronts already hashed.

Set `GOOGLE_BOOKS_API_KEY` to raise the Google Books quota. It is optional;
Open Library does the real work and Google anonymous requests start returning
429 partway through a shelf.

## Tests

```bash
npm test
```

The run prints the count, which is why one is not written here: it moved on
almost every merge and this line was three times out of date before anybody
noticed. The suites worth knowing about:

- `server/identify.test.ts` runs the real barcode and OCR pipelines against
  generated covers: clean, glossy, rotated 90 degrees, with a price add-on
  beside the ISBN, and with no barcode at all. This exists because the browser
  scanner passed all its unit tests and still could not read a book, having
  never been tested against an actual image.
- `shared/shelving.test.ts` and `shared/layout.test.ts` cover the filing-name
  edge cases and the shelf/area boundary arithmetic, including the two filing
  cases the heuristic is knowingly wrong about.
- `server/store.test.ts`, `server/shelves.test.ts` and `server/queue.test.ts`
  run the placement, boundary and capture-queue logic against a real database.
- `server/rehash.test.ts` covers the cover rehash: that a dry run writes
  nothing, that a second run finds nothing to do, and that a missing image is
  counted rather than thrown.
- Those four run **twice**, once against in-memory SQLite and once against a
  real Postgres in a container, and no assertion in them is conditional on
  which. That is the verification argument for stage F of the Postgres
  migration: the Postgres driver is correct exactly to the extent that the
  tests already guarding SQLite pass unchanged against it. **This is why
  `npm test` needs Docker**; `BOOKSCAN_TEST_DATABASE_URL` points the harness at
  a server you already have instead, and `npx vitest run --project sqlite` is
  the half that needs neither.
- `server/db.pg.test.ts` covers what those four cannot see, because every item
  on it fails silently rather than loudly: the `COLLATE "C"` declarations that
  keep shelf order in byte order, the connection a transaction is pinned to,
  and the aggregates that come back as strings without a cast.
- `server/bookcrop.test.ts` measures the crop detector against generated
  scenes whose true rectangle is known, and prints the figures. The assertion
  that matters is that no crop cut into the book, since that is the failure
  nobody can undo. `server/crop.test.ts` covers the storage half, including
  that the photograph is byte for byte what it was afterwards.

Fixtures are generated rather than checked in, so a test can state exactly
which condition it exercises.

## Known limits

- Series metadata resolves for well under half of books. Open Library packs it
  into free text (`"Dune (1); Dune Chronicles, Book 1"`) and Google Books does
  not expose it usably, so series name and number are editable fields and
  manual entry is the primary path.
- OCR is English only. A book whose ISBN is printed only in another script will
  need typing in.
- OCR only gets a turn when there is no barcode. PaddleOCR alone takes roughly
  a second; if it does not settle the answer, the tesseract ladder behind it
  adds several seconds more. A readable barcode still gives the fastest path
  by far.
- Cover matching is a shortlist, not an identification. It is not scale- or
  rotation-invariant, and never claims to be. It can open a book's page on its
  own when exactly one candidate is in the close band, because that writes
  nothing; it can never change a book's state, which always takes a tap.
- Non-fiction is ordered by author last name, matching fiction. If browsing by
  subject turns out to matter more, that is a change to the sort key tuple.
