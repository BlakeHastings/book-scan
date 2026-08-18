import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Card, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { IconCamera } from '../design/Icons'
import { Actions, Head } from '../design/Book'
import { Phone } from '../design/Phone'
import { Shots, threeSlots, type Shot } from '../design/Shots'
import { Sure } from '../design/Sure'
import type { Draft, LookupResponse, Misfile, Plank } from '../lib/api'
import { rememberedFirstPicture } from '../lib/firstPicture'
import { NOT_PICKED_OUT } from '../lib/gallery'
import { grouped } from '../lib/say'
import { SLOT_SHORT, type Slot } from '../lib/scanner'
import { BookFields } from './BookFields'
import { IsbnPrompt } from './IsbnPrompt'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  photos: Partial<Record<Slot, string>>
  /** The same photos cut to the book, where the detector found one. */
  crops?: Partial<Record<Slot, string>>
  /** Slots the detector has been shown, whether or not it found a book. */
  examined?: Slot[]
  derivedFiling: string
  saving: boolean
  relookupBusy: boolean
  relookupError: string
  /** True once the book is in the catalogue, which changes what you can do. */
  saved: boolean
  onChange: (patch: Partial<Draft>) => void
  onRelookup: (isbn: string) => void
  onClearRelookupError: () => void
  /** New book: on to the shelving step. */
  onShelve: () => void
  /** Existing book: write the edits and stay here. Resolves false if it failed. */
  onSaveEdits: () => Promise<boolean>
  onDiscard: () => void
  /** Label for the way out, since it depends on where you came from. */
  doneLabel?: string
  /** The shelf drawing. Rendered under the actions, as context not as a task. */
  placement?: ReactNode
  /** Where each of the four places goes. The frame knows the places, not the journey. */
  tabs?: Record<TabName, () => void>
  /**
   * What the last thing that happened actually did, and what went wrong.
   *
   * On the screen rather than in the app's header, which is where they were
   * until this screen stopped wearing one (#387). The same pair `CaptureReview`
   * takes, drawn the same way and dismissed by a tap.
   */
  notice?: string
  onDismissNotice?: () => void
  error?: string
  onDismissError?: () => void
  /** Null while the book is on a shelf, a timestamp while it is off one. */
  checkedOutAt?: string | null
  /** Check it out, or check it in. Saved books only. */
  onCheckOut?: (out: boolean) => void
  checkingOut?: boolean
  /**
   * Which plank a boundary move would land this book on, in each direction.
   * Null or absent everywhere it cannot go: not shelved, still being edited,
   * or genuinely in the middle of its area, where the server would refuse the
   * move anyway (#96). Read from the same placement preview the shelf drawing
   * below already uses, so nothing extra is fetched to offer it.
   *
   * A plank each way rather than a label each way (#359). The button sits on the
   * same screen as this book's recorded location, so what it says has to be what
   * that says: it read `Move it on to 1B` beside `Hall shelf · B`, which is two
   * names for one plank on one screen.
   */
  boundaryMoves?: { next: Plank | null; previous: Plank | null } | null
  /** Carry the first or last book of an area to the plank beside it. */
  onBoundaryMove?: (direction: 'next' | 'previous') => void
  boundaryMoving?: boolean
  /** Present only for a book already on the shelves. */
  onDelete?: () => void
  deleting?: boolean
  /**
   * The publisher's cover for whatever ISBN this matched, so the match itself
   * can be checked. An ISBN is thirteen digits nobody can verify by reading;
   * the cover is the one part of a lookup a person can confirm at a glance.
   */
  catalogueCover?: string
  /**
   * This book's entry in the shelving review, when the catalogue and the
   * order disagree about where it is.
   *
   * Null or absent for every book that is not flagged, which is nearly all of
   * them, and nothing is drawn in that case. The judgement is the server's:
   * this arrives from `api.misfiles`, already carrying the two facts the
   * library row carries, rather than being worked out again here from the
   * placement below (see findMisfile in src/lib/misfile.ts).
   */
  misfile?: Misfile | null
  /** A person says they have carried the book to where the order puts it. */
  onMisfileMoved?: () => void
  /**
   * A person says they never picked it up, so the boundary move goes back.
   *
   * Absent unless the server reports this misfile as an outstanding move. That
   * is the difference between an assignment the app made and the order having
   * genuinely moved a book, and only the first one is anybody's to withdraw.
   */
  onMisfileTakenBack?: () => void
  misfileMoving?: boolean
  /**
   * The lines OCR read off this capture's cover photograph, newline
   * separated, exactly as the queue row already quotes them.
   *
   * Empty for a catalogued book, which has no capture behind it, and for a
   * capture whose photographs produced nothing readable.
   */
  coverText?: string
  /**
   * The queue's note on this capture: usually why it could not settle what
   * the book is, and the line the next person needs before they start.
   */
  captureNote?: string
}

/**
 * Where the ISBN came from, in the words the review screen already uses.
 *
 * A barcode is self-validating, a printed number read by a machine is a guess,
 * and digits somebody typed are a person's word. Those are three different
 * amounts of trust and this screen is about deciding whether to trust what is
 * on it, so it says which.
 */
const READ_FROM: Record<string, string> = {
  barcode: 'Read off the barcode',
  ocr: 'Read off the printed number',
  manual: 'Typed in by hand',
}

/**
 * Shown in place of the ISBN while a relookup is in flight. Short, rotated
 * rather than fixed, and dropped the moment an answer arrives: this is a flow
 * used repeatedly in one sitting, and the same line every time stops reading
 * as a joke by the third book.
 */
const HUNTING_FOR_IT = [
  'Checking the card catalogue...',
  'Trying the shelf it is definitely not on...',
  'Asking a librarian for a withering look...',
  'Following the trail of dog-eared pages...',
  'Squinting at a spine from across the room...',
  'Ruling out the large-print edition...',
]

/**
 * Everything known about one book, and the form that corrects it.
 *
 * Two states, because there are two jobs. A book that is already catalogued is
 * something you look at: its facts read as text, and nothing invites a change
 * you did not mean. A book fresh off the camera, or one you have chosen to
 * edit, is something you correct, and only then do the fields become inputs.
 *
 * **The record leads with what you can do and the form ends with it.** On the
 * record the buttons are the reason you opened the page, and burying them under
 * a form you did not come to fill in means scrolling past twelve fields to
 * reach the one you wanted. On the form the same argument runs the other way:
 * you came to change something, so the answer to "have I finished" belongs
 * after the thing being changed, which is where the review screen's two answers
 * are drawn.
 *
 * ## What the gallery draws, and what it does not (#387)
 *
 * **This is the book edit view the owner named**, and the gallery has no
 * drawing of it. What it draws either side of it is: `book`, a page about a
 * book you already own, which `BookPane` builds; and `review`, the step between
 * a photograph and a shelf, which `CaptureReview` builds. This screen is what
 * the pencil in the corner of the first opens, and correcting a record is the
 * same act as checking one, so the two states here wear the two drawings rather
 * than a third invented for them: the record wears `Head` and `Actions`, which
 * is what a book's page is made of, and the form wears the review's fields,
 * which is what `CaptureReview` is made of. Every one of those is imported from
 * `src/design`, so nothing here is a second copy of a drawn thing.
 *
 * **Where a drawing had nothing to say, the behaviour was kept and dressed.**
 * The checked-out banner, the misfile notice, the boundary moves, the ISBN
 * block, the evidence from the photographs and the delete are all on this
 * screen because they were, and they are drawn with cards, fields and buttons
 * out of the design system rather than redesigned.
 *
 * ## The photographs are `Shots`, and `BookGallery` is gone
 *
 * The record shows them the way a book's page shows them, spine against front
 * with the rest behind it and a tap opening one whole; the form shows them the
 * way the review shows them, three slots with the spine first, each one a way
 * back to the camera. Both are `Shots`, which is the component the gallery
 * draws with, so there is one arrangement of a book's photographs in this app
 * rather than two that agree until one is edited.
 */
export function BookDetail({
  draft, lookup, photos, crops, examined, derivedFiling, saving,
  relookupBusy, relookupError, saved,
  onChange, onRelookup, onClearRelookupError, onShelve, onSaveEdits, onDiscard,
  onDelete, deleting = false, doneLabel = 'Done', placement,
  tabs, notice = '', onDismissNotice, error = '', onDismissError,
  checkedOutAt = null, onCheckOut, checkingOut = false, catalogueCover = '',
  boundaryMoves = null, onBoundaryMove, boundaryMoving = false,
  misfile = null, onMisfileMoved, onMisfileTakenBack, misfileMoving = false,
  coverText = '', captureNote = '',
}: Props) {
  // A catalogued book opens as a record. A new one opens ready to correct,
  // because correcting it is the whole reason it is on screen.
  const [editing, setEditing] = useState(!saved)
  const [asking, setAsking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [jokeIndex, setJokeIndex] = useState(0)
  /*
   * Which picture the record opens on, read once when the page mounts. A
   * preference rather than a live value, for the reason `BookPane` gives: it is
   * changed on another screen, and getting there means leaving this one.
   */
  const [firstPicture] = useState(rememberedFirstPicture)
  const wasBusy = useRef(false)

  // Pick a new line each time a lookup starts, never repeating the one just
  // shown, so back-to-back changes on different books do not echo each other.
  useEffect(() => {
    if (relookupBusy && !wasBusy.current) {
      setJokeIndex((current) => {
        if (HUNTING_FOR_IT.length <= 1) return 0
        let next = Math.floor(Math.random() * HUNTING_FOR_IT.length)
        while (next === current) next = Math.floor(Math.random() * HUNTING_FOR_IT.length)
        return next
      })
    }
    wasBusy.current = relookupBusy
  }, [relookupBusy])

  const category = draft.genre === FICTION_SLUG ? 'Fiction' : 'Non-fiction'
  const filing = draft.authorFilingOverride || derivedFiling

  /*
   * Whether a save can run at all, for either kind of book.
   *
   * One expression, read by both buttons, because there is only one question
   * here and it does not depend on which of them is drawn. A relookup in
   * flight is about to replace the title, the authors and the ISBN; a save
   * started before it lands writes the record it was about to correct. #74
   * established that for a catalogued book and wrote the condition into that
   * branch, which left the new-book branch next to it doing the same work
   * unguarded, and that is the branch somebody changing an ISBN is most often
   * on: resolving a fresh capture. Copying the condition across would leave
   * two of them to keep in step, which is how one came to be missed. So it is
   * shared, the way #68 gave the Camera tab and Back to camera one
   * backToCamera().
   *
   * A lookup that fails or finds nothing clears relookupBusy in its finally,
   * so both buttons come back either way and neither can strand a book.
   */
  const saveBlocked = saving || relookupBusy || !draft.title
  const whyBlocked = relookupBusy
    ? 'Waiting for the ISBN lookup to finish.'
    // Reachable since #156, and it was not before: a capture the app could not
    // identify used to arrive with the OCR guess sitting in the Title box, so
    // this button was live and one tap shelved that guess. Now the box is
    // empty, and a disabled button with nothing said about it is the shape
    // that makes somebody prod at a screen wondering what is broken.
    : !draft.title
      ? 'Type the title off the book to shelve it. Nothing has been filled in '
        + 'from the photographs; what the cover reads is quoted below.'
      : ''

  /** One of the three photographs of this copy, cropped where a crop exists. */
  const one = (slot: Slot): Shot => {
    const crop = crops?.[slot] ?? ''
    const whole = photos[slot] ?? ''
    return {
      word: SLOT_SHORT[slot],
      sliver: slot === 'edge',
      photo: crop || whole || undefined,
      // Full screen shows the photograph, not the crop the page drew. Absent
      // where there was nothing to cut, and then the drawn one is the whole.
      full: whole || undefined,
      // Said only where the detector was shown this photograph and declined,
      // which is the same honesty `BookGallery` carried: a photo that still
      // has the room around it says why rather than being quietly worse than
      // the one beside it.
      note: examined?.includes(slot) && !crop && whole ? NOT_PICKED_OUT : undefined,
    }
  }

  /*
   * The form's three slots, in the order they are read rather than the order
   * they are filled: the spine first, then whatever a catalogue holds, then
   * the photographs somebody took. `threeSlots` decides it, so this screen and
   * the review screen cannot disagree about the top of a form.
   */
  const slots = threeSlots(
    one('edge'),
    /* No press on it: it is not a photograph of this copy and there is no
       shutter that could take it again. Changing it is changing the ISBN. */
    { word: 'Downloaded', catalogue: true, photo: catalogueCover || undefined },
    [one('front'), one('back')],
  )

  /** The record's four pictures, in the order they are taken. */
  const shots: Shot[] = [
    one('edge'),
    one('front'),
    one('back'),
    {
      word: 'Downloaded',
      catalogue: true,
      photo: catalogueCover || undefined,
      full: catalogueCover || undefined,
    },
  ]

  const isbnLine = draft.isbn13 || draft.isbn10
  const printed = [draft.publisher, draft.published].filter(Boolean).join(', ')
  const long = draft.pages ? `${grouped(Number(draft.pages) || 0)} pages` : ''

  /**
   * The facts, as sentences rather than as a table of labels, which is how the
   * book's own page already says them.
   *
   * Where the book sits is deliberately not one of them: the drawing below says
   * that, and a sentence over a drawing is a second thing to keep true.
   */
  const facts = [
    category,
    printed || long ? `${[printed, long].filter(Boolean).join('. ')}.` : 'No publisher, year or length',
    seriesText(draft),
    isbnLine ? `ISBN ${isbnLine}` : 'No ISBN',
    filing ? `Files under ${filing}` : '',
  ].filter(Boolean)

  const back = editing && saved ? () => setEditing(false) : onDiscard

  return (
    <div className="wf">
      <Phone
        tab="library"
        onTab={tabs ? (name) => tabs[name]() : undefined}
        top={
          <TopBar
            title={editing && saved ? 'Edit the details' : draft.title || 'Untitled'}
            sub={editing && saved ? draft.title || 'Untitled' : draft.authors || 'no author'}
            onBack={back}
          />
        }
        /* Over the screen rather than beside it, and the screen underneath is
           drawn in full: what somebody is being asked about is the book they
           were just looking at.

           Two questions can be asked here and only one at a time. Correcting
           the ISBN came through this slot with #408, which is what took it out
           of a fixed overlay of its own: the card it is asked on is positioned
           inside the screen, the same way the delete question's is. */
        over={asking ? (
          <IsbnPrompt
            initial={draft.isbn13 || draft.isbn10}
            onCancel={() => setAsking(false)}
            onSubmit={(isbn) => { onRelookup(isbn); setAsking(false) }}
          />
        ) : confirmingDelete && onDelete ? (
          <Sure
            title={`Delete ${draft.title || 'this book'}?`}
            said={
              'It goes out of the catalogue and its photographs are deleted from '
              + 'disk. Nothing here can put either back.'
            }
            act={deleting ? 'Deleting...' : 'Delete book'}
            busy={deleting}
            onAct={onDelete}
            onKeep={() => setConfirmingDelete(false)}
          />
        ) : undefined}
      >
        {error && <div className="warn" onClick={onDismissError}>{error}</div>}
        {notice && (
          <div className="warn warn--soft" onClick={onDismissNotice}>{notice}</div>
        )}

        {/* Stated plainly and near the top: everything below, the drawing
            especially, means something different for a book in a pile.

            Quiet, which is the weight for a thing that is not there, and it is
            the same words the banner said. The class is what the browser
            journeys hold on to; the paint is the card's. */}
        {checkedOutAt && (
          <div className="checkedout">
            <Card weight="quiet" title="Off the bookcase">
              <p>
                Checked out {new Date(checkedOutAt).toLocaleDateString()}.
                Nothing is filed next to it, and the bookcase has closed up
                behind it.
              </p>
            </Card>
          </div>
        )}

        {/* Beside the checked-out banner, and for the same reason: it is a fact
            about where the book physically is, and the page below reads
            differently once you know it. The two are mutually exclusive in
            practice, since a book off the shelf holds no position to be wrong
            about and the server excludes it from the review entirely. */}
        {misfile && onMisfileMoved && (
          <MisfileNotice
            misfile={misfile}
            moving={misfileMoving}
            onMoved={onMisfileMoved}
            onTakeBack={onMisfileTakenBack}
          />
        )}

        {editing ? (
          <>
            {/* The photographs first, because the first thing somebody wants
                to know is whether they came out. Nothing presses back to the
                camera from here: this screen is reached from the shelves and
                from the scanner, and neither is holding the book in the frame
                the camera left. */}
            <Shots {...slots} size="big" />

            {/*
              The ISBN leads the fields, because it is the one field that
              decides what every other field says, and the way to correct it is
              a camera rather than a keyboard: thirteen digits typed off a book
              by somebody holding the book is the slowest and least reliable way
              to answer it.
            */}
            <Field
              label="ISBN"
              value={relookupBusy ? HUNTING_FOR_IT[jokeIndex] : isbnLine}
              placeholder="Not read yet"
              action={relookupBusy ? undefined : {
                name: 'Read the barcode on the back instead',
                icon: <IconCamera size={20} />,
                onPress: () => { onClearRelookupError(); setAsking(true) },
              }}
            />
            {draft.isbnSource && !relookupBusy && (
              <Said>{READ_FROM[draft.isbnSource] ?? draft.isbnSource}</Said>
            )}

            {/* Surfaced here rather than only in the prompt, because a failure
                arrives after the prompt has already closed: the user is back
                on this view by the time the answer comes in. Tap to dismiss. */}
            {!relookupBusy && relookupError && (
              <div className="warn" onClick={onClearRelookupError}>
                Could not look that up: {relookupError.replace(/\.?$/, '')}. The
                digits you typed are still saved; tap to dismiss and try again.
              </div>
            )}

            {/* Directly above the fields, because this is what somebody reads
                while they type into them. Anywhere higher and it is off screen
                by the time the Title box is. */}
            <CaptureEvidence coverText={coverText} note={captureNote} />

            <BookFields
              draft={draft}
              lookup={lookup}
              derivedFiling={derivedFiling}
              onChange={onChange}
            />

            {/*
              The two answers, at the end, which is where the drawing puts
              them: "That is the book" and "Leave it in the queue" are the last
              things on the review screen, and this is that form.

              **They were at the top for one round**, which is where the old
              screen kept them and where they are still right on the record
              beside this: you arrive at a record to do something to the book,
              and burying that under a form you did not come to fill in means
              scrolling past twelve fields to reach it. On the form itself it
              reads the other way round, and looking at it is what said so: the
              first thing offered was "Save changes", above every field, before
              anything had been changed. Found by looking at it.
            */}
            {saveBlocked && whyBlocked && <Said>{whyBlocked}</Said>}
            <Button tone="primary" block off={saveBlocked} onPress={
              saved
                ? async () => {
                    // Back to the record only if the write went through; on a
                    // failure the edits must stay on screen to be retried.
                    if (await onSaveEdits()) setEditing(false)
                  }
                : onShelve
            }>
              {saved
                ? (saving ? 'Saving...' : 'Save changes')
                : 'Looks right, shelve it'}
            </Button>
            <Button
              tone="quiet"
              block
              // Cancelling a catalogued book's edit drops back to the record
              // view without going through App at all, so nothing else would
              // stop a relookup's answer landing on it afterwards. Simplest
              // to make it wait, the same as Save: leaving mid-lookup is a
              // new book's edit unravelling entirely (onDiscard, already
              // session-safe), not a record view still showing a field the
              // lookup was about to change.
              off={saving || (saved && relookupBusy)}
              onPress={() => (saved ? setEditing(false) : onDiscard())}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Head
              title={draft.title || 'Untitled'}
              by={draft.authors || 'Nobody is credited'}
              shots={shots}
              facts={facts}
              first={firstPicture}
            />

            {draft.notes && <Said>{draft.notes}</Said>}

            <Actions>
              {/*
                * The one action the book's own state decides, and the only
                * thing that decides it. There is a single way in for a
                * catalogued book now, so this page cannot know whether
                * somebody arrived meaning to take it down or put it back, and
                * it does not need to: a book on the bookcase can come off it,
                * a book that is off can go back, and neither is ever offered
                * as the other.
                */}
              {checkedOutAt ? (
                /* Check-in goes through the same guided shuffle as a new book,
                   which is the point: it is how a shelf gets rearranged by
                   hand. */
                <Button tone="secondary" small onPress={onShelve}>
                  Check in
                </Button>
              ) : onCheckOut ? (
                <Button
                  tone="secondary"
                  small
                  off={checkingOut}
                  onPress={() => onCheckOut(true)}
                >
                  {checkingOut ? 'Checking out...' : 'Check out'}
                </Button>
              ) : null}

              {/*
                * Offered only when this book's own recorded position is the
                * first or last of its area, and only in the direction that has
                * somewhere to go (#96). The library used to draw this next to
                * every area instead, which is cramped in a scrolling run of
                * spines and one tap away from moving a book nobody meant to
                * touch; here there is no ambiguity about which book it is.
                * Starting the move hands off to the shelving step exactly the
                * way it always has: named plank, walk over, confirm.
                */}
              {!checkedOutAt && onBoundaryMove && boundaryMoves?.next && (
                <Button
                  tone="quiet"
                  small
                  off={boundaryMoving}
                  onPress={() => onBoundaryMove('next')}
                >
                  {boundaryMoving ? 'Moving...' : `Move it on to ${boundaryMoves.next.label}`}
                </Button>
              )}
              {!checkedOutAt && onBoundaryMove && boundaryMoves?.previous && (
                <Button
                  tone="quiet"
                  small
                  off={boundaryMoving}
                  onPress={() => onBoundaryMove('previous')}
                >
                  {boundaryMoving
                    ? 'Moving...'
                    : `Move it back to ${boundaryMoves.previous.label}`}
                </Button>
              )}

              {/* Available in either state, because correcting a record has
                  nothing to do with where the book physically is. */}
              <Button tone="quiet" small onPress={() => setEditing(true)}>
                Edit details
              </Button>
              <Button tone="quiet" small onPress={onDiscard}>{doneLabel}</Button>
            </Actions>

            {placement}

            <CaptureEvidence coverText={coverText} note={captureNote} />

            {/* Kept well away from the row above so it cannot be hit by
                accident, and it asks before it does anything. Outlined rather
                than filled, which is what `danger` means here: a filled red
                button invites the press it is warning about.

                It was a card with a heading over it for one round, and the
                heading said the same words as the button under it. Found by
                looking at it. */}
            {onDelete && (
              <>
                <Said>
                  Deleting takes the record and its photographs off disk, and
                  nothing here can put them back.
                </Said>
                <Button tone="danger" block onPress={() => setConfirmingDelete(true)}>
                  Delete this book and its photos
                </Button>
              </>
            )}
          </>
        )}
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

/**
 * The one thing this page was missing: that the catalogue and the order
 * disagree about where this book is, and that a person can close it.
 *
 * Both places are named, the same two the library's "Needs attention" row
 * carries, because "this book is misfiled" is not actionable on its own: you
 * are standing in front of the bookcase and need to know which shelf to take
 * it off and which to put it on. The placement drawing further down already
 * says where it belongs, so this does not draw that again; what it adds is the
 * disagreement itself.
 *
 * "Moved it" means somebody has physically carried the book. There is
 * deliberately no dismiss, no ignore and no clear: the recorded location is the
 * sole record of where the book actually is, and writing it to tidy a screen
 * would throw that record away and leave the book lost.
 *
 * "Undo the move" is not one of those, and it is offered only when the server
 * says a boundary move is outstanding on this book. It withdraws something the
 * app did and writes no location at all, so the record of where the book is
 * survives it untouched. Where it is absent, the list is still a report and can
 * still only be closed by a walk to the shelf.
 *
 * **The words are unchanged and only the paint moved** (#387). It was a bare
 * outlined box coloured out of the app's own palette, which is white text on
 * warm paper once the page around it is the design system's. It is a card with
 * two answers along the bottom now, and every sentence in it is the one it had.
 */
export function MisfileNotice({ misfile, moving, onMoved, onTakeBack }: {
  misfile: Misfile
  moving: boolean
  onMoved: () => void
  onTakeBack?: (() => void) | undefined
}) {
  return (
    <div className="misfile">
      <Card
        title="Needs attention"
        foot={
          <>
            <Button tone="secondary" small off={moving} onPress={onMoved}>
              {moving ? '...' : 'Moved it'}
            </Button>
            {onTakeBack && (
              <Button tone="quiet" small off={moving} onPress={onTakeBack}>
                {moving ? '...' : 'Undo the move'}
              </Button>
            )}
          </>
        }
      >
        <p className="misfile__where">
          Last seen on {misfile.from}. The order now puts it on{' '}
          <strong>{misfile.to}</strong>.
        </p>
        <p className="misfile__hint">
          Nothing has been changed for you. Tap "Moved it" once the book is
          actually there
          {onTakeBack ? ', or undo the move if you never picked it up.' : '.'}
        </p>
      </Card>
    </div>
  )
}

function seriesText(draft: Draft): string {
  if (!draft.seriesName) return ''
  return draft.seriesIndex ? `${draft.seriesName}, book ${draft.seriesIndex}` : draft.seriesName
}
