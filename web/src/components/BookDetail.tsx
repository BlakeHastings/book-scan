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
  /** A new book, a check-in, and a misplaced book's move all use this one screen to place a book. */
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
   * Drawn the same way `CaptureReview` draws this pair: a refusal is a
   * dismissible card, a notice is one quiet line the next thing replaces.
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
   * Null or absent wherever the move cannot happen: not shelved, still being
   * edited, or in the middle of its area, where the server would refuse the
   * move anyway. Read from the same placement preview the shelf drawing
   * below already uses, so nothing extra is fetched to offer it.
   *
   * An offer whose `empties` is set takes an area off the furniture, so
   * pressing it asks first instead of doing it.
   */
  boundaryMoves?: { next: BoundaryOffer | null; previous: BoundaryOffer | null } | null
  /**
   * The second argument reflects being asked about an area going, not a
   * property of the move: the server refuses a move that removes furniture
   * without it.
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
   * Null or absent for every book that is not flagged, which is nearly all
   * of them. Arrives from `api.misfiles`, already carrying the two facts the
   * library row carries, rather than being worked out again here from the
   * placement below.
   */
  misfile?: Misfile | null
  /**
   * The same `useTagging` hook and panel the other two tagging screens use,
   * so there is one vocabulary rather than two that could disagree.
   */
  tags?: AppliedTag[]
  vocabulary?: TagRow[]
  taggingBusy?: boolean
  taggingError?: string
  onAddTag?: (tag: { slug: string; label: string }) => void
  onRemoveTag?: (slug: string) => void
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

/**
 * Shown in place of the ISBN while a relookup is in flight. Rotated rather
 * than fixed, since this is a flow used repeatedly in one sitting and the
 * same line every time stops reading as a joke by the third book.
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
 * Two states: a catalogued book is a record, read as text with nothing
 * inviting an unmeant change; a new or edited book is a form, with the
 * fields open to correction. The record leads with the buttons and the form
 * ends with them, since each is reached for a different reason.
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
   * Only ever set for an offer whose `empties` says an area goes with the
   * book: an ordinary move re-anchors a boundary and removes nothing, so a
   * dialog for every move would be needless ceremony.
   */
  const [emptying, setEmptying] = useState<'next' | 'previous' | null>(null)
  const [jokeIndex, setJokeIndex] = useState(0)
  // Read once on mount; it is changed on another screen, and getting there
  // means leaving this one.
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

  // Shared by both buttons rather than duplicated per branch: a relookup in
  // flight is about to replace the title, authors and ISBN, so a save
  // started before it lands would write over the record it was correcting.
  const saveBlocked = saving || relookupBusy || !draft.title
  const whyBlocked = relookupBusy
    ? 'Waiting for the ISBN lookup to finish.'
    // This screen is a book the catalogue already holds, so an empty title
    // was just cleared rather than never filled in.
    : !draft.title
      ? 'Type the title off the book to save it.'
      : ''

  const one = (slot: Slot): Shot => {
    const crop = crops?.[slot] ?? ''
    const whole = photos[slot] ?? ''
    return {
      word: SLOT_SHORT[slot],
      sliver: slot === 'edge',
      photo: crop || whole || undefined,
      // Full screen shows the whole photograph, not the crop; absent only
      // where there was nothing to cut.
      full: whole || undefined,
    }
  }

  // Order decided by `threeSlots`, so this screen and the review screen
  // cannot disagree about it.
  const slots = threeSlots(
    one('edge'),
    // No press on it: it is not a photograph of this copy, so there is no
    // shutter that could take it again. Changing it is changing the ISBN.
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

  // Where the book sits is deliberately not one of these: the drawing below
  // says that, and a sentence duplicating it is a second thing to keep true.
  const facts = [
    category,
    printed || long ? `${[printed, long].filter(Boolean).join('. ')}.` : 'No publisher, year or length',
    seriesText(draft),
    isbnLine ? `ISBN ${isbnLine}` : 'No ISBN',
    filing ? `Files under ${filing}` : '',
  ].filter(Boolean)

  const back = editing && saved ? () => setEditing(false) : onDiscard

  // Read back off `boundaryMoves` rather than copied into state when
  // pressed, so a placement that arrives while the question is on screen is
  // the one it is about.
  const asked = emptying ? boundaryMoves?.[emptying] ?? null : null
  const goingWith = asked?.empties ? { ...asked, empties: asked.empties } : null

  // A move that only re-anchors a boundary happens on the press; one that
  // empties an area is asked about first, since that cannot be found out
  // afterwards.
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
        // Over the screen rather than beside it, and the screen underneath
        // is drawn in full: what somebody is being asked about is the book
        // they were just looking at. Only one of these is ever open at once.
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
          // `Sure`, not a second dialog invented here: the area screen asks
          // this exact question when somebody removes an area, and two
          // dialogs about one act are two sets of words waiting to disagree.
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
        <Trouble said={error} onDismiss={onDismissError} />
        {notice && <Said>{notice}</Said>}

        {/* Quiet weight, since this is not something to act on. The class
            is what browser tests hold on to; the paint is the card's. */}
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

        {/* One line and a door: pressing it opens the same shelving step a
            newly scanned or carried book uses. The two-answer version
            ("Moved it"/"Undo the move") still lives in the library's
            needs-attention list, which is a work list rather than a page
            about one book. */}
        {misfile && <Amiss onPress={onShelve} />}

        {editing ? (
          <>
            {/* Photographs first: whether they came out is the first thing
                anyone wants to know. Nothing presses back to the camera from
                here, since neither entry point is holding the book in the
                frame the camera left. */}
            <Shots {...slots} size="big" />

            {/* The ISBN leads the fields, since it decides what every other
                field says, and the way to correct it is a camera rather than
                a keyboard. */}
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

            {/* Surfaced here rather than only in the prompt: a failure
                arrives after the prompt has already closed. */}
            {!relookupBusy && (
              <Trouble
                said={relookupError
                  ? `Could not look that up: ${relookupError.replace(/\.?$/, '')}.`
                    + ' The digits you typed are still saved.'
                  : ''}
                onDismiss={onClearRelookupError}
              />
            )}

            <BookFields
              draft={draft}
              lookup={lookup}
              derivedFiling={derivedFiling}
              onChange={onChange}
              tags={tags}
              taggingBusy={taggingBusy}
              taggingError={taggingError}
              onRemoveTag={onRemoveTag}
              // Callback rather than local state: the panel covers the whole
              // screen, including the keyboard, under it.
              onAddTag={onAddTag ? () => setNaming(true) : undefined}
            />

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
              // Cancelling a catalogued edit drops back to the record view
              // without going through App, so nothing else stops a relookup
              // answer landing on it afterwards; wait the same as Save.
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
              {checkedOutAt ? (
                // Check-in goes through the same guided shuffle as a new
                // book: it is how a shelf gets rearranged by hand.
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

              {/* Offered only when this book's own recorded position is the
                  first or last of its area, and only toward wherever has
                  somewhere to go. */}
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

            {/* Outlined rather than filled: a filled red button invites the
                press it is warning about. */}
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

function seriesText(draft: Draft): string {
  if (!draft.seriesName) return ''
  return draft.seriesIndex ? `${draft.seriesName}, book ${draft.seriesIndex}` : draft.seriesName
}
