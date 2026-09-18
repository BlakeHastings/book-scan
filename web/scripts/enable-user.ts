/**
 * Who is allowed in, decided outside the app by whoever can reach the
 * database.
 *
 * A person can be named by the id this app owns, which is exact and
 * unambiguous, or by an email address, which is neither: an address that
 * matches more than one person is refused with all of them printed rather
 * than resolved, and nothing the running app does looks anybody up by email.
 *
 * The target comes from the command line, or `BOOKSCAN_ENABLE_TARGET`, and
 * nowhere else. It deliberately does not read `ConnectionStrings__bookscan`:
 * this writes, and a connection string that happens to be in a shell must
 * not decide what gets written to. Unlike `seed-world.ts` it does not refuse
 * port 5433, because the live catalogue is the one catalogue whose owner
 * this command is about. It opens a plain pool rather than `openPostgres`,
 * so it does not migrate the database on the way past.
 *
 * `--disable` takes effect on that person's very next request rather than
 * ending their session, since the gate reads `enabled` on every request
 * instead of caching it. `--sign-out` is the separate decision that revokes
 * every session they hold.
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'

import { connectionConfig, describeConnection, PgDb } from '../server/db.pg'
import type { Db } from '../server/driver'
import { AuthStore, type UserWithIdentities } from '../infrastructure/auth/auth-store'

export function describePerson(person: UserWithIdentities): string {
  const identities = person.identities.length
    ? person.identities
      .map((one) => `${one.issuer} ${one.email || '(no address)'}`)
      .join('; ')
    : '(no identity, which nothing here writes)'
  return `${person.enabled ? 'enabled ' : 'waiting '} ${person.id}  ${identities}`
}

/**
 * The person a name refers to, or a sentence saying why it refers to none.
 *
 * Exported so `enable-user.test.ts` can drive the ambiguous case: two people
 * sharing an address, which this refuses to resolve by guessing.
 */
export function findPerson(
  everyone: UserWithIdentities[],
  named: string,
): { person: UserWithIdentities } | { refusal: string } {
  const wanted = named.trim()
  const byId = everyone.find((one) => one.id === wanted)
  if (byId) return { person: byId }

  const lower = wanted.toLowerCase()
  const byEmail = everyone.filter((one) =>
    one.identities.some((identity) => identity.email.trim().toLowerCase() === lower))

  if (byEmail.length === 1) return { person: byEmail[0]! }
  if (byEmail.length === 0) {
    return {
      refusal: `Nobody here is ${wanted}. Run this with no --enable or --disable ` +
        'to list everybody, and use the id in the first column.',
    }
  }
  return {
    refusal:
      `${byEmail.length} different people have signed in with ${wanted}, and an ` +
      'email address is not an identity, so this will not pick one for you. ' +
      'Use the id:\n' + byEmail.map((one) => `  ${describePerson(one)}`).join('\n'),
  }
}

const USAGE =
  "Usage: npm run enable-user -- --target '<connection>' " +
  '[--enable <id|email> | --disable <id|email> | --sign-out <id|email>]'

interface Args {
  target: string
  enable?: string
  disable?: string
  signOut?: string
}

/** The command line, read strictly: an unrecognised argument is a refusal. */
export function readArgs(argv: string[], env: NodeJS.ProcessEnv): Args | { error: string } {
  const named = new Map<string, string>()
  const flags = ['--target', '--enable', '--disable', '--sign-out']

  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at]!
    if (!flags.includes(arg)) return { error: `Unrecognised argument: ${arg}` }
    const value = argv[at + 1]
    if (value === undefined || flags.includes(value)) {
      return { error: `${arg} needs a value.` }
    }
    if (named.has(arg)) return { error: `${arg} was given twice.` }
    named.set(arg, value)
    at += 1
  }

  const acts = flags.slice(1).filter((flag) => named.has(flag))
  if (acts.length > 1) {
    return { error: `${acts.join(' and ')} are different decisions. Make one at a time.` }
  }

  const target = named.get('--target') ?? env.BOOKSCAN_ENABLE_TARGET ?? ''
  if (!target) {
    return {
      error:
        'No target. This can write rows, so it will not take one from the ' +
        'environment the app is running in.\n' +
        "Read the api resource's connection out of `aspire describe` and pass it.",
    }
  }

  return {
    target,
    enable: named.get('--enable'),
    disable: named.get('--disable'),
    signOut: named.get('--sign-out'),
  }
}

/** Everybody, printed, with the waiting list called out because it is the point. */
export async function listEverybody(db: Db): Promise<UserWithIdentities[]> {
  const everyone = await new AuthStore(db).everybody()

  if (!everyone.length) {
    console.log(
      'Nobody has ever signed in to this catalogue. The first person to sign in ' +
      'is created here, disabled, and this command is how they get let in.',
    )
    return everyone
  }

  console.log(`${everyone.length} ${everyone.length === 1 ? 'person' : 'people'}:`)
  for (const person of everyone) console.log(`  ${describePerson(person)}`)

  const waiting = everyone.filter((one) => !one.enabled)
  if (waiting.length) {
    console.log('')
    console.log(
      `${waiting.length} ${waiting.length === 1 ? 'is' : 'are'} waiting. ` +
      'They can sign in, they hold a session, and every route answers 403 until ' +
      'somebody runs this with --enable and their id.',
    )
  }
  return everyone
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2), process.env)
  if ('error' in args) {
    console.error(`${args.error}\n${USAGE}`)
    process.exit(2)
  }

  // Host, port and database, never the credentials, so a log or transcript
  // says which catalogue this opened without carrying a password.
  console.log(`Catalogue: ${describeConnection(args.target)}`)

  const pool = new pg.Pool(connectionConfig(args.target))
  try {
    const db = new PgDb(pool)
    const store = new AuthStore(db)
    const named = args.enable ?? args.disable ?? args.signOut

    if (named === undefined) {
      await listEverybody(db)
      return
    }

    const found = findPerson(await store.everybody(), named)
    if ('refusal' in found) {
      console.error(found.refusal)
      process.exitCode = 1
      return
    }

    const person = found.person
    const now = new Date()

    if (args.signOut !== undefined) {
      const ended = await store.revokeSessionsFor(person.id, now)
      console.log(
        ended === 0
          ? `${person.id} holds no session, so there was nothing to end.`
          : `Ended ${ended} session(s) for ${person.id}. They stay ` +
            `${person.enabled ? 'enabled' : 'on the waiting list'}; this only took ` +
            'away the credential.',
      )
      return
    }

    const wanted = args.enable !== undefined
    const changed = await store.setEnabled(person.id, wanted, now)

    if (!changed) {
      console.log(`${person.id} is already ${wanted ? 'enabled' : 'on the waiting list'}. Nothing written.`)
      return
    }

    console.log(
      wanted
        ? `${person.id} is in. If they are holding a session already, their next ` +
          'request goes through; they do not have to sign in again.'
        : `${person.id} is back on the waiting list. Their next request answers ` +
          '403, on whatever session they are holding, with no sign-out needed. ' +
          'Use --sign-out as well if the credential itself is the problem.',
    )
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
