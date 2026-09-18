/**
 * The three tasks, and what counts as having done them.
 *
 * Each task names no screen, no button and no route: naming one would tell the
 * driver the answer and measure only typing speed. Completion is decided from
 * rows, never from the driver's own account, since an agent that believes it
 * finished is exactly the witness that must not be trusted.
 */

/** Anything a person would call a comic, however the tag ended up spelled. */
const COMICS = /comic|graphic novel|manga/i

/**
 * The two bookcases task 3 names: books come off bookcase 4 and go onto
 * bookcase 3. Every other piece is somebody else's furniture and this task may
 * not change it.
 */
const ABOUT = { off: 4, onto: 3 }

/** Every shelf the app draws, keyed by area id, from a `drawn` reading. */
function shelvesDrawn(drawn) {
  const shelves = new Map()
  for (const piece of drawn ?? []) {
    for (const shelf of piece.shelves) shelves.set(shelf.area_id, { ...shelf, piece })
  }
  return shelves
}

export const TASKS = [
  {
    id: 1,
    goal: 'You have a new bookcase in the hall with four shelves. Get it into the app.',
    /**
     * A piece of furniture the world did not have, called something a person
     * would recognise as the hall one, with four shelves on it.
     */
    check(world, baseline) {
      const before = new Set(baseline.furniture.map((row) => row.fixture_id))
      const added = [...new Map(world.furniture
        .filter((row) => !before.has(row.fixture_id))
        .map((row) => [row.fixture_id, row])).values()]
      const hall = added.find((row) => /hall/i.test(row.fixture_name))
      const target = hall ?? added[0]
      const shelves = target
        ? world.furniture.filter((row) => row.fixture_id === target.fixture_id && row.area_id !== null).length
        : 0
      return {
        parts: [
          ['a bookcase the world did not have', added.length > 0,
            added.length ? `fixture ${added.map((a) => a.fixture_id).join(', ')}` : 'nothing new'],
          ['it is recognisable as the hall one', Boolean(hall),
            target ? `name "${target.fixture_name}"` : 'no new fixture'],
          ['it has four shelves', shelves === 4, `${shelves} shelf/shelves`],
        ],
      }
    },
  },
  {
    id: 2,
    goal: 'The comics should live on the bottom shelf of the hall bookcase, and only comics.',
    /**
     * The bottom shelf is the last area of that piece, and "should live" is a
     * standing arrangement rather than one afternoon's tidying: the app either
     * records that comics belong there, or it does not and somebody has to
     * remember. Both halves are checked, because "and only comics" is the half
     * that is easy to leave out.
     */
    check(world, baseline) {
      const before = new Set(baseline.furniture.map((row) => row.fixture_id))
      const rows = world.furniture.filter((row) => !before.has(row.fixture_id) && row.area_id !== null)
      const hallId = rows.find((row) => /hall/i.test(row.fixture_name))?.fixture_id ?? rows[0]?.fixture_id
      const shelves = rows.filter((row) => row.fixture_id === hallId)
      const bottom = shelves[shelves.length - 1]
      const claiming = world.rules.filter((rule) => rule.area_id === bottom?.area_id)
      const comicRule = claiming.find((rule) => COMICS.test(rule.conditions) || COMICS.test(rule.name))
      const standingThere = world.books.filter((book) => book.current_area_id === bottom?.area_id)
      const strangers = standingThere.filter((book) => !COMICS.test(book.tags))
      return {
        parts: [
          ['there is a bottom shelf on the hall bookcase', Boolean(bottom),
            bottom ? `area ${bottom.area_id} at position ${bottom.area_position}` : 'no hall bookcase'],
          ['the app records that comics belong there', Boolean(comicRule),
            comicRule ? `rule ${comicRule.id} [${comicRule.conditions}]` : `${claiming.length} rule(s) point at it`],
          ['nothing that is not a comic stands there', strangers.length === 0,
            strangers.length ? strangers.map((b) => b.title).join(', ') : `${standingThere.length} book(s) there`],
        ],
      }
    },
  },
  {
    id: 3,
    goal: 'Move every non-fiction book off bookcase 4 and onto bookcase 3, and record that you have carried them.',
    /**
     * Three separate claims, and they fail separately on purpose: the books are
     * off bookcase 4, the books are on bookcase 3, and the app is not still
     * waiting to be told they were carried. A world where the app has worked
     * out the moves and nobody has confirmed them is a different outcome from a
     * world where nothing happened, and a single boolean would lose that.
     */
    check(world, baseline, standing = [], drawnBefore = null) {
      /*
       * Shelved only: a checked-out book is in somebody's bag rather than on
       * bookcase 4, so it cannot be carried off it, and counting it would mark
       * a correct outcome as a failure.
       */
      const nonFiction = world.books.filter((book) => /genre\/non-fiction/.test(book.tags) && book.state === 'shelved')
      const stillOnFour = nonFiction.filter((book) => book.fixture_position === 4)
      const onThree = nonFiction.filter((book) => book.fixture_position === 3)
      const waiting = world.outstanding.filter((move) => move.shelf_range === 'nonfiction')

      /*
       * Furniture the person built is not this task's to remove, whatever
       * happens to the books: the pieces and areas standing when the task
       * began have to still be rows when it ends. Rows rather than faces: a
       * shelf the run takes with it coming off its piece is a real consequence
       * of the request, but deleting the piece is not.
       */
      const before = standing.filter((row) => row.fixture_id !== null)
      const pieces = new Set(world.furniture.map((row) => row.fixture_id))
      const areas = new Set(world.furniture.map((row) => row.area_id).filter((id) => id !== null))
      const lostPieces = [...new Set(before
        .filter((row) => !pieces.has(row.fixture_id))
        .map((row) => row.fixture_name || `piece ${row.fixture_id}`))]
      const lostAreas = before.filter((row) => row.area_id !== null && !areas.has(row.area_id))

      /*
       * Rows surviving is not enough: applying the move can leave a piece and
       * its shelves standing as rows while no screen draws them and a rule
       * still files onto one. So these three ask the app instead of the table,
       * through `GET /api/fixtures`, the same endpoint the screens are drawn
       * from: nothing reachable when the task began became unreachable outside
       * the two bookcases in play, no shelf appeared that nobody asked for
       * except on the destination bookcase, and no rule is left filing onto a
       * shelf the app will not draw. An absent drawing fails these rather than
       * passing them.
       */
      const drawnNow = shelvesDrawn(world.drawn)
      const drawnThen = shelvesDrawn(drawnBefore)
      const asked = Boolean(world.drawn) && Boolean(drawnBefore)

      const pieceOf = (shelf) => shelf.piece.fixture_position
      const elsewhere = ([, shelf]) => pieceOf(shelf) !== ABOUT.off && pieceOf(shelf) !== ABOUT.onto

      const unreachable = [...drawnThen]
        .filter(elsewhere)
        .filter(([id]) => !drawnNow.has(id))
        .map(([, shelf]) => `${shelf.label}${shelf.area_name ? ` "${shelf.area_name}"` : ''}`)

      const invented = [...drawnNow]
        .filter(([, shelf]) => pieceOf(shelf) !== ABOUT.onto)
        .filter(([id]) => !drawnThen.has(id))
        .map(([, shelf]) => shelf.label)

      const filingNowhere = world.rules
        .filter((rule) => rule.area_id !== null && !drawnNow.has(rule.area_id))
        .map((rule) => `rule ${rule.id} [${rule.conditions}] -> area ${rule.area_id}`)

      return {
        parts: [
          ['no non-fiction left on bookcase 4', stillOnFour.length === 0,
            `${stillOnFour.length} of ${nonFiction.length} still there`],
          ['every non-fiction book is on bookcase 3', nonFiction.length > 0 && onThree.length === nonFiction.length,
            `${onThree.length} of ${nonFiction.length} on bookcase 3`],
          ['nothing is still waiting to be carried', waiting.length === 0,
            `${waiting.length} outstanding move(s)`],
          ['no piece of furniture was destroyed on the way', lostPieces.length === 0,
            lostPieces.length ? `lost ${lostPieces.join(', ')}` : `${pieces.size} piece(s) still standing`],
          ['no shelf and no name written on one was destroyed', lostAreas.length === 0,
            lostAreas.length
              ? `lost ${lostAreas.map((row) => row.area_name || `area ${row.area_id}`).join(', ')}`
              : `${areas.size} area row(s) still there`],
          ['every shelf on a bookcase this was not about is still one the app draws',
            asked && unreachable.length === 0,
            !asked ? 'the app was never asked what it draws'
              : unreachable.length ? `${unreachable.join(', ')} reach nobody now`
                : `${drawnThen.size} shelf/shelves drawn before, all still drawn`],
          ['no shelf appeared that nobody asked for',
            asked && invented.length === 0,
            !asked ? 'the app was never asked what it draws'
              : invented.length ? `${invented.join(', ')} nobody added`
                : `${drawnNow.size} shelf/shelves drawn`],
          ['no rule files books onto a shelf the app will not draw',
            asked && filingNowhere.length === 0,
            !asked ? 'the app was never asked what it draws'
              : filingNowhere.length ? filingNowhere.join('; ')
                : `${world.rules.length} rule(s), every one pointing somewhere reachable`],
        ],
      }
    },
  },
]

export function taskById(id) {
  const task = TASKS.find((t) => t.id === Number(id))
  if (!task) throw new Error(`No task ${id}. There are ${TASKS.length}.`)
  return task
}

/**
 * Run a task's check and fold its parts into one answer.
 *
 * `standing` is the furniture as it was when the task began, a different
 * question from `baseline`: what tasks two and three are judged against is
 * what the person had after task one, not the seeded world.
 *
 * `drawing` is that same moment asked of the app rather than of the rows: what
 * the person could actually reach when the task began.
 */
export function judge(task, world, baseline, standing = [], drawing = null) {
  const { parts } = task.check(world, baseline, standing, drawing)
  return {
    id: task.id,
    goal: task.goal,
    completed: parts.every(([, ok]) => ok),
    parts: parts.map(([what, ok, saw]) => ({ what, ok, saw })),
  }
}
