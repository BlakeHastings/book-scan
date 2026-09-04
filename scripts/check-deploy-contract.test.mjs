// What the deployment contract's two checkers must catch, and what they must
// let through.
//
//   node scripts/check-deploy-contract.test.mjs
//
// Two things are under test and they face opposite ways.
//
// `check-deploy-contract.mjs` holds the contract to this repository's source, so
// that "these are the variables" stays true as the code moves. Its failure mode
// is silence: a scan that matches nothing passes, and a contract nobody checks
// is exactly the shape of defect this project keeps finding. So the cases below
// break each fact in turn and require a complaint.
//
// `deploy/check-config.mjs` holds a deployment's configuration to the contract,
// and ships inside the image. Its failure mode is the opposite: refusing a
// configuration that is fine, which would teach the one person who runs it to
// stop running it. So the last block is a configuration that is correct, and it
// must say nothing is wrong.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  compare,
  envNamesIn,
  factProblems,
  siteSpecificProblems,
  withoutComments,
  NOT_A_DEPLOYMENT_SURFACE,
} from './check-deploy-contract.mjs'
import { checkConfig, parseEnvFile } from '../deploy/check-config.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const contract = JSON.parse(readFileSync(join(root, 'deploy', 'contract.json'), 'utf8'))

let failed = 0
const check = (name, actual, expected) => {
  if (actual !== expected) {
    failed++
    console.error(`FAIL  ${name}: expected ${expected}, got ${actual}`)
  }
}
const has = (name, lines, fragment) => {
  const found = lines.some((line) => line.includes(fragment))
  if (!found) {
    failed++
    console.error(`FAIL  ${name}: nothing said "${fragment}" in:\n    ${lines.join('\n    ') || '(nothing)'}`)
  }
}

// --- Finding the variables. Four shapes, because the codebase has four, and the
// --- fourth is the whole sign-in surface: providers.ts names its variables once
// --- as constants and then indexes an environment with them.
{
  const names = envNamesIn(`
    const a = process.env.BOOKSCAN_DATA
    const b = process.env['ConnectionStrings__bookscan']
    const c = env['OTEL_EXPORTER_OTLP_PROTOCOL']
    export const GOOGLE_CLIENT_ID = 'BOOKSCAN_OIDC_GOOGLE_CLIENT_ID'
  `)
  check('finds process.env.NAME', names.has('BOOKSCAN_DATA'), true)
  check('finds process.env["NAME"]', names.has('ConnectionStrings__bookscan'), true)
  check('finds env["NAME"]', names.has('OTEL_EXPORTER_OTLP_PROTOCOL'), true)
  check('finds a name held in a constant', names.has('BOOKSCAN_OIDC_GOOGLE_CLIENT_ID'), true)
}

// A variable named in prose is not a variable that is read. This file's own
// sources are dense with comments naming variables, and counting those would
// make the contract look complete while the code had moved on.
{
  check('block comments are ignored', withoutComments('/* BOOKSCAN_GHOST */ x').includes('GHOST'), false)
  check('line comments are ignored', withoutComments('// BOOKSCAN_GHOST\nx').includes('GHOST'), false)
  check('a URL is not a line comment', withoutComments('const u = "https://x/y"').includes('https://x/y'), true)
  check('a name only in a comment is not read', envNamesIn("// see 'BOOKSCAN_GHOST'\n").size, 0)
}

// --- Both directions, which is the point. An undeclared variable is a deployer
// --- finding out at runtime; a declared one nobody reads is a deployer setting
// --- something that does nothing.
{
  const declared = [{ name: 'BOOKSCAN_DATA', readAt: 'web/server/index.ts' }]

  check('agreement is silent', compare(new Map([['BOOKSCAN_DATA', ['web/server/index.ts']]]), declared).length, 0)

  has(
    'read and not declared',
    compare(new Map([['BOOKSCAN_DATA', ['web/server/index.ts']], ['BOOKSCAN_NEW', ['web/server/index.ts']]]), declared),
    'BOOKSCAN_NEW is read at web/server/index.ts and deploy/contract.json does not declare it',
  )
  has(
    'declared and not read',
    compare(new Map(), declared),
    'declares BOOKSCAN_DATA and nothing reads it any more',
  )
  has(
    'declared as read somewhere it is not',
    compare(new Map([['BOOKSCAN_DATA', ['web/server/moved.ts']]]), declared),
    'is read at web/server/moved.ts',
  )
  check(
    'a harness variable is excused by name',
    compare(new Map([['BOOKSCAN_TEST_DATABASE_URL', ['web/server/testdb.ts']]]), []).length,
    0,
  )
  check(
    'and every excuse carries its reason',
    [...NOT_A_DEPLOYMENT_SURFACE.values()].every((why) => typeof why === 'string' && why.length > 10),
    true,
  )
  check(
    'a variable read only by a dependency is not expected in the source',
    compare(new Map(), [{ name: 'OTEL_SERVICE_NAME', readAt: null }]).length,
    0,
  )
}

// --- The facts a deployer trips over, each broken in turn. These are the ones
// --- where being wrong is expensive: a published port that reaches nothing, and
// --- a mount that is not there.
{
  const good = {
    contract,
    dockerfile: readFileSync(join(root, 'Dockerfile'), 'utf8'),
    serverIndex: readFileSync(join(root, 'web', 'server', 'index.ts'), 'utf8'),
    serverBind: readFileSync(join(root, 'web', 'server', 'bind.ts'), 'utf8'),
    postgres: JSON.parse(readFileSync(join(root, 'postgres-version.json'), 'utf8')),
  }
  check('the tree as it stands agrees with the contract', factProblems(good).length, 0)

  /*
   * The bind is four facts rather than one since #539, because it is a choice
   * now: the variable that decides it, what each word means, which word is the
   * default, and that the listen call takes what those produced. The last is the
   * one that catches the change nobody would notice — every word could still be
   * right while `app.listen` carried an address of its own, and the contract
   * would be describing a variable that does nothing.
   */
  has(
    'a word that means a different address than the contract says',
    factProblems({ ...good, serverBind: good.serverBind.replace("loopback: '127.0.0.1',", "loopback: '127.0.0.2',") }),
    'BOOKSCAN_BIND=loopback binds 127.0.0.1',
  )
  has(
    'a default that moved in the code and not in the contract',
    factProblems({ ...good, serverBind: good.serverBind.replace("DEFAULT_BIND: BindName = 'loopback'", "DEFAULT_BIND: BindName = 'all'") }),
    'the bind defaults to loopback',
  )
  has(
    'a contract whose default word and default address disagree with each other',
    factProblems({ ...good, contract: { ...contract, network: { ...contract.network, bind: '0.0.0.0' } } }),
    'binds 0.0.0.0 by default',
  )
  has(
    'a variable renamed in the code and not in the contract',
    factProblems({ ...good, serverBind: good.serverBind.replace("export const BIND = 'BOOKSCAN_BIND'", "export const BIND = 'BOOKSCAN_HOST'") }),
    'chooses the bind, and web/server/bind.ts reads a different name',
  )
  has(
    'a listen call that went back to an address of its own',
    factProblems({ ...good, serverIndex: good.serverIndex.replace('app.listen(PORT, BIND.address', "app.listen(PORT, '0.0.0.0'") }),
    'listens on an address of its own',
  )
  has(
    'an EXPOSE that moved',
    factProblems({ ...good, dockerfile: good.dockerfile.replace('EXPOSE 3001', 'EXPOSE 8080') }),
    'the contract says the port is 3001',
  )
  has(
    'a mount that moved',
    factProblems({ ...good, dockerfile: good.dockerfile.replace('VOLUME ["/data"]', 'VOLUME ["/photos"]') }),
    'the contract says /data is the mount',
  )
  has(
    'an image that started running as root',
    factProblems({ ...good, dockerfile: good.dockerfile.replace(/^USER node$/m, '# USER node') }),
    'does not run as root',
  )
  has(
    'a Postgres major that moved',
    factProblems({ ...good, postgres: { tag: '19' } }),
    'the contract says Postgres 18, postgres-version.json says 19',
  )
  has(
    'an entrypoint that moved',
    factProblems({ ...good, dockerfile: good.dockerfile.replace('CMD ["node", "--enable-source-maps", "dist-server/index.js"]', 'CMD ["node", "other.js"]') }),
    "entrypoint is not the Dockerfile's CMD",
  )
  has(
    'a repository name a registry would refuse',
    factProblems({ ...good, contract: { ...contract, image: { ...contract.image, repository: 'BlakeHastings/book-scan' } } }),
    'not lowercase',
  )
}

// --- The boundary. This repository is public and the one that deploys it is
// --- private on purpose, so a hostname arriving here is a hostname that is
// --- public forever. The catalogue origins and the registry are the exceptions.
{
  // The same list `main` builds, and it is built the same way on purpose: a host
  // is excused because the contract declares a deployment must reach it, never
  // because a script names it. #537 added the sign-in hosts, of which
  // `login.microsoftonline.com` is the one this repository actually writes down.
  const allowed = [
    ...contract.dependencies.outboundHttps.hosts.map((one) => one.host),
    ...contract.dependencies.outboundHttps.signInHosts.map((one) => one.host),
    contract.image.registry,
  ]
  check('the contract as it stands names no place', siteSpecificProblems(contract, allowed).length, 0)

  has(
    'a domain that arrived in the contract',
    siteSpecificProblems({ ...contract, network: { ...contract.network, note: 'https://books.someones-house.net' } }, allowed),
    'books.someones-house.net',
  )
  has(
    'a hostname without a scheme',
    siteSpecificProblems({ ...contract, note: 'origin runs on nas-01.lan' }, allowed),
    'nas-01.lan',
  )
  check(
    'example.com is how a document says "a domain"',
    siteSpecificProblems({ ...contract, note: 'e.g. https://books.example.com' }, allowed).length,
    0,
  )
}

// --- The consumer's half: a configuration checked against the contract. Each of
// --- the refusals the server makes at start, asked before it starts.
{
  const ok = {
    ConnectionStrings__bookscan: 'postgres://user:pw@db:5432/bookscan',
    BOOKSCAN_DATA: '/data',
    BOOKSCAN_OIDC_GOOGLE_CLIENT_ID: 'an-id',
    BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET: 'a-secret',
    BOOKSCAN_PUBLIC_ORIGIN: 'https://example.invalid',
  }
  const errors = (env) => checkConfig(env, contract).errors

  // The case that matters most, because a checker that fails a good
  // configuration is a checker nobody runs twice.
  check('a correct deployment is passed', errors(ok).length, 0)

  has('no connection string', errors({}), 'ConnectionStrings__bookscan is not set')
  has('an empty connection string counts as absent', errors({ ...ok, ConnectionStrings__bookscan: '  ' }), 'ConnectionStrings__bookscan is not set')

  const half = { ...ok }
  delete half.BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET
  has('half a Google', errors(half), 'BOOKSCAN_OIDC_GOOGLE_CLIENT_SECRET is missing')

  const noOrigin = { ...ok, BOOKSCAN_PUBLIC_ORIGIN: '' }
  has('a provider with no origin', errors(noOrigin), 'BOOKSCAN_PUBLIC_ORIGIN is empty')

  has('the development door beside a real provider', errors({ ...ok, BOOKSCAN_DEV_SIGN_IN: 'blake' }), 'BOOKSCAN_DEV_SIGN_IN')

  // The one the app itself cannot refuse, because on a checkout it is correct.
  has(
    'the development door on its own is still wrong for a deployment',
    errors({ ConnectionStrings__bookscan: 'postgres://x', BOOKSCAN_DEV_SIGN_IN: 'blake' }),
    'must not set',
  )
  check(
    'unless the person running it says it is a checkout',
    checkConfig({ ConnectionStrings__bookscan: 'postgres://x', BOOKSCAN_DEV_SIGN_IN: 'blake' }, contract, { allowDevelopment: true }).errors.length,
    0,
  )

  // The cookie is Secure, always, so an http origin is a sign-in that appears
  // to work and lands back on the login screen.
  has('an origin that is not https', errors({ ...ok, BOOKSCAN_PUBLIC_ORIGIN: 'http://books.example' }), 'is not https')
  check('http://localhost is a secure context', errors({ ...ok, BOOKSCAN_PUBLIC_ORIGIN: 'http://localhost:5173' }).length, 0)
  has('an origin that is not a URL', errors({ ...ok, BOOKSCAN_PUBLIC_ORIGIN: 'books.example' }), 'not an absolute URL')

  has('a port that is not a port', errors({ ...ok, PORT: 'three thousand' }), 'PORT is set to something that is not a number')

  /*
   * The bind (#539). The value a deployer is likeliest to reach for is the one
   * that is refused, so that is the case with teeth: `0.0.0.0` is what everybody
   * types and it is not what this variable takes.
   *
   * The open bind is deliberately not an error and not a warning. It is a
   * decision a deployment is allowed to make, and what it earns is a note saying
   * which state it is now in.
   */
  has('an address where a word belongs', errors({ ...ok, BOOKSCAN_BIND: '0.0.0.0' }), 'which is not loopback or all')
  has('a word nobody defined', errors({ ...ok, BOOKSCAN_BIND: 'public' }), 'which is not loopback or all')
  check('the default spelled out is still the default', errors({ ...ok, BOOKSCAN_BIND: 'loopback' }).length, 0)
  check('an empty bind is an unset bind', errors({ ...ok, BOOKSCAN_BIND: '  ' }).length, 0)
  check('a bind that is open is not an error', errors({ ...ok, BOOKSCAN_BIND: 'all' }).length, 0)
  check('nor a warning', checkConfig({ ...ok, BOOKSCAN_BIND: 'all' }, contract).warnings.length, 0)
  has(
    'and it is said back as the state the deployment is in',
    checkConfig({ ...ok, BOOKSCAN_BIND: 'all' }, contract).notes,
    'the sign-in gate, which is then the only thing in front of the catalogue',
  )
  check('a bind that is closed says nothing, because it is the default', checkConfig({ ...ok, BOOKSCAN_BIND: 'loopback' }, contract).notes.some((line) => line.includes('BOOKSCAN_BIND')), false)

  // A typo in an optional variable is otherwise completely silent.
  const warnings = checkConfig({ ...ok, BOOKSCAN_DAT: '/data' }, contract).warnings
  has('a misspelt variable', warnings, 'BOOKSCAN_DAT is set and nothing reads it')
  has(
    'a data directory pointed away from the mount',
    checkConfig({ ...ok, BOOKSCAN_DATA: '/somewhere-else' }, contract).warnings,
    'BOOKSCAN_DATA is set to something other than /data',
  )
  check('an unrelated variable is not the app\'s business', checkConfig({ ...ok, PATH: '/usr/bin' }, contract).warnings.length, 0)

  // Two of these variables are a Postgres password and an OAuth client secret.
  // A checker whose output cannot be pasted into an issue will not be run.
  const everything = checkConfig({ ...ok, BOOKSCAN_DEV_SIGN_IN: 'blake', PORT: 'nope' }, contract)
  const printed = [...everything.errors, ...everything.warnings, ...everything.notes].join('\n')
  check('no value is ever printed', /user:pw|a-secret|an-id/.test(printed), false)
}

// --- The env-file reader, which is how a consumer checks a configuration
// --- without handing a container the values.
{
  const parsed = parseEnvFile('# a comment\nexport A=1\nB="two"\nC=\n\nnot a line\n')
  check('parses a key', parsed.A, '1')
  check('unquotes a value', parsed.B, 'two')
  check('an empty value is present and blank', parsed.C, '')
  check('a comment is not a key', 'a comment' in parsed, false)
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('The deployment contract checks behave.')
