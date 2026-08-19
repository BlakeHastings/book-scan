// node e2e/ux/tasks.test.mjs
//
// What task 3's furniture check must catch, and what it must not.
//
// The check exists because a task can fail for what it destroyed (#391), and it
// then failed to catch exactly that (#420): the second pass of the usability
// loop applied a move that left four shelves at negative positions, drawn by no
// screen, with a rule still filing comics onto one of them, and every part of
// the check reported ok because every row was still in the table.
//
// **A guard that measures the wrong thing is worse than no guard, because it is
// believed.** So the world below is not invented. It is the world #419 recorded,
// rows and all, and the first test here is the one that has to fail before the
// application code is worth anything: the old, row-counting parts pass over it.
//
// The check is pure, so this needs no database, no browser and no AppHost.
import assert from 'node:assert/strict'
import { judge, taskById } from './tasks.mjs'

let passed = 0
function test(name, body) {
  try {
    body()
    passed += 1
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`)
    process.exitCode = 1
  }
}

// ---------------------------------------------------------------------------
// The world, exactly as the second pass left it
// ---------------------------------------------------------------------------

/** A row of the `fixture LEFT JOIN area` read the checks are given. */
const row = (fixture, position, name, area, at, areaName = '') => ({
  fixture_id: fixture,
  fixture_name: name,
  fixture_position: position,
  kind: 'bookshelf',
  area_id: area,
  area_position: at,
  area_name: areaName,
  starts_at: '',
  books: '0',
})

/** One piece as `GET /api/fixtures` answers it, folded the way `world.mjs` folds it. */
const piece = (fixture, position, name, shelves, gone = []) => ({
  fixture_id: fixture,
  fixture_name: name,
  fixture_position: position,
  fixture_label: name || `Bookshelf ${position}`,
  books: 0,
  shelves: [
    ...shelves.map(([area, label, areaName = '']) => ({
      area_id: area, label, area_name: areaName, books: 0, gone: false,
    })),
    ...gone.map(([area, label, areaName = '', books = 1]) => ({
      area_id: area, label, area_name: areaName, books, gone: true,
    })),
  ],
})

/** The seed: fiction on 1 and 2, non-fiction on 4, no bookcase 3. */
const BASELINE_FURNITURE = [
  row(1, 1, '', 1, 0), row(1, 1, '', 21, 1),
  row(7, 2, '', 22, 0), row(7, 2, '', 23, 1),
  row(2, 4, '', 2, 0), row(2, 4, '', 24, 1), row(2, 4, '', 25, 2),
]

/** After tasks 1 and 2: the hall bookcase is up, four shelves, comics on the last. */
const AFTER_TASK_TWO = [
  ...BASELINE_FURNITURE,
  row(4, 5, 'Hall', 8, 0), row(4, 5, 'Hall', 9, 1),
  row(4, 5, 'Hall', 10, 2), row(4, 5, 'Hall', 11, 3, 'Comics'),
]

const DRAWN_AFTER_TASK_TWO = [
  piece(1, 1, '', [[1, '1A'], [21, '1B']]),
  piece(7, 2, '', [[22, '2A'], [23, '2B']]),
  piece(2, 4, '', [[2, '4A'], [24, '4B'], [25, '4C']]),
  piece(4, 5, 'Hall', [[8, '5A'], [9, '5B'], [10, '5C'], [11, '5D', 'Comics']]),
]

const RULES_AFTER_TASK_TWO = [
  { id: 1, name: 'Fiction', area_id: null, fixture_id: 1, conditions: 'tag is genre/fiction' },
  { id: 2, name: 'Non-fiction', area_id: null, fixture_id: 2, conditions: 'tag is genre/non-fiction' },
  { id: 3, name: 'Comics', area_id: 11, fixture_id: null, conditions: 'tag is subject/comics' },
]

/** Eight non-fiction books, all carried onto bookcase 3, so the book parts pass. */
const CARRIED = Array.from({ length: 8 }, (_, at) => ({
  id: 200 + at,
  title: `Non-fiction ${at}`,
  state: 'shelved',
  tags: 'genre/non-fiction',
  current_area_id: 30,
  fixture_position: 3,
}))

/**
 * What applying the move actually left, read off `e2e/ux/runs/turn2/report.md`.
 *
 * The hall's four shelves at `area_position` -4 to -1 in reversed order, a `4D`
 * that nobody added (area 15, a new row) on the bookcase the books came off, and
 * rule 3 still pointing at area 11.
 */
const BROKEN_FURNITURE = [
  ...BASELINE_FURNITURE,
  row(2, 4, '', 15, 3),
  row(9, 3, '', 30, 0), row(9, 3, '', 31, 1), row(9, 3, '', 32, 2),
  row(4, 5, 'Hall', 11, -4, 'Comics'), row(4, 5, 'Hall', 10, -3),
  row(4, 5, 'Hall', 9, -2), row(4, 5, 'Hall', 8, -1),
]

const BROKEN_DRAWN = [
  piece(1, 1, '', [[1, '1A'], [21, '1B']]),
  piece(7, 2, '', [[22, '2A'], [23, '2B']]),
  piece(9, 3, '', [[30, '3A'], [31, '3B'], [32, '3C']]),
  piece(2, 4, '', [[2, '4A'], [24, '4B'], [25, '4C'], [15, '4D']]),
  // Standing, and answering "0 areas, 0 books".
  piece(4, 5, 'Hall', []),
]

/** What the same move leaves once it stops touching the piece it was not about. */
const FIXED_FURNITURE = [
  ...BASELINE_FURNITURE.filter((one) => one.fixture_id !== 2),
  row(2, 4, '', 2, -1), row(2, 4, '', 24, -2), row(2, 4, '', 25, -3),
  row(9, 3, '', 30, 0), row(9, 3, '', 31, 1), row(9, 3, '', 32, 2),
  row(4, 5, 'Hall', 8, 0), row(4, 5, 'Hall', 9, 1),
  row(4, 5, 'Hall', 10, 2), row(4, 5, 'Hall', 11, 3, 'Comics'),
]

const FIXED_DRAWN = [
  piece(1, 1, '', [[1, '1A'], [21, '1B']]),
  piece(7, 2, '', [[22, '2A'], [23, '2B']]),
  piece(9, 3, '', [[30, '3A'], [31, '3B'], [32, '3C']]),
  // The run left it, its planks came off its face, and the books have all been
  // carried, so there is nothing left for the piece to draw. That is the
  // request, said in the plan as `RunMovePlan.emptied` before anybody pressed
  // anything, and it is why this bookcase is one of the two the task is about.
  piece(2, 4, '', []),
  piece(4, 5, 'Hall', [[8, '5A'], [9, '5B'], [10, '5C'], [11, '5D', 'Comics']]),
]

const worldWith = (furniture, drawn, rules = RULES_AFTER_TASK_TWO) => ({
  furniture,
  drawn,
  rules,
  books: CARRIED,
  outstanding: [],
})

const partsOf = (verdict) => new Map(verdict.parts.map((part) => [part.what, part]))

const judgeTaskThree = (furniture, drawn, rules) => judge(
  taskById(3),
  worldWith(furniture, drawn, rules),
  { furniture: BASELINE_FURNITURE },
  AFTER_TASK_TWO,
  DRAWN_AFTER_TASK_TWO,
)

// ---------------------------------------------------------------------------

test('the row parts pass over the world the second pass left, which is why they were not enough', () => {
  const parts = partsOf(judgeTaskThree(BROKEN_FURNITURE, BROKEN_DRAWN))

  assert.equal(parts.get('no piece of furniture was destroyed on the way').ok, true)
  assert.equal(parts.get('no shelf and no name written on one was destroyed').ok, true)
})

test('the shelves nobody can reach any more are named', () => {
  const parts = partsOf(judgeTaskThree(BROKEN_FURNITURE, BROKEN_DRAWN))
  const part = parts.get('every shelf on a bookcase this was not about is still one the app draws')

  assert.equal(part.ok, false)
  assert.match(part.saw, /5A/)
  assert.match(part.saw, /5D/)
  assert.match(part.saw, /Comics/)
})

test('the shelf nobody added is named, and it is the 4D', () => {
  const parts = partsOf(judgeTaskThree(BROKEN_FURNITURE, BROKEN_DRAWN))
  const part = parts.get('no shelf appeared that nobody asked for')

  assert.equal(part.ok, false)
  assert.match(part.saw, /4D/)
})

test('the rule left filing books onto a shelf the app will not draw is named', () => {
  const parts = partsOf(judgeTaskThree(BROKEN_FURNITURE, BROKEN_DRAWN))
  const part = parts.get('no rule files books onto a shelf the app will not draw')

  assert.equal(part.ok, false)
  assert.match(part.saw, /subject\/comics/)
})

test('the whole task fails over that world, where before it completed', () => {
  assert.equal(judgeTaskThree(BROKEN_FURNITURE, BROKEN_DRAWN).completed, false)
})

test('every part passes once the move leaves the piece it was not about alone', () => {
  const verdict = judgeTaskThree(FIXED_FURNITURE, FIXED_DRAWN)
  const failed = verdict.parts.filter((part) => !part.ok).map((part) => `${part.what}: ${part.saw}`)

  assert.deepEqual(failed, [])
  assert.equal(verdict.completed, true)
})

test('the bookcase the books came off may be emptied, because the task named it', () => {
  const parts = partsOf(judgeTaskThree(FIXED_FURNITURE, FIXED_DRAWN))

  assert.equal(parts.get('every shelf on a bookcase this was not about is still one the app draws').ok, true)
})

test('the destination may gain the shelves the move puts on it', () => {
  const parts = partsOf(judgeTaskThree(FIXED_FURNITURE, FIXED_DRAWN))

  assert.equal(parts.get('no shelf appeared that nobody asked for').ok, true)
})

test('a plank that stays reachable through the books on it counts as reachable', () => {
  // Before anybody carries anything, bookcase 4's planks are off its face and
  // still hold every book, which the app draws as "taken out" (#403). The hall
  // is untouched. Nothing here is unreachable.
  const drawn = [
    piece(1, 1, '', [[1, '1A'], [21, '1B']]),
    piece(7, 2, '', [[22, '2A'], [23, '2B']]),
    piece(9, 3, '', [[30, '3A'], [31, '3B'], [32, '3C']]),
    piece(2, 4, '', [], [[2, '4A', '', 2], [24, '4B', '', 4], [25, '4C', '', 1]]),
    piece(4, 5, 'Hall', [[8, '5A'], [9, '5B'], [10, '5C'], [11, '5D', 'Comics']]),
  ]
  const parts = partsOf(judgeTaskThree(FIXED_FURNITURE, drawn))

  assert.equal(parts.get('every shelf on a bookcase this was not about is still one the app draws').ok, true)
  assert.equal(parts.get('no rule files books onto a shelf the app will not draw').ok, true)
})

test('a run that never asked the app what it draws fails the three, rather than passing them', () => {
  const verdict = judge(
    taskById(3),
    { ...worldWith(FIXED_FURNITURE, null), drawn: null },
    { furniture: BASELINE_FURNITURE },
    AFTER_TASK_TWO,
    null,
  )
  const parts = partsOf(verdict)

  for (const what of [
    'every shelf on a bookcase this was not about is still one the app draws',
    'no shelf appeared that nobody asked for',
    'no rule files books onto a shelf the app will not draw',
  ]) {
    assert.equal(parts.get(what).ok, false, what)
    assert.match(parts.get(what).saw, /never asked/)
  }
})

test('an empty drawing is not the same answer as no drawing', () => {
  // [] would mean "the app drew nothing", which is a finding. null means nobody
  // asked, which is not an answer at all. Both fail here, for different reasons,
  // and neither may quietly pass.
  const parts = partsOf(judgeTaskThree(FIXED_FURNITURE, []))

  assert.equal(parts.get('every shelf on a bookcase this was not about is still one the app draws').ok, false)
  assert.match(parts.get('every shelf on a bookcase this was not about is still one the app draws').saw, /reach nobody/)
})

if (process.exitCode) {
  console.error('ux task checks failed.')
} else {
  console.log(`ux task checks: ${passed} tests passed.`)
}
