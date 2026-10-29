# The cover matcher: what others do, what was measured, and what to build

For #659, under epic #658. The epic asks for the scanner to recognise a book
from a photograph of its front cover by several strategies, measured rather
than believed. This page is the research half of the first step and the
explanation of the harness that does the measuring. It recommends; the table
decides, and every later step in #658 is expected to add its row before it
replaces anything.

Everything here was read or run on 2026-10-28. Versions are the ones current
that day.

---

## Where it stood before the fusion

Since #669 the scan route asks the fused matcher instead; see
[Fusion, as built](#fusion-as-built). What follows is the baseline the harness
still measures as `hash (today)`.

`POST /api/books/scan` reads a barcode first. When none decodes, it hashes the
centre 70% of the frame (`web/server/imagehash.ts`: a 64-bit DCT hash, `p1`
format) and ranks every catalogued book by Hamming distance to its stored
`front_hash` and `cover_hash` (`looksLike` in `web/server/index.ts`). Anything
past 24 bits is dropped; exactly one candidate within 8 bits is "confident"
(`confidentPick`, `web/shared/confidence.ts`) and is opened without asking.

The hash's own comments say it is not scale or rotation invariant. The harness
puts a number on what that costs: see [The measurements](#the-measurements).

---

## What others do

**The standard pipeline is retrieve, then verify.** Instance retrieval (finding
*this* object, not *this kind* of object) has looked the same for fifteen years:
a cheap global descriptor shortlists candidates from the whole database, and a
more expensive check re-ranks or verifies the shortlist. What changed is the
global descriptor: bag-of-visual-words over SIFT gave way to CNN descriptors and
now to self-supervised vision transformers.

- Book and CD covers are one of the categories of the Stanford Mobile Visual
  Search set, built exactly for phone photos of flat printed products against
  clean reference images (Chandrasekhar et al., MMSys 2011,
  <https://dl.acm.org/doi/10.1145/1943552.1943568>). The systems evaluated on it
  are local features with geometric verification.
- "Efficient Media Retrieval from Non-Cooperative Queries" (arXiv 1411.5307,
  <https://arxiv.org/abs/1411.5307>) adds 100K distractor covers to a mobile
  book-cover set and finds the title and author text "readily available and
  extremely helpful": cover retrieval is partly a text problem.
- A comparison of feature detectors for cover identification with one
  reference image per cover (arXiv 2001.05200,
  <https://arxiv.org/abs/2001.05200>) is the local-feature end of the same
  question.
- Patent US 9195819 (<https://patents.google.com/patent/US9195819>) describes a
  shipped book-ownership flow matching ORB/SIFT/SURF features of a cover photo
  against a cover database.
- pgvector's own README recommends hybrid search: vectors "together with
  Postgres full-text search", combined by Reciprocal Rank Fusion
  (<https://github.com/pgvector/pgvector#hybrid-search>).

So the shape #658 already chose (an ISBN when there is one, otherwise image
vectors and cover text fused by rank, a shortlist unless one candidate clears a
measured bar) is the mainstream shape, not an invention.

---

## Strategy by strategy

### 1. A decoded ISBN: keep, decisive

Not a matcher and not in the table. A check-digit-valid ISBN-13 is evidence and
short-circuits everything, as it does today (`web/server/identify.ts`). Nothing
here changes that.

### 2. Image embeddings: build, as the primary visual signal

A pretrained vision encoder turns an image into a vector; two photographs of
the same cover land close by cosine similarity, under perspective, glare and
crop, because the network was trained to be invariant to exactly those.

**Which kind of encoder matters more than which size.** CLIP and SigLIP are
trained to align images with captions, so they learn *what a picture is of*:
two different fantasy covers with a dragon on them are near neighbours. DINOv2
is self-supervised on images alone and keeps instance-level detail. Its paper
measures this directly (Oquab et al., arXiv 2304.07193, Table 9, frozen
features, <https://arxiv.org/abs/2304.07193>): on Oxford-Hard landmark retrieval
DINOv2 ViT-S/14, the smallest, scores **43.2 mAP against 19.7 for OpenCLIP
ViT-G/14**, a model more than fifty times its size. Independent practice agrees
informally: the ImageNet-flaws study (arXiv 2412.00076) tried CLIP for duplicate
detection, found it unsatisfactory, and used DINOv2.

Candidates that run from Node, measured or read:

| Encoder | ONNX on Hugging Face | Vision ONNX size | Dim | Weights licence | Notes |
| --- | --- | --- | --- | --- | --- |
| **DINOv2 ViT-S/14** | `onnx-community/dinov2-small` | 88.5 MB fp32, 24.4 MB int8 | 384 | Apache-2.0 | Instance-level. Measured below |
| CLIP ViT-B/32 | `Xenova/clip-vit-base-patch32` | 351.7 MB fp32, 89.1 MB int8 | 512 | MIT | Semantic. Measured below (int8) |
| SigLIP base 224 | `Xenova/siglip-base-patch16-224` | 371.8 MB fp32, 99.5 MB int8 | 768 | Apache-2.0 | Semantic, like CLIP. Not measured |
| SigLIP 2 base 224 | `google/siglip2-base-patch16-224` | ONNX community export | 768 | Apache-2.0 | Not measured |
| MobileCLIP / MobileCLIP2 | `apple/MobileCLIP-S0`, `apple/MobileCLIP2-S0` | small | 512 | **apple-amlr: research use only** | Ruled out by licence |
| DINOv3 ViT-S/16 | `onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX` | | 384 | **DINOv3 licence (custom, gated)** | Not measured; revisit if its terms suit |

Sizes are from the Hugging Face tree API at the pinned revisions; licences from
each model card's metadata. MobileCLIP's licence was read in full
(<https://huggingface.co/apple/MobileCLIP2-S0/blob/main/LICENSE>): "exclusively
for Research Purposes", defined to exclude "product development or use". That
is a hard no for an app, however small.

**How to run one.** `onnxruntime-node` is already a dependency (1.27.0, for
PaddleOCR), so the harness runs the encoder directly: resize to 224 by 224,
normalise by the model's published mean and standard deviation, one
`session.run`, take the vector, normalise it. That is about forty lines
(`web/server/cover-matching/embedding-matcher.ts`) and adds no package.
`@huggingface/transformers` (4.3.2) would do the preprocessing for us, but it
pins its own `onnxruntime-node` (1.30.0) and `sharp` (^0.35.4), so it would
bring a second copy of the ONNX runtime's native binary into the image for the
sake of a resize. Recommendation: stay on raw `onnxruntime-node` unless a model
needs a tokenizer.

Two preprocessing decisions, both measured on the tuning seed:

- **The whole cover squashed to a square, not the model card's centre crop.**
  The processor configs say resize the short side and centre crop 224. On a 2:3
  cover that cuts off the top and bottom sixths, which is where titles and
  authors are printed.
- **DINOv2's class token.** The `onnx-community` export has no pooled output,
  only `last_hidden_state`; its first token is the class token after the final
  layer norm, which is what Hugging Face's pooled output is.

**Recommendation: DINOv2 ViT-S/14 (`onnx-community/dinov2-small`), fp32,
384 dimensions, Apache-2.0.** Smallest of the candidates, instance-level by
design, licence clean, and the best row on real covers (90% top-1 against
CLIP's 81%). It is the worst row on the synthetic set, and why that is, and
what it means for the bar, is in [What the numbers say](#what-the-numbers-say).
The int8 export (24 MB) is worth measuring before shipping if the image size
matters.

### 3. Vectors in Postgres: pgvector, and no index yet

pgvector 0.8.7 (<https://github.com/pgvector/pgvector>), image
`pgvector/pgvector:pg18` (also `0.8.7-pg18` to pin). Cosine distance is `<=>`.

**At thousands of rows an index is not needed.** pgvector's README: "By default,
pgvector performs exact nearest neighbor search, which provides perfect
recall." Five thousand 384-float vectors is under 8 MB and a sequential scan of
it is milliseconds, against an encoder that takes tens of milliseconds per
photograph. An approximate index can only lose recall here.

When one is wanted, **HNSW rather than IVFFlat**: HNSW (`m` 16,
`ef_construction` 64, `hnsw.ef_search` 40 by default, operator class
`vector_cosine_ops`) can be built on an empty table and stays good as rows
arrive one at a time, which is how this catalogue grows. IVFFlat's lists are
trained on the data present when the index is built ("Create the index *after*
the table has some data") and drift as books are added. `vector` indexes up to
2,000 dimensions and `halfvec` up to 4,000; 384 needs neither trick.

Recommendation: `CREATE EXTENSION vector`, a `vector(384)` per image, exact
search, and an HNSW index only when a measurement says the scan is slow. The
epic's migration step can create the HNSW index anyway at no cost to recall if
it prefers having one in place; the point is not to pick IVFFlat.

### 4. Cover text: build, as the second signal

Titles and authors are printed large on the front, and they are what tells
apart the books an image cannot: one series in one template, which the harness
generates on purpose. arXiv 1411.5307 above found the text "extremely helpful".
PaddleOCR is already in the app (`web/server/paddle.ts`).

Matching noisy OCR to catalogue strings is what `pg_trgm` is for
(<https://www.postgresql.org/docs/current/pgtrgm.html>): `word_similarity(ocr,
title)` finds the title inside a longer OCR string and tolerates the
substitutions OCR makes (`rn` for `m`, `0` for `O`), with a GIN trigram index
when it is needed. Full-text search (`tsvector`, `ts_rank`) stems and drops stop
words, which helps a sentence and hurts a title made of three short words; it
also needs whole words right, which OCR often does not deliver. Recommendation:
trigrams, scored against title and author separately, as its own matcher row.

Cost is the catch. The scan route's comment puts a full OCR pass at five to ten
seconds; Paddle alone is faster. It has to be measured in the harness, at the
latency the route can afford, before it goes in front of the thorough barcode
read.

Built in #667, and two of the guesses above did not survive measuring:
`similarity` ranks better than `word_similarity`, and a GIN index with a
threshold loses the right book where a GiST nearest-first walk does not. See
[Cover text, as built](#cover-text-as-built).

### 5. The perceptual hash: keep only as a weak signal, if at all

pHash-style hashes compare the coarse light-dark layout of the whole frame, so
a few degrees of rotation, a keystone, or a different amount of table around
the book moves many bits. That is the published and the measured picture: the
harness puts today's hash at chance level on careless photographs and only
useful on photographs taken square. In practice hashes are used for
de-duplicating identical files, not for recognising an object in a scene.

Recommendation: keep `front_hash` and `cover_hash` (they are cheap and
existing), give the hash a row in every fusion measurement, and drop it from
the fusion if it does not move the fused row. Do not let it open a book on its
own once the embedding is in.

### 6. Local features with geometric verification: the re-ranker to try last

ORB, SIFT or AKAZE keypoints matched between the photograph and each
shortlisted cover, then RANSAC fitting a homography: the inlier count is close
to a proof, because a printed cover is a plane and a plane under perspective is
exactly a homography. This is the classic spatial verification step and is what
the patent and Stanford-set systems do. It is the strongest available answer to
"this series, but which volume", and the natural thing to raise confidence to
the opening bar.

In Node the options are OpenCV compiled to WebAssembly (`@techstark/opencv-js`
5.0.0-release.1, Apache-2.0) or native bindings, which are heavy to build;
learned matchers (SuperPoint with LightGlue) have ONNX exports but are another
two models. Recommendation: not now. Measure the embedding and text rows first;
if the confident-wrong rate on series is what is left, add ORB plus homography
over the top four only, as a re-ranker with its own row.

### 7. Fusion: reciprocal rank fusion, with a bar measured per fusion

RRF (Cormack, Clarke and Büttcher, SIGIR 2009,
<https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf>) scores each
candidate as the sum over rankers of 1 / (k + rank), with k = 60 in the paper.
It needs no calibration between a cosine and a trigram score, which is its
whole appeal, and it is what pgvector's README suggests for hybrid search.

The weakness is that RRF ranks; it does not say how sure. The confident bar
cannot be an RRF score. It has to be a rule over the underlying evidence,
measured in the harness: for example "the embedding's top cosine clears its bar
*and* the text matcher agrees on the same book", or a margin between first and
second. Agreement between independent signals is the cheapest strong evidence
there is. Recommendation: RRF for the shortlist, and an agreement rule for the
bar, both rows in the table.

---

## The harness

`web/server/cover-matching/`:

| File | What it is |
| --- | --- |
| `matcher.ts` | `CoverMatcher`: `prepare(catalogue)` once, then a search that takes a photograph and answers ranked candidates with scores and the one book, if any, it would open without asking. The bar is the matcher's own declaration |
| `synthetic.ts` | The labelled set, from a seed |
| `evaluate.ts` | top-1, top-4, confident right and wrong, timing, and the table |
| `hash-matcher.ts` | Today's matcher, using `MATCH_CUTOFF` and `confidentPick` from `shared/confidence.ts` so it is what ships |
| `embedding-matcher.ts`, `models.ts`, `encode.ts` | An encoder's row: in-memory cosine, weights pinned by revision and SHA-256 and cached in `~/.cache/bookscan/models`. `encode.ts` prepares and embeds an image, and the app embeds through it too (below) |
| `text-matcher.ts`, `catalogue-database.ts` | Cover text (#667): PaddleOCR, then the app's own query handler over a real Postgres the runner provides. See [Cover text, as built](#cover-text-as-built) |
| `real-covers.ts` | The optional local mode's Open Library download |
| `fused-matcher.ts` | The fused matcher (#669): `MatchCoverHandler`, the query the scan route asks, over the harness's picture and hash and the app's own text handler |
| `registry.ts` | The matchers scored, the floor each is held to, and `CI_SET` |
| `floors.test.ts` | The CI check |

`web/scripts/cover-matchers.ts` (`npm run eval:covers`) prints the table.

### The set

Covers are invented: SVG colour fields, gradients, stripes, frames and shapes,
with the title and author rendered by sharp from the embedded Gelasio font
(`server/fixtures-assets`), never a font name in SVG, which would resolve
differently per machine. About a quarter of the books come in series of three
to five that share one design and one author and differ only in their title,
which is the case a whole-image likeness is worst at.

Each catalogued book is photographed twice. A photograph is a true perspective
projection of the cover (a homography, sampled bilinearly) at up to 15 degrees
of rotation, a keystone tilt, a book filling 60 to 100% of the frame's height
so that the frame sometimes cuts it, on a wood, carpet, cloth or plain ground,
with light falling off across the frame, a glare spot, a colour cast, exposure
error, sensor noise, blur and JPEG at quality 50 to 90. `--severity` scales all
of that from 0 (square, clean) to 1 (the default).

A fifth as many books again are photographed but left out of the catalogue,
which is what somebody holding a new book does. Any confident answer to one of
those is confidently wrong, and the table says how many were.

The same seed gives byte-identical photographs on one machine (the test checks
this); glyph edges differ by a few grey levels between platforms, so the floors
carry a margin.

### The local real-cover mode

`npm run eval:covers -- --real 200` takes covers from Open Library's subject
listings across ten subjects, by cover id (which the covers API does not rate
limit: "The cover access by ids other than CoverID and OLID are rate-limited",
<https://openlibrary.org/dev/docs/api/covers>), caches them and the manifest
in `~/.cache/bookscan/cover-eval/openlibrary`, and photographs them with the
same transforms. Nothing is written to the repository or `BOOKSCAN_DATA`, no
test calls it, and CI never runs it. Covers are copyrighted: do not commit them.

### The floor test

`floors.test.ts` generates `CI_SET` (seed 1, 40 books, two photographs each,
ten uncatalogued), scores each registered matcher and fails when top-1 or top-4
falls below, or the confident-wrong rate rises above, what `registry.ts`
recorded. A matcher that needs weights runs only where they are already cached
and is skipped, by name, where they are not: the test never downloads. CI
restores both encoders' weights from `actions/cache`, keyed on each pinned
revision and SHA-256 (`web/scripts/cover-models.ts`), so every row runs on every
pull request, and a row that would be skipped there fails instead. The
cover-text row needs no encoder and runs everywhere, in the file's own scratch
database, with the Paddle models `paddle.test.ts` already fetches.

### In the app (#666)

The app embeds with DINOv2 ViT-S/14, through the same `openEncoder`, so a
photograph is prepared one way (squashed to 224, the measured choice) at save,
at query and in the floors:

- **After a save**, the background chain that fetches the cover, hashes it and
  crops the photographs ends by embedding the book's `front` and `catalogue`
  photographs into `cover_embedding`, one at a time and two threads each, so
  the quarter second each costs is never on a request.
- **At start**, once the weights are loaded and verified, every catalogued
  book's photograph without an embedding is embedded. `npx tsx
  server/embed-covers.ts --target` is the same backfill from the command line.
- **The weights** are fetched from the pinned revision at start, checked
  against the recorded SHA-256 whether fetched or already cached, and kept in
  `~/.cache/bookscan/models`. When that fails the server says
  `[covers] similarity is off` and nothing else changes.
- **`NearestCoversHandler`** embeds a photograph and asks Postgres for the
  nearest catalogued books, one entry per book, through the partial HNSW index
  migration 0034 builds for 384 dimensions. `/api/books/scan` asks it through
  the fused matcher (#669); see [Fusion, as built](#fusion-as-built).

## The measurements

All on one Linux x64 machine, CPU only, 2026-10-28.

### The synthetic set, default size (`npm run eval:covers`)

150 catalogued books, 300 photographs of them, 30 photographs of books not in
the catalogue, seed 1, severity 1. The set took 27 s to make; the whole run
238 s.

| matcher                  | photos | top-1 | top-4 | confident right | confident wrong       | prepare | per photo |
|--------------------------|--------|-------|-------|-----------------|-----------------------|---------|-----------|
| hash (today)             | 300+30 | 3.0%  | 13.3% | 0.0%            | 0.0% (0 uncatalogued) | 0.8s    | 7ms       |
| embedding (dinov2-small) | 300+30 | 23.3% | 44.0% | 0.0%            | 0.0% (0 uncatalogued) | 28.5s   | 336ms     |
| embedding (clip-b32)     | 300+30 | 91.0% | 98.7% | 49.1%           | 0.0% (0 uncatalogued) | 20.7s   | 147ms     |

Bars: hash, exactly one candidate within 8 of 64 bits (`confidentPick`);
DINOv2, best cosine at least 0.85 and 0.08 ahead of the second; CLIP, best
cosine at least 0.75 and 0.10 ahead of the second.

### The CI set (`npm run eval:covers -- --ci`, what `floors.test.ts` scores)

40 catalogued, 80 + 10 photographs, made in 8 s.

| matcher                  | photos | top-1 | top-4 | confident right | confident wrong       | prepare | per photo |
|--------------------------|--------|-------|-------|-----------------|-----------------------|---------|-----------|
| hash (today)             | 80+10  | 6.3%  | 16.3% | 0.0%            | 0.0% (0 uncatalogued) | 0.2s    | 7ms       |
| embedding (dinov2-small) | 80+10  | 40.0% | 80.0% | 0.0%            | 0.0% (0 uncatalogued) | 9.7s    | 334ms     |
| embedding (clip-b32)     | 80+10  | 90.0% | 97.5% | 38.9%           | 0.0% (0 uncatalogued) | 5.4s    | 127ms     |

### The hash, by how carefully the photograph is taken

Same 150 books, hash only, `--severity`:

| severity | top-1 | top-4 |
| --- | --- | --- |
| 0 (square, centred, clean) | 24.7% | 44.3% |
| 0.25 | 18.7% | 38.0% |
| 0.5 | 11.7% | 28.0% |
| 1 (default) | 3.0% | 13.3% |

Even a perfectly square photograph only gets the hash to one in four. That is
the framing, not the hash being broken: the catalogue's cover fills its image
and the book in a photograph does not, so the centre 70% of each is a different
region at a different scale. The "wrong book first about one lookup in ten" in
`server/index.ts` was measured photograph against photograph (`front_hash`, the
owner's own shot at save time), which this set does not model; against
publisher artwork, which is what `cover_hash` holds and what a fresh catalogue
mostly has, the hash is close to chance. It is never confidently wrong here
because it is never confident: nothing lands within 8 bits.

### Two decisions measured on the tuning seed (7), not the reported one

| preprocessing | DINOv2 top-1 / top-4 | CLIP top-1 / top-4 |
| --- | --- | --- |
| squash whole image to 224 | 22.9% / 50.4% | **93.3% / 98.8%** |
| model card: resize, centre crop 224 | 28.3% / 56.3% | 87.9% / 95.8% |

Squash is kept for both, for one rule across encoders. The crop's gain for
DINOv2 here is worth a row on real covers before the embedding ships, since
that is the encoder recommended below.

The bars came from the same seed. CLIP at cosine 0.75 and margin 0.10 cleared
134 of 270 photographs there and opened no wrong book; the closest a wrong
first answer came was 0.816 cosine, or a 0.093 lead. DINOv2's wrong answers
reached 0.80 and a 0.06 lead while its right ones rarely did better, so no bar
separates them and its bar is set where it is never confident.

### Real covers, locally (`npm run eval:covers -- --real 200`)

200 covers from Open Library's subject listings (ten subjects, twenty each),
160 catalogued and photographed twice, 40 held up but not catalogued, the same
transforms at severity 1. Not committed, not in CI. The downloads took most of
the 138 s the set took to make; the whole run 302 s.

| matcher                  | photos | top-1 | top-4 | confident right | confident wrong       | prepare | per photo |
|--------------------------|--------|-------|-------|-----------------|-----------------------|---------|-----------|
| hash (today)             | 320+40 | 7.8%  | 14.4% | 0.3%            | 0.0% (0 uncatalogued) | 0.6s    | 7ms       |
| embedding (dinov2-small) | 320+40 | 90.0% | 96.3% | 3.9%            | 0.0% (0 uncatalogued) | 33.5s   | 249ms     |
| embedding (clip-b32)     | 320+40 | 80.9% | 86.9% | 38.3%           | 0.3% (1 uncatalogued) | 12.6s   | 69ms      |

CLIP's one confident mistake: a photograph of *The warlord of Mars* (#3 in Burroughs' Barsoom series),
not catalogued, opened *A Princess of Mars*, its series sibling, unasked. That
is exactly the failure #658 warns about.

One limit of this mode: the photograph is made from the very file the
catalogue holds. A real shelf has a different printing, edition or wear from
whatever artwork Open Library has, so these numbers are an upper bound on the
match itself, not a prediction.

### What the numbers say

**The two encoders swap places between the sets, and both results are real.**
On the synthetic covers CLIP finds the book 91% of the time and DINOv2 23%; on
real covers DINOv2 finds it 90% of the time and CLIP 81%. The synthetic covers
are plain fields and shapes with large type, so the only thing that tells two
of them apart is the words, and CLIP, trained on web images with their
captions, learned to read; DINOv2, trained on images alone, sees type as
texture. Real covers carry artwork, which is what DINOv2 is built to recognise
and what its paper measures (Table 9, above). So:

- **The synthetic set over-rewards reading text.** It stays the CI check,
  because it is what can be generated, but it should not pick the encoder by
  itself. Richer artwork in the generator (photographic textures, illustrated
  scenes) is a reasonable follow-up; the real-cover mode is the arbiter until
  then.
- **Reading the words is a separate strategy, and #658 already plans it.**
  OCR'd cover text matched with trigrams covers what DINOv2 cannot see, and
  does it as evidence (the title is printed there) rather than as a likeness.
  CLIP's lead on the synthetic set is a preview of what the text matcher
  should add.

**Recommendation: DINOv2 ViT-S/14 (`onnx-community/dinov2-small`,
`onnx/model.onnx` at revision `8b1f705`), fp32, 384 dimensions, Apache-2.0,
88.5 MB, about 250 to 340 ms a photograph on this CPU, as the image embedding;
and the cover-text matcher next, to be fused with it.** CLIP stays registered
because it is the best reader of the two and the fusion step should measure
whether a second embedding earns its 89 MB and 70 to 150 ms.

**Neither bar is ready to ship.** DINOv2's bar, set on synthetic seed 7 where
nothing separated right from wrong, is so strict that on real covers it opens
only 4% of books unasked (and none wrongly). CLIP's, set on the same seed,
opened a series sibling on real covers. The bar has to be calibrated on real
covers (the local mode) and on fusion, not on the synthetic set, and a rule
that needs two independent signals to agree is the likeliest to keep a
series sibling out.

**The hash should not open a book on its own once anything else exists**, and
whether it earns a place in the fusion is the fusion step's measurement. On
real covers it is at 7.8% top-1 against publisher artwork.

### How long the harness takes

- `floors.test.ts` on CI (hash only, encoders not cached): the set is made in
  about 8 s and the hash scores it in under a second.
- The same file with both encoders cached: 51 s, of which DINOv2 is 24 s and
  CLIP 12 s.
- `npm run eval:covers`: 238 s for 150 books and three matchers.
- `--real 200`: 302 s the first time, most of it downloads.

---

## Cover text, as built

#667, measured 2026-10-29 on the same machine.

**What runs.** PaddleOCR reads the photograph (`server/paddle.ts`, the same
call the ISBN path makes on it), and `MatchCoverTextHandler`
(`web/application/books/queries/match-cover-text.ts`) takes the text, not the
photograph, so the fusion step can hand it the reading the ISBN path already
made. Its read model (`web/infrastructure/books/cover-text-read-model.ts`):

1. **Candidates**: the 50 titles nearest the reading (`ORDER BY title <->
   text`) and the books of the 50 printed names nearest it, each a
   nearest-first walk of a GiST trigram index (migration 0035).
2. **Scores**, per candidate, against the whole folded reading:
   `similarity(title, text)`, `similarity(author, text)` for the first credit,
   and `word_similarity(title, text)`.
3. **Rank** by the mean of the two similarities. A cover showing only a name
   still ranks that author's books, because the author half carries it.
4. **The bar** (the harness's; the scan route has none yet): the best has
   `word_similarity(title, text) >= 0.8`, which is the title being printed
   there, and leads the second by 0.05.

A reading with no word of four letters or more outside a short stop list
answers nothing: "THE OF A" names no book however many titles share its
trigrams.

**The harness runs it through the real thing.** The catalogue is saved by the
app's save path into a real Postgres (the suite's scratch database in
`floors.test.ts`, a container or `BOOKSCAN_TEST_DATABASE_URL` in
`npm run eval:covers`), so the row is the query that would ship, `pg_trgm`
and all, not a TypeScript copy of its arithmetic.

### Which OCR

Measured, not assumed. Every photograph of the CI set and of the 200 real
covers was read by Paddle and by tesseract's whole-frame pass
(`wide-normalised`, PSM AUTO, as `identify.ts` runs it), and each reading was
scored by the same formula:

| reader | CI set top-1 / top-4 | real covers top-1 / top-4 | per photograph |
| --- | --- | --- | --- |
| Paddle | 91.3% / 96.3% | 55.3% / 67.2% | about 180 ms |
| tesseract | 7.5% / 15.0% | 4.7% / 7.8% | about 430 ms |
| both, concatenated | 91.3% / 96.3% | | both |

(The formula there is the earlier `word_similarity` mean, with no candidate
step; the comparison between readers is what it is for.) Tesseract's layout
analysis does not find lines that are turned, and every photograph here is
turned a little; on the CI set it read 15 of 418 words of four letters or more
exactly, Paddle 257. Paddle alone, then, and tesseract adds nothing to it.

### Which `pg_trgm` function

Ranked by the mean of a title score and an author score, on Paddle's
readings, with every catalogued book scored (no candidate step):

| title and author each scored by | seed 7 (tuning) top-1 / top-4 | CI set | real covers |
| --- | --- | --- | --- |
| `word_similarity` | 89.3% / 98.0% | 91.3% / 96.3% | 55.3% / 67.2% |
| `strict_word_similarity` | 89.0% / 97.3% | 91.3% / 96.3% | 57.5% / 67.2% |
| **`similarity`** | **92.3% / 98.7%** | **93.8% / 96.3%** | **61.6% / 68.1%** |
| `word_similarity` per significant word, by length | 88.7% / 96.7% | | 56.3% / 67.2% |
| `word_similarity`, stop words stripped both sides | 87.0% / 96.7% | | 56.6% / 66.3% |

`similarity` wins on all three sets, by three to six points of top-1, and
that is why it ranks. `word_similarity(title, text)` asks how much of the
title is in the reading, so a short title contained in a longer one ("The
Hidden Garden" inside "Island of Hidden Gardens") scores as high as the
longer one; `similarity` also counts what of the reading the title does not
explain. Stripping stop words from both sides made things slightly worse
under every function, so short words are handled by refusing a reading made
only of them rather than by editing what is compared.

On seed 7, weighting the title above the author lost 0.3 points of top-1 at
2:1 and 1.6 at 3:1, and taking the larger of the two instead of the mean lost
21, because then every book of a series ties on its author.

### Why GiST and nearest-first, not GIN and a threshold

The first version found candidates the way the issue described: a GIN index,
and `title %> ANY(words)`, which holds when a word of the reading is within
`pg_trgm.word_similarity_threshold` (0.6) of a word of the title. On real
covers that left the right book out of the candidates for 145 of 320
photographs, and cost ten points of top-1 and fourteen of top-4 against
scoring every book; at 0.4 it still cost three and six. OCR of a real cover is
noisier than any threshold that still narrows anything.

GiST answers `ORDER BY title <-> text LIMIT n` nearest first and exactly, so
nothing is thresholded away. On the 160 real covers, scoring only the ten
nearest titles and the books of the ten nearest names gave the same top-1 and
top-4 as scoring every book; the read model takes fifty, for a collection
larger than 160.

### The measurements

Every row as `npm run eval:covers` printed it, with the cover-text row beside
the others (the embedding rows as they stood before #666 landed, on the same
sets):

The synthetic set, default size (150 catalogued, seed 1):

| matcher                      | photos | top-1 | top-4 | confident right | confident wrong       | prepare | per photo |
|------------------------------|--------|-------|-------|-----------------|-----------------------|---------|-----------|
| hash (today)                 | 300+30 | 3.0%  | 13.3% | 0.0%            | 0.0% (0 uncatalogued) | 0.7s    | 6ms       |
| embedding (dinov2-small)     | 300+30 | 23.3% | 44.0% | 0.0%            | 0.0% (0 uncatalogued) | 17.9s   | 118ms     |
| embedding (clip-b32)         | 300+30 | 91.0% | 98.7% | 49.1%           | 0.0% (0 uncatalogued) | 7.2s    | 47ms      |
| cover text (paddle, pg_trgm) | 300+30 | 90.0% | 94.3% | 48.5%           | 0.0% (0 uncatalogued) | 3.6s    | 119ms     |

The CI set (what `floors.test.ts` scores):

| matcher                      | photos | top-1 | top-4 | confident right | confident wrong       | prepare | per photo |
|------------------------------|--------|-------|-------|-----------------|-----------------------|---------|-----------|
| hash (today)                 | 80+10  | 6.3%  | 16.3% | 0.0%            | 0.0% (0 uncatalogued) | 0.2s    | 6ms       |
| embedding (dinov2-small)     | 80+10  | 40.0% | 80.0% | 0.0%            | 0.0% (0 uncatalogued) | 4.6s    | 113ms     |
| embedding (clip-b32)         | 80+10  | 90.0% | 97.5% | 38.9%           | 0.0% (0 uncatalogued) | 2.1s    | 48ms      |
| cover text (paddle, pg_trgm) | 80+10  | 93.8% | 96.3% | 56.7%           | 0.0% (0 uncatalogued) | 1.4s    | 121ms     |

Real covers, locally (`--real 200`; the cache held 200 covers, of which 170
were catalogued this time):

| matcher                      | photos | top-1 | top-4 | confident right | confident wrong       | prepare | per photo |
|------------------------------|--------|-------|-------|-----------------|-----------------------|---------|-----------|
| hash (today)                 | 340+30 | 8.2%  | 12.6% | 0.0%            | 0.3% (0 uncatalogued) | 0.5s    | 6ms       |
| embedding (dinov2-small)     | 340+30 | 88.5% | 94.4% | 4.6%            | 0.0% (0 uncatalogued) | 19.8s   | 113ms     |
| embedding (clip-b32)         | 340+30 | 79.1% | 84.7% | 39.2%           | 0.3% (1 uncatalogued) | 7.7s    | 45ms      |
| cover text (paddle, pg_trgm) | 340+30 | 58.2% | 65.0% | 17.8%           | 0.0% (0 uncatalogued) | 3.8s    | 147ms     |

Per photo is Paddle's reading plus the query. On real covers the text
matcher finds the book less often than DINOv2 (Open Library's medium covers carry small, stylised type that Paddle
often cannot read), but it is the only row that opens a book unasked on one
photograph in six without ever opening the wrong one, and it did not open
*A Princess of Mars* for *The Warlord of Mars*, which CLIP did. That is the
agreement the fusion step's bar wants: an embedding's likeness and a printed
title are independent evidence.

### Series siblings

Photographs of a book with a catalogued series sibling, and how often the
cover-text matcher ranked the right volume above every one of them (a sibling
outside the four answered counts as beaten only when the right book is inside
them):

| set | photographs with a sibling | right volume above every sibling |
| --- | --- | --- |
| synthetic, 150 books (series share author, design and the words before the colon) | 104 | 85 (81.7%) |
| real covers (sibling approximated as another catalogued book by the same first author) | 148 | 94 (63.5%) |

The misses are mostly readings where Paddle read the author and not the
title: then every volume ties on the author half and the title half is noise.
None of them was confident: the bar needs the title printed.

### The box over 'll'

The review of #664 saw a missing-glyph box drawn over the 'll' of the embedded
font, and #667 asked for it to be fixed in the generator. There is no such
box. The covers it was seen on are the first ones of seed 1, the "Signal Saga"
series by "Ada Quill", whose shared design puts two translucent rectangles
(`look.shapes`, a design's artwork) just above the author's name, the smaller
of them over the end of "Quill". Rendered on their own, "ll", "Hollow",
"Quill", "HOLLOW" and the ligatures "fi", "fl", "ffi" all draw from the font,
roman and italic. Paddle read "Quill" exactly on six of the eleven CI-set
photographs that carry it, and its misreadings ("Qul1", "Quln", "Qail") are
the photograph's blur and angle, not a glyph. Nothing in the generator
changed.

## Fusion, as built

#669, measured 2026-10-29 on the same machine. `POST /api/books/scan` asks
`MatchCoverHandler` (`web/application/books/queries/match-cover.ts`) whenever
no ISBN was read.

**What runs.** The scan's first pass is zxing and then Paddle, and nothing
slower (`identify(..., { barcodeEffort: 'fast', paddleOnly: true })`). An ISBN
Paddle reads still short-circuits everything, check digit and all. Otherwise
Paddle's reading goes to the handler, which asks three strategies at once:

1. **The picture**: `NearestCoversHandler`, the ten nearest catalogued covers
   by DINOv2 cosine. Null while the model is loading or when it could not be
   (`[covers] similarity is off`).
2. **The words**: `MatchCoverTextHandler` on the reading identify already
   made. Not read a second time.
3. **The hash**: today's, but only inside its `similar` band (16 bits), ten
   deep.

They are fused by **reciprocal rank fusion, k = 60**. The words take part with
their own four, and only books scoring at least 0.1: the text handler answers
its nearest titles whatever the reading, so in a small catalogue every book is
somewhere on its list, and that tail outvoted the one book whose title is
printed. The shortlist is the fused four.

**The bar.** One book is opened without asking only when the words rank it
first, and either

- **the picture agrees**: the image model ranks it first too, at least 0.6 of
  its title is printed (`word_similarity`), and the words put it 0.1 ahead of
  their second; or
- **its title is printed**: at least 0.8 of it, 0.05 ahead, and the picture
  has it among the ten it ranks.

With the model off, the second clause alone, without the picture. Since the
review, either way in also needs the title and the words in its type to
explain each other (`BAR.explains`, see
[A title contained in a sibling's](#a-title-contained-in-a-siblings-and-the-guard-for-it)).
The hash never opens a book. The response carries the server's `confident` id, and the
client opens that rather than judging the hash itself.

### How the bar was chosen, on seed 7

Every photograph's evidence from all three strategies was dumped once and the
rule searched offline, on seed 7 only (150 catalogued, 330 photographs):

| choice | seed 7 |
| --- | --- |
| hash in the fusion: all within 24 bits / within 16 / none | top-1 65.0% / 70.7% / 70.3% |
| agreement with any share of the title, text lead 0.05 | 1 wrong: *The Machine Cycle: The Silent Orchard* (uncatalogued) opened *The Silent Island* |
| the same, lead 0.08 / 0.1 | 0 wrong / 0 wrong |
| printed title 0.7, no picture condition | 1 wrong (a series sibling) on seed 1, 0 on seed 7; 0.8 is #667's bar |
| picture must have it in its top 4 / top 10 / not asked | 27.6% / 40.0% / 40.0% confident right, 0 wrong each |
| the words' share of the fusion: ten deep / four deep with score >= 0.1 | fused top-1 75.0% / 79.7% |

The share of the title in the agreement clause is not seed 7's choice: seed 7
opened nothing wrong at any share once the lead was 0.1. It is 0.6 because of
#664's sibling, which no synthetic set has: a reading of *The Warlord of Mars*
by Edgar Rice Burroughs holds 0.48 of *The Gods of Mars* and 0.42 of *A
Princess of Mars*, and a catalogue holding only one of them has no second
volume for the lead to stop on. At 0.4 the test for that shape fails
(`infrastructure/books/cover-match.test.ts`).

### The measurements

These are the rule as first built, before the review's title guard and before
the synthetic sets carried contained-title families. The guard's own before
and after are in
[A title contained in a sibling's](#a-title-contained-in-a-siblings-and-the-guard-for-it),
and it halves the confident rate on real covers.

Seed 7, the tuning set (`npm run eval:covers -- --seed 7`):

| matcher                             | photos | top-1 | top-4 | confident right | confident wrong       | prepare | per photo |
|-------------------------------------|--------|-------|-------|-----------------|-----------------------|---------|-----------|
| hash (today)                        | 300+30 | 7.7%  | 15.7% | 0.0%            | 0.0% (0 uncatalogued) | 0.7s    | 6ms       |
| embedding (dinov2-small)            | 300+30 | 24.3% | 51.0% | 0.0%            | 0.0% (0 uncatalogued) | 16.5s   | 110ms     |
| cover text (paddle, pg_trgm)        | 300+30 | 92.3% | 98.7% | 50.9%           | 0.0% (0 uncatalogued) | 3.6s    | 115ms     |
| fused (dinov2 + text + hash)        | 300+30 | 80.3% | 98.7% | 40.0%           | 0.0% (0 uncatalogued) | 20.2s   | 234ms     |
| fused, similarity off (text + hash) | 300+30 | 92.0% | 98.3% | 50.9%           | 0.0% (0 uncatalogued) | 4.2s    | 132ms     |

Seed 1, reported (`npm run eval:covers`):

| matcher                             | photos | top-1 | top-4 | confident right | confident wrong       | prepare | per photo |
|-------------------------------------|--------|-------|-------|-----------------|-----------------------|---------|-----------|
| hash (today)                        | 300+30 | 3.0%  | 13.3% | 0.0%            | 0.0% (0 uncatalogued) | 0.7s    | 6ms       |
| embedding (dinov2-small)            | 300+30 | 23.3% | 44.0% | 0.0%            | 0.0% (0 uncatalogued) | 16.3s   | 108ms     |
| cover text (paddle, pg_trgm)        | 300+30 | 90.0% | 94.3% | 48.5%           | 0.0% (0 uncatalogued) | 3.5s    | 115ms     |
| fused (dinov2 + text + hash)        | 300+30 | 74.0% | 95.0% | 32.7%           | 0.0% (0 uncatalogued) | 20.4s   | 238ms     |
| fused, similarity off (text + hash) | 300+30 | 88.7% | 94.0% | 48.5%           | 0.0% (0 uncatalogued) | 4.2s    | 120ms     |

Real covers, locally (`--real 200`, 170 catalogued, 30 not):

| matcher                             | photos | top-1 | top-4 | confident right | confident wrong       | prepare | per photo |
|-------------------------------------|--------|-------|-------|-----------------|-----------------------|---------|-----------|
| hash (today)                        | 340+30 | 8.2%  | 12.6% | 0.0%            | 0.3% (0 uncatalogued) | 0.5s    | 6ms       |
| embedding (dinov2-small)            | 340+30 | 88.5% | 94.4% | 4.6%            | 0.0% (0 uncatalogued) | 18.1s   | 110ms     |
| cover text (paddle, pg_trgm)        | 340+30 | 58.2% | 65.0% | 17.8%           | 0.0% (0 uncatalogued) | 4.0s    | 145ms     |
| fused (dinov2 + text + hash)        | 340+30 | 93.5% | 98.2% | 24.1%           | 0.0% (0 uncatalogued) | 23.0s   | 273ms     |
| fused, similarity off (text + hash) | 340+30 | 55.9% | 60.3% | 17.8%           | 0.0% (0 uncatalogued) | 4.3s    | 154ms     |

The hash's one confident mistake on real covers: *Women in Love* opened *This
Side of Paradise*.

**What the numbers say.**

- **On real covers the fusion beats every strategy in it**: 93.5% top-1
  against DINOv2's 88.5%, 98.2% top-4 against 94.4%, and it opens a book
  unasked on one photograph in four (one in eight with the title guard), with
  no wrong book, where the hash opened one wrong book and no right one.
- **On synthetic covers it is below the words alone** (74.0% against 90.0% on
  seed 1), because DINOv2 cannot read and these covers differ only in their
  words. The confident rate is lower for the same reason: the picture is asked
  to agree and on these covers it mostly cannot. The real set is the arbiter,
  as #664 found.
- **With the model off it is the words, slightly worse.** The hash inside 16
  bits costs a point or three of top-1 against the words alone, on every set.
  It is kept because the issue asks for it and because it costs nothing at the
  bar; dropping it is a one-line follow-up the table would support.

### A title contained in a sibling's, and the guard for it

**The shape.** A photograph of an uncatalogued *Dune Messiah* holds all of
*Dune* (`word_similarity` 1.0). As first built, the printed-title clause
opened *Dune* for it whenever the picture had *Dune* in its ten, and for one
series' design it will. The other direction fails too: a held *The Winter
Empire* opened a catalogued *The Winter Empire Unbound* on seed 1 through the
agreement clause, once the set had that shape in it (below).

**The guard** (`titleExplains` in `web/shared/cover-words.ts`, `BAR.explains`
in the handler). Either way in, the reading and the candidate's title must
explain each other at **0.75** or better, once the first author's name is set
aside. That means the smaller of:

- the share of the title's words that were read anywhere on the cover, and
- the share of the words printed **in the title's type** that the title holds.

The title's type comes from Paddle's line boxes, which now travel with the
reading (`IdentifyResult.paddleLines`). The line holding the most of the title
picks the size, and every line at least 0.8 of its height counts, so a title
broken over two lines is one region and a tagline in small type is left out.
Without line boxes, the whole reading is used, which asks more often. Words are
compared the way `pg_trgm` counts trigrams: half of them shared makes the same
word, so "DARKNES5" is "darkness" and "messiah" is not "dune".

So a *Dune Messiah* cover explains *Dune* at 0.5, and the reverse also gives
0.5, so neither opens. A cover of *Dune* with "WINNER OF THE HUGO AWARD" in
small type above the title still opens *Dune*. With both volumes catalogued,
*Dune Messiah*'s cover opens *Dune Messiah*, and *Dune*'s cover asks, with
*Dune* first: the two score close on the words. The tests are in
`infrastructure/books/cover-match.test.ts`. Before the guard, the first of
them failed with `expected 1 to be null`.

**The set measures it now.** `coverSet` adds two contained-title families per
seed, by default from a random stream of their own, so every other book and
photograph of a seed is unchanged. Each family is "The Adjective Noun" and
"The Adjective Noun Sequel", in one design and by one author. One family
catalogues the short title and holds up the long one; the other does the
reverse. Two families is little power: before the guard, seed 1 showed the
shape once, and seed 7 not at all.

**What it cost**, the fused rows before and after the guard on the same sets
(the synthetic sets now including the families):

| set | fused | top-1 | top-4 | confident right | confident wrong |
| --- | --- | --- | --- | --- | --- |
| seed 7 | before the guard | 80.3% | 98.7% | 40.2% | 0.0% |
| seed 7 | after | 79.9% | 98.7% | 32.4% | 0.0% |
| seed 1 | before the guard | 74.3% | 95.1% | 32.4% | **0.3%** (*The Winter Empire* opened *The Winter Empire Unbound*) |
| seed 1 | after | 74.3% | 95.1% | 29.2% | 0.0% |
| real covers | before the guard | 93.5% | 98.2% | 24.1% | 0.0% |
| real covers | after | 93.5% | 98.2% | **11.9%** | 0.0% |
| model off, real | before / after | 55.9% | 60.3% | 17.8% / 10.8% | 0.0% |

The shortlist does not move. The bar fires half as often on real covers: real
covers carry series names, quotes and publishers' lines in type as large as
the title, and OCR misses words of the title, and either one now makes the
scanner ask. That is the safe direction, and it is what was chosen: one book in
eight still opens unasked, none wrongly, and the right book is in the four
shown 98.2% of the time.

Seed 7 after the guard, every row:

| matcher                             | photos | top-1 | top-4 | confident right | confident wrong       |
|-------------------------------------|--------|-------|-------|-----------------|-----------------------|
| hash (today)                        | 304+32 | 7.6%  | 15.5% | 0.0%            | 0.0% (0 uncatalogued) |
| embedding (dinov2-small)            | 304+32 | 24.7% | 51.3% | 0.0%            | 0.0% (0 uncatalogued) |
| cover text (paddle, pg_trgm)        | 304+32 | 92.4% | 98.7% | 51.2%           | 0.0% (0 uncatalogued) |
| fused (dinov2 + text + hash)        | 304+32 | 79.9% | 98.7% | 32.4%           | 0.0% (0 uncatalogued) |
| fused, similarity off (text + hash) | 304+32 | 92.1% | 98.4% | 43.5%           | 0.0% (0 uncatalogued) |

Seed 1 after the guard, every row:

| matcher                             | photos | top-1 | top-4 | confident right | confident wrong       |
|-------------------------------------|--------|-------|-------|-----------------|-----------------------|
| hash (today)                        | 304+32 | 3.0%  | 13.2% | 0.0%            | 0.0% (0 uncatalogued) |
| embedding (dinov2-small)            | 304+32 | 23.0% | 44.4% | 0.0%            | 0.0% (0 uncatalogued) |
| cover text (paddle, pg_trgm)        | 304+32 | 90.1% | 94.4% | 47.9%           | 0.0% (0 uncatalogued) |
| fused (dinov2 + text + hash)        | 304+32 | 74.3% | 95.1% | 29.2%           | 0.0% (0 uncatalogued) |
| fused, similarity off (text + hash) | 304+32 | 88.2% | 94.1% | 43.8%           | 0.0% (0 uncatalogued) |

Note that the cover-text row's own bar does not carry the guard, so it would
still open *Dune* for *Dune Messiah*. Nothing ships that bar.

**What is still open.** The 0.75 came from the review, not from seed 7: seed 7
opened nothing wrong with or without the guard. Where the lost real-cover
openings go (a title word OCR missed, or a large line that is not the title) is
not yet broken down. That breakdown is how to win some of them back without
reopening the shape. Two families per seed is also too few to say how often the
shape opens wrongly: a family-only run with many more of them would.

## What this does not settle

- How often a contained-title sibling opens the wrong book, beyond the two families per seed; and winning back the real-cover openings the title guard costs. See [A title contained in a sibling's](#a-title-contained-in-a-siblings-and-the-guard-for-it).
- Photograph against photograph. The set compares photographs to catalogue
  artwork only. The app also holds the owner's own photograph of each front
  (`front_hash`), and an embedding of that is likely to match better than the
  artwork does; the backfill step can measure it once there are embeddings to
  compare.
- SigLIP and SigLIP 2, which are Apache-2.0 and read text like CLIP; the int8
  DINOv2 export; DINOv2 with registers. Each is one entry in `models.ts` and a
  row in the table.
- ORB with homography verification as a re-ranker, deferred until the fused
  table shows what is left.
