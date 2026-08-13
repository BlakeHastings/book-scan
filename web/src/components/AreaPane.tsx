/**
 * One area, and what you can change about it.
 *
 * **It does not draw the piece it sits on.** The whole of the bookcase used to
 * stand at the top of this, above everything the screen is for. The owner:
 * "when we're in the area view we don't need to show the bookcase any more. You
 * see Bookcase 2 and that's taking up so much of the screen." Which piece it is
 * on is not lost and never needed a drawing: the top bar says it in four words
 * and the arrow beside them goes there.
 *
 * ## Removing an area is a merge, and the dialog must not say otherwise
 *
 * The books stay on the piece they are on. What changes is which area the rules
 * say they are in, and therefore what label they will be looked for under. The
 * drawn dialog ended "2B holds 42 books afterwards", and that number is one
 * this app cannot honestly print: **a count on an area is where somebody last
 * said the books were**, and only `PATCH /api/books/:id/location` changes that.
 * Removing an area writes assignments, which is what the rules want, and the
 * difference between the two is the needs-attention list that already exists.
 *
 * So the sentence says what is written and who has to confirm it, and the
 * number in it is `joining`, which is the count the server actually answers
 * with: how many books get refiled, pinned ones excluded and said out loud.
 *
 * ## `pinned` is never a silent subtraction
 *
 * Where the plan leaves books alone it says how many and why, on the screen,
 * under the sentence. A dialog that said "18 books join 2B" having quietly left
 * three pinned ones out of the eighteen would be lying by omission at the one
 * moment somebody is deciding about their own books.
 */

import type { ReactElement } from 'react'
import { Card } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { Sure } from '../design/Sure'
import type { AreaDto, AreaRemovalPlan, FixtureDto } from '../lib/api'
import { orderedSaid, pieceSaid, plural, skippedSaid } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

/** What being asked to remove this area looks like, once the server has answered. */
export type Asking =
  | { kind: 'merge'; plan: AreaRemovalPlan }
  /** The only area on its piece: there is nowhere on it for the books to go. */
  | { kind: 'only'; said: string }

interface Props {
  piece: FixtureDto | null
  area: AreaDto | null
  /** What they have typed into the name, which is not saved until they say so. */
  name: string
  asking: Asking | null
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onName: (name: string) => void
  onSaveName: () => void
  onBelongs: () => void
  onSorting: () => void
  onSplit: () => void
  onAsk: () => void
  onKeep: () => void
  onRemove: () => void
  /** The way out of the last state: the piece itself is what has to go. */
  onPiece: () => void
}

export function AreaPane({
  piece, area, name, asking, busy, error, tabs,
  onBack, onName, onSaveName, onBelongs, onSorting, onSplit, onAsk, onKeep, onRemove, onPiece,
}: Props) {
  const top = (
    <TopBar
      title={area ? area.label : 'An area'}
      sub={area && piece ? `${plural(area.books, 'book')}, on ${pieceSaid(piece)}` : undefined}
      onBack={onBack}
    />
  )

  if (!piece || !area) {
    return (
      <RoomFrame top={top} tabs={tabs}>
        <Trouble said={error} />
      </RoomFrame>
    )
  }

  const from = pieceSaid(piece)

  return (
    <RoomFrame top={top} tabs={tabs} over={asked(asking, area, piece, onRemove, onKeep, onPiece)}>
      <Trouble said={error} />

      <Field
        label="What you call this area"
        placeholder="Not named"
        value={name}
        onChange={onName}
      />
      {/*
        Not in the drawing, which has a name field on a screen with no Save on
        it. Saving on every keystroke would relabel an area four times while
        somebody types "Cookery", and saving silently when the field loses
        focus is a write nobody asked for. So the way to keep it appears when
        there is something to keep, and it is not the screen's primary: what
        this screen is for is splitting the area, not naming it.
      */}
      {name.trim() !== area.name && (
        <Button tone="secondary" block onPress={busy ? undefined : onSaveName}>
          {busy ? 'Saving' : `Call it ${name.trim() || 'nothing'}`}
        </Button>
      )}

      <Card
        kind="What belongs here"
        title={area.holds}
        foot={
          <Button tone="secondary" block onPress={onBelongs}>
            {area.rule ? 'See what belongs here' : 'See what could belong here'}
          </Button>
        }
      />

      <Card
        kind="How it is ordered"
        title={orderedSaid(area, from)}
        foot={
          <Button tone="secondary" block onPress={onSorting}>
            Change the order
          </Button>
        }
      >
        {area.selfContained
          ? <p>It orders itself, so nothing overflows into it from the area before.</p>
          : <p>It takes what overflows from the area before it.</p>}
      </Card>

      <Button tone="primary" block onPress={onSplit}>
        Split this area in two
      </Button>

      {/* The fence. A screen should not let the irreversible thing sit
          shoulder to shoulder with the thing the screen is for, and there is
          no sentence over it: this one has a dialog, and a dialog is a better
          place to say it than a caption nobody read on the way past. */}
      <Card
        weight="quiet"
        foot={
          <Button tone="danger" block onPress={busy ? undefined : onAsk}>
            Remove this area
          </Button>
        }
      />
    </RoomFrame>
  )
}

/**
 * The dialog, in whichever of its states applies.
 *
 * Two of the three states the gallery drew are one call to the server: which
 * area takes the books in and whether it is the one before or the one after is
 * `joins`, and the shuffle of labels behind it is `becomes`, drawn rather than
 * described. The third state is the refusal, and it lands on the piece,
 * because the only way out of it is the piece itself going.
 */
function asked(
  asking: Asking | null,
  area: AreaDto,
  piece: FixtureDto,
  onRemove: () => void,
  onKeep: () => void,
  onPiece: () => void,
): ReactElement | undefined {
  if (!asking) return undefined

  if (asking.kind === 'only') {
    const from = pieceSaid(piece).toLowerCase()
    return (
      <Sure
        title={area.books === 0
          ? `The ${from} has no other area for books to go in`
          : `Its ${plural(area.books, 'book')} have nowhere else on the ${from}`}
        said={
          <>
            Every book sits in an area, and this is the only one the {from} has, so
            there is nothing here for them to join. Deleting the {from} moves them to
            other furniture instead, and shows you where every one goes first.
          </>
        }
        act={`Take the ${from} out of the room`}
        onAct={onPiece}
        onKeep={onKeep}
      />
    )
  }

  const { plan } = asking
  return (
    <Sure
      title={plan.area.books === 0
        ? `No books stand in ${plan.area.label}`
        : `Its ${plural(plan.area.books, 'book')} join ${plan.into.label}`}
      said={
        <>
          {plan.joins === 'next'
            ? `Nothing comes before it, so its books join the area after it rather than the one before, and every area behind that comes forward. `
            : `They stay on ${pieceSaid(piece)} where they are, and nothing is carried. `}
          {plan.joining > 0
            ? `${plural(plan.joining, 'book')} will be filed under ${plan.into.label} from now `
              + 'on, and the app will ask you to confirm each one where it stands, because '
              + 'only somebody standing in front of them can say a book has moved.'
            : 'No book has to be refiled.'}
          {plan.skipped.map((one) => ` ${skippedSaid(one.reason, one.books)}.`)}
        </>
      }
      becomes={plan.becomes}
      act="Remove the area"
      onAct={onRemove}
      onKeep={onKeep}
    />
  )
}
