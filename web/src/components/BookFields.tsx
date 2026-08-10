import type { Draft, LookupResponse } from '../lib/api'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  derivedFiling: string
  onChange: (patch: Partial<Draft>) => void
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'confident',
  medium: 'probable',
  weak: 'weak guess',
  unknown: 'unknown, please set',
}

/**
 * The editable fields, in the order they are worth your attention.
 *
 * Fiction, title and author come first: they are what a lookup gets wrong and
 * what decides where the book ends up. Publisher, page count and the rest are
 * filled in from the catalogue and almost never touched, so they sit at the
 * bottom where they cost nothing to scroll past.
 */
export function BookFields({ draft, lookup, derivedFiling, onChange }: Props) {
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

      {/* Fiction is first and largest: non-fiction lives in a different
          bookcase, so getting this wrong sends the book across the room. */}
      <div className={`classify ${needsAttention ? 'classify--attention' : ''}`}>
        <div className="classify__row">
          <button
            type="button"
            className={draft.genre === FICTION_SLUG ? 'seg seg--on' : 'seg'}
            onClick={() => onChange({ genre: FICTION_SLUG, classificationSource: 'manual' })}
          >
            Fiction
          </button>
          <button
            type="button"
            className={draft.genre === NON_FICTION_SLUG ? 'seg seg--on' : 'seg'}
            onClick={() => onChange({ genre: NON_FICTION_SLUG, classificationSource: 'manual' })}
          >
            Non-fiction
          </button>
        </div>
        {/* A book loaded from the catalogue has no lookup attached, so there
            is no reasoning to quote and a bare "probable:" says nothing. */}
        {(draft.classificationSource === 'manual' || lookup?.classification.reason) && (
          <div className="classify__why">
            {draft.classificationSource === 'manual'
              ? 'Set by you'
              : `${CONFIDENCE_LABEL[confidence] ?? confidence}: ${lookup?.classification.reason}`}
          </div>
        )}
      </div>

      {field('title', 'Title')}
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

      {field('notes', 'Notes')}

      {/* Everything below arrives from the catalogue and is rarely wrong. */}
      <details className="more">
        <summary>Publication details</summary>

        {field('subtitle', 'Subtitle')}

        <div className="row">
          {field('seriesName', 'Series')}
          {field('seriesIndex', 'Number')}
        </div>

        <div className="row">
          {field('publisher', 'Publisher')}
          {field('published', 'Published')}
        </div>

        {field('pages', 'Pages')}
      </details>
    </div>
  )
}
