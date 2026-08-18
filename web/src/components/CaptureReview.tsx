/**
 * Check the details, for a book that is not in the catalogue yet.
 *
 * The cataloguing half of what `BookDetail` used to do on its own. They were
 * one screen because a queued capture and a catalogued book are both "a book,
 * looked at and edited", and the drawings say they are two: `review` is the
 * step between a photograph and a shelf, with the photographs at the top and
 * two answers at the bottom, and `book` is a page about a book you own, with
 * everything you can do to it. `BookDetail` is still that second one and is
 * untouched by this file; #315 is converting it.
 *
 * ## The photographs lead
 *
 * There were none on this screen at all, which the owner found immediately:
 *
 * > We are not showing any images here. We wanna show those images and enable
 * > them to retake them if they don't like them because they're blurry.
 *
 * So `Shots` is first, at the size somebody can judge a blurred photograph
 * from, and pressing one goes back to the camera pointed at that slot.
 *
 * ## Three slots, and the spine leads them (#373)
 *
 * > At the top of this screen we need to show the catalogue image if it's
 * > available. If it's not available, we don't show it. The spine should be on
 * > the far left, not on the far right.
 *
 * It was on the far right, because `SLOTS` is the order the camera fills them
 * in and the spine is the last thing photographed. The order a book is
 * photographed in is not the order a book is looked at in, so this screen names
 * its own and the camera keeps `SLOTS`.
 *
 * The arrangement itself is `threeSlots` in `design/Shots.tsx`, so the drawing
 * and this screen cannot disagree about it. What it decides is where the
 * downloaded cover goes and what happens to the room it takes: with one, the
 * two photographs somebody took share the last slot and a swipe moves between
 * them; without one, they take a slot each and there is nothing to swipe.
 * Either way there are three, the spine is the first, and no empty frame is
 * ever drawn for a cover nobody has downloaded.
 *
 * ## The ISBN leads the fields, and its second answer is not a keyboard
 *
 * It is the one field that decides what every other field says, and thirteen
 * digits typed off a book by somebody holding the book is the slowest and
 * least reliable way to answer it. The camera in the corner of the field opens
 * the ISBN prompt, which has a camera of its own: point it at the barcode or
 * at the printed number and it fills the box in rather than submitting it,
 * because OCR misreads digits and a wrong ISBN silently fetches a different
 * book.
 *
 * ## What the photographs read is beside the form and never in it
 *
 * `CaptureEvidence`, which is at the foot of this file since #409 because this
 * screen is the only place it is drawn. It was shared with the screen for a book
 * the catalogue already holds, and the owner took it off that one: "we have text
 * underneath the images coming from the OCR system. We shouldn't show those,
 * they're very intrusive."
 *
 * **It stays here, and the difference is what the screen is for.** This is the
 * page for exactly the captures the app could not settle by itself, so what the
 * photographs read is the one piece of evidence somebody has while they type;
 * on a book already in the catalogue it is a machine's old guess at a record a
 * person has since confirmed. OCR is a lossy reading of a photograph, and a
 * guess promoted into a box somebody then saves enters the catalogue wearing the
 * clothes of a confirmed value (#147).
 */

import { useState } from 'react'
import { Card, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { IconCamera } from '../design/Icons'
import { AddTag, Tag, Tags } from '../design/List'
import { Phone } from '../design/Phone'
import { Shots, threeSlots, type Shot } from '../design/Shots'
import { IsbnPrompt } from './IsbnPrompt'
import { TagNaming } from './TagNaming'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import type { AppliedTag, Draft, LookupResponse, TagRow } from '../lib/api'
import { SLOT_SHORT, type Slot } from '../lib/scanner'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  photos: Partial<Record<Slot, string>>
  derivedFiling: string
  saving: boolean
  relookupBusy: boolean
  relookupError: string
  /**
   * The publisher's picture for whatever ISBN this matched, where there is one.
   *
   * Drawn beside the photograph somebody took so the two can be compared, which
   * is the one part of a lookup a person can confirm at a glance: an ISBN is
   * thirteen digits nobody can verify by reading. Empty means no catalogue held
   * a picture, and then it is not drawn at all rather than drawn as a gap.
   */
  catalogueCover: string
  /** What the photographs produced, quoted rather than filled in (#147). */
  coverText: string
  captureNote: string
  /** What the last thing that happened actually did, in its own words. */
  notice: string
  onDismissNotice: () => void
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
   * What somebody has said this book is, beyond the two answers above.
   *
   * Only a person's tags, and that is a choice rather than an omission. A book
   * out of Open Library arrives carrying up to twelve subject headings, and
   * twelve chips on the screen somebody is trying to get a book off would be a
   * wall where the point was a fast path. These are the ones a person put on,
   * on this screen, and taking one off is tapping it again.
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
   * Whether a tag can be written at all, which is whether there is a row to
   * hang one on.
   *
   * A capture is a row in `books` from its first photograph (#183), so there
   * almost always is. The one moment there is not is a book being drawn before
   * its capture has come back, and offering to tag it then would be a target
   * that answers 404.
   */
  canTag: boolean
}

/**
 * Where the ISBN came from, as the second line of the top bar.
 *
 * A barcode is self-validating, a printed number read by a machine is a guess,
 * and digits somebody typed are a person's word. Those are three different
 * amounts of trust and the screen is about deciding whether to trust what is
 * on it, so it says which.
 */
const READ_FROM: Record<string, string> = {
  barcode: 'Read off the barcode',
  ocr: 'Read off the printed number',
  manual: 'Typed in by hand',
}

export function CaptureReview({
  draft, lookup, photos, derivedFiling, saving, relookupBusy, relookupError,
  catalogueCover, coverText, captureNote, notice, onDismissNotice, error,
  onDismissError, onChange, onRelookup, onClearRelookupError, onRetake,
  onShelve, onLeave, tabs,
  tags, vocabulary, taggingBusy, taggingError, onAddTag, onRemoveTag, canTag,
}: Props) {
  const [asking, setAsking] = useState(false)
  const [naming, setNaming] = useState(false)

  /*
   * Whether a save can run at all. The same expression `BookDetail` reads and
   * for the same reason: a relookup in flight is about to replace the title,
   * the authors and the ISBN, and a save started before it lands writes the
   * record it was about to correct.
   */
  const blocked = saving || relookupBusy || !draft.title
  const why = relookupBusy
    ? 'Waiting for the ISBN lookup to finish.'
    : !draft.title
      ? 'Type the title off the book to shelve it. Nothing has been filled in '
        + 'from the photographs; what the cover reads is quoted below.'
      : ''

  /*
   * The three slots, named in the order they are read rather than the order
   * they are filled.
   *
   * `SLOTS` is the camera's order, back then front then spine, and it put the
   * spine on the far right of this screen. That is the camera's business and
   * not this screen's, so the two are no longer the same list.
   */
  const one = (slot: Slot): Shot => ({
    word: SLOT_SHORT[slot],
    sliver: slot === 'edge',
    photo: photos[slot],
    onPress: () => onRetake(slot),
  })

  const slots = threeSlots(
    one('edge'),
    /* No press on it: it is not a photograph of this copy and there is no
       shutter that could take it again. Changing it is changing the ISBN,
       which is the field below. */
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
        /* Over the screen rather than beside it, because the book being named
           is the one on the screen underneath and the panel is measured in
           seconds. See `design/Naming.tsx` for why it is a panel from the top
           and not a card from the bottom: there is a keyboard under this one. */
        over={asking ? (
          /* Correcting the ISBN, which is a card from the bottom rather than a
             panel from the top: its answer is the number on the photographs at
             the top of the screen underneath. Through this slot since #408,
             which is what took it out of a fixed overlay of its own. */
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
        {error && (
          <div className="warn" onClick={onDismissError}>{error}</div>
        )}
        {notice && (
          <div className="warn warn--soft" onClick={onDismissNotice}>{notice}</div>
        )}

        {/* The photographs first, because the first thing somebody wants to
            know is whether they came out. */}
        <Shots {...slots} act size="big" />

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

        {draft.title ? (
          <Card kind={lookup?.source || 'What you have said'} title={draft.title}>
            {found && <p>{found}</p>}
          </Card>
        ) : (
          /* Quiet, which is the weight for something that is not there yet.
             It was `Instruction` for a round, which sets a sentence in the
             book face at the size the screen's own purpose is set at, and a
             screen for checking details led with an apology. */
          <Card weight="quiet" kind="Nothing came back" title="Fill it in from the book">
            <p>
              No catalogue answered for this one. What the photographs read is
              underneath, as evidence rather than as an answer.
            </p>
          </Card>
        )}

        <CaptureEvidence coverText={coverText} note={captureNote} />

        {/*
          The ISBN leads, because it is the one field that decides what every
          other field says. The way to correct it is a camera rather than a
          keyboard, which is the owner's: "on the right side of it, we should
          show like a camera icon [...] it opens up to scan the ISBN in the
          back of the book, like our current flow."
        */}
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

        {!relookupBusy && relookupError && (
          <div className="warn" onClick={onClearRelookupError}>
            Could not look that up: {relookupError.replace(/\.?$/, '')}. The
            digits you typed are still saved; tap to dismiss and try again.
          </div>
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

        {/*
          The two answers that decide which bookcase this book crosses the room
          to, and then whatever else somebody has said it is (#372).

          The two are one question with two answers and at most one holds, and
          they are the draft's rather than the book's: they are written by the
          save, through `settleGenre`, which is how #304 keeps a genre out of
          anything that did not actually answer that question. Everything after
          them is a set somebody adds to, written the moment it is said, because
          a capture is a row from its first photograph and there is somewhere to
          put it.

          Drawn as one wrapping row all the same, because a person reading this
          sees tags. Where they came from is a distinction the model needs and
          the screen does not.
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
            {/* Lit, because every one of these is on the book right now, and
                pressing one takes it off again. The same "tap it again to unsay
                it" the tags screen already has. */}
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
 * What the photographs said, on the screen where somebody has to work out
 * what the book is.
 *
 * This is the page for exactly the captures the app could not settle by
 * itself, and its one piece of evidence used to be on the previous screen:
 * the queue row said "Cover reads: Song of Solomon", and opening the row
 * showed neither that nor the note. Somebody correcting a stack of these was
 * backing out to re-read a line they had just been shown and holding it in
 * their head while typing (#147).
 *
 * Shown as evidence and never as a value. Nothing here is pre-filled into a
 * field and there is deliberately no control that copies it across: OCR is a
 * lossy, engine-version-dependent reading of a photograph, and a guess
 * promoted into a box somebody then saves enters the catalogue wearing the
 * clothes of a confirmed value. So it is quoted beside the form rather than
 * poured into it, and it says both where it came from and how much to trust
 * it.
 *
 * The note gets the same room. Three people work one pile, and a note is how
 * one of them hands the work to the next.
 *
 * **It lives here rather than in `BookDetail` since #409**, which is where it
 * was written and where it is no longer drawn. One caller, one file.
 */
export function CaptureEvidence({ coverText = '', note = '' }: {
  coverText?: string
  note?: string
}) {
  const lines = coverText.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length && !note) return null

  return (
    <section className="evidence">
      {note && (
        <p className="evidence__note">
          <span className="evidence__label">Note</span>
          {note}
        </p>
      )}

      {lines.length > 0 && (
        <div className="evidence__cover">
          <span className="evidence__label">The cover photo reads</span>
          <ul className="evidence__lines">
            {lines.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
          <p className="evidence__caveat">
            Read off the photograph by a machine, and often wrong. Nothing here
            has been filled in for you: type what the book itself says.
          </p>
        </div>
      )}
    </section>
  )
}
