import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Card, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button, Field } from '../design/Controls'
import { IconCamera } from '../design/Icons'
import { Actions, Amiss, Head } from '../design/Book'
import { Phone } from '../design/Phone'
import { Shots, threeSlots, type Shot } from '../design/Shots'
import { Sure } from '../design/Sure'
import type { AppliedTag, BoundaryOffer, Draft, LookupResponse, Misfile, TagRow } from '../lib/api'
import { rememberedFirstPicture } from '../lib/firstPicture'
import { grouped } from '../lib/say'
import { SLOT_SHORT, type Slot } from '../lib/scanner'
import { BookFields } from './BookFields'
import { IsbnPrompt } from './IsbnPrompt'
import { Trouble } from './RoomFrame'
import { TagNaming } from './TagNaming'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'

interface Props {
  draft: Draft
  lookup: LookupResponse | null
  photos: Partial<Record<Slot, string>>
  /** The same photos cut to the book, where the detector found one. */
  crops?: Partial<Record<Slot, string>>
  derivedFiling: string
  saving: boolean
  relookupBusy: boolean
  relookupError: string
  /** True once the book is in the catalogue, which changes what you can do. */
  saved: boolean
  onChange: (patch: Partial<Draft>) => void
  onRelookup: (isbn: string) => void
  onClearRelookupError: () => void
  /**
   * On to the shelving step, for whichever book is in hand.
   *
   * Three things ask for it and all three are the same act: a new book being
   * placed for the first time, a book being checked back in, and, since round
   * ten, the notice saying this one is supposed to be moved. There is one
   * screen that places a book and this is the way to it (#409).
   */
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
   * takes, and drawn the same way: a refusal is a card with a way to put it
   * away, and a notice is one quiet line that the next thing you do replaces.
   */
  notice?: string
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
   *
   * **And what the move costs** (#433). An offer whose `empties` is set takes an
   * area off the furniture, so pressing it asks first instead of doing it.
   */
  boundaryMoves?: { next: BoundaryOffer | null; previous: BoundaryOffer | null } | null
  /**
   * Carry the first or last book of an area to the plank beside it.
   *
   * The second argument is somebody having been asked about an area going, not a
   * property of the move: the server refuses a move that removes furniture
   * without it, which is what keeps the promise off this rendering.
   */
  onBoundaryMove?: (direction: 'next' | 'previous', theAreaGoes: boolean) => void
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
   *
   * **Only its presence is read now** (#409). The notice used to recite the two
   * places it carries and offer two answers; it is one sentence and a door, and
   * the entry stays the thing that decides whether there is anything to say.
   * Where the book belongs is drawn by the board below and named by the step the
   * notice opens, so it is on the screen twice without being written once.
   */
  misfile?: Misfile | null
  /**
   * What a person has said this book is, and the vocabulary to say more in.
   *
   * The third door onto naming a book (#433). #377 built it on the queue's
   * check-the-details screen and #400 let a rule name a tag nothing carries yet;
   * a book already on a shelf had neither, so the only thing anybody could say
   * about one was which of two genres it was. It is the same `useTagging` hook
   * both other screens use and the same panel, because a second way of saying
   * what a book is would be two vocabularies waiting to disagree.
   */
  tags?: AppliedTag[]
  vocabulary?: TagRow[]
  taggingBusy?: boolean
  taggingError?: string
  onAddTag?: (tag: { slug: string; label: string }) => void
  onRemoveTag?: (slug: string) => void
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
  draft, lookup, photos, crops, derivedFiling, saving,
  relookupBusy, relookupError, saved,
  onChange, onRelookup, onClearRelookupError, onShelve, onSaveEdits, onDiscard,
  onDelete, deleting = false, doneLabel = 'Done', placement,
  tabs, notice = '', error = '', onDismissError,
  checkedOutAt = null, onCheckOut, checkingOut = false, catalogueCover = '',
  boundaryMoves = null, onBoundaryMove, boundaryMoving = false,
  misfile = null,
  tags = [], vocabulary = [], taggingBusy = false, taggingError = '',
  onAddTag, onRemoveTag,
}: Props) {
  // A catalogued book opens as a record. A new one opens ready to correct,
  // because correcting it is the whole reason it is on screen.
  const [editing, setEditing] = useState(!saved)
  const [asking, setAsking] = useState(false)
  const [naming, setNaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  /**
   * The direction of a boundary move somebody is being asked about, or null.
   *
   * Only ever set for an offer whose `empties` says an area goes with the book
   * (#433). An ordinary move re-anchors a boundary and removes nothing, and a
   * dialog over every one of them would be the ceremony `Sure`'s own comment
   * warns against: what it exists for is the moment somebody cannot find out
   * afterwards.
   */
  const [emptying, setEmptying] = useState<'next' | 'previous' | null>(null)
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
    // A disabled button with nothing said about it is the shape that makes
    // somebody prod at a screen wondering what is broken. This screen is a
    // book the catalogue already holds, so an empty title is one somebody has
    // just cleared rather than one nothing ever filled in; what the queue's
    // screen says about the photographs would not be true here (#409).
    : !draft.title
      ? 'Type the title off the book to save it.'
      : ''

  /**
   * One of the three photographs of this copy, cropped where a crop exists.
   *
   * **Nothing is written under it any more** (#409). Each photograph the
   * detector had been shown and declined to cut carried a sentence saying so,
   * and the owner named that text off this screen: "we have text underneath the
   * images coming from the OCR system. We shouldn't show those, they're very
   * intrusive." A photograph that still has the room around it is now simply
   * the photograph, and what the machine made of it is said nowhere here.
   */
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

  /*
   * The offer somebody is being asked about, or null when nothing is being
   * asked. Read back off `boundaryMoves` rather than copied into state when the
   * button was pressed, so a placement that arrives while the question is on
   * screen is the placement the question is about.
   */
  const asked = emptying ? boundaryMoves?.[emptying] ?? null : null
  const goingWith = asked?.empties ? { ...asked, empties: asked.empties } : null

  /*
   * Taking one of the two offers, which is two different acts wearing one
   * button (#433).
   *
   * A move that only re-anchors a boundary happens on the press, as it always
   * has: the shelving step is the stop, and it names the plank and waits. A move
   * that leaves an area with no books on it takes that area off the furniture,
   * and #281 settled that a thing somebody cannot find out afterwards is asked
   * about first.
   */
  const start = (direction: 'next' | 'previous', offer: BoundaryOffer) => {
    if (offer.empties) setEmptying(direction)
    else onBoundaryMove?.(direction, false)
  }

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
        /*
          Over the screen rather than beside it, and the screen underneath is
          drawn in full: what somebody is being asked about is the book they
          were just looking at.

          Two questions can be asked here and only one at a time. Correcting
          the ISBN came through this slot with #408, which is what took it out
          of a fixed overlay of its own: the card it is asked on is positioned
          inside the screen, the same way the delete question's is.

          **The delete question is the only place its warning is written now**
          (#409). The sentence that used to sit over the button on the page said
          these same two things, and a warning nobody is about to act on is
          prose; the answer is not to say it less firmly here but to say it only
          here.
        */
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
            onPick={(tag) => { onAddTag?.(tag); setNaming(false) }}
            onClose={() => setNaming(false)}
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
        ) : goingWith ? (
          /*
            The one boundary move that removes furniture, asked about before it
            happens rather than reported after (#433).

            It is `Sure` and not a second dialog invented here, for the reason
            that component exists: the area screen already asks this exact
            question when somebody removes an area, and two dialogs about one act
            are two sets of words waiting to disagree about what it does. The
            rows under it are the labels that read differently afterwards, which
            is #281's argument that showing a renumbering beats claiming one.
          */
          <Sure
            title={goingWith.empties.areas.length === 1
              ? `${goingWith.empties.areas[0]} goes when this book leaves it`
              : `${goingWith.empties.areas.join(' and ')} go when this book leaves`}
            said={
              'It is the only book there, and an area with no books on it comes off '
              + `the furniture. Carry it to ${goingWith.label} and say it fits; until you `
              + 'do, the list of books needing attention offers the move back.'
            }
            becomes={goingWith.empties.becomes}
            act={boundaryMoving ? 'Moving...' : `Move it to ${goingWith.label}`}
            busy={boundaryMoving}
            onAct={() => {
              const direction = emptying!
              setEmptying(null)
              onBoundaryMove?.(direction, true)
            }}
            onKeep={() => setEmptying(null)}
          />
        ) : undefined}
      >
        {/*
          What went wrong and what just happened, which are two different
          things and stay two (#387). A refusal is a card somebody has to read
          and it says so in its own head; a notice is one quiet line, which is
          what `Said` is for. They looked nearly alike when both were painted
          out of the app's own palette, and that was the thing worth taking
          off, not the difference between them.
        */}
        <Trouble said={error} onDismiss={onDismissError} />
        {notice && <Said>{notice}</Said>}

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

        {/*
          Beside the checked-out banner, and for the same reason: it is a fact
          about where the book physically is, and the page below reads
          differently once you know it. The two are mutually exclusive in
          practice, since a book off the shelf holds no position to be wrong
          about and the server excludes it from the review entirely.

          **It is one line and it is a door** (#409). Pressing it opens the
          step that places a book, which is the same screen a newly scanned
          book and a carried book are placed on, so there is no second way to
          say where a book went. What used to be here was a card with two
          paragraphs and two answers in it: "Moved it", which wrote a location
          from a screen nobody could be standing at a bookcase reading, and
          "Undo the move". Both are still offered, in the library's list of
          books needing attention, which is the screen that is a work list.
          Here there is one thing to do and it is a walk.
        */}
        {misfile && <Amiss onPress={onShelve} />}

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
            {!relookupBusy && (
              <Trouble
                said={relookupError
                  ? `Could not look that up: ${relookupError.replace(/\.?$/, '')}.`
                    + ' The digits you typed are still saved.'
                  : ''}
                onDismiss={onClearRelookupError}
              />
            )}

            {/*
              What the photographs read used to be quoted here, above the
              fields. It is gone (#409): "we have text underneath the images
              coming from the OCR system. We shouldn't show those, they're very
              intrusive."

              Nothing is lost from this screen by its going, because there was
              nothing on this screen to lose. A book the catalogue already holds
              has no capture behind it to quote, and `openBook` sets the evidence
              empty for exactly that reason, so this block has drawn nothing here
              since the screens split (#316). It is still drawn where it is read,
              which is the queue's check-the-details screen, where somebody is
              working out what an unidentified book is; that is where #147 put it
              and it is the screen the gallery draws it on.
            */}
            <BookFields
              draft={draft}
              lookup={lookup}
              derivedFiling={derivedFiling}
              onChange={onChange}
              tags={tags}
              taggingBusy={taggingBusy}
              taggingError={taggingError}
              onRemoveTag={onRemoveTag}
              /* The panel is over the whole screen rather than inside the form,
                 which is why opening it is a callback rather than a state this
                 owns: there is a keyboard under it. Same shape as the queue's
                 check-the-details screen, and the same panel. */
              onAddTag={onAddTag ? () => setNaming(true) : undefined}
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
                  onPress={() => start('next', boundaryMoves.next!)}
                >
                  {boundaryMoving ? 'Moving...' : `Move it on to ${boundaryMoves.next.label}`}
                </Button>
              )}
              {!checkedOutAt && onBoundaryMove && boundaryMoves?.previous && (
                <Button
                  tone="quiet"
                  small
                  off={boundaryMoving}
                  onPress={() => start('previous', boundaryMoves.previous!)}
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

            {/*
              Kept well away from the row above so it cannot be hit by accident,
              and it asks before it does anything. Outlined rather than filled,
              which is what `danger` means here: a filled red button invites the
              press it is warning about.

              It was a card with a heading over it for one round, and the heading
              said the same words as the button under it. Then it was a sentence
              over the button saying the record and its photographs come off disk
              and nothing here can put them back, and round ten took that too:

              > At the bottom of the detail view as well: we don't want to explain
              > to them that deleting takes the record and its photographs off
              > disk and nothing here could put them back. We don't need to put
              > that text there.

              **The warning did not go with it, and that distinction is the whole
              of #281.** Ambient prose is noise; an explanation at the moment of
              an irreversible decision is the entire job. So the sentence is not
              on the page and is word for word in the dialog below, which is the
              moment somebody is actually deciding.
            */}
            {onDelete && (
              <Button tone="danger" block onPress={() => setConfirmingDelete(true)}>
                Delete this book and its photos
              </Button>
            )}
          </>
        )}
      </Phone>
    </div>
  )
}

/*
 * `CaptureEvidence` was here, and it is in `CaptureReview.tsx` now.
 *
 * It quotes what the photographs read, and this screen was one of its two
 * callers until the owner named it off this one (#409): "we have text
 * underneath the images coming from the OCR system. We shouldn't show those,
 * they're very intrusive." It went to its remaining caller rather than staying
 * here exported for one, which is the queue's check-the-details screen, where a
 * person is working out what an unidentified book is and where #147 put it.
 *
 * Nothing about the quoting changed in the move, and nothing about it needed to:
 * it is still evidence rather than a value, still nowhere near a field, and
 * still says how much to trust itself.
 */

/*
 * `MisfileNotice` was here, and there is nothing in its place but a sentence.
 *
 * It was a card headed "Needs attention" with two paragraphs in it, naming
 * where the book was last seen and where the order now wants it, and two
 * answers along the bottom: "Moved it", which wrote a location, and "Undo the
 * move". The owner replaced the whole of it (#409):
 *
 * > Instead of "moved it, there is an option", we should remove any button
 * > there, but let the user click on the needs-attention pop up to take them to
 * > the shelving step for that book [...] we can just have a message like "book
 * > is supposed to be moved" or something. A little less intense, taking up so
 * > much of the screen.
 *
 * So what is drawn is `Amiss` out of the design system, one line, and pressing
 * it opens the step that places a book. **Neither answer was lost**: the
 * library's list of books needing attention still offers "Moved it" and "Undo
 * the move" on every entry, which is the screen that is a work list rather than
 * a page about one book, and the walk itself is now a walk rather than a claim
 * about one typed from an armchair.
 */

function seriesText(draft: Draft): string {
  if (!draft.seriesName) return ''
  return draft.seriesIndex ? `${draft.seriesName}, book ${draft.seriesIndex}` : draft.seriesName
}
