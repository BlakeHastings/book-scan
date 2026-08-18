/**
 * Writing a rule on the place it is about: the state, and nothing drawn.
 *
 * **One hook, two screens.** An area's page and a piece's page answer the same
 * two questions, and #382 made them draw one widget rather than two so they
 * could not drift. The behaviour behind that widget is the same fact one level
 * down: the lines somebody is holding, the vocabulary they pick from, the plan
 * they read, and the write at the end of it are identical on both pages, and a
 * second copy of them in the second screen is two behaviours that agree until
 * one of them is edited.
 *
 * ## The rule is a draft until the last press
 *
 * Nothing here writes until `apply`. That is what makes a half-built rule safe:
 * taking the last line off is a state somebody passes through on the way to the
 * right one, and if it were a write the collection would spend that moment with
 * an area claiming nothing and a plan nobody asked for. See `server/place-rule.ts`.
 *
 * ## Planning is a press, not a keystroke
 *
 * The plan runs the rules over every book in the collection. Asking for one on
 * every change would put that behind a thumb, and it would also be the wrong
 * shape of promise: what somebody agrees to is the answer they read, so the
 * answer is cleared the moment the lines stop matching it.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type DraftRule, type RuleChangePlan, type RuleDraftLine, type TagRow,
} from '../lib/api'
import { linesSaid, offering, slugFor } from '../lib/ruleWriting'
import type { RuleEditing } from '../design/Rules'

/** Which place is being written about, which is exactly one of two things. */
export interface Place {
  about: 'area' | 'fixture'
  id: number
}

export interface Writing {
  /** Whether somebody is writing a rule at all. */
  on: boolean
  /**
   * What they have written: the rules on this place, each a list of lines.
   *
   * Two levels and no third. A line added to a rule is "and"; a rule added to
   * the place is "or"; a group inside a group is the boolean tree the model
   * refuses and there is nowhere here to hold one.
   */
  rules: DraftRule[]
  /** What the change would do, once they have asked. Null until they have. */
  plan: RuleChangePlan | null
  /** What the write did, once it has. Null until then. */
  applied: { wrote: number; carrying: number } | null
  busy: boolean
  error: string
  /** The vocabulary a line can be chosen from, as the app already reads it. */
  vocabulary: TagRow[]
  /** Everything the widget needs, already wired. Null when nobody is writing. */
  editing: RuleEditing | null
  /** Open it, seeded from the rules written on this place today. */
  start: () => void
  /** Shut it without writing anything, which is most of the ways out. */
  stop: () => void
  /** Write it down, and answer whether that worked. */
  apply: () => Promise<boolean>
}

/**
 * Nobody is writing a rule, which is what a page looks like almost all the time.
 *
 * A value rather than a special case, so a pane never has to ask whether it was
 * handed one: the resting state answers every question with "no", and a test
 * that is about something else on the page hands this and says nothing more.
 */
export const RESTING: Writing = {
  on: false,
  rules: [],
  plan: null,
  applied: null,
  busy: false,
  error: '',
  vocabulary: [],
  editing: null,
  start: () => {},
  stop: () => {},
  apply: async () => false,
}

/**
 * @param after Called once the write has landed, so the page can read the room
 *   again. **Found by walking it**: applying wrote the rule and the card above
 *   the confirmation went on saying what the area used to allow, because a label
 *   and a rule in this app are worked out at read time and nothing had re-read
 *   them. The page was reporting a change it was not showing.
 */
export function useWriting(place: Place | null, after?: () => void): Writing {
  const [on, setOn] = useState(false)
  const [rules, setRules] = useState<DraftRule[]>([])
  /** Which rule a tag is being chosen for, or null when none is. */
  const [choosing, setChoosing] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [plan, setPlan] = useState<RuleChangePlan | null>(null)
  const [applied, setApplied] = useState<{ wrote: number; carrying: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [vocabulary, setVocabulary] = useState<TagRow[]>([])

  /*
   * Read once, when somebody opens the editor rather than when the page loads.
   * The vocabulary is only ever needed by the picker, and a page somebody is
   * reading should not fetch a list of four hundred tags on the chance that they
   * are about to change a rule.
   */
  useEffect(() => {
    if (!on || vocabulary.length > 0) return
    let stale = false
    api.tags()
      .then((got) => { if (!stale) setVocabulary(got.tags) })
      .catch((caught) => { if (!stale) setError((caught as Error).message) })
    return () => { stale = true }
  }, [on, vocabulary.length])

  /*
   * The rules are read again on the way in rather than taken off the room the
   * page is already drawing. The room answers rules in labels, because no
   * reading route in this app hands out an identity; what goes back has to be
   * the identity, so what comes in is asked for in that shape from the one route
   * that speaks it.
   */
  const start = useCallback(() => {
    setRules([])
    setPlan(null)
    setApplied(null)
    setChoosing(null)
    setQuery('')
    setError('')
    setOn(true)
    if (!place) return

    api.placeRules(place.about, place.id)
      .then((got) => setRules(got.rules))
      .catch((caught) => setError((caught as Error).message))
  }, [place])

  const stop = useCallback(() => {
    setOn(false)
    setChoosing(null)
    setPlan(null)
    setError('')
  }, [])

  /*
   * Every change throws the plan away. What somebody agreed to is the answer
   * they read, and a plan drawn against rules it was not worked out from is the
   * one lie this whole journey exists to make impossible.
   */
  const held = useCallback((next: DraftRule[]) => {
    setRules(next)
    setPlan(null)
    setError('')
  }, [])

  /** One rule changed and the rest left alone, which is every edit there is. */
  const changed = useCallback((group: number, lines: RuleDraftLine[]) => {
    held(rules.map((rule, at) => (at === group ? { ...rule, conditions: lines } : rule)))
  }, [held, rules])

  const ask = useCallback(async () => {
    if (!place) return
    setBusy(true)
    setError('')
    try {
      const answer = await api.planRuleChange({
        about: place.about,
        placeId: place.id,
        rules,
      })
      setPlan(answer.plan)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }, [place, rules])

  const apply = useCallback(async () => {
    if (!place) return false
    setBusy(true)
    setError('')
    try {
      const answer = await api.applyRuleChange({
        about: place.about,
        placeId: place.id,
        rules,
      })
      setApplied({ wrote: answer.wrote.assigned, carrying: answer.plan.moving })
      setPlan(null)
      setOn(false)
      setChoosing(null)
      after?.()
      return true
    } catch (caught) {
      setError((caught as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }, [place, rules, after])

  const editing: RuleEditing | null = on
    ? {
      /*
       * The labels, worked out from the slugs the draft holds. One direction
       * only: a tag is drawn by its label and never by its identity, and the
       * identity is what goes back to the server.
       */
      groups: rules.map((rule) => linesSaid(vocabulary, rule.conditions)),
      choosing: choosing === null
        ? null
        : {
          group: choosing,
          query,
          offering: offering(
            vocabulary,
            query,
            (rules[choosing]?.conditions ?? []).map((line) => line.tag),
          ),
          onQuery: setQuery,
          onPick: (label) => {
            const slug = slugFor(vocabulary, label)
            if (!slug) return
            changed(choosing, [
              ...(rules[choosing]?.conditions ?? []),
              { operator: 'is', tag: slug },
            ])
            setChoosing(null)
            setQuery('')
          },
          onClose: () => { setChoosing(null); setQuery('') },
        },
      busy,
      onAsk: (group, at, operator) => changed(
        group,
        (rules[group]?.conditions ?? []).map((line, index) =>
          (index === at ? { ...line, operator } : line)),
      ),
      onTakeOff: (group, at) => changed(
        group,
        (rules[group]?.conditions ?? []).filter((_, index) => index !== at),
      ),
      onAdd: (group) => { setQuery(''); setChoosing(group) },
      /*
       * "Or", which is another rule on the same place. A new one has no id
       * because it is not a row yet, and it starts empty, which claims nothing
       * until a tag goes on it: a half-built alternative files no book anywhere.
       */
      onAlso: () => {
        held([...rules, { id: null, conditions: [] }])
        setQuery('')
        setChoosing(rules.length)
      },
      onDrop: (group) => {
        setChoosing(null)
        held(rules.filter((_, at) => at !== group))
      },
      onPlan: () => { void ask() },
      onClose: stop,
    }
    : null

  return {
    on, rules, plan, applied, busy, error, vocabulary, editing, start, stop, apply,
  }
}
