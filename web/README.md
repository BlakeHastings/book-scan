# book-scan web

A phone-first version of the scanner. Point an iPhone at the barcode on a back
cover and it tells you which two books to put it between.

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
  lib/scanner   getUserMedia + ZXing. Lazy loaded on first camera start.
  lib/api       typed fetch wrapper
server/         Express API on loopback only
  db            SQLite schema
  store         all SQL, including the neighbour lookup
  lookup        Open Library primary, Google Books top-up
  classify      fiction vs non-fiction ladder
shared/         pure logic used by both sides
  shelving      sort keys, filing names, placement, misfile detection
  isbn          validation, ISBN-10 to 13, price-barcode rejection
```

The phone only ever talks to Vite over HTTPS. Vite proxies `/api` to the
Express process server-side, which is what keeps the page free of the
mixed-content errors Safari would otherwise block.

## Why it is built this way

**ZXing rather than `BarcodeDetector`.** Safari does not implement
`BarcodeDetector`. Decoding is restricted to EAN-13, which is faster per frame
and avoids reporting the EAN-5 price add-on printed next to the ISBN on most
back covers. `pickIsbn` only accepts 978/979 prefixes with a valid check digit,
so a price barcode never reaches a lookup and never produces a confident wrong
book.

**Canvas stills rather than `ImageCapture`.** Safari does not implement
`ImageCapture` either, so a still is a canvas draw of the current video frame.
The only lever on quality is the requested track resolution, so the app asks
for 1080p and shows what it actually got in the camera HUD.

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
- `covers/`, captured stills as JPEGs

Set `GOOGLE_BOOKS_API_KEY` to raise the Google Books quota. It is optional;
Open Library does the real work and Google anonymous requests start returning
429 partway through a shelf.

## Tests

```bash
npm test
```

62 tests. The interesting ones are the filing-name edge cases in
`shared/shelving.test.ts`, the price-barcode rejection in `shared/isbn.test.ts`,
and `server/store.test.ts`, which runs the full insert-and-place path against a
real in-memory SQLite database.

## Known limits

- Series metadata resolves for well under half of books. Open Library packs it
  into free text (`"Dune (1); Dune Chronicles, Book 1"`) and Google Books does
  not expose it usably, so series name and number are editable fields and
  manual entry is the primary path.
- No OCR. Books with no readable barcode go through the manual title search.
- Non-fiction is ordered by author last name, matching fiction. If browsing by
  subject turns out to matter more, that is a change to the sort key tuple.
