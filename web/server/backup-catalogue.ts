/**
 * Command line front end for the Postgres backup. Run it from web/:
 *
 *     npx tsx server/backup-catalogue.ts --source <connection> --dir <path>
 *     npx tsx server/backup-catalogue.ts --verify-only --dir <path> --scratch <connection>
 *
 * It follows the conventions migrate-sqlite-to-pg.ts and rehash-covers.ts set:
 * it prints what it is about to do, refuses rather than guesses, and says which
 * database it is talking to before it talks to it.
 *
 * **The source is named on the command line and is never inherited by default.**
 * This does not read `ConnectionStrings__bookscan`, the variable the running app
 * reads, for the reason AGENTS.md gives for every other tool here: a connection
 * string sitting in a shell must not be able to decide which catalogue a job
 * touches.
 *
 * `BOOKSCAN_BACKUP_SOURCE` and `BOOKSCAN_BACKUP_SCRATCH` are read **only when
 * `--source-from-env` or `--scratch-from-env` asks for them.** They used to be
 * read whenever `--source` was absent, and that was the same mistake in a
 * different coat: the variables were set at `Machine` scope so a scheduled task
 * could carry a password out of its command line, which handed the live
 * catalogue to every process on the box, and `npx tsx server/backup-catalogue.ts`
 * with no arguments then opened it. Inheriting is now a thing somebody asks for
 * by name, the way `scripts/seed-world.ts` refuses to inherit its target.
 * `scripts/backup-catalogue.ps1` is the only caller that asks, and it puts the
 * connections into its own child's environment from a DPAPI-encrypted file
 * rather than finding them lying around. See docs/backup-runbook.md.
 *
 * `--dir` still falls back to `BOOKSCAN_BACKUP_DIR` on purpose. A directory
 * decides where a dump is written, not which catalogue is opened, and an
 * inherited one cannot point this at somebody's collection.
 *
 * **Nothing here writes to the source.** The dump side opens one read-only
 * repeatable-read transaction, exports its snapshot, and runs `pg_dump` inside
 * it. The verification never connects to the source at all: it restores into a
 * scratch database on a different server and drops it afterwards.
 */

import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import pg from 'pg'
import { connectionConfig } from './db.pg'
import {
  compareDigests,
  containerConnection,
  DEFAULT_IMAGE,
  DEFAULT_KEEP,
  DEFAULT_MAX_BYTES,
  DEFAULT_MIN_FREE_BYTES,
  describeSource,
  dumpFileName,
  dumpTimestamp,
  humanBytes,
  imageMajor,
  manifestFileName,
  manifestPredatesDerivedTables,
  planRetention,
  readDigest,
  scratchDatabaseName,
  serverMajor,
  tablesCompared,
  tablesIn,
  type CatalogueDigest,
  type DumpFile,
  type Manifest,
} from './backup'

const USAGE = `Dump the Postgres catalogue, prune old dumps, and prove one restores.

Usage: npx tsx server/backup-catalogue.ts [options]

  --source <s>    The catalogue to dump. A postgres:// URL or an ADO.NET
                  keyword string. Only ever read from. Nothing in the
                  environment is read unless --source-from-env asks for it, and
                  ConnectionStrings__bookscan is never read at all.
  --source-from-env  Take the source from BOOKSCAN_BACKUP_SOURCE. This is how
                  the scheduled task carries a password that is not in its
                  command line. A bare run refuses rather than inheriting.
  --scratch <s>   A Postgres the verification may create and drop databases on.
                  Must NOT be the live server. Without it, nothing is verified
                  and the run says so.
  --scratch-from-env  Take the scratch server from BOOKSCAN_BACKUP_SCRATCH,
                  on the same terms as --source-from-env.
  --dir <p>       Where dumps and manifests go. BOOKSCAN_BACKUP_DIR is read
                  when this is not given.
  --keep <n>      How many dumps to retain. Default ${DEFAULT_KEEP}.
  --max-mb <n>    Total size cap on retained dumps, in MiB. Default
                  ${DEFAULT_MAX_BYTES / 1024 / 1024}. Whichever limit bites first wins. The newest
                  dump is never deleted to satisfy this.
  --min-free-mb <n>  Refuse to dump when the volume has less free than this.
                  Default ${DEFAULT_MIN_FREE_BYTES / 1024 / 1024}.
  --image <s>     Postgres client image for pg_dump and pg_restore when the
                  tools are not on PATH. Default ${DEFAULT_IMAGE}. Its major
                  version must be at least the server's.
  --runner <s>    auto (default), docker, or local.
  --verify-only   Do not dump. Verify the newest dump in --dir, or --file.
  --prune-only    Do not dump or verify. Apply retention and report.
  --file <name>   The dump to verify, instead of the newest.
  --keep-scratch  Leave the restored scratch database behind for inspection.
                  Off by default: the verification drops what it created.

The cover photographs are NOT in the dump. pg_dump moves rows, not files.
See docs/backup-runbook.md.`

interface Options {
  source: string
  scratch: string
  dir: string
  keep: number
  maxBytes: number
  minFreeBytes: number
  image: string
  runner: 'auto' | 'docker' | 'local'
  verifyOnly: boolean
  pruneOnly: boolean
  file: string
  keepScratch: boolean
}

export function parseArgs(argv: readonly string[]): Options | { error: string } {
  const flags = [
    '--verify-only', '--prune-only', '--keep-scratch',
    '--source-from-env', '--scratch-from-env',
    '--help', '-h',
  ]
  const values = [
    '--source', '--scratch', '--dir', '--keep', '--max-mb', '--min-free-mb',
    '--image', '--runner', '--file',
  ]
  const given = new Map<string, string>()
  const seen = new Set<string>()

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (flags.includes(arg)) { seen.add(arg); continue }
    if (values.includes(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` }
      given.set(arg, value)
      i += 1
      continue
    }
    return { error: `Unrecognised argument: ${arg}` }
  }

  const number = (name: string, fallback: number): number | { error: string } => {
    const raw = given.get(name)
    if (raw === undefined) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return { error: `${name} needs a positive number` }
    return parsed
  }

  const keep = number('--keep', DEFAULT_KEEP)
  if (typeof keep === 'object') return keep
  const maxMb = number('--max-mb', DEFAULT_MAX_BYTES / 1024 / 1024)
  if (typeof maxMb === 'object') return maxMb
  const minFreeMb = number('--min-free-mb', DEFAULT_MIN_FREE_BYTES / 1024 / 1024)
  if (typeof minFreeMb === 'object') return minFreeMb

  const runner = given.get('--runner') ?? 'auto'
  if (runner !== 'auto' && runner !== 'docker' && runner !== 'local') {
    return { error: '--runner must be auto, docker or local' }
  }

  /**
   * A connection comes from the command line, or from the environment because
   * somebody asked for the environment by name. Never from the environment
   * because the command line was quiet.
   *
   * That distinction is the whole of #215. The variables exist so a scheduled
   * task can carry a password without putting it in a process listing, which is
   * a good reason, and for a while the reading of them was unconditional, which
   * meant a bare run in any shell that happened to have them opened whatever
   * they named. An opt-in keeps the good half.
   */
  const connection = (
    flag: string, option: string, variable: string,
  ): string | { error: string } => {
    const explicit = given.get(option)
    if (!seen.has(flag)) return explicit ?? ''
    if (explicit !== undefined) {
      return { error: `${option} and ${flag} both name a connection. Give one of them.` }
    }
    const inherited = process.env[variable] ?? ''
    if (!inherited) {
      return {
        error: `${flag} was given and ${variable} is empty, so nothing was inherited. ` +
          `Set ${variable} in this process, or pass ${option}.`,
      }
    }
    return inherited
  }

  const source = connection('--source-from-env', '--source', 'BOOKSCAN_BACKUP_SOURCE')
  if (typeof source === 'object') return source
  const scratch = connection('--scratch-from-env', '--scratch', 'BOOKSCAN_BACKUP_SCRATCH')
  if (typeof scratch === 'object') return scratch

  return {
    source,
    scratch,
    dir: resolve(given.get('--dir') ?? process.env.BOOKSCAN_BACKUP_DIR ?? 'backups'),
    keep,
    maxBytes: maxMb * 1024 * 1024,
    minFreeBytes: minFreeMb * 1024 * 1024,
    image: given.get('--image') ?? DEFAULT_IMAGE,
    runner,
    verifyOnly: seen.has('--verify-only'),
    pruneOnly: seen.has('--prune-only'),
    file: given.get('--file') ?? '',
    keepScratch: seen.has('--keep-scratch'),
  }
}

function line(label: string, value: string | number): void {
  console.log(`  ${label.padEnd(20)}${value}`)
}

// ---------------------------------------------------------------------------
// Running the client tools.
// ---------------------------------------------------------------------------

/**
 * How `pg_dump` and `pg_restore` get run.
 *
 * `local` is preferred when the tools are installed, because a subprocess beats
 * a container. They are not installed on the owner's machine, where Postgres
 * itself only ever arrived as an image, so `docker` is the path this was built
 * and tested on.
 *
 * The live container is never used as the runner. `docker exec` into it would
 * work and would be one fewer moving part, and it is refused on purpose: it
 * puts a scheduled job inside the process namespace of the thing it is meant to
 * be protecting.
 */
type Runner = 'docker' | 'local'

async function chooseRunner(preference: Options['runner']): Promise<Runner> {
  if (preference !== 'auto') return preference
  const found = await new Promise<boolean>((done) => {
    const probe = spawn('pg_dump', ['--version'], { stdio: 'ignore', shell: false })
    probe.on('error', () => done(false))
    probe.on('close', (code) => done(code === 0))
  })
  return found ? 'local' : 'docker'
}

interface ToolInvocation {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

/** Build the argv and environment for one client tool run. */
function invoke(
  runner: Runner,
  image: string,
  tool: 'pg_dump' | 'pg_restore',
  connection: string,
  toolArgs: readonly string[],
): ToolInvocation {
  const { url, password } = containerConnection(connection)

  if (runner === 'local') {
    // Locally the loopback rewrite is wrong, so the original connection is used
    // and only the password is lifted out of it.
    const config = connectionConfig(connection)
    const localUrl = config.connectionString
      ? stripPassword(config.connectionString)
      : `postgres://${encodeURIComponent(config.user ?? '')}@${config.host ?? 'localhost'}:` +
        `${config.port ?? 5432}/${encodeURIComponent(config.database ?? '')}`
    const localPassword = config.connectionString
      ? decodeURIComponent(new URL(config.connectionString).password)
      : String(config.password ?? '')
    return {
      command: tool,
      args: ['--dbname', localUrl, ...toolArgs],
      env: { ...process.env, PGPASSWORD: localPassword },
    }
  }

  return {
    command: 'docker',
    args: [
      'run', '--rm', '-i',
      // By name only. Giving docker `-e PGPASSWORD=secret` would put the
      // password in an argument vector anything on the machine can read.
      '-e', 'PGPASSWORD',
      // Docker Desktop resolves this already; stating it keeps the same command
      // working on a plain Linux daemon, which is where CI would run it.
      '--add-host', 'host.docker.internal:host-gateway',
      image, tool, '--dbname', url, ...toolArgs,
    ],
    env: { ...process.env, PGPASSWORD: password },
  }
}

function stripPassword(url: string): string {
  const parsed = new URL(url)
  parsed.password = ''
  return parsed.href
}

/**
 * Run a client tool, streaming one end of it to or from a file.
 *
 * Piped rather than bind-mounted. A bind mount of a Windows path into a
 * container brings ownership and path-translation problems that have nothing to
 * do with the job, and a stream has neither.
 */
async function runTool(
  invocation: ToolInvocation,
  io: { stdoutTo?: string; stdinFrom?: string },
): Promise<{ code: number; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(invocation.command, invocation.args, {
      env: invocation.env,
      stdio: [io.stdinFrom ? 'pipe' : 'ignore', io.stdoutTo ? 'pipe' : 'inherit', 'pipe'],
      shell: false,
    })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    const streams: Array<Promise<void>> = []
    if (io.stdoutTo && child.stdout) {
      streams.push(pipeline(child.stdout, createWriteStream(io.stdoutTo)))
    }
    if (io.stdinFrom && child.stdin) {
      streams.push(pipeline(createReadStream(io.stdinFrom), child.stdin))
    }

    child.on('error', fail)
    child.on('close', (code) => {
      Promise.allSettled(streams).then((results) => {
        const broken = results.find((r) => r.status === 'rejected')
        // A broken pipe when the tool has already failed is a consequence of
        // the failure, not a second one, so the tool's own exit code wins.
        if (broken && code === 0) {
          fail((broken as PromiseRejectedResult).reason)
          return
        }
        done({ code: code ?? -1, stderr })
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Reading the directory.
// ---------------------------------------------------------------------------

async function listDumps(dir: string): Promise<DumpFile[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const files: DumpFile[] = []
  for (const name of names) {
    const takenAt = dumpTimestamp(name)
    if (!takenAt) continue
    const info = await stat(join(dir, name))
    files.push({ name, bytes: info.size, takenAt })
  }
  return files.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
}

async function readManifest(dir: string, dump: string): Promise<Manifest | undefined> {
  try {
    const text = await readFile(join(dir, manifestFileName(dump)), 'utf8')
    return JSON.parse(text) as Manifest
  } catch {
    return undefined
  }
}

async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  await writeFile(
    join(dir, manifestFileName(manifest.dump)),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
}

// ---------------------------------------------------------------------------
// The dump.
// ---------------------------------------------------------------------------

async function takeDump(options: Options, runner: Runner): Promise<string> {
  await mkdir(options.dir, { recursive: true })

  const free = await statfs(options.dir)
  const freeBytes = Number(free.bsize) * Number(free.bavail)
  line('free on volume', humanBytes(freeBytes))
  if (freeBytes < options.minFreeBytes) {
    throw new Error(
      `Refusing to dump: ${humanBytes(freeBytes)} free, ` +
      `below the ${humanBytes(options.minFreeBytes)} floor. ` +
      'Free space or lower --min-free-mb deliberately.',
    )
  }

  // Said before the connection is opened rather than after, because "says which
  // database it is talking to before it talks to it" is what the header of this
  // file claims and it was only true of the other tools here. It matters most
  // when the connection fails: a run that cannot reach its source should still
  // have named the source it was reaching for. describeSource drops the
  // credentials, so this is safe in a log a scheduled task writes.
  line('source', describeSource(options.source))

  const client = new pg.Client(connectionConfig(options.source))
  await client.connect()

  const takenAt = new Date()
  const name = dumpFileName(takenAt)
  const partial = join(options.dir, `${name}.part`)
  let digest: CatalogueDigest

  try {
    // READ ONLY is belt and braces on top of a tool that only reads: it makes
    // the server refuse a write on this connection rather than trusting that
    // none is sent.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const snapshot = await client.query<{ id: string }>('select pg_export_snapshot() as id')
    const snapshotId = snapshot.rows[0]?.id ?? ''
    if (!snapshotId) throw new Error('The server would not export a snapshot')

    const version = await client.query<{ num: string }>(
      "select current_setting('server_version_num') as num",
    )
    const serverVersionNum = Number(version.rows[0]?.num ?? 0)
    const clientMajor = runner === 'docker' ? imageMajor(options.image) : undefined
    if (clientMajor !== undefined && clientMajor < serverMajor(serverVersionNum)) {
      throw new Error(
        `The client image ${options.image} is Postgres ${clientMajor} and the server is ` +
        `${serverMajor(serverVersionNum)}. pg_dump refuses a newer server. ` +
        'Pass --image with a tag at least as new.',
      )
    }

    line('server', String(serverVersionNum))
    line('client', runner === 'docker' ? `docker ${options.image}` : 'pg_dump on PATH')
    line('snapshot', snapshotId)
    line('writing', name)

    // --snapshot pins pg_dump to the transaction above, so the dump and the
    // digest below describe one instant. Without it the digest would be read
    // from a catalogue that a scan could have changed while the dump ran, and
    // the verification would fail for a reason that is not a backup problem.
    const dump = await runTool(
      invoke(runner, options.image, 'pg_dump', options.source, [
        '--format', 'custom',
        '--compress', '9',
        '--no-owner',
        '--no-privileges',
        `--snapshot=${snapshotId}`,
      ]),
      { stdoutTo: partial },
    )
    if (dump.code !== 0) throw new Error(`pg_dump exited ${dump.code}\n${dump.stderr}`)

    digest = await readDigest(client)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    await rm(partial, { force: true })
    throw error
  } finally {
    await client.end()
  }

  // Renamed only once pg_dump has exited zero, so a dump that was interrupted
  // is a `.part` file rather than something retention will count and a restore
  // will later choke on.
  const final = join(options.dir, name)
  await rename(partial, final)
  const info = await stat(final)

  const manifest: Manifest = {
    dump: name,
    takenAt: takenAt.toISOString(),
    source: describeSource(options.source),
    digest,
    bytes: info.size,
    client: runner === 'docker' ? `docker ${options.image}` : 'pg_dump on PATH',
  }
  await writeManifest(options.dir, manifest)

  line('size', humanBytes(info.size))
  printDigest(digest)
  return name
}

function printDigest(digest: CatalogueDigest): void {
  console.log('')
  console.log('  As of the snapshot')
  console.log('  ' + '-'.repeat(60))
  for (const table of tablesIn(digest)) {
    console.log(
      `  ${table.padEnd(18)}${String(digest.counts[table] ?? 0).padStart(8)}` +
      `  ${(digest.digests[table] ?? '').slice(0, 12)}`,
    )
  }
  console.log(`  ${'shelf order'.padEnd(18)}${' '.repeat(8)}  ${digest.shelfOrder ?? '(no books)'}`)
  console.log(
    `  ${'area order'.padEnd(18)}${' '.repeat(8)}  ${digest.areaOrder ?? '(no areas)'}`,
  )
  console.log(`  ${'collation'.padEnd(18)}${' '.repeat(8)}  ${digest.collation} / ${digest.encoding}`)
  console.log('')
}

// ---------------------------------------------------------------------------
// Retention.
// ---------------------------------------------------------------------------

async function prune(options: Options): Promise<void> {
  const files = await listDumps(options.dir)
  const plan = planRetention(files, { keep: options.keep, maxBytes: options.maxBytes })
  const total = plan.kept.reduce((sum, file) => sum + file.bytes, 0)

  for (const file of plan.removed) {
    await rm(join(options.dir, file.name), { force: true })
    await rm(join(options.dir, manifestFileName(file.name)), { force: true })
    console.log(`  removed ${file.name} (${file.because} limit)`)
  }

  line('retained', `${plan.kept.length} dumps, ${humanBytes(total)}`)
  if (plan.kept.length === 1 && total > options.maxBytes) {
    console.log(
      `  WARNING: the only dump is ${humanBytes(total)}, over the ` +
      `${humanBytes(options.maxBytes)} cap. It was kept: deleting the last copy ` +
      'of the catalogue to satisfy a disk budget is the worse outcome. Raise --max-mb.',
    )
  }
}

// ---------------------------------------------------------------------------
// The verification: restore into a scratch database, compare, drop it.
// ---------------------------------------------------------------------------

function adminPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool(connectionConfig(connectionString))
  // node-postgres throws on an `error` event with no listener, which surfaces
  // as the process dying for a connection nobody was using.
  pool.on('error', () => {})
  return pool
}

/** The scratch connection with its database replaced. */
function withDatabase(connection: string, database: string): string {
  const config = connectionConfig(connection)
  if (config.connectionString) {
    const url = new URL(config.connectionString)
    url.pathname = `/${database}`
    return url.href
  }
  const user = config.user ? `${encodeURIComponent(config.user)}` : ''
  const password = config.password ? `:${encodeURIComponent(String(config.password))}` : ''
  const credentials = user ? `${user}${password}@` : ''
  return `postgres://${credentials}${config.host ?? 'localhost'}:${config.port ?? 5432}/${database}`
}

async function verify(options: Options, runner: Runner, dumpName: string): Promise<boolean> {
  const manifest = await readManifest(options.dir, dumpName)
  if (!manifest) {
    throw new Error(
      `No manifest beside ${dumpName}. There is nothing to compare the restore against, ` +
      'so this dump cannot be verified. A dump taken by this tool always has one.',
    )
  }

  const scratchName = scratchDatabaseName(randomBytes(5).toString('hex'))
  const scratchUrl = withDatabase(options.scratch, scratchName)

  console.log('')
  line('verifying', dumpName)
  line('scratch server', describeSource(options.scratch))
  line('scratch database', scratchName)

  // Said out loud rather than inferred from a short comparison table. Such a
  // manifest cannot prove anything about the tables it never described, and a
  // partial proof that looks like a full one is the thing this whole tool
  // exists to not be.
  if (manifestPredatesDerivedTables(manifest.digest)) {
    const named = tablesIn(manifest.digest)
    console.log(
      `  PARTIAL: this manifest names ${named.length} tables and was written before the ` +
      'coverage came from the catalogue.',
    )
    console.log(`  Only those are compared: ${named.join(', ')}.`)
    console.log('  A dump taken since then is checked on every table it holds.')
  }

  const admin = adminPool(options.scratch)
  try {
    // template0 and the source's own collation, so the restore lands in a
    // database that is the same shape as the one it came out of. A restore into
    // a differently collated database is not a proof that the catalogue
    // survived: it is a proof that some catalogue did.
    await admin.query(
      `CREATE DATABASE ${scratchName} TEMPLATE template0 ` +
      `ENCODING '${manifest.digest.encoding}' ` +
      `LC_COLLATE '${manifest.digest.collation}' LC_CTYPE '${manifest.digest.ctype}'`,
    )
  } catch (error) {
    await admin.end()
    throw new Error(
      `Could not create a scratch database with the source's collation ` +
      `(${manifest.digest.collation} / ${manifest.digest.encoding}) on ` +
      `${describeSource(options.scratch)}: ${(error as Error).message}\n` +
      'Point --scratch at a server built the same way as the source. Verifying ' +
      'under a different collation would not prove the catalogue restored.',
    )
  }

  let differences: ReturnType<typeof compareDigests> = []
  let ok = false
  try {
    const restore = await runTool(
      invoke(runner, options.image, 'pg_restore', scratchUrl, [
        '--no-owner',
        '--no-privileges',
        // One transaction, so a failed restore leaves an empty database rather
        // than a partial catalogue that the comparison would then describe in
        // terms of missing rows instead of a failed restore.
        '--single-transaction',
        '--exit-on-error',
      ]),
      { stdinFrom: join(options.dir, dumpName) },
    )
    if (restore.code !== 0) {
      console.log('')
      console.log(`  pg_restore exited ${restore.code}`)
      console.log(restore.stderr.split('\n').map((l) => `    ${l}`).join('\n'))
    } else {
      const pool = adminPool(scratchUrl)
      try {
        const restored = await readDigest(pool)
        differences = compareDigests(manifest.digest, restored)
        ok = differences.length === 0
        printComparison(manifest.digest, restored, differences)
      } finally {
        await pool.end()
      }
    }
  } finally {
    if (options.keepScratch) {
      console.log(`  scratch database ${scratchName} left behind by --keep-scratch`)
    } else {
      // Dropped whatever happened, including after a failure. The point of a
      // scratch database is that nothing depends on it existing a moment later.
      await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`).catch(async () => {
        await admin.query(`DROP DATABASE IF EXISTS ${scratchName}`).catch(() => {})
      })
    }
    await admin.end()
  }

  manifest.verified = {
    at: new Date().toISOString(),
    ok,
    scratch: scratchName,
    differences,
  }
  await writeManifest(options.dir, manifest)

  console.log('')
  if (ok) {
    console.log(`  RESTORED AND VERIFIED. ${dumpName} restores to the catalogue it was taken from.`)
  } else {
    console.log(`  VERIFICATION FAILED for ${dumpName}. This dump is not a backup.`)
  }
  return ok
}

function printComparison(
  expected: CatalogueDigest,
  actual: CatalogueDigest,
  differences: ReturnType<typeof compareDigests>,
): void {
  console.log('')
  console.log('  table                 dumped  restored  digest(dumped)  digest(restored)')
  console.log('  ' + '-'.repeat(74))
  for (const table of tablesCompared(expected, actual)) {
    console.log(
      `  ${table.padEnd(20)}` +
      `${String(expected.counts[table] ?? 0).padStart(6)}` +
      `${String(actual.counts[table] ?? 0).padStart(10)}` +
      `  ${(expected.digests[table] ?? '').slice(0, 12).padEnd(16)}` +
      `${(actual.digests[table] ?? '').slice(0, 12)}`,
    )
  }
  console.log('')
  line('shelf order', `${expected.shelfOrder ?? '-'}  ${actual.shelfOrder ?? '-'}`)
  line('area order', `${expected.areaOrder ?? '-'}  ${actual.areaOrder ?? '-'}`)
  line('collation', `${expected.collation}  ${actual.collation}`)

  if (differences.length === 0) return
  console.log('')
  console.log('  DIFFERENCES')
  console.log('  ' + '-'.repeat(72))
  for (const difference of differences) {
    console.log(`  ${difference.what.padEnd(20)}dumped ${difference.expected}`)
    console.log(`  ${''.padEnd(20)}restored ${difference.actual}`)
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return 0
  }

  const parsed = parseArgs(argv)
  if ('error' in parsed) {
    console.error(`${parsed.error}\n\n${USAGE}`)
    return 2
  }
  const options = parsed

  const runner = await chooseRunner(options.runner)
  console.log('')
  line('backup directory', options.dir)

  if (options.pruneOnly) {
    await prune(options)
    return 0
  }

  let target = options.file ? basename(options.file) : ''

  if (!options.verifyOnly) {
    if (!options.source) {
      console.error(
        'No source, and this will not take one from the environment it happens to be\n' +
        'running in. Pass --source <connection>, or --source-from-env to say out loud\n' +
        'that BOOKSCAN_BACKUP_SOURCE is the one you mean.\n' +
        'ConnectionStrings__bookscan is deliberately not read; see the top of this file.\n\n' +
        USAGE,
      )
      return 2
    }
    target = await takeDump(options, runner)
    await prune(options)
  }

  if (!target) {
    const files = await listDumps(options.dir)
    const newest = files[0]
    if (!newest) {
      console.error(`No dumps in ${options.dir}.`)
      return 1
    }
    target = newest.name
  }

  // Said on every run, in the same place, because it is the half of the
  // irreplaceable data this tool does not touch and a silent omission is how it
  // gets forgotten.
  console.log('')
  console.log('  The cover photographs are NOT in this dump. pg_dump moves rows, not files.')
  console.log('  See docs/backup-runbook.md for what covers them.')

  if (!options.scratch) {
    console.log('')
    console.log('  NOT VERIFIED: no --scratch server given, so nothing was restored.')
    console.log('  An unrestored dump is a hypothesis. Pass --scratch, or --scratch-from-env,')
    console.log('  to prove it.')
    return 1
  }

  const ok = await verify(options, runner, target)
  return ok ? 0 : 1
}

export { main }

// Only when run directly. Importing this file from a test must not start a
// backup, and process.argv in a vitest worker is not this tool's.
if (process.argv[1] && /backup-catalogue/.test(process.argv[1])) {
  main().then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      console.error(error)
      process.exitCode = 1
    },
  )
}
