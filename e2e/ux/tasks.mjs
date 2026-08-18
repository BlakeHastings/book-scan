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
    check(world, baseline, standing = []) {
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
 */
export function judge(task, world, baseline, standing = []) {
  const { parts } = task.check(world, baseline, standing)
  return {
    id: task.id,
    goal: task.goal,
    completed: parts.every(([, ok]) => ok),
    parts: parts.map(([what, ok, saw]) => ({ what, ok, saw })),
  }
}
