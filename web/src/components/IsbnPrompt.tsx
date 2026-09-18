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
 * The photos stay visible behind this: the whole point is to read digits off
 * the cover on screen and type them in, so a full-screen dialog would hide
 * what is being copied. That is why it is drawn as a card asked over the
 * screen rather than a panel from the top.
 *
 * The lookup happens after this closes, not while it is open: submit hands
 * off the ISBN and this unmounts immediately, so there is deliberately no
 * busy or error state here, both belong to the screen the answer lands on.
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
      {/* The camera action is this design system's way of saying a field has another way to answer it. */}
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

      {/* A barcode read is as reliable as typing it; a text (OCR) read is a guess and deserves a second look. */}
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
