# book-scan web

A phone-first version of the scanner. Photograph a book's cover, back and
spine, and it reads the ISBN and tells you which two books to put it between.

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
src/            React UI (phone-first, dark, 44px tap targets)
  lib/scanner   getUserMedia and manual still capture. No decoding.
  lib/api       typed fetch wrapper
server/         Express API on loopback only
  identify      zbar barcode + tesseract OCR, ported from recognize.py
  fixtures      synthetic covers for tests
  db            SQLite schema
  store         all SQL, including the neighbour lookup
  lookup        Open Library primary, Google Books top-up
  classify      fiction vs non-fiction ladder
shared/         pure logic used by both sides
  shelving      sort keys, filing names, placement, misfile detection
  isbn          validation, ISBN-10 to 13, OCR extraction, add-on rejection
```

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

**Correcting a book happens in the detail view, not at the camera.** Opening a
queued book shows its photos, every editable field, and the ISBN it was matched
on. **Change ISBN** prompts for the right digits, validates them before
spending a request, then refetches the whole record from the catalogue.

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

## The queue, and two people scanning at once

Photographing a book takes seconds; reading it takes longer. So a capture is
accepted the moment the photos exist and read afterwards. **Next book** hands
the three photos to `/api/captures` and clears the camera immediately, and the
Queue tab is where books are confirmed and shelved. Three books enqueue in
under 100 ms; the reading happens behind them.

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
has no `BarcodeDetector` to fall back on. The server now does what
`recognize.py` does, and it works for the same four reasons:

1. It decodes a **full-resolution still**, not a video frame.
2. It retries with **preprocessed variants** rather than giving up on the first
   look: normalise, 2x upscale, threshold, rotate 90 and 270. Threshold is what
   rescues glossy laminate; upscale is what rescues a small or distant barcode.
3. It uses **zbar** (via `@undecaf/zbar-wasm`), the same engine `pyzbar` wraps,
   which is materially better than ZXing on real EAN-13.
4. It **falls back to OCR** of the printed ISBN when there is no readable
   barcode, which is the case ZXing could never handle at all.

It also keeps several megabytes of WASM off the phone. The client bundle no
longer contains a barcode library at all.

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

**Only two kinds of OCR'd number are trusted.** A check digit alone is not
enough evidence, which a real book proved:

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

**Pre-ISBN-13 paperbacks need all of this.** They carry a retail **UPC-A**, not
a Bookland EAN, so the barcode is not the book and the only ISBN present is the
printed line. zbar promotes UPC-A to EAN-13 with a leading zero, which has a
valid checksum and is still not an ISBN.

**OCR preprocessing is a ladder, not a choice.** Measured on a real failing
photo (1986 paperback, dark cover, dark table): 1600px + CLAHE read *nothing*;
2200px + normalise read the ISBN; cropping to the region zbar reported the
barcode in read it most clearly. CLAHE is kept last because it is what rescues
a glossy cover, which normalise handles badly. Neither wins everywhere.

**Canvas stills rather than `ImageCapture`.** Safari does not implement
`ImageCapture`, so a still is a canvas draw of the video frame. That makes the
requested track resolution the only real lever on quality, so the app asks for
4K, captures at up to 2400px wide at JPEG 0.92, and shows the resolution it
actually got in the camera HUD. Both the barcode decoder and OCR lose accuracy
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
- `covers/`, three captured stills per book as JPEGs
- `tessdata/`, cached OCR language data (about 15 MB, downloaded once)

Set `GOOGLE_BOOKS_API_KEY` to raise the Google Books quota. It is optional;
Open Library does the real work and Google anonymous requests start returning
429 partway through a shelf.

## Tests

```bash
npm test
```

130 tests. The ones worth knowing about:

- `server/identify.test.ts` runs the real zbar and tesseract pipelines against
  generated covers: clean, glossy, rotated 90 degrees, with a price add-on
  beside the ISBN, and with no barcode at all. This exists because the browser
  scanner passed all its unit tests and still could not read a book, having
  never been tested against an actual image.
- `shared/shelving.test.ts` covers the filing-name edge cases, including the
  two the heuristic is knowingly wrong about.
- `server/store.test.ts` runs the full insert-and-place path against a real
  in-memory SQLite database.

Fixtures are generated rather than checked in, so a test can state exactly
which condition it exercises.

## Known limits

- Series metadata resolves for well under half of books. Open Library packs it
  into free text (`"Dune (1); Dune Chronicles, Book 1"`) and Google Books does
  not expose it usably, so series name and number are editable fields and
  manual entry is the primary path.
- OCR is English only. A book whose ISBN is printed only in another script will
  need typing in.
- The OCR fallback takes roughly one to two seconds per photo. Barcode decoding
  is far quicker, so a readable barcode still gives the fastest path.
- Non-fiction is ordered by author last name, matching fiction. If browsing by
  subject turns out to matter more, that is a change to the sort key tuple.
