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

## Where it stands today

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
| `embedding-matcher.ts`, `models.ts` | The embedding prototype: in-memory cosine, weights pinned by revision and SHA-256 and cached in `~/.cache/bookscan/models` |
| `real-covers.ts` | The optional local mode's Open Library download |
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
and is skipped, by name, where they are not: the test never downloads, so it
behaves the same offline and on CI, where only the hash row runs.

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

## What this does not settle

- The bar. See above.
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
