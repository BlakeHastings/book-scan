/**
 * Changing what belongs where: point a rule at other furniture, see every book
 * that would move, apply it.
 *
 * **There is one of these and this is it.** #244 built it, reached from the
 * library, because the run somebody wants to move is the one they are looking
 * at. #323 gave the rule itself a way here, because somebody standing in front
 * of a bookcase looks at the rule rather than at the library. Both are the same
 * journey and there is deliberately no second screen for the second way in: a
 * rule change is a plan and an apply, and building a second one beside this
 * would be two answers to where the books go.
 *
 * Backing out lands on whichever screen offered the change, which is
 * `leaveArranging`. From the library that is the library's own return anchor,
 * so it lands on the stretch of books this screen was about: landing on Fiction
 * after moving non-fiction reads as the apply having done nothing.
 *
 * **Applying lands on the carry flow instead**, since #314 built it. Applying
 * writes down where the rules want each book and moves nothing, so the honest
 * next thing is the trips somebody would walk.
 */

import { MoveRunView } from '../components/MoveRunView'
import { useNavigation } from '../app/navigation'

export function ArrangeScreen() {
  const { arranging, arrangeFrom, leaveArranging, setRoute } = useNavigation()

  return (
    <MoveRunView
      range={arranging}
      onBack={leaveArranging}
      backSaid={arrangeFrom === 'belongs' ? 'Back to the rule' : 'Back to the library'}
      onCarry={() => setRoute('carry')}
    />
  )
}
