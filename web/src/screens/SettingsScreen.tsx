/**
 * How your books are ordered goes to the server, since it is one row in the collection the
 * whole house shares; it goes through `useRoom`, so the answer is re-read after the write
 * rather than assumed.
 *
 * Which hand you hold the phone in and which picture of a book comes first both stay on the
 * phone: nobody signs in, so a preference written to the collection would be one person in
 * the house deciding for everybody.
 *
 * The resets are counted by the server before each press and counted again after, so what
 * a button promises is never older than the last thing anybody did here.
 */

import { useCallback, useEffect, useState } from 'react'
import { SettingsPane } from '../components/SettingsPane'
import { ResetsCard, type ResetPlans } from '../components/ResetsCard'
import { Connections } from '../design/Connections'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { useSummary } from '../app/summary'
import { api, Refusal, type SortStrategyCode } from '../lib/api'
import { rememberFirstPicture, rememberedFirstPicture } from '../lib/firstPicture'
import { rememberHand, rememberedHand } from '../lib/hand'
import { resetDone } from '../lib/resetWords'
import {
  ALREADY_GONE, connectionSaid, disconnected, type ConnectionSaid,
} from '../lib/connectionWords'
import { RESETS, type ResetName } from '../../shared/resets'

export function SettingsScreen() {
  const { leaveRoom } = useNavigation()
  const { room, error, busy, write, read } = useRoom()
  const [hand, setHand] = useState(rememberedHand)
  const [firstPicture, setFirstPicture] = useState(rememberedFirstPicture)
  const tabs = useRoomTabs()
  // Off the health read the app already makes on every change of screen, so this screen costs no request of its own.
  const { lookups, counts } = useSummary()
  useDesignPage()

  const [plans, setPlans] = useState<ResetPlans>({})
  const [asking, setAsking] = useState<ResetName | null>(null)
  const [typed, setTyped] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetSaid, setResetSaid] = useState('')

  const countResets = useCallback(async () => {
    const answered = await Promise.all(RESETS.map((name) => api.planReset(name).catch(() => null)))
    const next: ResetPlans = {}
    for (const plan of answered) {
      if (plan) (next as Record<ResetName, unknown>)[plan.reset] = plan.counts
    }
    setPlans(next)
  }, [])

  useEffect(() => { void countResets() }, [countResets])

  const [connections, setConnections] = useState<ConnectionSaid[] | null>(null)
  const [connectionsFailed, setConnectionsFailed] = useState('')
  const [unhooking, setUnhooking] = useState<ConnectionSaid | null>(null)
  const [unhookBusy, setUnhookBusy] = useState(false)
  const [unhookSaid, setUnhookSaid] = useState('')

  // A 401 or 403 here has already told the gate, which draws the sign-in over this screen.
  const readConnections = useCallback(async () => {
    try {
      const answer = await api.connections()
      setConnections(answer.connections.map((one) => connectionSaid(one)))
      setConnectionsFailed('')
    } catch (caught) {
      setConnections(null)
      setConnectionsFailed((caught as Error).message)
    }
  }, [])

  useEffect(() => { void readConnections() }, [readConnections])

  const disconnect = async () => {
    if (!unhooking) return
    const one = unhooking
    setUnhookBusy(true)
    try {
      await api.disconnect(one.id)
      setUnhookSaid(disconnected(one))
    } catch (caught) {
      setUnhookSaid(caught instanceof Refusal && caught.status === 404 ? ALREADY_GONE : (caught as Error).message)
    } finally {
      setUnhooking(null)
      setUnhookBusy(false)
      await readConnections()
    }
  }

  const confirm = async () => {
    if (!asking) return
    const name = asking
    setResetting(true)
    try {
      const answer = await api.runReset(name, typed)
      setResetSaid(resetDone(name, answer.done))
      setAsking(null)
      setTyped('')
    } catch (caught) {
      setResetSaid((caught as Error).message)
      setAsking(null)
    } finally {
      setResetting(false)
      await Promise.all([countResets(), read()])
    }
  }

  return (
    <SettingsPane
      room={room}
      hand={hand}
      firstPicture={firstPicture}
      busy={busy}
      error={error}
      tabs={tabs}
      lookups={lookups}
      onBack={leaveRoom}
      onOrder={(code: SortStrategyCode) => { void write(() => api.editCollection(code)) }}
      onHand={(next) => { setHand(next); rememberHand(next) }}
      onFirstPicture={(next) => { setFirstPicture(next); rememberFirstPicture(next) }}
      connections={(
        <Connections
          rows={connections}
          books={counts?.total ?? null}
          failed={connectionsFailed}
          said={unhookSaid}
          asking={unhooking}
          busy={unhookBusy}
          onAsk={(one) => { setUnhooking(one); setUnhookSaid('') }}
          onDisconnect={() => { void disconnect() }}
          onKeep={() => setUnhooking(null)}
        />
      )}
      resets={(
        <ResetsCard
          plans={plans}
          asking={asking}
          typed={typed}
          busy={resetting}
          said={resetSaid}
          onAsk={(name) => { setAsking(name); setTyped(''); setResetSaid('') }}
          onType={setTyped}
          onConfirm={() => { void confirm() }}
          onKeep={() => { setAsking(null); setTyped('') }}
        />
      )}
    />
  )
}
