/**
 * The app's image model: DINOv2 ViT-S/14 through `onnxruntime-node`, chosen by
 * #664's measurements (`docs/the-cover-matcher.md`).
 *
 * The weights are fetched once, from a pinned Hugging Face commit, checked
 * against the SHA-256 recorded in `server/cover-matching/models.ts`, and kept
 * under the home directory beside Tesseract's language data, never under
 * `BOOKSCAN_DATA` and never in the repository. `load` is the only thing that
 * fetches; until it has succeeded `ready()` is false and every caller treats
 * cover similarity as off, which is how a machine that cannot reach Hugging
 * Face still saves books.
 */

import type { CoverEncoder } from '../../application/capture/read-models'
import { type Embed, modelId, openEncoder } from '../../server/cover-matching/encode'
import { DINOV2_SMALL, type Encoder, cachedPath, ensureModel } from '../../server/cover-matching/models'

/**
 * Threads one embedding may use. Embedding is background work on a server that
 * is also answering people, so it takes two cores rather than all of them.
 */
const THREADS = 2

export class OnnxCoverEncoder implements CoverEncoder {
  readonly model: string
  readonly dimensions: number
  private embedder: Embed | null = null
  /** One embedding at a time, so a burst of saves queues rather than piling onto the CPU at once. */
  private turn: Promise<unknown> = Promise.resolve()

  constructor(private readonly encoder: Encoder = DINOV2_SMALL) {
    this.model = modelId(encoder)
    this.dimensions = encoder.dimensions
  }

  /** Fetches and verifies the weights if need be, and opens them. Rejects, saying why, when it cannot. */
  async load(): Promise<string> {
    const started = Date.now()
    const path = await ensureModel(this.encoder, { verify: true })
    this.embedder = await openEncoder(this.encoder, path, { threads: THREADS })
    return `${this.model} (${this.dimensions} dimensions) from ${cachedPath(this.encoder)}, SHA-256 checked, in ${Date.now() - started} ms`
  }

  ready(): boolean {
    return this.embedder !== null
  }

  embed(image: Uint8Array): Promise<number[]> {
    const embedder = this.embedder
    if (!embedder) return Promise.reject(new Error(`${this.model} is not loaded`))
    const mine = this.turn.then(async () => Array.from(await embedder(Buffer.from(image))))
    this.turn = mine.catch(() => undefined)
    return mine
  }
}
