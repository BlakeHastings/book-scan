/**
 * The box a person names a tag in, wired to the collection they actually keep.
 *
 * `design/Naming.tsx` is the panel and `domain/tagging/naming.ts` is the rule.
 * This is the third piece: it asks the collection what it already means, hands
 * the answer to the drawing, and calls back with the one tag that was chosen.
 * It decides nothing itself, deliberately, because the thing it would be
 * deciding is whether "comic books" and "Comic Book" are one tag, and that is a
 * rule with a test on it rather than a condition in a component.
 *
 * ## Nothing typed is not an empty screen
 *
 * With the box empty it offers the tags this collection uses most. Somebody
 * scanning their second comic book then never types at all: open, tap, done,
 * which is the fast path this screen is on. It is also the honest first answer
 * to "what can I put on this", where a blank panel is an invitation to invent a
 * word the collection already has under another spelling.
 *
 * ## The two genre answers are not in here
 *
 * They are the two buttons this panel was opened from, and offering them again
 * would be two controls for one question, which the design rules already refuse
 * by name. `nameTag` covers the other half: a person typing "fiction" is sent
 * back to those buttons rather than quietly filed under something else, because
 * #304 is that this app writes a genre only when somebody actually answered
 * that question.
 */

import { useState } from 'react'
import { Nothing, Said } from '../design/Card'
import { Make, Naming } from '../design/Naming'
import { Suggestion, Suggestions } from '../design/Finding'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { slugSegment } from '../../domain/tagging/tags'
import { NAMED_UNDER, nameIn, nameTag, sameThing, type Naming as Verdict } from '../../domain/tagging/naming'
import type { TagRow } from '../lib/api'
import { labelOf, underOf } from '../lib/tagTree'

/** How many of the tags a collection uses most are offered before anything is typed. */
const FEW = 6

/** The two the buttons above the box answer, which this panel never offers. */
const GENRE_ANSWERS: string[] = [FICTION_SLUG, NON_FICTION_SLUG]

/**
 * The two sentences that mention a book, for the one door that has not got one.
 *
 * Everything else this panel says is about the word rather than about the book:
 * the refusal, the genre answer, where a new one goes. These two are not, and
 * #452 opened a third door where there is no book in anybody's hand, so "Type
 * what this book is" would be the panel asking about something that is not
 * there.
 *
 * A pair of strings rather than a `forBook` flag, because a boolean that
 * switches copy is a place two sets of words hide behind one name, and the next
 * caller cannot see what it is choosing between.
 */
export interface NamingWords {
  /** The invitation, with nothing typed and nothing to offer. */
  prompt: string
  /** What the panel calls it when the write is refused. */
  wrong: string
}

const ABOUT_A_BOOK: NamingWords = {
  prompt: 'Type what this book is. Whatever you say here, a rule can ask for.',
  wrong: 'That tag could not be added.',
}

export function TagNaming({
  vocabulary,
  carried,
  busy,
  error,
  words = ABOUT_A_BOOK,
  onPick,
  onClose,
}: {
  /** Every tag the collection keeps, with its counts. From `/api/tags`. */
  vocabulary: TagRow[]
  /** What this book is under already, as slugs. Offering one of those is a no-op. */
  carried: readonly string[]
  busy: boolean
  error: string
  /** The two sentences that assume a book. Defaults to the two that do. */
  words?: NamingWords
  onPick: (tag: { slug: string; label: string }) => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')

  const has = new Set(carried)
  /* What may be offered at all: not the two above, and not what this book is
     already under. Both are things that would draw a target that does nothing. */
  const offerable = vocabulary.filter(
    (tag) => !GENRE_ANSWERS.includes(tag.slug) && !has.has(tag.slug),
  )

  const answer = nameTag(typed, offerable)

  /* What the new tag will sit under, in the words this collection already uses
     for it. Never the slug: nesting is said, and a pinned test refuses a screen
     that draws one. */
  const under = labelOf(
    vocabulary.find((one) => one.slug === NAMED_UNDER.value)
    ?? { slug: NAMED_UNDER.value, label: '' },
  )

  const offer = (tag: TagRow) => (
    <Suggestion
      key={tag.slug}
      name={labelOf(tag)}
      where={underOf(tag, vocabulary)}
      books={tag.books}
      onPress={busy ? undefined : () => onPick({ slug: tag.slug, label: labelOf(tag) })}
    />
  )

  /*
   * What is listed, which is a wider question than what `nameTag` answers.
   *
   * `nameTag` decides whether the collection already *means* what was typed,
   * which is a whole word against a whole word: that is the question about
   * making a second tag, and it is deliberately strict. What somebody wants
   * while they are still typing is looser than that. Half a word matching the
   * front of a tag they keep is the fast path working, and without it the
   * second comic book somebody scans sees nothing at all until the word is
   * finished, which is the moment they would give up and type their own.
   *
   * The ones that mean the same thing come first, because those are the answer
   * rather than a lead.
   *
   * Before anything is typed it is the tags this collection uses most, and only
   * a few: there is a keyboard over the bottom two thirds of a phone, so this
   * has room for about four, and a longer list is one somebody scrolls instead
   * of reads.
   */
  const looking = typed.trim().toLowerCase()
  const key = sameThing(typed)
  const name = slugSegment(typed)
  const reading = looking
    ? [...offerable]
      .filter((tag) => labelOf(tag).toLowerCase().includes(looking)
        || nameIn(tag.slug).includes(name)
        || sameThing(nameIn(tag.slug)) === key)
      .sort((a, b) => Number(sameThing(nameIn(b.slug)) === key)
        - Number(sameThing(nameIn(a.slug)) === key))
      .slice(0, FEW)
    : [...offerable].sort((a, b) => b.books - a.books).slice(0, FEW)

  return (
    <Naming
      typed={typed}
      onType={setTyped}
      onClose={onClose}
      reads={reads(answer, busy, reading.length)}
    >
      {error && <Nothing said={words.wrong}>{error}</Nothing>}

      {reading.length > 0 && (
        <Suggestions label={looking ? 'Tags reading like that' : 'Tags you use most'}>
          {reading.map(offer)}
        </Suggestions>
      )}

      {answer.kind === 'nothing' && reading.length === 0 && (
        <Said>{words.prompt}</Said>
      )}

      {answer.kind === 'genre' && (
        <Said>
          Fiction and non-fiction are the two above this box. They decide which
          bookcase the book crosses the room to, so they are answered there
          rather than typed.
        </Said>
      )}

      {/* The refusal, said. There is no way past it on purpose: a panel that
          offered to make one anyway is a panel where the second comic book
          makes the second comic book tag. */}
      {answer.kind === 'already' && answer.nearly && (
        <Said>
          That is the same word to this app as the one you already keep, so there
          is one tag rather than two. Add it, or type something else.
        </Said>
      )}

      {answer.kind === 'new' && (
        <>
          <Make
            name={answer.label}
            where={under}
            onPress={busy ? undefined : () => onPick({ slug: answer.slug, label: answer.label })}
          />
          {/* Where it goes and why, and deliberately not "nothing of yours
              reads like that": tags reading like it may well be listed above,
              because half a word matches the front of one and does not mean it.
              A sentence contradicting the list over it is worse than no
              sentence. Found by looking at it with "comic" typed. */}
          <Said>
            A new one goes under {under}, where your catalogue's own words go, so
            a rule can ask for it.
          </Said>
        </>
      )}
    </Naming>
  )
}

/**
 * The quiet line under the field: what the box made of what was typed.
 *
 * Only where it is not obvious from the answers underneath, which is the same
 * rule the find screen's field follows. A list of tags needs no caption; a
 * refusal and an empty panel both do.
 */
function reads(answer: Verdict, busy: boolean, listed: number): string | undefined {
  if (busy) return 'Adding it...'
  if (answer.kind === 'genre') return 'That is one of the two above.'
  if (answer.kind === 'already' && answer.nearly) return 'You already keep this one.'
  // Only when there is genuinely nothing under it. Half a word matches the
  // front of a tag without meaning it, so this line and a list of tags reading
  // like it were on screen together until it was looked at.
  if (answer.kind === 'new' && listed === 0) return 'Nothing of yours reads like that yet.'
  if (listed > 0 && answer.kind !== 'nothing') {
    return listed === 1 ? 'One of your tags reads like that.' : `${listed} of your tags read like that.`
  }
  return undefined
}
