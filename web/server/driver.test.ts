/**
 * The seam itself: the placeholder translation, and the transaction behaviour
 * the stores rely on.
 *
 * Worth its own file rather than being left to the store tests. Those exercise
 * the translator on every statement they run, which is the point of routing
 * SQLite through it, but they exercise it on the statements that happen to
 * exist today. The cases below are the ones that will break stage F if they are
 * wrong and nothing here has ever looked at them: a placeholder inside a
 * comment, a name used twice, an `IN` list whose length is decided at run time,
 * and the numbered spelling Postgres will ask for.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { anonymous, bindParams, numbered, type Db } from './driver'
import { openDatabase } from './db'

describe('translating placeholders', () => {
  it('takes ? placeholders in the order it meets them', () => {
    const bound = bindParams(
      'SELECT * FROM books WHERE shelf_range = ? AND sort_key < ? AND id != ?',
      ['fiction', 'k', 7],
      anonymous,
    )
    expect(bound.text).toBe(
      'SELECT * FROM books WHERE shelf_range = ? AND sort_key < ? AND id != ?',
    )
    expect(bound.values).toEqual(['fiction', 'k', 7])
  })

  it('spells the same statement in the numbered style, which is what stage F needs', () => {
    const bound = bindParams(
      'SELECT * FROM books WHERE shelf_range = ? AND sort_key < ?',
      ['fiction', 'k'],
      numbered,
    )
    expect(bound.text).toBe(
      'SELECT * FROM books WHERE shelf_range = $1 AND sort_key < $2',
    )
    expect(bound.values).toEqual(['fiction', 'k'])
  })

  it('reads @name and :name from the same map, because both styles are in the SQL', () => {
    const bound = bindParams(
      'UPDATE books SET title = @title WHERE isbn13 = :isbn13',
      { title: 'Dune', isbn13: '9780441013593' },
      numbered,
    )
    expect(bound.text).toBe('UPDATE books SET title = $1 WHERE isbn13 = $2')
    expect(bound.values).toEqual(['Dune', '9780441013593'])
  })

  it('gives a name used twice a placeholder and a value each time', () => {
    // CaptureQueue.attach mentions @slot twice. The anonymous style has no way
    // to point back at an earlier placeholder, so the value has to be sent
    // again rather than referred to.
    const bound = bindParams(
      "SELECT REPLACE(a, ',' || @slot || ',', ',' || @slot)",
      { slot: 'back' },
      numbered,
    )
    expect(bound.text).toBe("SELECT REPLACE(a, ',' || $1 || ',', ',' || $2)")
    expect(bound.values).toEqual(['back', 'back'])
  })

  it('handles an IN list whose length is only known at run time', () => {
    // CaptureQueue.list builds this from however many statuses it was asked
    // for, so the same statement text never has a fixed placeholder count.
    for (const statuses of [['pending'], ['pending', 'ready', 'failed']]) {
      const marks = statuses.map(() => '?').join(', ')
      const bound = bindParams(
        `SELECT * FROM captures WHERE status IN (${marks})`,
        statuses,
        numbered,
      )
      const expected = statuses.map((_, i) => `$${i + 1}`).join(', ')
      expect(bound.text).toBe(`SELECT * FROM captures WHERE status IN (${expected})`)
      expect(bound.values).toEqual(statuses)
    }
  })

  it('leaves anything inside a string literal alone', () => {
    const bound = bindParams(
      "SELECT ',' || a, '@name', ':name', '?' FROM t WHERE b = ?",
      ['x'],
      numbered,
    )
    expect(bound.text).toBe("SELECT ',' || a, '@name', ':name', '?' FROM t WHERE b = $1")
    expect(bound.values).toEqual(['x'])
  })

  it('does not let an apostrophe in a comment open a string literal', () => {
    // This is not hypothetical. CaptureQueue.edit carries the line
    // "-- Mirrored onto the row's own columns", and a scanner that read that
    // apostrophe as a quote would swallow the rest of the statement.
    const bound = bindParams(
      [
        'UPDATE captures SET',
        "  -- the row's own columns, and a colon: like this",
        '  a = @a,',
        '  b = @b',
        'WHERE id = @id',
      ].join('\n'),
      { a: 1, b: 2, id: 3 },
      numbered,
    )
    expect(bound.text).toContain("-- the row's own columns, and a colon: like this")
    expect(bound.text).toContain('a = $1')
    expect(bound.text).toContain('b = $2')
    expect(bound.text).toContain('WHERE id = $3')
    expect(bound.values).toEqual([1, 2, 3])
  })

  it('skips a block comment', () => {
    const bound = bindParams(
      'SELECT /* not a ? placeholder, nor @this */ a FROM t WHERE b = ?',
      ['x'],
      numbered,
    )
    expect(bound.text).toBe(
      'SELECT /* not a ? placeholder, nor @this */ a FROM t WHERE b = $1',
    )
    expect(bound.values).toEqual(['x'])
  })

  it('reads a doubled quote as an escape rather than the end of the literal', () => {
    const bound = bindParams(
      "SELECT 'it''s not @over here', ? FROM t",
      ['x'],
      numbered,
    )
    expect(bound.text).toBe("SELECT 'it''s not @over here', $1 FROM t")
    expect(bound.values).toEqual(['x'])
  })

  it('leaves a quoted identifier alone', () => {
    // Store.counts aliases one column AS "checkedOut", and the quoting is what
    // stops a dialect folding its case. Rewriting inside it would undo that.
    const bound = bindParams(
      'SELECT COUNT(*) AS "checkedOut" FROM books WHERE shelf_range = ?',
      ['fiction'],
      numbered,
    )
    expect(bound.text).toBe(
      'SELECT COUNT(*) AS "checkedOut" FROM books WHERE shelf_range = $1',
    )
  })

  it('leaves a lone colon that is not a name alone', () => {
    const bound = bindParams('SELECT a::b FROM t', {}, numbered)
    expect(bound.text).toBe('SELECT a::b FROM t')
    expect(bound.values).toEqual([])
  })

  it('refuses a name the caller gave no value for', () => {
    expect(() => bindParams('SELECT @a, @b', { a: 1 }, anonymous))
      .toThrow('no value was given for @b')
  })

  it('refuses a value the statement never asked for', () => {
    // better-sqlite3 refuses this today, and it is the mistyped-name case: a
    // value nobody reads is a column that quietly keeps what it had.
    expect(() => bindParams('SELECT @a', { a: 1, tilte: 'Dune' }, anonymous))
      .toThrow('tilte')
  })

  it('refuses a positional list that does not match the placeholders', () => {
    expect(() => bindParams('SELECT ?, ?', ['one'], anonymous)).toThrow('too few')
    expect(() => bindParams('SELECT ?', ['one', 'two'], anonymous)).toThrow('too many')
  })

  it('refuses SQLite numbered placeholders, which have no Postgres spelling', () => {
    expect(() => bindParams('SELECT ?1, ?1', ['one'], anonymous))
      .toThrow('numbered placeholders')
  })
})

describe('transactions', () => {
  let db: Db

  beforeEach(async () => {
    db = openDatabase(':memory:')
  })

  const names = async () =>
    (await db.all<{ display_key: string }>(
      'SELECT display_key FROM author_filing ORDER BY display_key',
    )).map((row) => row.display_key)

  const write = (db: Db, key: string) =>
    db.run('INSERT INTO author_filing (display_key, filing_name) VALUES (?, ?)', [key, key])

  it('commits what the work did', async () => {
    await db.tx(async (tx) => { await write(tx, 'a') })
    expect(await names()).toEqual(['a'])
  })

  it('rolls back everything the work did when it throws', async () => {
    await expect(db.tx(async (tx) => {
      await write(tx, 'a')
      throw new Error('no')
    })).rejects.toThrow('no')
    expect(await names()).toEqual([])
  })

  it('rolls back only the inner transaction when the inner one fails', async () => {
    await db.tx(async (tx) => {
      await write(tx, 'outer')
      await expect(tx.tx(async (inner) => {
        await write(inner, 'inner')
        throw new Error('inner failed')
      })).rejects.toThrow('inner failed')
    })
    expect(await names()).toEqual(['outer'])
  })

  it('rolls the inner one back with the outer one when the outer fails', async () => {
    await expect(db.tx(async (tx) => {
      await write(tx, 'outer')
      await tx.tx(async (inner) => { await write(inner, 'inner') })
      throw new Error('outer failed')
    })).rejects.toThrow('outer failed')
    expect(await names()).toEqual([])
  })

  it('nests through the handle the store holds, not only the one it was handed', async () => {
    // Shelves.moveAcrossBoundary opens a transaction and then calls `remove`,
    // which opens one of its own against the same handle the class holds. That
    // is the nesting that has to work, and it is not the one the signature
    // makes obvious.
    await db.tx(async () => {
      await write(db, 'outer')
      await db.tx(async () => { await write(db, 'inner') })
    })
    expect(await names()).toEqual(['inner', 'outer'])
  })

  it('does not nest one caller\'s transaction inside another\'s', async () => {
    // Both start while the first is suspended. If the second were read as
    // nested, the first one's rollback would take it with it.
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })

    const first = db.tx(async (tx) => {
      await write(tx, 'first')
      await held
      throw new Error('first failed')
    })
    const second = db.tx(async (tx) => { await write(tx, 'second') })

    release()
    await expect(first).rejects.toThrow('first failed')
    await second

    expect(await names()).toEqual(['second'])
  })

  it('keeps a statement from outside a transaction out of it', async () => {
    // better-sqlite3 gave this for nothing by being synchronous: a transaction
    // ran start to finish with no chance for anything else to slip in. An
    // `await` inside the work is exactly such a chance, so a write from
    // elsewhere must not end up inside a transaction that then rolls back.
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })

    const rolled = db.tx(async (tx) => {
      await write(tx, 'doomed')
      await held
      throw new Error('rolled back')
    })
    const outside = write(db, 'unrelated')

    release()
    await expect(rolled).rejects.toThrow('rolled back')
    await outside

    expect(await names()).toEqual(['unrelated'])
  })

  it('closes', async () => {
    await db.close()
    await expect(db.all('SELECT 1')).rejects.toThrow()
  })
})

describe('what imports better-sqlite3', () => {
  it('is one production file, which is how stage F stays a new file', () => {
    // The plan makes this the verification for the stage, as a grep. It is
    // worth being a test as well: the value of the seam is that there is
    // exactly one place a driver can be reached from, and a grep only says so
    // on the day somebody runs it.
    const here = fileURLToPath(new URL('.', import.meta.url))
    const roots = [here, join(here, '..', 'scripts')]
    const imports = /(?:from|require\()\s*['"]better-sqlite3['"]/

    const named: string[] = []
    for (const root of roots) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
        if (imports.test(readFileSync(join(root, entry.name), 'utf8'))) {
          named.push(entry.name)
        }
      }
    }

    expect(named).toEqual(['db.ts'])
  })
})
