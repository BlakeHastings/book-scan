import { Card, Said } from '../design/Card'
import { Button, Field } from '../design/Controls'
import { Asked } from '../design/Sure'
import type { ResetCounts } from '../lib/api'
import { RESET_TITLE, resetWords } from '../lib/resetWords'
import { RESETS, RESET_PHRASES, confirms, type ResetName } from '../../shared/resets'

export type ResetPlans = { [Name in ResetName]?: ResetCounts[Name] }

interface Props {
  /** Whichever the server has answered. A reset with no answer yet draws no button. */
  plans: ResetPlans
  /** The reset whose phrase is being typed, or null when none is. */
  asking: ResetName | null
  typed: string
  busy: boolean
  /** What the last reset did, or why it was refused. */
  said: string
  onAsk: (name: ResetName) => void
  onType: (typed: string) => void
  onConfirm: () => void
  onKeep: () => void
}

/** Drawn rather than stateful, so the screen holds the state and this can be rendered as markup in a test. */
export function ResetsCard({
  plans, asking, typed, busy, said, onAsk, onType, onConfirm, onKeep,
}: Props) {
  const askingCounts = asking ? plans[asking] : undefined

  return (
    <Card kind="Starting over" title="Reset where your books are">
      <Said>
        Each of these changes every book or every piece of furniture at once,
        and asks you to type a phrase first.
      </Said>
      {said && <Said>{said}</Said>}

      {RESETS.map((name) => {
        const counts = plans[name]
        if (!counts) return null
        const words = resetWords(name, counts as ResetCounts[typeof name])
        return (
          <div key={name}>
            <span className="wf-field__label">{RESET_TITLE[name]}</span>
            <Said>{words.blocked || words.said}</Said>
            <Button tone="danger" block off={busy || Boolean(words.blocked)} onPress={() => onAsk(name)}>
              {RESET_TITLE[name]}
            </Button>
          </div>
        )
      })}

      {asking && askingCounts && (
        <Asked
          title={RESET_TITLE[asking]}
          said={resetWords(asking, askingCounts as ResetCounts[typeof asking]).said}
          onOut={busy ? undefined : onKeep}
        >
          <Field
            label={`Type "${RESET_PHRASES[asking]}" to do this`}
            value={typed}
            placeholder={RESET_PHRASES[asking]}
            focus
            onChange={onType}
            onEnter={() => { if (!busy && confirms(asking, typed)) onConfirm() }}
          />
          <div className="wf-sure__acts">
            <Button tone="danger" off={busy || !confirms(asking, typed)} onPress={onConfirm}>
              {RESET_TITLE[asking]}
            </Button>
            <Button tone="secondary" off={busy} onPress={onKeep}>
              Keep it
            </Button>
          </div>
        </Asked>
      )}
    </Card>
  )
}
