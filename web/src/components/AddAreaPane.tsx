/**
 * Adding an area, which is always cutting one that is there.
 *
 * ## Adding and splitting are the same act
 *
 * "Add an area to this bookcase" and "split this area in two" arrive at this
 * screen and it draws one thing, because in this model they are one thing. An
 * area is a stretch of the order between two boundaries, so a new area is a new
 * boundary, and a boundary is a book: the one the new area starts at. Adding an
 * area to the end of a piece without saying where it starts would be an area
 * that begins nowhere and takes no books, and the areas of a piece are read in
 * the order the books run along it, so the server refuses that outright.
 *
 * The exception is a run with nothing standing in it, and there are two of
 * those. A piece nobody has cut yet has no areas, so the first one opens at the
 * beginning. A piece whose last area holds no books has nothing to divide, so
 * the new area opens where that one opens. **Neither has a decision in it**, so
 * neither draws a list or waits for a book to be picked: the button adds the
 * area (#367). What separates them from the ordinary case is one question, which
 * is whether any book stands in the run being cut.
 *
 * A run that has not answered yet is not an empty one. `coming` is the
 * difference, and without it this screen would offer the decisionless version
 * of itself for as long as the request takes and cut an unanchored area into a
 * full bookcase for anybody who pressed inside that window.
 *
 * ## Which book, not how many
 *
 * The boundary is anchored to a place in the order rather than to a count, so
 * what somebody picks is the first book of the new area. The counts underneath
 * follow from that. Anchoring to a number would mean the boundary moved every
 * time a book was catalogued into the middle of the run.
 */

import { Card, Instruction } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { AreaBox, Nest } from '../design/Furniture'
import { List, Row } from '../design/List'
import type { AreaDto, FixtureDto } from '../lib/api'
import type { Cloth } from '../design/Shelf'
import { labelsIfNamed, pieceNote, pieceSaid, plural } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

/** A book of the area being cut, as this screen needs it. */
export interface SplitBook {
  id: number
  title: string
  authorFiling: string
  sortKey: string
}

interface Props {
  piece: FixtureDto | null
  /** The area being cut, or null on a piece that has none yet. */
  area: AreaDto | null
  books: SplitBook[]
  /**
   * Whether the books of the area being cut are still coming.
   *
   * An empty list and a list that has not arrived are the same list, and they
   * are opposite answers to the only question this screen asks.
   */
  coming: boolean
  /** Which book the new area starts at, as a place in `books`. */
  at: number | null
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onPick: (at: number) => void
  onAdd: () => void
}

const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']
const clothFor = (id: number): Cloth => CLOTHS[Math.abs(id) % CLOTHS.length]!

export function AddAreaPane({
  piece, area, books, coming, at, busy, error, tabs, onBack, onPick, onAdd,
}: Props) {
  /*
   * Whether there is anything to decide. A run with books in it has to say
   * where it is cut; a run with none is added and that is the whole of it. The
   * question is asked of the books rather than of the piece, because it is the
   * run being cut that either divides or does not: a bookcase can be full and
   * the area at the end of it still empty.
   */
  const deciding = area !== null && (coming || books.length > 0)

  const top = (
    <TopBar
      title="Add an area"
      /* Nothing with nothing in it is being split, and a line saying "splitting
         5A" over a sentence saying 5A has nothing on it to divide is the screen
         disagreeing with itself. */
      sub={deciding && area ? `Splitting ${area.label}` : piece ? `To ${pieceSaid(piece)}` : undefined}
      onBack={onBack}
    />
  )

  if (!piece) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  const keeping = at ?? books.length
  const taking = books.length - keeping

  /*
   * The face as it will read, with the new area standing in it.
   *
   * Not the new one's own label bolted onto the end of the list as it is: it
   * lands directly after the area being cut, so **every area behind it reads
   * differently**, and a screen that drew the new one as `4C, new` under an
   * area still called `4C` would be showing two of them. The labels are worked
   * out from the positions they will have, by the function the server will use.
   */
  const landing = area ? area.position + 1 : 0
  const face = [
    ...piece.areas.map((one) => ({
      key: String(one.id),
      name: one.name,
      books: one.id === area?.id ? keeping : one.books,
      holds: one.holds,
      // Marked as the one being worked on only while it is: an area with
      // nothing in it is not divided by this, it is merely the one the new
      // area lands after.
      on: one.id === area?.id && deciding,
      fresh: false,
    })),
  ]
  /*
   * What the new area will hold, which is whatever reaches the place it lands
   * in: the run carrying on past the area being cut, the piece's own rule where
   * this is the first area on it, and otherwise nothing, because a crate
   * nothing files onto is filled by hand and cutting it in two does not change
   * that.
   */
  const arriving = area?.rule
    ? `${area.rule.name}, carrying on`
    : piece.rule
      ? `${piece.rule.name} starts here`
      : 'Put here by hand'

  face.splice(landing, 0, {
    key: 'new',
    name: '',
    books: taking,
    holds: arriving,
    on: true,
    fresh: true,
  })
  const reading = labelsIfNamed(
    piece,
    face.map((one, position) => ({ position, name: one.name })),
    { name: piece.name, position: piece.position },
  )

  return (
    <RoomFrame top={top} tabs={tabs}>
      <Trouble said={error} />

      <Instruction>
        {deciding
          ? 'Where does the new area start?'
          : area
            ? `Nothing stands on ${area.label} yet, so there is nothing to divide `
              + 'and the new area goes after it.'
            : `Nothing has been cut into ${pieceSaid(piece)} yet, so the first area takes all of it.`}
      </Instruction>

      <Nest name={pieceSaid(piece)} note={pieceNote(piece)} holds={piece.holds}>
        {face.map((one, position) => (
          <AreaBox
            key={one.key}
            reads={one.fresh ? `${reading[position]}, new` : reading[position]!}
            books={one.books}
            holds={one.holds}
            on={one.on}
          />
        ))}
      </Nest>

      {books.length > 0 && (
        <>
          <p className="wf-heading wf-heading--flush">Books on {area?.label}</p>
          <List label={`Books on ${area?.label}`}>
            {books.map((book, index) => (
              <Row
                key={book.id}
                title={book.title}
                sub={book.authorFiling}
                cloth={clothFor(book.id)}
                meta={index === at ? 'Starts here' : undefined}
                onward={false}
                onPress={() => onPick(index)}
              />
            ))}
          </List>
        </>
      )}

      <Card
        weight="sunk"
        kind="What it does"
        title={!area
          ? `${pieceSaid(piece)} gets its first area`
          : !deciding
            /* Said as what happens rather than as what does not: an area is
               added, and the reason there is nothing to choose is that there
               are no books here to put on either side of the choice. */
            ? `${pieceSaid(piece)} gets another area, and no book moves`
            : at === null
              ? 'Nothing is cut until you say which book the new area starts at'
              : `${area.label} keeps ${plural(keeping, 'book')}, `
                + `the new one takes ${plural(taking, 'book')}`}
      >
        {/*
          The counts above are where the books belong once the boundary is
          there. The count on the new area will read nought until somebody has
          been to the shelf, because a count is where a person last said the
          books were and cutting an area is not somebody saying it. Left
          unsaid, the new area reading "0 books" a second after this screen
          promised it two looks like the split not having worked.
        */}
        {area && at !== null && (
          <p>
            Nothing moves and nothing is carried. The app will ask you to confirm
            each one where it stands, so until then they are still counted on{' '}
            {area.label}.
          </p>
        )}
      </Card>

      {/*
        Held back only while there is a decision outstanding, and **drawn as
        held back**.

        It used to be held back whenever there was an area being cut, which on a
        run with no books in it was a button that could never be pressed. It was
        also held back by handing it no action while it went on looking exactly
        like a button, which is what "clicking the add the area button doesn't
        work" describes from the outside: a live-looking button that answers a
        press with nothing (#367). `off` is the honest drawing of it, and the
        card above says in words why, which is the condition that prop carries.
      */}
      <Button
        tone="primary"
        block
        off={busy || (deciding && at === null)}
        onPress={busy || (deciding && at === null) ? undefined : onAdd}
      >
        {busy ? 'Adding' : 'Add the area'}
      </Button>
      <Button tone="quiet" block onPress={onBack}>
        {deciding ? 'Leave it as one area' : 'Leave it as it is'}
      </Button>
    </RoomFrame>
  )
}
