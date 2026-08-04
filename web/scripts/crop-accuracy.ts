/**
 * Measure the book detector against scenes whose true rectangle is known.
 *
 * Run with: npx tsx scripts/crop-accuracy.ts
 *
 * Prints how often it finds the book and, the number that matters, how often
 * it crops to something other than the book.
 */

import sharp from 'sharp'
import { detectBook, type Rect } from '../server/bookcrop'
import { backCover, frontCover, glossy, photographedBook, spine, type SceneBackground } from '../server/fixtures'

interface Case {
  name: string
  image: Buffer
  rect: Rect
}

function iou(a: Rect, b: Rect): number {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  if (right <= left || bottom <= top) return 0
  const overlap = (right - left) * (bottom - top)
  return overlap / (a.width * a.height + b.width * b.height - overlap)
}

function coverage(truth: Rect, crop: Rect): number {
  const left = Math.max(truth.left, crop.left)
  const top = Math.max(truth.top, crop.top)
  const right = Math.min(truth.left + truth.width, crop.left + crop.width)
  const bottom = Math.min(truth.top + truth.height, crop.top + crop.height)
  if (right <= left || bottom <= top) return 0
  return ((right - left) * (bottom - top)) / (truth.width * truth.height)
}

async function build(): Promise<Case[]> {
  const front = await frontCover('The Dispossessed', 'Ursula K. Le Guin')
  const back = await backCover('9780441013593')
  const shiny = await glossy(front)
  const strip = await spine('The Dispossessed', 'Le Guin')

  const cases: Case[] = []
  const backgrounds: SceneBackground[] = ['carpet', 'floorboards', 'rug', 'plain']

  let seed = 1
  for (const background of backgrounds) {
    for (const subject of [
      { label: 'front', buffer: front },
      { label: 'back', buffer: back },
      { label: 'glossy', buffer: shiny },
    ]) {
      for (const rotate of [0, 4, -7]) {
        for (const fill of [0.35, 0.55, 0.7]) {
          const scene = await photographedBook(subject.buffer, {
            seed: seed++,
            background,
            fill,
            rotate,
            distractors: background === 'plain' ? 0 : 1,
            camouflage: background === 'plain' ? 0.5 : 0,
          })
          cases.push({
            name: `${background}/${subject.label}/rot${rotate}/fill${fill}`,
            image: scene.image,
            rect: scene.rect,
          })
        }
      }
    }
  }

  // The edge slot: a spine strip already cropped to the guide rectangle, with
  // a sliver of room left at the sides.
  for (const background of backgrounds) {
    for (const fill of [0.6, 0.78, 0.9]) {
      const scene = await photographedBook(strip, {
        seed: seed++,
        width: 480,
        height: 1360,
        background,
        fill,
        rotate: 0,
      })
      cases.push({ name: `spine/${background}/fill${fill}`, image: scene.image, rect: scene.rect })
    }
  }

  return cases
}

/** Frames with no book at all. Anything found here is a false positive. */
async function negatives(): Promise<Case[]> {
  const cases: Case[] = []
  const empty: Rect = { left: 0, top: 0, width: 0, height: 0 }
  let seed = 900
  for (const background of ['carpet', 'floorboards', 'rug', 'plain'] as SceneBackground[]) {
    for (const distractors of [0, 1, 3]) {
      const scene = await photographedBook(
        await sharp({ create: { width: 4, height: 4, channels: 3, background: '#808080' } }).png().toBuffer(),
        { seed: seed++, background, fill: 0.004, distractors, shadow: false },
      )
      cases.push({ name: `empty/${background}/d${distractors}`, image: scene.image, rect: empty })
    }
  }
  return cases
}

async function main() {
  const started = Date.now()
  const cases = await build()
  let found = 0
  let correct = 0
  const wrong: string[] = []
  const missed: string[] = []

  for (const item of cases) {
    const decision = await detectBook(item.image)
    if (!decision.rect) {
      missed.push(`${item.name} (${decision.refusal})`)
      continue
    }
    found++
    const overlap = iou(item.rect, decision.rect)
    const kept = coverage(item.rect, decision.rect)
    if (kept >= 0.98 && overlap >= 0.8) {
      correct++
    } else {
      wrong.push(`${item.name} iou=${overlap.toFixed(2)} kept=${kept.toFixed(3)}`)
    }
  }

  const blanks = await negatives()
  const falsePositives: string[] = []
  for (const item of blanks) {
    const decision = await detectBook(item.image)
    if (decision.rect) falsePositives.push(`${item.name} ${JSON.stringify(decision.rect)}`)
  }

  console.log(`cases      ${cases.length}`)
  console.log(`found      ${found} (${((found / cases.length) * 100).toFixed(0)}%)`)
  console.log(`correct    ${correct} (${((correct / cases.length) * 100).toFixed(0)}% of all)`)
  console.log(`wrong      ${wrong.length} (${((wrong.length / cases.length) * 100).toFixed(0)}% of all)`)
  console.log(`no book    ${blanks.length} frames, ${falsePositives.length} cropped`)
  console.log(`elapsed    ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log('\ndeclined:')
  for (const line of missed) console.log('  ' + line)
  console.log('\nwrong:')
  for (const line of wrong) console.log('  ' + line)
  console.log('\nfalse positives:')
  for (const line of falsePositives) console.log('  ' + line)
}

void main()
