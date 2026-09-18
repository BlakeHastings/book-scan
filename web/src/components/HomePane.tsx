import type { ReactElement, ReactNode } from 'react'
import { TopBar, type TabName } from '../design/Chrome'
import { CarryBooks, Doors, InHand, SayWhat } from '../design/Controls'
import { Stats } from '../design/List'
import { Phone } from '../design/Phone'
import { Trouble } from '../design/Trouble'
import { troubleWith } from '../lib/backupWords'
import { driftTrouble } from '../lib/driftWords'
import { catalogueTrouble } from '../lib/catalogueWords'
import { CANNOT_REACH } from '../lib/reachWords'
import { grouped } from '../lib/say'
import type {
  BackupWatch, CarryItem, Counts, LookupStandings, QueueCounts,
} from '../lib/api'
import { CHECKED_OUT, type BookState } from '../../domain/books/state'
import type { Which } from './QueuePane'

interface Props {
  counts: Counts | null
  queue: QueueCounts | null
  /** Null until the read has answered, which is different from an empty list. */
  carrying: CarryItem[] | null
  unclaimed: number | null
  /**
   * Null whenever there is nothing to report: no answer yet, a failed read, a
   * healthy backup, or no directory being watched. The card only appears when
   * something is actually wrong.
   */
  backup: BackupWatch | null
  /** Null when there is nothing to report: no answer, a failed read, or zero drift. */
  drifting: number | null
  /**
   * Only a catalogue that was asked, described nothing, and is actively
   * refusing requests produces a card here; one merely slow or down does not.
   */
  lookups: LookupStandings | null
  /**
   * Whether the reads this screen is made of came back at all.
   *
   * A `401` or `403` never reaches this: `app/gate.tsx` replaces the screen
   * before this component sees it.
   */
  unreachable: boolean
  onAdd: () => void
  /**
   * Distinct from `onAdd`: this identifies a book already owned, `onAdd`
   * catalogues a new one. Using the wrong handler here would create a
   * duplicate record.
   */
  onInHand: () => void
  /**
   * Handed in rather than built here, so the same corner on the library
   * screen cannot drift out of sync with this one.
   */
  corner: { word: string; icon: ReactNode; onPress: () => void }
  menu?: ReactElement
  /**
   * Pass the state the count was about; passing null (as the total does) also
   * clears any narrowing left over from last time.
   */
  onLibrary: (showing?: BookState) => void
  /** Pass which books the count was about; the tab bar passes nothing. */
  onQueue: (showing?: Which) => void
  onCarry: () => void
  onUnclaimed: () => void
}

function waitingIn(queue: QueueCounts): number {
  return queue.pending + queue.ready + queue.failed
}

export function HomePane({
  counts, queue, carrying, unclaimed, backup, drifting, lookups, unreachable,
  onAdd, onInHand, corner, menu, onLibrary, onQueue, onCarry, onUnclaimed,
}: Props) {
  const tabs: Record<TabName, () => void> = {
    home: () => {},
    // Opens the whole library: a tab is a room, not a claim about content.
    library: () => onLibrary(),
    scan: onAdd,
    queue: () => onQueue(),
  }

  const top = (
    <TopBar
      title="Book scan"
      action={corner}
    />
  )

  // Independent of `counts`/`queue`: a slow or down catalogue must not be
  // able to hide news that the backup has stopped.
  const trouble = troubleWith(backup)
  const drift = driftTrouble(drifting)
  const catalogues = catalogueTrouble(lookups)
  const news = (unreachable || trouble || drift || catalogues) && (
    <>
      {/*
        Ranked by severity, except `unreachable`, which is drawn first
        because it explains why the rest of the screen is blank. Ordinarily
        it is alone here anyway: a server that could not answer it did not
        answer the other three either, so all three are null.
      */}
      {unreachable && (
        <Trouble kind="Counts" title={CANNOT_REACH.title}>{CANNOT_REACH.said}</Trouble>
      )}
      {trouble && <Trouble kind="Backups" title={trouble.title}>{trouble.said}</Trouble>}
      {drift && (
        <Trouble kind="Where books stand" title={drift.title}>{drift.said}</Trouble>
      )}
      {catalogues && (
        <Trouble kind="Catalogues" title={catalogues.title}>
          {catalogues.said}
        </Trouble>
      )}
    </>
  )

  // Nothing has come back yet. Drawing zeros would misrepresent the
  // collection for as long as the first request takes.
  if (!counts || !queue) return <Screen top={top} tabs={tabs} over={menu}>{news}</Screen>

  const waiting = waitingIn(queue)
  const bare = counts.total === 0 && waiting === 0

  return (
    <Screen top={top} tabs={tabs} over={menu}>
      {news}

      <Stats
        cat={bare ? 'sleeping' : undefined}
        items={[
          { n: grouped(counts.total), word: 'catalogued', onPress: () => onLibrary() },
          {
            n: grouped(counts.checkedOut),
            word: 'checked out',
            onPress: () => onLibrary(CHECKED_OUT),
          },
          {
            n: grouped(queue.ready),
            word: 'ready to shelve',
            onPress: () => onQueue('ready'),
          },
          ...(carrying
            ? [{ n: grouped(carrying.length), word: 'to carry', onPress: onCarry }]
            : []),
          { n: grouped(queue.failed), word: 'stuck', onPress: () => onQueue('stuck') },
        ]}
      />

      {(counts.total > 0 || waiting > 0
        || (carrying && carrying.length > 0)
        || (unclaimed !== null && unclaimed > 0)) && (
        <Doors cat="lying">
          {(counts.total > 0 || waiting > 0) && <InHand onPress={onInHand} />}
          {carrying && carrying.length > 0 && <CarryBooks onPress={onCarry} />}
          {unclaimed !== null && unclaimed > 0 && <SayWhat onPress={onUnclaimed} />}
        </Doors>
      )}
    </Screen>
  )
}

/**
 * `.wf` scopes the design system's tokens. The app's own stylesheet also
 * defines `--line` on `:root`, and inside `.wf` this one wins.
 */
function Screen({
  top, tabs, over, children,
}: {
  top: ReactElement
  tabs: Record<TabName, () => void>
  over?: ReactElement
  children?: ReactNode
}) {
  return (
    <div className="wf">
      <Phone tab="home" onTab={(name) => tabs[name]()} top={top} over={over}>
        {children}
      </Phone>
    </div>
  )
}
