/**
 * A photograph is scaled to a pixel budget once, before any reader sees it
 * (#673). Every reader's memory grows with the image it is handed, so this is
 * what bounds one capture's cost; the readers themselves are real here, and only
 * watched, so the test also shows a large photograph still reads.
 */

import { afterAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { PaddleOcrService } from 'ppu-paddle-ocr'
import { backCover } from './fixtures'
import { identify, PIXEL_BUDGET, shutdownOcr, withinPixelBudget } from './identify'
import { paddleOcr, PADDLE_MAX_SIDE } from './paddle'

vi.mock('./paddle', async (importOriginal) => {
  const real = await importOriginal<typeof import('./paddle')>()
  return { ...real, paddleOcr: vi.fn(real.paddleOcr) }
})

const ISBN = '9780441013593'

afterAll(async () => {
  await shutdownOcr()
})

const sizeOf = async (image: Buffer | ArrayBuffer) => {
  const { width = 0, height = 0 } = await sharp(Buffer.from(image as ArrayBuffer)).metadata()
  return { width, height, pixels: width * height }
}

/** A back cover with its ISBN printed and no barcode, at about 24 MP. */
async function hugeBackCover(): Promise<Buffer> {
  const cover = await backCover(ISBN, { barcode: false })
  const { width, height } = await sizeOf(cover)
  const scale = Math.sqrt(24_000_000 / (width * height))
  return sharp(cover)
    .resize(Math.round(width * scale), Math.round(height * scale))
    .jpeg({ quality: 92 })
    .toBuffer()
}

describe('the pixel budget', () => {
  it('scales a photograph over it to fit, keeping its shape', async () => {
    const photo = await sharp({
      create: { width: 6000, height: 4000, channels: 3, background: '#808080' },
    }).jpeg().toBuffer()

    const bounded = await sizeOf(await withinPixelBudget(photo))
    expect(bounded.pixels).toBeLessThanOrEqual(PIXEL_BUDGET)
    expect(bounded.pixels).toBeGreaterThan(PIXEL_BUDGET * 0.98)
    expect(bounded.width / bounded.height).toBeCloseTo(1.5, 2)
  })

  it('hands back the very same bytes when the photograph is within it', async () => {
    // What the camera screen sends is within it, and must read exactly as before.
    const photo = await sharp({
      create: { width: 2160, height: 3840, channels: 3, background: '#808080' },
    }).jpeg().toBuffer()
    expect(await withinPixelBudget(photo)).toBe(photo)
  })

  it('leaves bytes that are not an image for the readers to refuse', async () => {
    const junk = Buffer.from('this is not an image at all')
    expect(await withinPixelBudget(junk)).toBe(junk)
  })
})

describe('reading a photograph over the budget', () => {
  it('never hands a reader more than the budget, and still reads the ISBN', async () => {
    const recognize = vi.spyOn(PaddleOcrService.prototype, 'recognize')
    const photo = await hugeBackCover()
    expect((await sizeOf(photo)).pixels).toBeGreaterThan(PIXEL_BUDGET * 2)

    const result = await identify(photo, { wantTitle: false })

    const given = vi.mocked(paddleOcr).mock.calls.map(([image]) => image)
    expect(given.length).toBeGreaterThan(0)
    for (const image of given) {
      expect((await sizeOf(image)).pixels).toBeLessThanOrEqual(PIXEL_BUDGET)
    }
    // And Paddle itself gets no more than its own, smaller, bound.
    expect(recognize).toHaveBeenCalled()
    for (const [image] of recognize.mock.calls) {
      const { width, height } = await sizeOf(image as ArrayBuffer)
      expect(Math.max(width, height)).toBeLessThanOrEqual(PADDLE_MAX_SIDE)
    }

    expect(result.isbn13).toBe(ISBN)
  }, 120_000)
})
