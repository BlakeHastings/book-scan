import { useState } from 'react'
import { Card, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { IconCamera } from '../design/Icons'
import { AddTag, Tag, Tags } from '../design/List'
import { Phone } from '../design/Phone'
import { Shots, threeSlots, type Shot } from '../design/Shots'
import { Sure } from '../design/Sure'
import { IsbnPrompt } from './IsbnPrompt'
import { Trouble } from './RoomFrame'
import { TagNaming } from './TagNaming'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import type { AppliedTag, CataloguedBook, Draft, LookupResponse, TagRow, TitleSuggestion } from '../lib/api'
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
  /**
   * What looking the cover's title up found. Its match is offered, never
   * applied, until somebody says it is the book.
   */
  suggestion?: TitleSuggestion | null
  /** "Yes, that is it": fill the record from the match. */
  onAcceptSuggestion?: (match: LookupResponse) => void
  /** "No": the match is not this book, so start from what the cover reads. */
  onRejectSuggestion?: () => void
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
  /**
   * Throw the scan away with its photographs. Absent where there is no scan on
   * the server to throw away yet, and then nothing offers it.
   */
  onDiscard?: () => void
  /** The discard has been sent and not answered. */
  discarding?: boolean
  tabs: Record<TabName, () => void>
  /** The tab the book was picked up under, which is where `onLeave` goes back to. */
  tab: TabName

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
  catalogueCover, coverText, captureNote, suggestion = null,
  onAcceptSuggestion, onRejectSuggestion, notice, error,
  onDismissError, onChange, onRelookup, onClearRelookupError, onRetake,
  onShelve, onLeave, onDiscard, discarding = false, tabs, tab,
  tags, vocabulary, taggingBusy, taggingError, onAddTag, onRemoveTag, canTag,
}: Props) {
  const [asking, setAsking] = useState(false)
  const [naming, setNaming] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [turnedDown, setTurnedDown] = useState(false)

  // Offered only while nothing else has named the book.
  const offered = !turnedDown && !lookup?.found && !draft.title ? suggestion?.match ?? null : null
  // The form holds the cover's reading rather than anything a person or a
  // catalogue said, so it says so beside the fields.
  const readOffCover = Boolean(
    suggestion && !lookup?.found && draft.title && draft.title === suggestion.read.title,
  )

  // Same expression `BookDetail` reads, and for the same reason: a relookup
  // in flight is about to replace the title, authors and ISBN.
  const blocked = saving || relookupBusy || !draft.title
  const why = relookupBusy
    ? 'Waiting for the ISBN lookup to finish.'
    : offered
      ? `Say whether it is ${offered.title} above, or type the title off the book.`
      : !draft.title
        ? 'Type the title off the book to shelve it.'
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
        tab={tab}
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
        ) : confirmingDiscard && onDiscard ? (
          <Sure
            title={`Discard ${draft.title || 'this scan'}?`}
            said={
              'It comes out of the queue and its photographs are deleted from disk. '
              + (catalogued ? `The copy already catalogued as #${catalogued.id} stays. ` : '')
              + 'Nothing here can put the photographs back.'
            }
            act={discarding ? 'Discarding...' : 'Discard it'}
            busy={discarding}
            onAct={() => { setConfirmingDiscard(false); onDiscard() }}
            onKeep={() => setConfirmingDiscard(false)}
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

        {offered ? (
          <Card
            kind="Found by the title on the cover"
            title={`Looks like ${offered.title}${offered.authors.length ? ` by ${offered.authors.join(', ')}` : ''}?`}
            foot={(
              <>
                <Button tone="primary" onPress={() => onAcceptSuggestion?.(offered)}>
                  Yes, that is it
                </Button>
                <Button
                  tone="quiet"
                  onPress={() => { setTurnedDown(true); onRejectSuggestion?.() }}
                >
                  No, type it in
                </Button>
              </>
            )}
          >
            <div className="suggestion">
              {offered.coverUrl && (
                <img className="suggestion__cover" src={offered.coverUrl} alt={`The cover of ${offered.title}`} />
              )}
              <p>
                {[offered.publisher, offered.published, offered.pages ? `${offered.pages} pages` : '']
                  .filter(Boolean).join(' · ')
                  || 'Open Library knows a book by this title.'}
              </p>
            </div>
          </Card>
        ) : readOffCover ? (
          <Card weight="quiet" kind="Read off the cover" title={draft.title}>
            <p>{coverOnlySaid(suggestion!, turnedDown)}</p>
          </Card>
        ) : draft.title ? (
          <Card kind={lookup?.source || 'What you have said'} title={draft.title}>
            {found && <p>{found}</p>}
          </Card>
        ) : (
          <Card weight="quiet" kind="Not found" title="Fill it in from the book">
            <p>{nothingFoundSaid(draft, coverText, suggestion)}</p>
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
        {readOffCover && (
          <Said>Title and author read off the cover. Check them against the book.</Said>
        )}
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

        <Button tone={offered ? 'secondary' : 'primary'} block off={blocked} onPress={onShelve}>
          {saving ? 'Saving...' : 'That is the book'}
        </Button>
        <Button tone="quiet" block onPress={onLeave}>
          Leave it in the queue
        </Button>

        {/* Outlined rather than filled, as on a catalogued book's page: a filled
            red button invites the press it is warning about. */}
        {onDiscard && (
          <Button tone="danger" block off={discarding} onPress={() => setConfirmingDiscard(true)}>
            {discarding ? 'Discarding...' : 'Discard this scan and its photos'}
          </Button>
        )}
      </Phone>
    </div>
  )
}

/** What happened, when the form holds what the cover reads rather than a catalogue's record. */
function coverOnlySaid(suggestion: TitleSuggestion, turnedDown: boolean): string {
  if (turnedDown && suggestion.match) {
    return `Not ${suggestion.match.title}, then. The title and author below are what the cover reads.`
  }
  const { title, author } = suggestion.read
  return `No ISBN on the photographs. Looked up ${title}${author ? ` by ${author}` : ''} `
    + 'and nothing matched, so the title and author below are what the cover reads.'
}

/** What happened, said plainly, when nothing has named the book and the form is empty. */
function nothingFoundSaid(draft: Draft, coverText: string, suggestion: TitleSuggestion | null): string {
  const isbn = draft.isbn13 || draft.isbn10
  if (isbn) return `No catalogue we asked has ISBN ${isbn}. Type the title and author off the book.`
  if (suggestion) {
    return `No ISBN on the photographs. Looked up ${suggestion.read.title} and nothing matched. `
      + 'Type the title and author off the book.'
  }
  if (coverText.trim()) {
    return 'No ISBN on the photographs. What the cover reads is quoted below; '
      + 'type the title and author off the book.'
  }
  return 'No ISBN and no words could be read off the photographs. Type the title and author off the book.'
}

/**
 * The cover's words quoted as the machine read them. OCR is a lossy,
 * engine-version-dependent reading of a photograph, so a title and author
 * filled in from it are marked as read off the cover beside the fields, and
 * this quotation stays to check them against.
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
              Read off the photograph by a machine, and often wrong. Check
              anything filled in from it against the book itself.
            </Said>
          </div>
        )}
      </Card>
    </div>
  )
}
