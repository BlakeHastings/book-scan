/**
 * Image encoders a cover matcher can run, and where their weights live.
 *
 * Weights are fetched from Hugging Face at a pinned revision, checked against
 * the SHA-256 that revision publishes, and kept under the user's home
 * directory beside Tesseract's language data (`TESSDATA_CACHE` in
 * `server/identify.ts`): never in the repository and never under
 * `BOOKSCAN_DATA`, so a model can neither be committed nor land beside the
 * catalogue's photographs.
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const MODEL_CACHE = join(homedir(), '.cache', 'bookscan', 'models')

export interface Encoder {
  /** For a table row. */
  name: string
  repo: string
  /** A commit, never a branch: the same name must always mean the same weights. */
  revision: string
  file: string
  bytes: number
  sha256: string
  /** The tensor holding the image's vector. */
  output: string
  /**
   * Set when `output` is a sequence of tokens rather than one vector: the
   * vector is the first token, the class token, this many values long.
   */
  classToken?: number
  /** How long a vector it answers, which is what `cover_embedding.dimensions` records. */
  dimensions: number
  /** The side of the square the encoder takes. */
  side: number
  mean: [number, number, number]
  std: [number, number, number]
}

/** Apache-2.0 (DINOv2 weights, relicensed by Meta in August 2023). 384 dimensions. */
export const DINOV2_SMALL: Encoder = {
  name: 'dinov2-small',
  repo: 'onnx-community/dinov2-small',
  revision: '8b1f705a3a7f6f062f6bdd21986c1583d3ef105d',
  file: 'onnx/model.onnx',
  bytes: 88_532_934,
  sha256: 'f22797eabf810a75e41de68d378541ebea372122b25c4ce3ef25ff618250c20a',
  // This export has no pooled output. Its first token is the class token
  // after the final layer norm, which is what the pooled output would be.
  output: 'last_hidden_state',
  classToken: 384,
  dimensions: 384,
  side: 224,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
}

/** MIT (OpenAI CLIP). 512 dimensions. */
export const CLIP_B32: Encoder = {
  name: 'clip-b32',
  repo: 'Xenova/clip-vit-base-patch32',
  revision: '6b7c523703ae26e39be4b03774966f8571c7f523',
  file: 'onnx/vision_model_quantized.onnx',
  bytes: 89_117_001,
  sha256: '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299',
  output: 'image_embeds',
  dimensions: 512,
  side: 224,
  mean: [0.48145466, 0.4578275, 0.40821073],
  std: [0.26862954, 0.26130258, 0.27577711],
}

export const ENCODERS = [DINOV2_SMALL, CLIP_B32] as const

export function cachedPath(encoder: Encoder): string {
  return join(MODEL_CACHE, encoder.repo, encoder.revision, encoder.file)
}

/** Present and the right size. The digest is checked once, when it is fetched. */
export function isCached(encoder: Encoder): boolean {
  const path = cachedPath(encoder)
  return existsSync(path) && statSync(path).size === encoder.bytes
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export interface EnsureOptions {
  /**
   * Check the digest of weights already cached too, not only of a fresh
   * download, and fetch them again when it is wrong. A long-running server
   * asks for this once at start; the harness, which loads the weights per
   * matcher, does not pay for it every time.
   */
  verify?: boolean
}

/** The path to the weights, fetching them first if this machine has never had them. */
export async function ensureModel(encoder: Encoder, options: EnsureOptions = {}): Promise<string> {
  const path = cachedPath(encoder)
  if (isCached(encoder)) {
    if (!options.verify || await sha256(path) === encoder.sha256) return path
    rmSync(path, { force: true })
  }

  mkdirSync(dirname(path), { recursive: true })
  const url = `https://huggingface.co/${encoder.repo}/resolve/${encoder.revision}/${encoder.file}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Fetching ${url} answered ${response.status}.`)

  // Written beside the destination and moved into place only once it checks
  // out, so an interrupted download is never mistaken for a model.
  const partial = `${path}.partial`
  await writeFile(partial, Buffer.from(await response.arrayBuffer()))
  const digest = await sha256(partial)
  if (digest !== encoder.sha256) {
    rmSync(partial, { force: true })
    throw new Error(`${encoder.repo}/${encoder.file} arrived with SHA-256 ${digest}, not the pinned ${encoder.sha256}.`)
  }
  renameSync(partial, path)
  return path
}
