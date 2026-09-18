import { shelfPhoto, type Neighbour } from '../../shared/shelving'
import type { PlacementResponse } from '../lib/api'
import { Instruction, Nothing, Said } from '../design/Card'
import { List, Row } from '../design/List'

/** Photos are served by the API, not bundled, so they need the /api prefix. */
export function coverUrl(filename: string): string {
  return filename ? `/api/covers/${encodeURIComponent(filename)}` : ''
}

/** The server only answers a fixed list of widths, which is why this only accepts one of them. */
export function coverThumbUrl(filename: string, width: 160 | 320 | 640): string {
  return filename ? `${coverUrl(filename)}?w=${width}` : ''
}

/** The label goes in front of the name, in a row's second line ("After · Miéville, China"), which is the order somebody standing at a shelf wants them; place stays on the right, in the column a plank label lines up in. */
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
 * The fallback for a placement with no strip (an empty range, or a server too
 * old to send one); everywhere else the shelf itself is drawn with the gap in
 * it. Built from `Row`, the same component the library, queue and carry list
 * use, so this is not a second way of drawing a book.
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
