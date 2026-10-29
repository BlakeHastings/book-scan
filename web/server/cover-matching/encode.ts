/**
 * One image to one unit-length vector, through an encoder's ONNX weights.
 *
 * The harness's matchers and the app's `OnnxCoverEncoder` both embed through
 * `openEncoder`, so a photograph is prepared the same way when it is saved,
 * when it is searched for, and when the floors in `floors.test.ts` are scored.
 * Two embeddings are comparable only when both were made by the same weights
 * and the same preparation, which is what `modelId` names.
 */

import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import type { Encoder } from './models'

export type Embed = (image: Buffer) => Promise<Float32Array>

/**
 * The whole image squashed to the encoder's square, rather than the model
 * card's resize-then-centre-crop: a cover is 2:3, and the centre crop throws
 * away its top and bottom sixths, which is where titles and authors are
 * printed.
 */
async function pixels(image: Buffer, encoder: Encoder): Promise<Float32Array> {
  const side = encoder.side
  const rgb = await sharp(image)
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .resize(side, side, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer()

  // Channels first, as the encoder takes them.
  const plane = side * side
  const out = new Float32Array(3 * plane)
  for (let p = 0; p < plane; p += 1) {
    for (let ch = 0; ch < 3; ch += 1) {
      out[ch * plane + p] = (rgb[p * 3 + ch]! / 255 - encoder.mean[ch]!) / encoder.std[ch]!
    }
  }
  return out
}

function unit(vector: Float32Array): Float32Array {
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm) || 1
  return vector.map((value) => value / norm)
}

/**
 * What `cover_embedding.model` says about a row: the weights, by repository and
 * commit, and the preparation. Changing either changes this, so a row made the
 * old way is never compared with a photograph prepared the new way.
 */
export function modelId(encoder: Encoder): string {
  return `${encoder.repo}@${encoder.revision.slice(0, 7)}/squash${encoder.side}`
}

export interface EncoderOptions {
  /** Threads one embedding may use. Absent is onnxruntime's default, every core. */
  threads?: number
}

/** A session over the weights at `path`, as a function from image bytes to a unit vector. */
export async function openEncoder(encoder: Encoder, path: string, options: EncoderOptions = {}): Promise<Embed> {
  const session = await ort.InferenceSession.create(path, {
    graphOptimizationLevel: 'all',
    ...(options.threads ? { intraOpNumThreads: options.threads, interOpNumThreads: 1 } : {}),
  })
  const input = session.inputNames[0]!

  return async (image) => {
    const tensor = new ort.Tensor('float32', await pixels(image, encoder), [1, 3, encoder.side, encoder.side])
    const result = await session.run({ [input]: tensor })
    const output = result[encoder.output]
    if (!output) throw new Error(`${encoder.name} has no output named ${encoder.output}; it has ${session.outputNames.join(', ')}.`)
    const data = output.data as Float32Array
    return unit(encoder.classToken ? data.slice(0, encoder.classToken) : data)
  }
}
