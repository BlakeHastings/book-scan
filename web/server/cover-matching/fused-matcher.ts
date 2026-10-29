/**
 * The fused matcher's row: `MatchCoverHandler`, the query the scan route asks,
 * scored on the harness's photographs.
 *
 * Only the ports are the harness's. The words are the app's own
 * `MatchCoverTextHandler` over a real Postgres, as in the cover-text row; the
 * picture is the DINOv2 encoder through `openEncoder`, ranked in memory as the
 * embedding row ranks it (the app asks pgvector the same question); the hash
 * is today's, inside the band the handler asks for. The fusion and the bar are
 * the handler's, so this row measures exactly what ships.
 */

import { MatchCoverHandler } from '../../application/books/queries/match-cover'
import { MatchCoverTextHandler } from '../../application/books/queries/match-cover-text'
import type { CoverHashes, CoverPictures, CoverWords } from '../../application/books/read-models'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { DrizzleCoverTextReadModel } from '../../infrastructure/books/cover-text-read-model'
import { coverHash, distance } from '../imagehash'
import { paddleOcr } from '../paddle'
import { testBooks } from '../testbooks'
import { catalogueDatabase } from './catalogue-database'
import { openEncoder } from './encode'
import type { CoverMatcher } from './matcher'
import { DINOV2_SMALL, ensureModel } from './models'

async function hashOrNull(image: Uint8Array): Promise<string | null> {
  try {
    return await coverHash(Buffer.from(image))
  } catch {
    return null
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!
  return sum
}

/** Nothing compared, as the app answers while its model is not loaded. */
const PICTURES_OFF: CoverPictures = { nearest: async () => null }

/**
 * @param pictures false scores the matcher as it runs with
 *   `[covers] similarity is off`: the words and the hash alone.
 */
export function fusedMatcher({ pictures }: { pictures: boolean }): CoverMatcher {
  return {
    name: pictures ? 'fused (dinov2 + text + hash)' : 'fused, similarity off (text + hash)',
    bar: pictures
      ? 'the words rank it first with >= 0.6 of its title printed and a 0.1 lead and the picture ranks it first; '
        + 'or >= 0.8 of its title printed with a 0.05 lead and the picture has it in its four'
      : 'the words rank it first with >= 0.8 of its title printed and a 0.05 lead',

    async prepare(catalogue) {
      const db = await catalogueDatabase()
      const books = testBooks(db)
      const harnessId = new Map<number, string>()
      const appId = new Map<string, number>()
      for (const book of catalogue) {
        const saved = await books.catalogue({
          title: book.title,
          authors: book.author ? [book.author] : [],
          genre: FICTION_SLUG,
        })
        harnessId.set(saved.id, book.id)
        appId.set(book.id, saved.id)
      }

      const hashed: { id: number, hash: string }[] = []
      for (const book of catalogue) {
        const hash = await hashOrNull(book.cover)
        if (hash) hashed.push({ id: appId.get(book.id)!, hash })
      }
      const hashes: CoverHashes = {
        async near(photo, within, limit) {
          const query = await hashOrNull(photo)
          if (!query) return []
          return hashed
            .map((entry) => ({ id: entry.id, distance: distance(query, entry.hash) }))
            .filter((entry) => entry.distance <= within)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit)
        },
      }

      let picturesPort = PICTURES_OFF
      if (pictures) {
        const embed = await openEncoder(DINOV2_SMALL, await ensureModel(DINOV2_SMALL))
        const index: { id: number, vector: Float32Array }[] = []
        for (const book of catalogue) index.push({ id: appId.get(book.id)!, vector: await embed(book.cover) })
        picturesPort = {
          async nearest(photo, limit) {
            const query = await embed(Buffer.from(photo))
            return index
              .map((entry) => ({ id: entry.id, similarity: dot(query, entry.vector) }))
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, limit)
          },
        }
      }

      const text = new MatchCoverTextHandler(new DrizzleCoverTextReadModel(db))
      const words: CoverWords = { near: (reading, limit) => text.handle({ text: reading, limit }) }
      const handler = new MatchCoverHandler(picturesPort, words, hashes)

      return async (photo) => {
        const read = await paddleOcr(photo)
        const answer = await handler.handle({ photo, reading: read?.text ?? '', lines: read?.lines })
        const id = (bookId: number) => harnessId.get(bookId) ?? String(bookId)
        return {
          candidates: answer.candidates.map((candidate) => ({ id: id(candidate.id), score: candidate.fused })),
          confident: answer.confident === null ? null : id(answer.confident),
        }
      }
    },
  }
}
