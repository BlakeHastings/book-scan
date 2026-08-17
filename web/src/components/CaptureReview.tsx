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
 * `CaptureEvidence` again, unchanged and imported rather than redrawn: OCR is
 * a lossy reading of a photograph, and a guess promoted into a box somebody
 * then saves enters the catalogue wearing the clothes of a confirmed value
 * (#147).
 */

import { useState } from 'react'
import { Card, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { IconCamera } from '../design/Icons'
import { Tag, Tags } from '../design/List'
import { Phone } from '../design/Phone'
import { Shots, threeSlots, type Shot } from '../design/Shots'
import { CaptureEvidence } from './BookDetail'
import { IsbnPrompt } from './IsbnPrompt'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import type { Draft, LookupResponse } from '../lib/api'
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
}: Props) {
  const [asking, setAsking] = useState(false)

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
          Two tags and not a switch, which is as far as the drawing can be
          followed today: a book carries as many tags as it carries, and a
          capture has nowhere to keep the others until the queue speaks the
          same tags a book does. What decides which bookcase this book crosses
          the room to is here, which is the part that has to be right before it
          is shelved.
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
          </Tags>
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

      {asking && (
        <IsbnPrompt
          initial={draft.isbn13 || draft.isbn10}
          onCancel={() => setAsking(false)}
          onSubmit={(isbn) => { onRelookup(isbn); setAsking(false) }}
        />
      )}
    </div>
  )
}
