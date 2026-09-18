/**
 * There is nothing to accept or dismiss: there is no plan and nothing is
 * stored, so the list changes the moment the rule does and this only reports
 * what happened. The rules write assignments in one run with one timestamp;
 * the newest of those timestamps names the last change and its rows are what
 * it did. See `domain/placement/carry.ts`.
 */

import { Card, Instruction } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { List, Row } from '../design/List'
import { coverThumbUrl } from './PlacementCard'
import { WfScreen } from './WfScreen'
import { clothFor } from '../lib/bookLook'
import { plural, said, saidBooks, words } from '../lib/carryWords'
import type { CarryWork } from '../lib/api'

interface Props {
  work: CarryWork | null
  onCarry: () => void
  onHome: () => void
  onQueue: () => void
  onScan: () => void
}

/** Both halves in one sentence when there are two, since they are one event. */
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
      {/* Deliberately not "went from 38 to 47": subtracting one count from the other is only true at the moment of the change, and goes wrong the instant a book is carried afterwards. */}
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
        <Card kind="On the list" title={`${saidBooks(changed.joined)} joined`}>
          {changed.again.length > 0 && (
            <>
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
                    photo={coverThumbUrl(one.book.cover, 160)}
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
