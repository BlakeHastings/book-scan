import type { Draft, LookupResponse } from '../lib/api'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  derivedFiling: string
  onChange: (patch: Partial<Draft>) => void
  onSave: () => void
  onDiscard: () => void
  saving: boolean
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'confident',
  medium: 'probable',
  weak: 'weak guess',
  unknown: 'unknown, please set',
}

export function ReviewPane({
  draft, lookup, derivedFiling, onChange, onSave, onDiscard, saving,
}: Props) {
  const field = (key: keyof Draft, label: string, type = 'text') => (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={String(draft[key] ?? '')}
        onChange={(event) => onChange({ [key]: event.target.value } as Partial<Draft>)}
      />
    </label>
  )

  const confidence = draft.classificationConfidence
  const needsAttention = confidence === 'unknown' || confidence === 'weak'

  return (
    <div className="review">
      {/* Fiction is first and largest: S4 is the only non-fiction shelf, so
          getting this wrong sends the book to a different bookcase. */}
      <div className={`classify ${needsAttention ? 'classify--attention' : ''}`}>
        <div className="classify__row">
          <button
            type="button"
            className={draft.isFiction ? 'seg seg--on' : 'seg'}
            onClick={() => onChange({ isFiction: true, classificationSource: 'manual' })}
          >
            Fiction
          </button>
          <button
            type="button"
            className={!draft.isFiction ? 'seg seg--on' : 'seg'}
            onClick={() => onChange({ isFiction: false, classificationSource: 'manual' })}
          >
            Non-fiction (S4)
          </button>
        </div>
        <div className="classify__why">
          {draft.classificationSource === 'manual'
            ? 'Set by you'
            : `${CONFIDENCE_LABEL[confidence] ?? confidence}: ${lookup?.classification.reason ?? ''}`}
        </div>
      </div>

      {lookup?.duplicateOf && (
        <div className="warn">
          Already catalogued as #{lookup.duplicateOf.id} ({lookup.duplicateOf.title})
          {lookup.duplicateOf.location ? ` at ${lookup.duplicateOf.location}` : ''}.
          Saving adds a second copy.
        </div>
      )}

      {lookup?.notes.map((note) => (
        <div className="warn warn--soft" key={note}>{note}</div>
      ))}

      {field('title', 'Title')}
      {field('subtitle', 'Subtitle')}
      {field('authors', 'Authors (comma separated)')}

      <label className="field">
        <span>
          Files under
          {draft.authorFilingOverride ? ' (overridden)' : ''}
        </span>
        <input
          type="text"
          placeholder={derivedFiling}
          value={draft.authorFilingOverride}
          onChange={(event) => onChange({ authorFilingOverride: event.target.value })}
        />
      </label>
      <p className="hint">
        Derived: <code>{derivedFiling || '...'}</code>. Override for compound
        surnames such as Garcia Marquez, or to shelve a pseudonym with its real
        name.
      </p>

      <div className="row">
        {field('seriesName', 'Series')}
        {field('seriesIndex', 'Number', 'text')}
      </div>

      <div className="row">
        {field('isbn13', 'ISBN-13')}
        {field('pages', 'Pages')}
      </div>

      <div className="row">
        {field('publisher', 'Publisher')}
        {field('published', 'Published')}
      </div>

      {field('location', 'Shelved at')}
      <p className="hint">
        Pre-filled from the suggestion. Change it to wherever the book actually
        went if that shelf was full.
      </p>

      {field('notes', 'Notes')}

      <div className="actions">
        <button className="btn btn--primary" onClick={onSave} disabled={saving || !draft.title}>
          {saving ? 'Saving...' : 'Looks right, shelve it'}
        </button>
        <button className="btn" onClick={onDiscard} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}
