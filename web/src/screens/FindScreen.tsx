/**
 * Finding a book, which is not a place you can be.
 *
 * The owner took it out of the tab bar: "I think we should just have the find
 * system as part of the library rather than a completely separate system." It is
 * the one action in the library's top right, and this screen wears the library
 * tab for that reason: you have not gone anywhere.
 */

import { FindPane } from '../components/FindPane'

export function FindScreen() {
  return <FindPane />
}
