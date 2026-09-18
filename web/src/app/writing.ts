/**
 * Writing a rule on the place it is about: the state, and nothing drawn.
 *
 * One hook, shared by an area's page and a piece's page, so the behaviour
 * cannot drift between two copies of it.
 *
 * Nothing here writes until `apply`, so a half-built rule is safe to pass
 * through. See `server/place-rule.ts`.
 *
 * The plan is asked for by a press, not recomputed on every keystroke: the
 * plan somebody agreed to is the answer they read, so it is cleared the
 * moment the lines stop matching it.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type DraftRule, type RuleChangePlan, type RuleDraftLine, type TagRow,
} from '../lib/api'
import { linesSaid, making, offering, slugFor } from '../lib/ruleWriting'
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
   * Two levels and no third: a line added to a rule is "and", a rule added
   * to the place is "or", and there is nowhere here to hold a nested group.
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
 * Nobody is writing a rule, which is what a page looks like almost all the
 * time. A value rather than a special case, so a pane never has to ask
 * whether it was handed one.
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
 * @param after Called once the write has landed, so the page can read the
 *   room again: a label and a rule in this app are worked out at read
 *   time, so nothing else would notice the change.
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
   * Read once, when somebody opens the editor rather than when the page
   * loads: a page somebody is just reading should not fetch a list of
   * hundreds of tags on the chance they are about to change a rule.
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
   * The rules are read again on the way in rather than taken off what the
   * page is already drawing: no other reading route in this app hands out
   * a rule's identity, only its label, and identity is what has to go back.
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
   * Every change throws the plan away: a plan drawn against rules it was
   * not worked out from would misrepresent what somebody is agreeing to.
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

  /**
   * Everything the picker needs for one rule: what to offer, and what to
   * make.
   *
   * Words already on the place count as vocabulary too: a word named on
   * the first rule of an "or" has no row until the write, so without this
   * a picker would offer to make it a second time.
   */
  const chooseFor = (group: number) => {
    const onThisRule = rules[group]?.conditions ?? []
    const namedHere = rules.flatMap((rule) => rule.conditions)
    const { make, said, slug } = making(vocabulary, query, namedHere)
    const put = (tag: string, label?: string) => {
      changed(group, [
        ...(rules[group]?.conditions ?? []),
        { operator: 'is' as const, tag, ...(label ? { label } : {}) },
      ])
      setChoosing(null)
      setQuery('')
    }

    return {
      group,
      query,
      /*
       * Narrowed by the lines on this rule, not the place's: two rules can
       * legitimately name the same tag, and hiding it would make the
       * second "or" unwritable.
       */
      offering: offering(vocabulary, query, onThisRule.map((line) => line.tag)),
      make: make && slug ? { ...make, onPress: () => put(slug, make.name) } : null,
      said,
      onQuery: setQuery,
      onPick: (label: string) => {
        const slugged = slugFor(vocabulary, label)
        if (slugged) { put(slugged); return }
        /* A word named on another rule of this place has no row yet, so the
           vocabulary cannot answer for it and the draft does. */
        const named = namedHere.find((line) => line.label === label)
        if (named) put(named.tag, named.label)
      },
      onClose: () => { setChoosing(null); setQuery('') },
    }
  }

  const editing: RuleEditing | null = on
    ? {
      /*
       * The labels, worked out from the slugs the draft holds. One
       * direction only: a tag is drawn by its label but sent back by its
       * identity.
       */
      groups: rules.map((rule) => linesSaid(vocabulary, rule.conditions)),
      choosing: choosing === null
        ? null
        : chooseFor(choosing),
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
       * "Or": another rule on the same place. A new one has no id since it
       * is not a row yet, and starts empty, so it claims nothing until a
       * tag goes on it.
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
