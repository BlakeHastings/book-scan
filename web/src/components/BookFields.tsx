/**
 * The editable fields of one book, drawn with the design system.
 *
 * ## It is the review screen's form, on the screen that corrects a record
 *
 * The gallery draws `review` ("Check the details") and draws no screen at all
 * for editing a book the catalogue already holds. The two are the same act on
 * two kinds of book, so this wears what that drawing wears rather than
 * inventing a second form: the ISBN above it, then the title, the author, what
 * it files under, the series, the tags, and everything that arrives from a
 * catalogue in a sunk card at the bottom. `CaptureReview` builds that shape out
 * of the same `Field`, `Card` and `Tag` this does, so the two screens cannot
 * drift into two forms.
 *
 * **The names are the drawing's names.** "Authors (comma separated)" said in a
 * label what the placeholder says better, and the drawing calls it "Author";
 * the browser journeys that typed into the old name were changed with it, in
 * the same pull request, because a label is the thing a test holds on to.
 *
 * ## The order is the order they are worth your attention
 *
 * Which is unchanged: fiction and non-fiction first, because they decide which
 * bookcase the book crosses the room to, then what a lookup most often gets
 * wrong. Publisher, year and length arrive from the catalogue and are almost
 * never touched, so they are last, in a card of their own.
 *
 * The one thing that moved is the page count and its friends: they were behind
 * a `<details>` somebody had to open. A sunk card says the same "this is the
 * rest of it" without hiding a field from anybody looking for one.
 */

import { Card, Said } from '../design/Card'
import { Field } from '../design/Controls'
import { AddTag, Tag, Tags } from '../design/List'
import type { AppliedTag, Draft, LookupResponse } from '../lib/api'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  derivedFiling: string
  onChange: (patch: Partial<Draft>) => void
  /**
   * What a person has said this book is, beyond which of the two genres it is.
   *
   * Absent until #433, which is the defect: the two genre answers are a draft
   * the save writes, and everything else somebody might say about a book is a
   * set written the moment it is said. This form had the first and not the
   * second, so a book already on a shelf could not be told what it was.
   */
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

  /*
   * Where the answer above came from, and how much to trust it.
   *
   * A book loaded out of the catalogue carries no lookup, so there is no
   * reasoning to quote and a bare "probable:" says nothing. That condition is
   * the one the old markup had and it is kept exactly.
   */
  const why = draft.classificationSource === 'manual'
    ? 'Set by you'
    : lookup?.classification.reason
      ? `${CONFIDENCE_LABEL[confidence] ?? confidence}: ${lookup.classification.reason}`
      : ''

  return (
    <>
      {/*
        A book the catalogue already holds, which is news somebody has to read
        before they save. It is a card with the news in its title, which is
        where `Card` says news belongs, and it is quiet rather than loud: this
        is a thing to know rather than a refusal, and saving a second copy of a
        book somebody genuinely owns twice is allowed.
      */}
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

      {/* What the catalogue said it could not answer for. Quiet lines, because
          each of them is a fact about the lookup rather than a thing to do. */}
      {lookup?.notes.map((note) => (
        <Said key={note}>{note}</Said>
      ))}

      {/*
        Fiction and non-fiction, drawn as the two tags they are, which is what
        the review screen draws and what a person reading this sees. They are
        one question with two answers and at most one holds; pressing one says
        a person decided it, which is what keeps it safe from an automatic
        rewrite.
      */}
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

          {/* Everything else somebody has said this book is, in the same
              wrapping row as the two genre answers, because a person reading
              this sees tags. Where they came from is a distinction the model
              needs and the screen does not, and the review screen draws the
              same row the same way. Lit, because every one of these is on the
              book right now and pressing one takes it off again. */}
          {tags.map((tag) => (
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

      {/* Kept out of the card below, because it is the one line here nothing
          else wrote: a catalogue never has an opinion about where somebody
          left their own copy. */}
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
