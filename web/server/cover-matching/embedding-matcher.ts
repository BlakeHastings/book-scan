/**
 * Recognising a cover by an image embedding: one vector per image from a
 * pretrained vision encoder, compared by cosine similarity against every
 * catalogued cover in memory.
 *
 * A prototype for the harness, not for the app. The catalogue here is a list
 * in memory; the app would keep the vectors in pgvector (#658). Run through
 * `onnxruntime-node`, which the app already has for PaddleOCR, so measuring an
 * encoder adds no dependency.
 */

import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import type { Candidate, CoverMatcher } from './matcher'
import { type Encoder, ensureModel } from './models'

export interface Bar {
  /** Cosine similarity the best candidate has to reach. */
  floor: number
  /** How far ahead of the second it has to be. */
  margin: number
}

/**
 * The whole image squashed to the encoder's square, rather than the model
 * card's resize-then-centre-crop: a cover is 2:3, and the centre crop throws
 * away its top and bottom sixths, which is where titles and authors are
 * printed.
 */
async function pixels(image: Buffer, encoder: Encoder): Promise<Float32Array> {
  const side = encoder.side
  const rgb = await sharp(image)
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

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!
  return sum
}

export function embeddingMatcher(encoder: Encoder, bar: Bar): CoverMatcher {
  return {
    name: `embedding (${encoder.name})`,
    bar: `best cosine >= ${bar.floor} and >= ${bar.margin} ahead of the second`,

    async prepare(catalogue) {
      const session = await ort.InferenceSession.create(await ensureModel(encoder), {
        graphOptimizationLevel: 'all',
      })
      const input = session.inputNames[0]!

      const embed = async (image: Buffer) => {
        const tensor = new ort.Tensor('float32', await pixels(image, encoder), [1, 3, encoder.side, encoder.side])
        const result = await session.run({ [input]: tensor })
        const output = result[encoder.output]
        if (!output) throw new Error(`${encoder.name} has no output named ${encoder.output}; it has ${session.outputNames.join(', ')}.`)
        const data = output.data as Float32Array
        return unit(encoder.classToken ? data.slice(0, encoder.classToken) : data)
      }

      const index: { id: string, vector: Float32Array }[] = []
      for (const book of catalogue) index.push({ id: book.id, vector: await embed(book.cover) })

      return async (photo) => {
        const query = await embed(photo)
        const ranked: Candidate[] = index
          .map((entry) => ({ id: entry.id, score: dot(query, entry.vector) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 4)

        const [first, second] = ranked
        const clear = first !== undefined
          && first.score >= bar.floor
          && first.score - (second?.score ?? -1) >= bar.margin
        return { candidates: ranked, confident: clear ? first.id : null }
      }
    },
  }
}
