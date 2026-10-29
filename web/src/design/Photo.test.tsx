/**
 * Every picture of a book is a copy the size it is drawn, never the photograph
 * as the camera took it, whichever address the screen handed over.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Covers } from './Covers'
import { List, Row } from './List'
import { Shots, threeSlots } from './Shots'
import { originalOf, photoName, sized } from '../lib/photos'
import { shotsOf } from '../lib/queuePhoto'

/** Every address an `<img>` in this markup could download. */
function addresses(markup: string): string[] {
  const found: string[] = []
  for (const tag of markup.match(/<img[^>]*>/g) ?? []) {
    const src = /\ssrc="([^"]*)"/.exec(tag)?.[1]
    if (src) found.push(src.replace(/&amp;/g, '&'))
    const set = /\ssrcSet="([^"]*)"/i.exec(tag)?.[1]
    if (set) found.push(...set.replace(/&amp;/g, '&').split(',').map((one) => one.trim().split(' ')[0]!))
  }
  return found
}

function allCopies(markup: string) {
  const found = addresses(markup)
  expect(found.length).toBeGreaterThan(0)
  for (const one of found) expect(one).toMatch(/^\/api\/covers\/[^?]+\?w=\d+$/)
}

const ORIGINAL = '/api/covers/seed_0001_9780030000010_front.jpg'

describe('a photograph is downloaded at the size it is drawn', () => {
  it('in a list row', () => {
    allCopies(renderToStaticMarkup(<List label="Books"><Row title="Dune" photo={ORIGINAL} /></List>))
  })

  it('in a grid of covers', () => {
    allCopies(renderToStaticMarkup(<Covers items={[{ id: '1', title: 'Dune', author: 'Herbert', photo: ORIGINAL }]} label="Books" />))
  })

  it('in the row of photographs on the edit view, from the original the screen holds', () => {
    const slots = threeSlots(
      { word: 'Spine', sliver: true, photo: ORIGINAL },
      { word: 'Downloaded', catalogue: true, photo: ORIGINAL },
      [{ word: 'Front', photo: ORIGINAL, full: ORIGINAL }],
    )
    allCopies(renderToStaticMarkup(<Shots {...slots} size="big" full />))
  })

  it('in a book drawn on its own page', () => {
    allCopies(renderToStaticMarkup(
      <Shots mode="book" full shots={[{ word: 'Spine', sliver: true, photo: ORIGINAL }, { word: 'Front', photo: ORIGINAL }]} />,
    ))
  })

  it('in a waiting book in the queue', () => {
    const shots = shotsOf({
      front_image: 'q_front.jpg', back_image: 'q_back.jpg', edge_image: 'q_edge.jpg',
      front_crop: '', back_crop: '', edge_crop: '',
    })
    allCopies(renderToStaticMarkup(<Shots mode="book" size="small" shots={shots} />))
  })

  it('off screen, it waits to be scrolled to, and it never holds up the page decoding', () => {
    const markup = renderToStaticMarkup(<List label="Books"><Row title="Dune" photo={ORIGINAL} /></List>)
    expect(markup).toContain('loading="lazy"')
    expect(markup).toContain('decoding="async"')
  })

  it('leaves a picture that is not one of ours exactly as it was given', () => {
    const camera = 'data:image/jpeg;base64,AAAA'
    const markup = renderToStaticMarkup(<List label="Books"><Row title="Dune" photo={camera} /></List>)
    expect(addresses(markup)).toEqual([camera])
  })
})

describe('the address of a photograph', () => {
  it('reads the filename out of an original or a copy alike', () => {
    expect(photoName('/api/covers/a%20b.jpg')).toBe('a b.jpg')
    expect(photoName('/api/covers/a%20b.jpg?w=160')).toBe('a b.jpg')
    expect(photoName('https://covers.openlibrary.org/b/isbn/1-L.jpg')).toBeNull()
  })

  it('goes back to the original from a copy', () => {
    expect(originalOf('/api/covers/a%20b.jpg?w=160')).toBe('/api/covers/a%20b.jpg')
  })

  it('picks a copy at least twice the drawn width for a browser with no srcset', () => {
    expect(sized(ORIGINAL, 46).src).toBe(`${ORIGINAL}?w=160`)
    expect(sized(ORIGINAL, 200).src).toBe(`${ORIGINAL}?w=480`)
    expect(sized(ORIGINAL, 2000).src).toBe(`${ORIGINAL}?w=1280`)
  })
})
