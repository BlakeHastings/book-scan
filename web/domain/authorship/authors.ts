/**
 * Authors, the names they publish under, and who a book credits.
 *
 * An author holds no name. One person publishes under several: Iain Banks and
 * Iain M. Banks, Stephen King and Richard Bachman. Putting a name on the author
 * would force a choice between two spellings that `docs/shelving.md` settles
 * must file apart, so the name is on the alias and the author is what the
 * aliases have in common.
 *
 * A book credits an alias, not a person. The shelf follows the alias, so Banks
 * and Banks M sit in different places as printed, and "everything by this
 * person" follows the author behind the alias. A book crediting the author
 * instead would lose the spelling, and no join brings it back.
 *
 * `nameKey` says when two spellings are one name, and it says nothing about
 * pseudonyms. Two names that do not fold together are two authors here, and
 * joining them is somebody deciding, through `absorbing`. That direction is
 * recoverable and the other one is not: once one author has swallowed two
 * people, nothing left in the data says which books were whose.
 *
 * No database, no HTTP, no catalogue. `filingName` comes from `shared/`, where
 * the shelving code reads it from; a second copy here would be a second thing to
 * keep in step with `books.author_filing`.
 */

import { filingName } from '../../shared/shelving'

/**
 * The key two spellings of one name share.
 *
 * Case, punctuation and runs of whitespace folded; accents kept. Written the
 * same way in `migrations/0004_authors_become_rows.sql`, which cannot call this
 * function, and `author-repository.test.ts` asks Postgres for the SQL answer and
 * compares it against this one rather than trusting that they still agree.
 *
 * Accents are kept, which is the one difference from `normalise()`: `García` and
 * `Garcia` stay two names. That is the conservative direction, because an alias
 * too many is a row somebody merges in a second and an alias too few has quietly
 * filed two people's books under one name.
 */
export function nameKey(printed: string): string {
  return printed
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toUpperCase()
}

/**
 * A name as it is printed on a book. Cannot exist empty, and cannot exist as
 * something with no letter or digit in it: those all fold to the same key, so
 * accepting them would make one alias out of unrelated punctuation.
 */
export class PrintedName {
  private constructor(readonly value: string) {}

  static of(raw: string): PrintedName {
    const name = PrintedName.parse(raw)
    if (!name) throw new Error(`"${raw}" has nothing in it that could be a name`)
    return name
  }

  /** The same, answering `null` instead of throwing. What a route wants. */
  static parse(raw: string): PrintedName | null {
    const printed = (raw ?? '').replace(/\s+/g, ' ').trim()
    if (!printed || !nameKey(printed)) return null
    return new PrintedName(printed)
  }

  get key(): string {
    return nameKey(this.value)
  }

  /**
   * What this app files the name under when nobody has said otherwise.
   *
   * The heuristic, and it is knowingly wrong on Spanish compound surnames and on
   * the Dutch particle convention. Those are why an alias stores its filing name
   * rather than deriving it every time: somebody corrects it once.
   *
   * Never empty. The empty string sorts ahead of every real filing name, so a
   * book given one is shelved as though nobody wrote it; `filingName` guarantees
   * that by falling back to what was printed.
   */
  get derivedFiling(): string {
    return filingName(this.value)
  }

  equals(other: PrintedName): boolean {
    return this.key === other.key
  }

  toString(): string {
    return this.value
  }
}

/** One name an author publishes under, and what it files as. */
export interface Alias {
  name: PrintedName
  /** What the shelf orders by. Corrected by a person, never re-derived. */
  filing: string
  isPrimary: boolean
}

/**
 * A person, or an organisation, and every name they publish under. The aggregate
 * is the whole set rather than one alias, because the two rules worth having are
 * about the set: which name stands for the person, and what happens when two of
 * these turn out to be one.
 */
export class Author {
  private constructor(
    readonly isCorporate: boolean,
    readonly note: string,
    readonly aliases: readonly Alias[],
  ) {}

  static of(aliases: readonly Alias[], isCorporate = false, note = ''): Author {
    if (!aliases.length) {
      // `absorbing` empties an author, and an author with no name is one nothing
      // can display, name or credit. It is deleted there rather than allowed to
      // exist here.
      throw new Error('an author with no aliases is nobody')
    }
    return new Author(isCorporate, note, [...aliases])
  }

  /**
   * The name to show when the person is named rather than one of their books:
   * the first one so marked, and the first alias when none is. A total answer
   * rather than a check, so there is always a name to show.
   */
  get primary(): Alias {
    return this.aliases.find((alias) => alias.isPrimary) ?? this.aliases[0]!
  }

  publishes(name: PrintedName): boolean {
    return this.aliases.some((alias) => alias.name.equals(name))
  }

  /**
   * Two authors turn out to be one person. Every alias of `other` joins this
   * author, keeping its own printed name and its own filing name, so nothing
   * moves on the shelf: the books still credit the same aliases, which still
   * file the same way. Only `other`'s primary is demoted, because a person has
   * one name they are called by and this author already has one.
   *
   * A name both authors already publish under is not added twice.
   */
  absorbing(other: Author): Author {
    const joined = other.aliases
      .filter((alias) => !this.publishes(alias.name))
      .map((alias) => ({ ...alias, isPrimary: false }))

    return new Author(
      // Corporate is kept when either says so: an organisation absorbing a
      // spelling of its own name is still an organisation.
      this.isCorporate || other.isCorporate,
      [this.note, other.note].filter(Boolean).join(' '),
      [...this.aliases, ...joined],
    )
  }
}

/**
 * Who a book credits, in the order the names are printed on it.
 *
 * The first-listed name files the book (`docs/shelving.md`), which is why the
 * order is part of the model rather than a detail of how the rows came back:
 * `books.sort_key` is built from the first credit and from nothing else.
 */
export class Credits {
  private constructor(readonly names: readonly PrintedName[]) {}

  /**
   * The credits a list of printed names means. Names that fold to the same key
   * are one credit, first appearance winning: a catalogue that lists a person
   * once as printed and once with the initials spaced is crediting them once.
   */
  static of(printed: readonly string[]): Credits {
    const seen = new Map<string, PrintedName>()
    for (const raw of printed) {
      const name = PrintedName.parse(raw)
      if (name && !seen.has(name.key)) seen.set(name.key, name)
    }
    return new Credits([...seen.values()])
  }

  get isEmpty(): boolean {
    return this.names.length === 0
  }

  /** The name the book files under, or null when nobody is credited. */
  get filingName(): PrintedName | null {
    return this.names[0] ?? null
  }

  /** Each credit with the position it is stored at. First-listed is 1. */
  get positioned(): { position: number; name: PrintedName }[] {
    return this.names.map((name, at) => ({ position: at + 1, name }))
  }
}
