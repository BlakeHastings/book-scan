/**
 * Settings: the two answers this app already holds and had nowhere to ask for.
 *
 * **Nothing on it was invented, and the shortness of it is the finding.** The
 * instruction in #329 was not to draw a page of switches, so what is here was
 * arrived at by going and looking for every answer the app already keeps, and
 * then taking off the ones that already live somewhere better.
 *
 * ## The two that had no home, and both change something
 *
 * **How your books are ordered** is `collection.default_sort_strategy`, one row
 * in the schema, and its comment says why it is a fact about the collection
 * rather than a rule on every piece: "a default expressed on every fixture
 * would have to be changed on every fixture and could then disagree with
 * itself." Two screens already read it out loud. An area says it is ordered
 * "The way bookcase 2 does"; the ordering screen says that is "By the author",
 * which is what the whole library uses. That is this value, deferred to twice,
 * offered nowhere until now. Changing it here changes what those two screens
 * say and, through the placement rules, where the app thinks every book that
 * inherits belongs.
 *
 * **Which hand you hold the phone in** is the one the design system asked for
 * by name before there was a screen to put it on. `design/Camera.tsx`, on the
 * switch in the viewfinder's far corner: "In the app it belongs beside the rest
 * of the settings and this is the wireframe standing in for one." This is that
 * one, and it is the same stored answer the camera reads, in `lib/hand.ts`,
 * rather than a second copy of the question.
 *
 * ## Three orderings, not four
 *
 * The area's ordering screen offers five and this offers three. Two cannot
 * apply and each is refused by the server as well as left off here.
 * "The way the piece does" needs something above you to ask and a collection
 * has nothing; by tag orders a run by its first tag slug, which is a sensible
 * thing to ask of one area and files a whole house by an accident of the
 * vocabulary. `COLLECTION_STRATEGIES` in the domain is the list, said once.
 *
 * The drawing had by tag on it, greyed out and labelled "not ready to be
 * offered yet". It is not drawn at all here: it is not unfinished, it is not
 * for this question, and a permanently greyed row is a promise nobody will
 * keep.
 *
 * ## The card at the foot is the answer to the ring in the corner
 *
 * Somebody who taps a profile icon and works through the menu is, sooner or
 * later, looking for the account. This is where they arrive, and it says the
 * true thing plainly and once. **It offers nothing**: no sign-in, no sign-out,
 * no name, and nothing greyed out and labelled coming soon. #171 is a decision
 * nobody has made and a door drawn for it here would be this screen making it.
 *
 * ## What is not on it, and none of it is an oversight
 *
 * **The other four remembered answers.** The app persists six and four sit
 * beside the thing they change: which of the three ways the library is drawn,
 * whether a queued book shows its front or its spine, which lens the camera
 * uses, and whether the torch is lit. Collecting those here would take controls
 * off the screens they act on in order to look fuller than the app is, and the
 * last two need a live camera to mean anything.
 * **Day and night**: the app follows the phone already, both palettes are in
 * `tokens.css` under `prefers-color-scheme`, and a switch here would be a
 * control nobody asked for over a question the phone has answered.
 * **Backing up and exporting**: `docs/backup-runbook.md` is a job somebody does
 * by hand at a terminal and the server has no endpoint for either, so a button
 * would be a promise with nothing behind it.
 * **A name for the collection**: `collection.name` is a real column and no
 * screen in this app shows it, so a field for it would be a control with no
 * visible effect.
 * **Who checked a book out**: checking out records no borrower at all, and
 * `claimed_by` is a lease held by a browser rather than a person.
 * **A version**: there is no version string anywhere in the app to show.
 *
 * ## It holds no state
 *
 * Everything it draws arrives as a prop and every change leaves as a call, the
 * way `HomePane` does it, so its test can render it as markup and read what it
 * says.
 */

import { Card, Said } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Choice, Segmented } from '../design/Controls'
import type { FurnitureDto, SortStrategyCode } from '../lib/api'
import type { Hand } from '../design/Camera'
import { HAND_WORD } from '../lib/hand'
import { orderingSaid } from '../lib/furniture'
import { RoomFrame, Trouble } from './RoomFrame'

/**
 * The orderings a whole collection may take, in the order they are offered.
 *
 * The codes are the domain's `COLLECTION_STRATEGIES` and the words are
 * `orderingSaid`, which is what the area's ordering screen says, so the two
 * screens offering the same question offer it in the same words.
 */
const OFFERED: Exclude<SortStrategyCode, 'inherit' | 'tag'>[] = ['author', 'title', 'published']

interface Props {
  /**
   * The room, for the one value on it this screen is about. Null until the read
   * answers: drawing "By the author" over a collection that is ordered by title
   * would be a setting showing somebody the wrong answer, which is worse than
   * showing none.
   */
  room: FurnitureDto | null
  /** Which hand, read out of the same place the camera reads it from. */
  hand: Hand
  busy: boolean
  error: string
  tabs: Record<TabName, () => void>
  onBack: () => void
  onOrder: (code: SortStrategyCode) => void
  onHand: (hand: Hand) => void
}

export function SettingsPane({
  room, hand, busy, error, tabs, onBack, onOrder, onHand,
}: Props) {
  const top = <TopBar title="Settings" onBack={onBack} />

  return (
    <RoomFrame top={top} tabs={tabs}>
      <Trouble said={error} />

      <div>
        <span className="wf-field__label">How your books are ordered</span>
        <div style={{ height: 6 }} />
        {room ? (
          <Choice
            label="How your books are ordered"
            on={room.defaultSortStrategy}
            /* Pressing the one that is already chosen writes nothing. It is
               not an error and it gets no refusal: it is somebody confirming
               what they already had. */
            onPick={(code) => {
              if (!busy && code !== room.defaultSortStrategy) onOrder(code)
            }}
            options={OFFERED.map((code) => ({
              value: code,
              /* The second argument is what "the way it does" would name, and
                 nothing offered here inherits, so it is never read. */
              word: orderingSaid(code, ''),
            }))}
          />
        ) : (
          <Said>Reading how your books are ordered.</Said>
        )}
      </div>
      {/* Under the control rather than over it, and it is the sentence that
          makes this a setting rather than a preference: it is the answer every
          piece of furniture and every area gives when it has not been asked the
          question itself. */}
      <Said>Every bookcase and every area follows this unless it says otherwise.</Said>

      <div>
        <span className="wf-field__label">Which hand you hold the phone in</span>
        <div style={{ height: 6 }} />
        <Segmented
          label="Which hand you hold the phone in"
          on={hand}
          onPick={onHand}
          options={[
            { value: 'left' as Hand, word: HAND_WORD.left },
            { value: 'right' as Hand, word: HAND_WORD.right },
          ]}
        />
      </div>
      <Said>
        The shutter goes to that edge, under the thumb of the hand already
        holding the phone, and the photographs go to the other one.
      </Said>

      <Card kind="Nobody signs in" title="Everybody in the house shares one collection">
        <p>
          Nothing here knows who you are. What you choose here is remembered on
          this phone and on no other.
        </p>
      </Card>
    </RoomFrame>
  )
}
