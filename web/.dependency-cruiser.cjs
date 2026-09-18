/**
 * The layering, as a check rather than as a convention.
 *
 *     cd web && npm run lint:layers
 *
 * ## The layers, and what each one may reach
 *
 * | Layer | May import |
 * | --- | --- |
 * | `domain/` | `domain/`, `shared/`, node built-ins |
 * | `application/` | `domain/`, `application/`, `shared/` |
 * | `infrastructure/` | everything except the React client |
 * | `server/`, `src/` | everything |
 *
 * `shared/` is the odd one and it is deliberate. It holds the pure rules the
 * client and the server both use, it has no I/O and imports nothing below
 * itself, and it is domain code that predates `domain/` existing. It stays
 * where it is with the domain allowed to use it, but it must never gain an
 * import from a layer below, which the last rule below checks.
 *
 * ## Why this and not an ESLint rule
 *
 * `no-restricted-imports` matches the specifier a file wrote, so
 * `../../infrastructure/db/schema` and a re-export through a barrel are two
 * different strings and only one of them is caught. This resolves the graph
 * and asks where a module actually is.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-imports-nothing-below',
      comment:
        'A domain file may not import from application, infrastructure, the express ' +
        'server or the React client. The domain has to compile with infrastructure/ ' +
        'deleted; that is the test of whether the separation is real, and this is what ' +
        'keeps it true.',
      severity: 'error',
      from: { path: '^domain/' },
      to: { path: '^(application|infrastructure|server|src|scripts)/' },
    },
    {
      name: 'domain-imports-no-libraries',
      comment:
        'The domain is plain TypeScript. No query builder, no driver, no HTTP client, ' +
        'no image library. If a rule here needs one of those it is not a rule, it is a ' +
        'a piece of infrastructure that has not been named yet.',
      severity: 'error',
      from: { path: '^domain/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'],
        // The test runner, and nothing else: a domain test that needed a
        // database would be a domain object that is not one.
        pathNot: ['node_modules/vitest/'],
      },
    },
    {
      name: 'application-imports-no-infrastructure',
      comment:
        'The application layer owns the ports; the implementations depend on it and ' +
        'not the other way round. An import from here into infrastructure or the ' +
        'server means a handler has learned what a database is.',
      severity: 'error',
      from: { path: '^application/' },
      to: { path: '^(infrastructure|server|src|scripts)/' },
    },
    {
      name: 'application-imports-no-data-store',
      comment:
        'No driver and no query builder in the application layer. The ports say what ' +
        'is needed; something else says how.',
      severity: 'error',
      from: { path: '^application/' },
      to: { path: 'node_modules/(drizzle-orm|pg|better-sqlite3|express)' },
    },
    {
      name: 'data-store-stays-in-infrastructure',
      comment:
        'The driver and the query builder belong to infrastructure/ and to nothing else. ' +
        'A `pg` or a `drizzle-orm` import anywhere below is a statement being written ' +
        'outside the layer that owns statements, which is the thing #169 exists to stop. ' +
        'The exceptions are named below and each is a file whose whole job is the seam ' +
        'itself, or a test looking inside it.',
      severity: 'error',
      from: {
        pathNot: [
          '^infrastructure/',
          // `Db` and its one implementation: the only thing in the codebase
          // that may hold a connection, which forty files import `type { Db }`
          // from.
          '^server/db\\.pg\\.ts$',
          // The test harness: both import `vitest`, so neither can be reached
          // from a running server, and what they do with `pg` is create and
          // drop scratch databases, not query about books.
          '^server/(pgcontainer|testdb)\\.ts$',
          // The backup tool opens its own connection on purpose: it talks to
          // a catalogue whose schema it does not assume, reading `pg_class`
          // to find out.
          '^server/backup-catalogue\\.ts$',
          // A test may look inside the box: these stand up a real Postgres
          // and assert what the production code actually wrote.
          '\\.test\\.ts$',
        ],
      },
      to: { path: 'node_modules/(pg|drizzle-orm)/' },
    },
    {
      name: 'infrastructure-imports-no-client',
      comment: 'The React client is above everything here, not beside it.',
      severity: 'error',
      from: { path: '^infrastructure/' },
      to: { path: '^src/' },
    },
    {
      name: 'shared-stays-pure',
      comment:
        'shared/ is the domain code the client and the server both use. It predates ' +
        'domain/ and is allowed to be imported by it, which is only safe while it ' +
        'imports nothing from any layer at all.',
      severity: 'error',
      from: { path: '^shared/' },
      to: { path: '^(domain|application|infrastructure|server|src|scripts)/' },
    },
    {
      name: 'no-circular',
      comment:
        'A cycle across a layer boundary is the boundary being crossed in both ' +
        'directions at once.',
      severity: 'error',
      from: { path: '^(domain|application|infrastructure)/' },
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
