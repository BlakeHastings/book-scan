interface Props {
  title: string
  body: string
  confirmLabel: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * A stop before something irreversible.
 *
 * Deleting takes the record and its photos off disk, and the photos cannot be
 * retaken from the shelf once the book has been reshelved. Cancel is the
 * default action here: it is on the right, and the destructive button is
 * styled as such rather than as the primary one.
 */
export function ConfirmDialog({
  title, body, confirmLabel, busy = false, onCancel, onConfirm,
}: Props) {
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel() }}
    >
      <div className="modal__card">
        <h3 className="modal__title">{title}</h3>
        <p className="hint">{body}</p>

        <div className="actions">
          <button className="btn btn--danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting...' : confirmLabel}
          </button>
          <button className="btn" onClick={onCancel} disabled={busy} autoFocus>
            Keep it
          </button>
        </div>
      </div>
    </div>
  )
}
