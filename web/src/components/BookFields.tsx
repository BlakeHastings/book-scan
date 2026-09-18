/** Built out of the same `Field`, `Card` and `Tag` as `CaptureReview`, so the two screens cannot drift into two forms. */

import { Card, Said } from '../design/Card'
import { Field } from '../design/Controls'
import { AddTag, Tag, Tags } from '../design/List'
import type { AppliedTag, Draft, LookupResponse } from '../lib/api'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'

/** The two the buttons above the row answer, which the row never repeats. */
const GENRE_ANSWERS: string[] = [FICTION_SLUG, NON_FICTION_SLUG]

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  derivedFiling: string
  onChange: (patch: Partial<Draft>) => void
  /** Genre is part of the draft the whole form saves; these tags are written the moment they are said, through `onAddTag`/`onRemoveTag`. */
  tags?: AppliedTag[]
  taggingBusy?: boolean
  taggingError?: string
  /** Open the panel a tag is named in. Absent where there is nowhere to write one. */
  onAddTag?: () => void
  onRemoveTag?: (slug: string) => void
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'confident',
  medium: 'probable',
  weak: 'weak guess',
  unknown: 'unknown, please set',
}

export function BookFields({
  draft, lookup, derivedFiling, onChange,
  tags = [], taggingBusy = false, taggingError = '', onAddTag, onRemoveTag,
}: Props) {
  const confidence = draft.classificationConfidence

  // A book loaded from the catalogue carries no lookup, so there is no
  // reasoning to quote; without `lookup.classification.reason`, a bare
  // confidence label would say nothing useful.
  const why = draft.classificationSource === 'manual'
    ? 'Set by you'
    : lookup?.classification.reason
      ? `${CONFIDENCE_LABEL[confidence] ?? confidence}: ${lookup.classification.reason}`
      : ''

  return (
    <>
      {/* Quiet rather than loud: this is a thing to know, not a refusal, since saving a genuine second copy is allowed. */}
      {lookup?.duplicateOf && (
        <Card
          weight="quiet"
          kind="Saving adds a second copy"
          title={
            `Already catalogued as #${lookup.duplicateOf.id} (${lookup.duplicateOf.title})`
            + `${lookup.duplicateOf.location ? ` at ${lookup.duplicateOf.location}` : ''}.`
          }
        />
      )}

      {lookup?.notes.map((note) => (
        <Said key={note}>{note}</Said>
      ))}

      {/* Setting `classificationSource: 'manual'` on press is what protects this answer from being overwritten by an automatic reclassification later. */}
      <div>
        <span className="wf-field__label">Tags</span>
        <div style={{ height: 6 }} />
        <Tags>
          <Tag
            tone={draft.genre === FICTION_SLUG ? 'on' : undefined}
            onPress={() => onChange({ genre: FICTION_SLUG, classificationSource: 'manual' })}
          >
            Fiction
          </Tag>
          <Tag
            tone={draft.genre === NON_FICTION_SLUG ? 'on' : undefined}
            onPress={() => onChange({ genre: NON_FICTION_SLUG, classificationSource: 'manual' })}
          >
            Non-fiction
          </Tag>

          {/* Filters out the two genre slugs: a book whose genre is set already carries that tag, so without this the row would read "Fiction  Non-fiction  Fiction". */}
          {tags.filter((tag) => !GENRE_ANSWERS.includes(tag.slug)).map((tag) => (
            <Tag
              key={tag.slug}
              tone="on"
              onPress={taggingBusy ? undefined : () => onRemoveTag?.(tag.slug)}
            >
              {tag.label}
            </Tag>
          ))}
          {onAddTag && <AddTag onPress={onAddTag}>Add a tag</AddTag>}
        </Tags>
        {why && <Said>{why}</Said>}
        {taggingError && <Said>{taggingError}</Said>}
      </div>

      <Field
        label="Title"
        value={draft.title}
        placeholder="Off the title page"
        onChange={(title) => onChange({ title })}
      />
      <Field
        label="Author"
        value={draft.authors}
        placeholder="Separate two names with a comma"
        onChange={(authors) => onChange({ authors })}
      />
      <Field
        label="Files under"
        value={draft.authorFilingOverride}
        placeholder={derivedFiling || 'Worked out from the author'}
        onChange={(authorFilingOverride) => onChange({ authorFilingOverride })}
      />
      <Said>
        Where it sits on the bookcase. Override it for a compound surname such
        as Garcia Marquez, or to file a pen name with the real one.
      </Said>

      <Field
        label="Series"
        value={draft.seriesName}
        placeholder="Not in a series"
        onChange={(seriesName) => onChange({ seriesName })}
      />
      <Field
        label="Number in the series"
        value={draft.seriesIndex}
        inputMode="numeric"
        onChange={(seriesIndex) => onChange({ seriesIndex })}
      />

      {/* Kept out of the card below: unlike those fields, a catalogue never has an opinion about a note somebody left on their own copy. */}
      <Field
        label="Notes"
        value={draft.notes}
        onChange={(notes) => onChange({ notes })}
      />

      <Card title="The rest of it" weight="sunk">
        <Field
          label="Subtitle"
          value={draft.subtitle}
          onChange={(subtitle) => onChange({ subtitle })}
        />
        <Field
          label="Publisher"
          value={draft.publisher}
          onChange={(publisher) => onChange({ publisher })}
        />
        <Field
          label="Published"
          value={draft.published}
          onChange={(published) => onChange({ published })}
        />
        <Field
          label="Pages"
          value={draft.pages}
          inputMode="numeric"
          onChange={(pages) => onChange({ pages })}
        />
      </Card>
    </>
  )
}
