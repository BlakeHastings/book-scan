import { shelfPhoto, type Neighbour } from '../../shared/shelving'
import type { PlacementResponse } from '../lib/api'
import { Instruction, Nothing, Said } from '../design/Card'
import { List, Row } from '../design/List'

/** Photos are served by the API, not bundled, so they need the /api prefix. */
export function coverUrl(filename: string): string {
  return filename ? `/api/covers/${encodeURIComponent(filename)}` : ''
}

/**
 * The same photo, resized by the server before it is sent.
 *
 * For a screen that is nothing but pictures. One book at full size is fine;
 * a grid of a hundred is tens of megabytes of image to draw thumbnails with,
 * and on a phone that is somebody's data allowance. The server only answers a
 * short list of widths, so this must ask for one of them.
 */
export function coverThumbUrl(filename: string, width: 160 | 320 | 640): string {
  return filename ? `${coverUrl(filename)}?w=${width}` : ''
}

/**
 * One book this one goes beside, drawn as the list rows every other set of
 * books in the app is drawn as.
 *
 * The label is the whole point of the row and so it goes where a row's second
 * line goes, in front of the name: "After · Miéville, China" is which side and
 * who, in the order somebody standing at a shelf wants them. The place stays on
 * the right, in the column a plank label lines up in.
 */
function NeighbourRow({
  label, neighbour, emptyText,
}: {
  label: string
  neighbour: Neighbour | null
  emptyText: string
}) {
  if (!neighbour) {
    return <Row title={emptyText} sub={label} onward={false} />
  }

  return (
    <Row
      title={neighbour.title}
      sub={`${label} · ${neighbour.authorFiling}`}
      photo={coverUrl(shelfPhoto(neighbour))}
      place={neighbour.location || 'no location'}
    />
  )
}

/**
 * Where a book goes, said in words, for a placement that arrived with no run
 * of books in it.
 *
 * **The drawing is the answer and this is what is left when there is no
 * drawing.** `PlacementView` reaches for it when a placement has no strip,
 * which is an empty range or a server older than the strip, and it is the only
 * way in: everywhere else the shelf itself is drawn with the gap in it, which
 * is what the owner asked for twice.
 *
 * So it says the same three things the drawn one does, in the design system's
 * own parts rather than in a card of its own: the sentence a person reads
 * walking to the shelf, and the two books either side with the one being placed
 * between them. Nothing here is a second arrangement of a book: they are `Row`,
 * which is what the library, the queue and the carry list are made of.
 */
export function PlacementCard({
  placement,
  pending,
  saved,
}: {
  placement: PlacementResponse | null
  pending: boolean
  saved: boolean
}) {
  if (!placement) {
    return <Nothing said="Placement appears once there is a title and author." />
  }

  const { predecessor, successor } = placement
  const range = placement.range === 'fiction' ? 'Fiction' : 'Non-fiction'

  return (
    <div className={pending ? 'placement--stale' : ''}>
      <Instruction>{placement.instruction}</Instruction>
      <Said>{saved ? `${range} · saved` : range}</Said>

      {(predecessor || successor) && (
        <List label={`Where ${placement.authorFiling || 'this book'} goes`}>
          <NeighbourRow
            label="After"
            neighbour={predecessor}
            emptyText="nothing, this is the start"
          />

          <Row
            title={placement.authorFiling || 'this book'}
            sub="This one"
            onward={false}
          />

          <NeighbourRow
            label="Before"
            neighbour={successor}
            emptyText="nothing, this is the end"
          />
        </List>
      )}
    </div>
  )
}
