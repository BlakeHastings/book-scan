/**
 * What the last change of mind did to a list somebody was halfway through.
 *
 * The counts are the easy half and they lead, because the first question is
 * whether the job got bigger. The second card is the one this screen exists for:
 * **books that were carried and have to be carried again.** Nobody may find that
 * out one book at a time standing at a shelf, so they are named here with both
 * ends of the new carry on them.
 *
 * There is nothing to accept or dismiss. The list changed the moment the rule
 * did, because there is no plan and nothing is stored: the work is what the
 * ledger says now. This only says what happened, and the way on is the work.
 *
 * ## Where the numbers come from, since nothing recorded a session
 *
 * The rules write their assignments in one run with one timestamp, so the newest
 * of those timestamps names the last change of mind and the rows carrying it are
 * what it did. Folding each of those books with and without that run is the
 * difference somebody would notice. See `domain/placement/carry.ts`.
 */

import { Card, Instruction } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { List, Row } from '../design/List'
import { WfScreen } from './WfScreen'
import { plural, said, saidBooks, words } from '../lib/carryWords'
import type { Cloth } from '../design/Shelf'
import type { CarryWork } from '../lib/api'

interface Props {
  work: CarryWork | null
  onCarry: () => void
  onHome: () => void
  onQueue: () => void
  onScan: () => void
}

const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']

const clothFor = (id: number): Cloth => CLOTHS[Math.abs(id) % CLOTHS.length]!

/**
 * What the change did, which is the first question: did the job get bigger.
 *
 * Both halves in one sentence when there are two, because they are one event.
 */
function whatItDid(left: number, joined: number): string {
  const off = `took ${plural(left, 'book')} off your list`
  const on = `put ${plural(joined, 'book')} on your list`

  if (left > 0 && joined > 0) return `Your last change ${off} and put ${plural(joined, 'book')} on.`
  return `Your last change ${left > 0 ? off : on}.`
}

export function CarryStalePane({ work, onCarry, onHome, onQueue, onScan }: Props) {
  const tabs: Record<TabName, () => void> = {
    home: onHome,
    library: onCarry,
    scan: onScan,
    queue: onQueue,
  }

  const changed = work?.changed ?? null

  if (!work || !changed) {
    return (
      <WfScreen tab="library" tabs={tabs} top={<TopBar title="What changed" onBack={onCarry} />}>
        {work && (
          <Instruction>Nothing has changed since you were last here.</Instruction>
        )}
      </WfScreen>
    )
  }

  return (
    <WfScreen
      tab="library"
      tabs={tabs}
      top={<TopBar title="What changed" sub="You changed where books belong" onBack={onCarry} />}
    >
      {/*
        The two counts, and not "your list went from 38 books to 47".
        Subtracting one from the other is only true at the moment of the change:
        carry three books afterwards and the arithmetic goes backwards, which it
        did on a real list the first time this screen was walked. What is always
        true is what the change itself did.
      */}
      <Instruction>{whatItDid(changed.left, changed.joined)}</Instruction>

      {changed.left > 0 && (
        <Card
          kind="Off the list"
          title={`${saidBooks(changed.left)} no longer ${changed.left === 1 ? 'moves' : 'move'}`}
        >
          <p>
            The rules now want {changed.left === 1 ? 'it' : 'them'} where{' '}
            {changed.left === 1 ? 'it already is' : 'they already are'}.
          </p>
        </Card>
      )}

      {changed.joined > 0 && (
        /* One card, not two. The books that have to be carried again are the
           whole reason this screen exists, so they sit inside the count they
           belong to rather than reading as a fourth thing that happened. */
        <Card kind="On the list" title={`${saidBooks(changed.joined)} joined`}>
          {changed.again.length > 0 && (
            <>
              {/* "Two of them" when the two are all of them is a sentence that
                  makes somebody count. Found by looking at a list where every
                  book that joined was one they had carried. */}
              <p>
                {changed.again.length === changed.joined
                  ? `You had already carried ${changed.joined === 1 ? 'it' : 'them'}.`
                  : `${said(changed.again.length)} of the ${
                    words(changed.joined)} you had already carried.`}
              </p>
              <List label="Books to carry again">
                {changed.again.map((one) => (
                  <Row
                    key={one.book.id}
                    title={one.book.title}
                    sub={one.book.authorFiling}
                    cloth={clothFor(one.book.id)}
                    meta={`${one.from} to ${one.to}`}
                    onward={false}
                  />
                ))}
              </List>
            </>
          )}
        </Card>
      )}

      <Button tone="primary" block onPress={onCarry}>
        Show me what is left
      </Button>
    </WfScreen>
  )
}
