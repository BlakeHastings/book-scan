/** Rendered as markup rather than driven in a browser: `MovesSoFar` holds no state, which is why it is split out of the pane at all. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MovesSoFar, PlankChoice, ShelveView } from './ShelveView'
import {
  asking, confirm, emptyCascade, pushCarry, pushFrame,
  type Cascade, type Frame,
} from '../lib/cascade'
import type { FixtureDto, PlacementResponse } from '../lib/api'

const frame = (title: string, from: string, to: string, id = 1): Frame => ({
  // Invented and only needs to be distinct: this file is about what the list says.
  fromAreaId: 100 + from.charCodeAt(from.length - 1),
  from,
  kind: 'area',
  proposal: {
    id, title, authorFiling: `${title} author`, to,
    toAreaId: 100 + to.charCodeAt(to.length - 1),
    strip: null,
  },
})

const settle = (cascade: Cascade): Cascade => {
  const top = asking(cascade)!
  return confirm(cascade, {
    id: top.proposal.id, title: top.proposal.title, from: top.from, to: top.proposal.to,
  })
}

const drawn = (cascade: Cascade) =>
  renderToStaticMarkup(MovesSoFar({ cascade })!)

/*
 * 1A is full, so its last book goes to 1B. 1B will not take it, so 1B's last
 * book goes to 2A. Back at 1A, 1B is still too tight, so another book goes
 * 1B to 2A. Then 1B takes the book off 1A. Three moves over three planks, and
 * the pair 1B to 2A is walked twice.
 */
const revisiting = (): Cascade => {
  let cascade = pushFrame(emptyCascade, frame('The Dispossessed', '1A', '1B'))
  cascade = pushFrame(cascade, frame('Snow Crash', '1B', '2A', 2))
  cascade = settle(cascade)
  cascade = pushFrame(cascade, frame('The Book Thief', '1B', '2A', 3))
  cascade = settle(cascade)
  return settle(cascade)
}

describe('a shuffle that uses the same planks twice', () => {
  it('draws every move, including the one a dedupe would have swallowed', () => {
    const html = drawn(revisiting())
    expect(html.match(/wf-step__n/g)).toHaveLength(3)
    for (const title of ['Snow Crash', 'The Book Thief', 'The Dispossessed']) {
      expect(html).toContain(title)
    }
  })

  it('puts them in the order the books were carried, which is what it claims', () => {
    const html = drawn(revisiting())
    expect(html).toContain('Shuffle, in the order it happened')
    expect(html.indexOf('Snow Crash')).toBeLessThan(html.indexOf('The Book Thief'))
    expect(html.indexOf('The Book Thief')).toBeLessThan(html.indexOf('The Dispossessed'))
  })

  // A route drawn between plank names would assert an order, but the order
  // walked and the order the displacement propagated are different orders;
  // every plank here is named only inside a move that also names its book.
  it('states no route between planks', () => {
    expect(drawn(revisiting())).not.toContain('→')
  })
})

describe('nothing having happened', () => {
  it('draws nothing at all rather than an empty heading', () => {
    expect(MovesSoFar({ cascade: emptyCascade })).toBeNull()
  })

  it('does not call it a shuffle when only the book in hand moved on', () => {
    const carried = pushCarry(emptyCascade, {
      id: 0, title: 'Dune', from: '1A', to: '1B',
    })
    const html = drawn(carried)
    expect(html).toContain('Where it went instead')
    expect(html).not.toContain('Shuffle')
  })
})

/**
 * Distinguishes a state where nothing is coming (no rule places this range)
 * from the ordinary wait: the placement has not arrived, or has and a
 * boundary move made it stale, both of which really do have an answer on the way.
 */
describe('a book whose range nothing places', () => {
  const nowhere = {
    kind: 'range-has-no-start',
    range: 'nonfiction',
    instruction:
      'Nothing says where non-fiction begins, so there is nowhere to put this book. '
      + 'Say what belongs on a bookcase or a shelf first.',
    suggestedLocation: '',
    derivedLocation: '',
    derivedAreaId: null,
    predecessor: null,
    successor: null,
    authorFiling: 'Berger, John',
    sortKey: 'berger john|ways of seeing',
    strip: null,
  } as unknown as PlacementResponse

  const drawnFor = (placement: PlacementResponse | null, stale = false) =>
    renderToStaticMarkup(
      <ShelveView
        placement={placement}
        stale={stale}
        range="nonfiction"
        title="Ways of Seeing"
        saving={false}
        onShelved={() => {}}
        onBack={() => {}}
        cascade={emptyCascade}
        setCascade={() => {}}
        onRefresh={async () => {}}
      />,
    )

  it('says nothing places the range, rather than promising an answer', () => {
    const html = drawnFor(nowhere)
    expect(html).toContain('Nothing says where non-fiction')
    expect(html).not.toContain('Working out where')
  })

  it('is what tells that screen apart from the one still waiting', () => {
    const waiting = drawnFor(null)
    expect(waiting).toContain('Working out where')
    expect(waiting).not.toContain('Nothing says where')
  })

  it('names no plank, because there is none to name', () => {
    const html = drawnFor(nowhere)
    expect(html).not.toContain('Start at')
    expect(html).not.toContain('gap at')
  })

  it('offers no answer to press, because every one of them writes', () => {
    // None of the three buttons is a question that can be asked about a run
    // that does not exist, so all three stay disabled.
    const html = drawnFor(nowhere)
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(3)
  })

  it('says nothing has been changed and what ends the state', () => {
    const html = drawnFor(nowhere)
    expect(html).toContain('Nothing has been changed and nothing is lost')
    expect(html).toContain('Where a range begins is whatever your rules say')
  })

  it('does not say it about a book that is simply in neither run', () => {
    // A different absence: a book with no genre tag is in neither ordered
    // list, whereas this is a list that stands nowhere at all.
    const html = renderToStaticMarkup(
      <ShelveView
        placement={null}
        stale={false}
        range={null}
        title="Ways of Seeing"
        saving={false}
        onShelved={() => {}}
        onBack={() => {}}
        cascade={emptyCascade}
        setCascade={() => {}}
        onRefresh={async () => {}}
      />,
    )
    expect(html).toContain('is fiction or')
    expect(html).not.toContain('Nothing says where')
  })
})

describe('a book no rule claims, placed by hand', () => {
  const unclaimed = (byHand: boolean) => renderToStaticMarkup(
    <ShelveView
      placement={null}
      stale={false}
      range={null}
      title="Ways of Seeing"
      saving={false}
      onShelved={() => {}}
      onBack={() => {}}
      cascade={emptyCascade}
      setCascade={() => {}}
      onRefresh={async () => {}}
      byHand={byHand}
    />,
  )

  it('offers the furniture for a catalogued book instead of ending in a sentence', () => {
    const html = unclaimed(true)
    expect(html).toContain('Put it somewhere yourself')
    expect(html).toContain('or choose a shelf for it below')
  })

  it('offers nothing for a book not saved yet, whose insert takes no plank', () => {
    const html = unclaimed(false)
    expect(html).not.toContain('Put it somewhere yourself')
    expect(html).not.toContain('choose a shelf')
  })

  const area = (id: number, label: string) => ({ id, label, name: '' })
  const fixtures = [
    { id: 1, label: 'Bookcase 1', name: 'Hall', areas: [area(11, '1A'), area(12, '1B')] },
    { id: 2, label: 'Bookcase 2', name: '', areas: [] },
  ] as unknown as FixtureDto[]

  const choice = (over: Partial<Parameters<typeof PlankChoice>[0]> = {}) =>
    PlankChoice({ title: 'Ways of Seeing', fixtures, off: false, onChosen: () => {}, ...over })

  it('names every plank under the piece it is on, and no empty piece', () => {
    const html = renderToStaticMarkup(choice())
    expect(html).toContain('Hall')
    expect(html).toContain('On 1A')
    expect(html).toContain('On 1B')
    expect(html).not.toContain('Bookcase 2')
  })

  it('hands on the plank chosen by its id', () => {
    const chosen: number[] = []
    const found: { onPress?: () => void; children?: unknown }[] = []
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      const props = (node as { props?: { onPress?: () => void; children?: unknown } }).props
      if (props?.onPress) found.push(props)
      walk(props?.children)
    }
    walk(choice({ onChosen: (id) => chosen.push(id) }))
    found.find((one) => one.children === 'On 1B')!.onPress!()
    expect(chosen).toEqual([12])
  })

  it('says there is nowhere yet rather than drawing an empty list', () => {
    const html = renderToStaticMarkup(choice({ fixtures: [] }))
    expect(html).toContain('There is no furniture to put Ways of Seeing on yet')
    expect(html).not.toContain('<button')
  })

  it('says it is reading while the room has not answered', () => {
    expect(renderToStaticMarkup(choice({ fixtures: null }))).toContain('Reading the room')
  })
})

describe('a catalogued book a rule wants somewhere', () => {
  const placement = {
    kind: 'between',
    range: 'fiction',
    instruction: '',
    suggestedLocation: '',
    derivedLocation: '1A',
    derivedAreaId: 1,
    predecessor: null,
    successor: null,
    authorFiling: 'Herbert, Frank',
    sortKey: 'herbert frank|dune',
    strip: null,
  } as unknown as PlacementResponse

  const drawn = (wanted: { areaId: number; label: string } | null) => renderToStaticMarkup(
    <ShelveView
      placement={placement}
      stale={false}
      range="fiction"
      title="Dune"
      saving={false}
      onShelved={() => {}}
      onBack={() => {}}
      cascade={emptyCascade}
      setCascade={() => {}}
      onRefresh={async () => {}}
      byHand
      wanted={wanted}
    />,
  )

  it('offers the plank the rules name when the gap is somewhere else', () => {
    const html = drawn({ areaId: 4, label: '4A' })
    expect(html).toContain('The rules put it on 4A')
    expect(html).toContain('It is on 4A, save')
  })

  it('says nothing extra when the rules and the gap agree, or no rule claims it', () => {
    expect(drawn({ areaId: 1, label: '1A' })).not.toContain('The rules put it')
    expect(drawn(null)).not.toContain('The rules put it')
  })
})

describe('a book nobody has said is fiction or non-fiction', () => {
  const asked = (onGenre?: (range: 'fiction' | 'nonfiction') => void) => renderToStaticMarkup(
    <ShelveView
      placement={null}
      stale={false}
      range={null}
      title="Middlemarch"
      saving={false}
      onShelved={() => {}}
      onBack={() => {}}
      cascade={emptyCascade}
      setCascade={() => {}}
      onRefresh={async () => {}}
      onGenre={onGenre}
    />,
  )

  it('asks the question here, with two answers that can be pressed', () => {
    const html = asked(() => {})
    expect(html).toContain('Is <strong>Middlemarch</strong> fiction or non-fiction?')
    const buttons = html.match(/<button[^>]*>[^<]*<\/button>/g) ?? []
    const fiction = buttons.find((one) => />Fiction</.test(one))
    const nonFiction = buttons.find((one) => />Non-fiction</.test(one))
    expect(fiction).toBeDefined()
    expect(nonFiction).toBeDefined()
    expect(fiction).not.toMatch(/disabled/)
    expect(nonFiction).not.toMatch(/disabled/)
  })

  it('does not offer answers that cannot be given yet, or a false reason', () => {
    const html = asked(() => {})
    expect(html).not.toContain('It fits, save')
    expect(html).not.toContain('title and author')
    expect(html).not.toContain('Go back and say')
  })
})

describe('where it goes, on a phone', () => {
  const placed = {
    kind: 'between-same-location',
    range: 'fiction',
    instruction:
      '1A: between Children of Dune (Herbert, Frank) and The Dispossessed (Le Guin, Ursula K.)',
    suggestedLocation: '1A',
    derivedLocation: '1A',
    derivedAreaId: 11,
    authorFiling: 'Ishiguro, Kazuo',
    sortKey: 'ishiguro kazuo|the remains of the day',
    predecessor: {
      id: 1, title: 'Children of Dune', authorFiling: 'Herbert, Frank', authors: '',
      location: '1A', areaId: 11, sortKey: '', images: { front: '', back: '', edge: '' },
    },
    successor: {
      id: 2, title: 'The Dispossessed', authorFiling: 'Le Guin, Ursula K.', authors: '',
      location: '1A', areaId: 11, sortKey: '', images: { front: '', back: '', edge: '' },
    },
    strip: {
      label: '1A', gapIndex: 1, placedIndex: null,
      books: [
        { id: 1, title: 'Children of Dune', authorFiling: 'Herbert, Frank', spine: '', spineSlot: 'edge' },
        { id: 2, title: 'The Dispossessed', authorFiling: 'Le Guin, Ursula K.', spine: '', spineSlot: 'edge' },
      ],
    },
  } as unknown as PlacementResponse

  const drawn = renderToStaticMarkup(
    <ShelveView
      placement={placed}
      stale={false}
      range="fiction"
      title="The Remains of the Day"
      saving={false}
      onShelved={() => {}}
      onBack={() => {}}
      cascade={emptyCascade}
      setCascade={() => {}}
      onRefresh={async () => {}}
    />,
  )

  it('leads with the shelf and the two authors, and nothing longer', () => {
    expect(drawn).toContain('Shelf 1A, between Herbert and Le Guin')
    expect(drawn).not.toContain('Children of Dune (Herbert')
  })

  // `.wf-bleed` pulls its contents out to the screen edge, which is right for
  // the drawn shelf and leaves a sentence touching the glass.
  it('keeps the sentence out of the edge-to-edge strip', () => {
    const bleed = drawn.indexOf('wf-bleed')
    const sentence = drawn.indexOf('wf-instruction')
    expect(sentence).toBeGreaterThan(-1)
    expect(bleed).toBeGreaterThan(-1)
    expect(sentence).toBeLessThan(bleed)
  })

  it('says each thing once', () => {
    expect(drawn).not.toContain('In your hand')
    expect(drawn).not.toContain('Each time you say there is no room')
  })

  it('uses none of the words the app keeps for itself', () => {
    const words = drawn.replace(/<[^>]*>/g, ' ')
    expect(words).not.toMatch(/\b(plank|boundary|area|ledger)\b/i)
  })
})
