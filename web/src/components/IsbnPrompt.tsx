import { useState } from 'react'
import { resolveIsbnPair } from '../../shared/isbn'
import { Said } from '../design/Card'
import { Button, Field } from '../design/Controls'
import { IconCamera } from '../design/Icons'
import { Asked } from '../design/Sure'
import { IsbnCamera } from './IsbnCamera'

interface Props {
  initial: string
  onCancel: () => void
  onSubmit: (isbn: string) => void
}

/**
 * Asks for an ISBN and validates it before spending a network round trip.
 *
 * The photos stay visible behind it: the whole point is to read the digits off
 * the cover on screen and type them in, so a full-screen dialog would hide the
 * thing being copied. That is why this is the card `Sure` is asked on and not
 * the panel `Naming` is: a panel from the top is right for a question whose
 * answers are a list, and wrong for one whose answer is on the screen behind
 * it.
 *
 * The lookup itself happens after this closes, not while it is open: submit
 * hands the ISBN off and this unmounts immediately, so the search plays out on
 * the detail view underneath rather than inside a busy modal. That is also
 * why there is no busy or error state here; both belong to the screen the
 * answer actually lands on.
 *
 * ## What #408 changed here, and what it did not
 *
 * The chrome. It was the last `.modal` in the app: a card in the old app's
 * colours drawn over two screens that had been converted around it, opened by
 * a `Field` the design system draws and answered by buttons it does not. It is
 * `Asked`, `Field`, `Said` and `Button` now, so the card, the box, the quiet
 * line under it and both answers are the ones every other screen uses.
 *
 * **What it asks and what it does with the answer are untouched.** The same
 * `resolveIsbnPair`, the same rule about not complaining until ten digits have
 * been typed, the same refusal to submit anything that is not a valid ISBN,
 * and the same sentence naming a text read as a guess worth checking.
 *
 * Two small things went with the old card and are worth saying out loud. The
 * red on the invalid line is now the system's quiet line beside a button that
 * cannot be pressed, which is the pattern every other screen answers "why can
 * I not press this" with. And Escape no longer cancels: this is a phone, the
 * ways out are the button and the page around the card, and both are drawn.
 *
 * **The gallery has no drawing of this card.** What it draws is the ISBN field
 * with a camera at the end of it going straight to a camera, which is a
 * different flow: it has no way to type. Which of the two is right is a
 * question for the owner and not one to settle by building.
 */
export function IsbnPrompt({ initial, onCancel, onSubmit }: Props) {
  const [value, setValue] = useState(initial)
  const [scanning, setScanning] = useState(false)
  const [readFrom, setReadFrom] = useState<'barcode' | 'ocr' | ''>('')

  const pair = resolveIsbnPair(value)
  const digits = value.replace(/[^0-9Xx]/g, '')
  const valid = Boolean(pair.isbn13)
  // Only complain once enough has been typed to judge it.
  const showInvalid = digits.length >= 10 && !valid

  if (scanning) {
    return (
      <IsbnCamera
        onCancel={() => setScanning(false)}
        onRead={(isbn, source) => {
          setValue(isbn)
          setReadFrom(source)
          setScanning(false)
        }}
      />
    )
  }

  return (
    <Asked
      title="Change ISBN"
      said="Type the ISBN, or photograph it off the book. Hyphens and spaces are fine."
      onOut={onCancel}
    >
      {/* The camera at the end of the box, which is the way this system says a
          field has another way to answer it, and the way the drawing puts it on
          the ISBN field that opens this. Thirteen digits typed off a book by
          somebody holding the book is the slowest and least reliable answer. */}
      <Field
        label="ISBN"
        value={value}
        placeholder="978-0-441-01359-3"
        focus
        onChange={(typed) => { setValue(typed); setReadFrom('') }}
        onEnter={() => { if (valid) onSubmit(value) }}
        action={{
          name: 'Photograph the ISBN',
          icon: <IconCamera size={20} />,
          onPress: () => setScanning(true),
        }}
      />

      <Said>
        {showInvalid
          ? 'That is not a valid ISBN-10 or ISBN-13. Check the digits.'
          : valid
            ? `Reads as ${pair.isbn13}${pair.isbn10 ? ` (${pair.isbn10})` : ''}`
            : 'Enter 10 or 13 digits.'}
      </Said>

      {/* Named rather than implied. A barcode read is as good as typing it;
          a text read is a guess at digits and deserves a second look. */}
      {readFrom && valid && (
        <Said>
          {readFrom === 'barcode'
            ? 'Scanned from the barcode.'
            : 'Read from the printed text. Check the digits before looking it up.'}
        </Said>
      )}

      <Button tone="primary" block off={!valid} onPress={() => onSubmit(value)}>
        Look up and replace
      </Button>
      <Button tone="quiet" block onPress={onCancel}>
        Cancel
      </Button>
    </Asked>
  )
}
