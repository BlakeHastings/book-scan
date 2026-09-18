import { useState } from 'react'
import { Card, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { IconCamera } from '../design/Icons'
import { AddTag, Tag, Tags } from '../design/List'
import { Phone } from '../design/Phone'
import { Shots, threeSlots, type Shot } from '../design/Shots'
import { IsbnPrompt } from './IsbnPrompt'
import { Trouble } from './RoomFrame'
import { TagNaming } from './TagNaming'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import type { AppliedTag, CataloguedBook, Draft, LookupResponse, TagRow } from '../lib/api'
import { SLOT_SHORT, type Slot } from '../lib/scanner'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  /**
   * Two different questions: whether some catalogue can name an ISBN, and
   * whether this collection already holds it. Read from the catalogue
   * rather than from `lookup`, so a book no source can name is still
   * warned about.
   */
  catalogued: CataloguedBook | null
  photos: Partial<Record<Slot, string>>
  derivedFiling: string
  saving: boolean
  relookupBusy: boolean
  relookupError: string
  /**
   * Drawn beside the photograph somebody took so the two can be compared,
   * since that is the one part of a lookup a person can confirm at a
   * glance. Empty means not drawn at all, rather than drawn as a gap.
   */
  catalogueCover: string
  /** What the photographs produced, quoted rather than filled in (#147). */
  coverText: string
  captureNote: string
  /** What the last thing that happened actually did, in its own words. */
  notice: string
  error: string
  onDismissError: () => void
  onChange: (patch: Partial<Draft>) => void
  onRelookup: (isbn: string) => void
  onClearRelookupError: () => void
  /** Point the camera at one of the three again. */
  onRetake: (slot: Slot) => void
  /** On to the shelving step. */
  onShelve: () => void
  /** Put it down and go back where it came from. */
  onLeave: () => void
  tabs: Record<TabName, () => void>

  /**
   * Only a person's tags: a book from Open Library can carry up to twelve
   * subject headings, and drawing all of those would bury the few someone
   * actually chose.
   */
  tags: AppliedTag[]
  /** Every tag the collection keeps, which is what is offered before anything new. */
  vocabulary: TagRow[]
  /** A tag being written or taken off right now. */
  taggingBusy: boolean
  taggingError: string
  onAddTag: (tag: { slug: string; label: string }) => void
  onRemoveTag: (slug: string) => void
  /**
   * A capture becomes a row in `books` from its first photograph, so this is
   * almost always true; false only for a book drawn before its capture has
   * come back, where offering to tag it would be a target that answers 404.
   */
  canTag: boolean
}

/**
 * A barcode is self-validating, a printed number read by a machine is a
 * guess, and digits somebody typed are a person's word: three different
 * amounts of trust, so the screen says which.
 */
const READ_FROM: Record<string, string> = {
  barcode: 'Read off the barcode',
  ocr: 'Read off the printed number',
  manual: 'Typed in by hand',
}

export function CaptureReview({
  draft, lookup, catalogued, photos, derivedFiling, saving, relookupBusy, relookupError,
  catalogueCover, coverText, captureNote, notice, error,
  onDismissError, onChange, onRelookup, onClearRelookupError, onRetake,
  onShelve, onLeave, tabs,
  tags, vocabulary, taggingBusy, taggingError, onAddTag, onRemoveTag, canTag,
}: Props) {
  const [asking, setAsking] = useState(false)
  const [naming, setNaming] = useState(false)

  // Same expression `BookDetail` reads, and for the same reason: a relookup
  // in flight is about to replace the title, authors and ISBN.
  const blocked = saving || relookupBusy || !draft.title
  const why = relookupBusy
    ? 'Waiting for the ISBN lookup to finish.'
    : !draft.title
      ? 'Type the title off the book to shelve it. Nothing has been filled in '
        + 'from the photographs; what the cover reads is quoted below.'
      : ''

  // Named in the order they are read, not `SLOTS`' order (the camera's):
  // that is the camera's business, not this screen's.
  const one = (slot: Slot): Shot => ({
    word: SLOT_SHORT[slot],
    sliver: slot === 'edge',
    photo: photos[slot],
    onPress: () => onRetake(slot),
  })

  const slots = threeSlots(
    one('edge'),
    // No press on it: it is not a photograph of this copy. Changing it is
    // changing the ISBN, which is the field below.
    { word: 'Downloaded', catalogue: true, photo: catalogueCover },
    [one('front'), one('back')],
  )

  const found = [draft.publisher, draft.published, draft.pages ? `${draft.pages} pages` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="wf">
      <Phone
        tab="queue"
        onTab={(name) => tabs[name]()}
        top={
          <TopBar
            title="Check the details"
            sub={READ_FROM[draft.isbnSource] ?? undefined}
            onBack={onLeave}
          />
        }
        // Over the screen rather than beside it: the book being named is the
        // one on the screen underneath.
        over={asking ? (
          <IsbnPrompt
            initial={draft.isbn13 || draft.isbn10}
            onCancel={() => setAsking(false)}
            onSubmit={(isbn) => { onRelookup(isbn); setAsking(false) }}
          />
        ) : naming ? (
          <TagNaming
            vocabulary={vocabulary}
            carried={tags.map((tag) => tag.slug)}
            busy={taggingBusy}
            error={taggingError}
            onPick={(tag) => { onAddTag(tag); setNaming(false) }}
            onClose={() => setNaming(false)}
          />
        ) : undefined}
      >
        <Trouble said={error} onDismiss={onDismissError} />
        {notice && <Said>{notice}</Said>}

        <Shots {...slots} act size="big" />

        {catalogued && (
          <Card
            weight="quiet"
            kind="Saving adds a second copy"
            title={
              `Already catalogued as #${catalogued.id} (${catalogued.title})`
              + `${catalogued.location ? ` at ${catalogued.location}` : ''}.`
            }
          />
        )}
        {lookup?.notes.map((note) => (
          <Said key={note}>{note}</Said>
        ))}

        {draft.title ? (
          <Card kind={lookup?.source || 'What you have said'} title={draft.title}>
            {found && <p>{found}</p>}
          </Card>
        ) : (
          <Card weight="quiet" kind="Nothing came back" title="Fill it in from the book">
            <p>
              No catalogue answered for this one. What the photographs read is
              underneath, as evidence rather than as an answer.
            </p>
          </Card>
        )}

        <CaptureEvidence coverText={coverText} note={captureNote} />

        {/* Leads the fields: it is the one field that decides what every
            other field says. */}
        <Field
          label="ISBN"
          value={relookupBusy ? 'Looking it up...' : draft.isbn13 || draft.isbn10}
          placeholder="Not read yet"
          action={{
            name: 'Read the barcode on the back instead',
            icon: <IconCamera size={20} />,
            onPress: () => { onClearRelookupError(); setAsking(true) },
          }}
        />

        {!relookupBusy && (
          <Trouble
            said={relookupError
              ? `Could not look that up: ${relookupError.replace(/\.?$/, '')}.`
                + ' The digits you typed are still saved.'
              : ''}
            onDismiss={onClearRelookupError}
          />
        )}

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

        {/* Fiction/Non-fiction and the tags below are drawn as one row, since
            a person reading this sees tags; that they are the draft's genre
            versus a set someone adds to is a distinction the model needs and
            the screen does not. */}
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
            {/* Lit because it is on the book right now; pressing it again takes it off. */}
            {tags.map((tag) => (
              <Tag
                key={tag.slug}
                tone="on"
                onPress={taggingBusy ? undefined : () => onRemoveTag(tag.slug)}
              >
                {tag.label}
              </Tag>
            ))}
            {canTag && (
              <AddTag onPress={() => setNaming(true)}>Add a tag</AddTag>
            )}
          </Tags>
          {taggingError && !naming && (
            <Said>{taggingError}</Said>
          )}
        </div>

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
          <Field
            label="Notes"
            value={draft.notes}
            onChange={(notes) => onChange({ notes })}
          />
        </Card>

        {/* In the page rather than in a tooltip: this is a phone, there is no
            hover, and a `title` attribute is never read on one. Says what to
            do, not what is wrong. */}
        {blocked && why && <Said>{why}</Said>}

        <Button tone="primary" block off={blocked} onPress={onShelve}>
          {saving ? 'Saving...' : 'That is the book'}
        </Button>
        <Button tone="quiet" block onPress={onLeave}>
          Leave it in the queue
        </Button>
      </Phone>
    </div>
  )
}

/**
 * Shown as evidence and never as a value: nothing here is pre-filled into a
 * field, and there is deliberately no control that copies it across. OCR is
 * a lossy, engine-version-dependent reading of a photograph, and a guess
 * promoted into a box somebody then saves enters the catalogue wearing the
 * clothes of a confirmed value.
 */
export function CaptureEvidence({ coverText = '', note = '' }: {
  coverText?: string
  note?: string
}) {
  const lines = coverText.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length && !note) return null

  return (
    // Labels here are `Field`'s label even though nothing here is a field: a
    // label over this well says where a line came from, not what to type.
    <div className="evidence">
      <Card weight="sunk">
        {note && (
          <div className="evidence__part">
            <span className="wf-field__label">Note</span>
            <p>{note}</p>
          </div>
        )}

        {lines.length > 0 && (
          <div className="evidence__part">
            <span className="wf-field__label">The cover photo reads</span>
            <ul className="evidence__lines">
              {lines.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ul>
            {/* Under the quotation rather than over it, and quiet, because it
                is the app talking about the machine's reading rather than more
                of the reading. */}
            <Said>
              Read off the photograph by a machine, and often wrong. Nothing here
              has been filled in for you: type what the book itself says.
            </Said>
          </div>
        )}
      </Card>
    </div>
  )
}
