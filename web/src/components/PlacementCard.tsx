import { shelfPhoto, shelfPhotoSlot, type Neighbour } from '../../shared/shelving'
import type { PlacementResponse } from '../lib/api'

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

function NeighbourRow({
  label, neighbour, emptyText,
}: {
  label: string
  neighbour: Neighbour | null
  emptyText: string
}) {
  const photo = coverUrl(shelfPhoto(neighbour))
  const slot = shelfPhotoSlot(neighbour)

  return (
    <div className="neighbour">
      <span className="neighbour__label">{label}</span>
      {neighbour ? (
        <>
          <span className="neighbour__photo">
            {photo
              ? <img
                  className={`thumb thumb--${slot}`}
                  src={photo}
                  alt={`${neighbour.title}`}
                  loading="lazy"
                />
              : <span className="neighbour__nophoto">no photo</span>}
          </span>
          <span className="neighbour__text">
            <span className="neighbour__title">{neighbour.title}</span>
            <span className="neighbour__author">{neighbour.authorFiling}</span>
          </span>
          <span className="neighbour__loc">{neighbour.location || 'no location'}</span>
        </>
      ) : (
        <span className="neighbour__none">{emptyText}</span>
      )}
    </div>
  )
}

/**
 * The instruction the user reads while standing at the shelf with a book in
 * hand. It is deliberately the largest thing on screen, names both neighbours
 * by author as well as title, and shows each neighbour's spine so they can be
 * found by eye rather than by reading every label on the shelf.
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
    return (
      <div className="placement placement--empty">
        <p>Placement appears once there is a title and author.</p>
      </div>
    )
  }

  const { predecessor, successor } = placement

  return (
    <div className={`placement ${saved ? 'placement--saved' : ''} ${pending ? 'placement--stale' : ''}`}>
      <div className="placement__range">
        {placement.range === 'fiction' ? 'Fiction' : 'Non-fiction'}
        {saved ? ' · saved' : ''}
      </div>

      <div className="placement__instruction">{placement.instruction}</div>

      {(predecessor || successor) && (
        <div className="placement__neighbours">
          <NeighbourRow
            label="After"
            neighbour={predecessor}
            emptyText="nothing, this is the start"
          />

          <div className="neighbour neighbour--target">
            <span className="neighbour__label">This one</span>
            <span className="neighbour__text">
              <span className="neighbour__title">
                {placement.authorFiling || 'this book'}
              </span>
            </span>
          </div>

          <NeighbourRow
            label="Before"
            neighbour={successor}
            emptyText="nothing, this is the end"
          />
        </div>
      )}
    </div>
  )
}
