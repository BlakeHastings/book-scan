/**
 * The three tasks, and what counts as having done them.
 *
 * They live here rather than in whatever was typed at an agent, because the
 * point of this harness is running it again after a change and comparing. A
 * task that was worded slightly differently the second time is a number that
 * cannot be compared with the first.
 *
 * **Each task is somebody's goal and names no screen, no button and no route.**
 * That is the whole design. Naming one would be telling the driver the answer
 * and measuring nothing but typing speed.
 *
 * **Completion is decided from rows, never from the driver's own account.** An
 * agent that believes it finished is exactly the witness that must not be
 * trusted, and the interesting failure here is somebody doing five reasonable
 * things and ending up with a world that does not match what they were asked
 * for.
 */

/** Anything a person would call a comic, however the tag ended up spelled. */
const COMICS = /comic|graphic novel|manga/i

/**
 * The two bookcases task 3 names out loud, and the only two it may rearrange.
 *
 * Task 3 asks for books to come off bookcase 4 and go onto bookcase 3. Those two
 * pieces are the request: taking the run's planks off the one it leaves is a
 * real consequence of it, said in the plan before anybody presses anything, and
 * standing planks on the one it goes to is the request itself. **Every other
 * piece in the room is somebody else's furniture and this task may not change
 * it**, which is the difference between a consequence and collateral damage.
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
       * The shelved ones only, and this is a correction the first run earned.
       * A checked-out book is in somebody's bag rather than on bookcase 4, so
       * it cannot be carried off it, and the app says so plainly on the plan
       * ("One checked out. Left alone."). Counting it would have marked a
       * correct outcome as a failure. Recorded here rather than quietly fixed:
       * a check written before the run and adjusted after it is exactly the
       * thing that has to be visible.
       */
      const nonFiction = world.books.filter((book) => /genre\/non-fiction/.test(book.tags) && book.state === 'shelved')
      const stillOnFour = nonFiction.filter((book) => book.fixture_position === 4)
      const onThree = nonFiction.filter((book) => book.fixture_position === 3)
      const waiting = world.outstanding.filter((move) => move.shelf_range === 'nonfiction')

      /*
       * #391, and it is here because the first pass of this task passed every
       * part above while deleting a bookcase.
       *
       * The person put the hall bookcase up in task 1, gave it four shelves and
       * named one Comics. Applying the move deleted the piece, all four areas
       * and the name, and said nothing. Every number this task had was about
       * books, so a world where somebody's furniture had been destroyed scored
       * exactly the same as one where it had not.
       *
       * **Furniture the person built is not this task's to remove**, whatever
       * happens to the books, so the pieces and the areas standing when the task
       * began have to still be rows when it ends. Rows rather than faces: a
       * shelf the run takes with it comes off the piece it was on, which is a
       * real consequence of a real request and is said in the plan. Deleting it
       * is not.
       */
      const before = standing.filter((row) => row.fixture_id !== null)
      const pieces = new Set(world.furniture.map((row) => row.fixture_id))
      const areas = new Set(world.furniture.map((row) => row.area_id).filter((id) => id !== null))
      const lostPieces = [...new Set(before
        .filter((row) => !pieces.has(row.fixture_id))
        .map((row) => row.fixture_name || `piece ${row.fixture_id}`))]
      const lostAreas = before.filter((row) => row.area_id !== null && !areas.has(row.area_id))

      /*
       * #420, and it is the part of this check that was missing rather than
       * wrong.
       *
       * The two above ask whether the rows survived, and the second pass of the
       * loop walked straight through both: applying the move left the hall
       * bookcase standing and all four of its shelves as rows, at
       * `area_position` -4 to -1, drawn by no screen, the piece answering
       * "0 areas, 0 books", and the rule task 2 wrote still filing comics onto
       * one of them. Every row was there. **What went was reachability**, and a
       * guard that measures the wrong thing is worse than none, because it is
       * believed.
       *
       * So these three ask the app instead of the table, through
       * `GET /api/fixtures`, which is what the screens are drawn from:
       *
       *  - nothing the person could reach when the task began became
       *    unreachable, on any piece the task was not about;
       *  - no shelf appeared that nobody asked for, anywhere but on the
       *    bookcase the books were going to (that is the `4D`);
       *  - no rule is left filing books onto a shelf the app will not draw.
       *
       * **An absent drawing fails them rather than passing them.** A run from a
       * harness that never asked the app what it draws cannot say any of this,
       * and saying nothing has to read as "not judged", never as ok.
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
 * `standing` is the furniture as it was when the task began, which is a
 * different question from `baseline` and cannot be got from it: the baseline is
 * the seeded world, and what tasks two and three have to be judged against is
 * what the person had after task one. See task 3, and #391.
 *
 * `drawing` is the same moment asked of the app rather than of the rows: what
 * the person could actually reach when the task began. Rows and reachability are
 * two different questions and #420 is the cost of only ever asking the first.
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
