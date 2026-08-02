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

Three photos per book, taken manually with a shutter button:

| Slot | What it is for |
| --- | --- |
| Front cover | The record, and an OCR title guess if no ISBN turns up |
| Back cover | The barcode and the printed ISBN. This is the one that matters |
| Spine | How the book looks on the shelf |

Each photo is sent to `/api/identify` as it is taken. Tap any slot to make it
the shutter's target and retake it. A photo is kept whether or not an ISBN is
found, and manual ISBN or title entry is always available.

The phone only ever talks to Vite over HTTPS. Vite proxies `/api` to the
Express process server-side, which is what keeps the page free of the
mixed-content errors Safari would otherwise block.

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

**Every OCR'd ISBN candidate is check-digit validated.** The extraction
patterns are deliberately loose, tolerating a hyphen or an OCR-inserted space
after any digit. That is only safe because nothing survives without a valid
check digit; without it the patterns would match half the numbers on a
copyright page.

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

94 tests. The ones worth knowing about:

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
