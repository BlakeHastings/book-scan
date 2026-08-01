import type { PlacementResponse } from '../lib/api'

/**
 * The instruction the user reads while standing at the shelf with a book in
 * hand. It is deliberately the largest thing on screen, names both neighbours
 * by author as well as title (you scan spines for an author block first), and
 * stays put after saving so it survives the walk to the shelf.
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
          <div className="neighbour">
            <span className="neighbour__label">After</span>
            {predecessor ? (
              <>
                <span className="neighbour__title">{predecessor.title}</span>
                <span className="neighbour__author">{predecessor.authorFiling}</span>
                <span className="neighbour__loc">{predecessor.location || 'no location'}</span>
              </>
            ) : (
              <span className="neighbour__none">nothing, this is the start</span>
            )}
          </div>

          <div className="neighbour neighbour--target">
            <span className="neighbour__label">This book</span>
            <span className="neighbour__title">{placement.authorFiling || '...'}</span>
          </div>

          <div className="neighbour">
            <span className="neighbour__label">Before</span>
            {successor ? (
              <>
                <span className="neighbour__title">{successor.title}</span>
                <span className="neighbour__author">{successor.authorFiling}</span>
                <span className="neighbour__loc">{successor.location || 'no location'}</span>
              </>
            ) : (
              <span className="neighbour__none">nothing, this is the end</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
