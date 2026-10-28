/**
 * The apps somebody has let act as them, and the way to stop one.
 *
 * Every name here was chosen by the app that registered it, so each is drawn
 * as text with the host its approval went to boxed beside it, and the question
 * before a disconnect repeats the host rather than trusting the name alone.
 */

import { Card, Said } from './Card'
import { Button } from './Controls'
import { Sure } from './Sure'
import { CONNECTING_GUIDE, disconnectAsked, type ConnectionSaid } from '../lib/connectionWords'

export function Connections({
  rows,
  books = null,
  failed = '',
  said = '',
  asking = null,
  busy = false,
  onAsk,
  onDisconnect,
  onKeep,
}: {
  /** Null until the list has been read, so an empty list is never claimed before anybody asked. */
  rows: ConnectionSaid[] | null
  /** How many books a connection can reach, or null before the counts are read. */
  books?: number | null
  /** Why the list could not be read. */
  failed?: string
  /** What the last disconnect did, or why it did not. */
  said?: string
  /** The row being asked about, or null when nothing is. */
  asking?: ConnectionSaid | null
  busy?: boolean
  onAsk?: (row: ConnectionSaid) => void
  onDisconnect?: () => void
  onKeep?: () => void
}) {
  const asked = asking ? disconnectAsked(asking, books) : null

  return (
    <Card kind="Connections" title="Apps that use your books as you">
      {said && <Said>{said}</Said>}

      {rows === null ? (
        <Said>{failed ? `Could not read what is connected: ${failed}` : 'Reading what is connected.'}</Said>
      ) : rows.length === 0 ? (
        <>
          <Said>
            Nothing is connected. A connection is Claude, or another app you
            allowed in, reading and changing this catalogue as you.
          </Said>
          <Said>
            <a href={CONNECTING_GUIDE} target="_blank" rel="noreferrer">How to connect Claude</a>
            {' '}is written up step by step, and so is how to take it away again.
          </Said>
        </>
      ) : (
        <>
          <Said>
            Each of these can read and change this catalogue as you until you
            disconnect it. An app names itself, so the boxed address beside the
            name is what tells you which one it really is.
          </Said>
          {rows.map((row) => (
            <div key={row.id} className="wf-connection" role="group" aria-label={`${row.name}, through ${row.host}`}>
              {/* The name keeps the case it was registered in: uppercasing it would hide a lookalike. */}
              <div className="wf-connection__who">
                <span className="wf-connection__name">{row.name}</span>
                <span className="wf-connection__host">{row.host}</span>
              </div>
              <Said>{row.said}</Said>
              <Button tone="danger" block off={busy} onPress={() => onAsk?.(row)}>
                Disconnect
              </Button>
            </div>
          ))}
        </>
      )}

      {asking && asked && (
        <Sure
          title={asked.title}
          said={asked.said}
          act="Disconnect"
          busy={busy}
          onAct={onDisconnect}
          onKeep={busy ? undefined : onKeep}
        />
      )}
    </Card>
  )
}
