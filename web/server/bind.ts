/**
 * Which interface this server listens on, decided by configuration rather
 * than by editing a line of code.
 *
 * Defaults to `127.0.0.1`. Inside a container that has a consequence nobody
 * expects the first time: a published port reaches nothing, since
 * `docker run -p 8080:3001` routes to the container's own address and
 * nothing is listening there. The default does not move; a deployment that
 * wants the container's own network to be its boundary sets one variable and
 * says so.
 *
 * The default stays closed even with the sign-in gate in front: the gate is
 * what makes opening the bind safe, and a default that assumes the gate is
 * correct stops being safe the day the gate has a hole.
 *
 * A word rather than an address, since a narrower interface address is
 * assigned by the runtime when the container starts, is not knowable when
 * the variable is set, and changes when the container is replaced; a value
 * that was right once becomes a container that will not start next time.
 * `all` maps to `0.0.0.0`, the address a published port maps and `EXPOSE`
 * documents. There is deliberately no third word for IPv6.
 */

/**
 * `BOOKSCAN_BIND` rather than `HOST` or `BIND_ADDRESS`: an inherited shell
 * variable must not be able to decide this, and Docker sets `HOSTNAME` in
 * every container it starts while orchestrators set `HOST` for their own
 * purposes.
 */
export const BIND = 'BOOKSCAN_BIND'

/** The two answers, and there are deliberately only two. */
export type BindName = 'loopback' | 'all'

/**
 * What each word means to `listen`.
 *
 * `deploy/contract.json` carries the same two pairs under `network.bindOptions`
 * and `scripts/check-deploy-contract.mjs` holds them to this table, so the
 * contract cannot describe a bind this file does not have.
 */
export const BIND_ADDRESSES: Record<BindName, string> = {
  loopback: '127.0.0.1',
  all: '0.0.0.0',
}

/** Unset, empty or unstated all mean this. */
export const DEFAULT_BIND: BindName = 'loopback'

export interface Bind {
  /** The word a deployment chose, or the default. */
  name: BindName
  /** The address handed to `app.listen`. */
  address: string
}

/**
 * Read the environment and say which interface to listen on.
 *
 * Refuses rather than guesses: silently falling back to the default would
 * make a deployment that asked to be reachable and was not look identical to
 * the bind it was trying to change.
 *
 * Empty means unset, the same rule `BOOKSCAN_DATA` and `BOOKSCAN_BACKUP_DIR`
 * follow.
 */
export function bindFrom(env: NodeJS.ProcessEnv): Bind {
  const asked = (env[BIND] ?? '').trim()
  if (!asked) return { name: DEFAULT_BIND, address: BIND_ADDRESSES[DEFAULT_BIND] }

  const word = asked.toLowerCase()
  if (word in BIND_ADDRESSES) {
    const name = word as BindName
    return { name, address: BIND_ADDRESSES[name] }
  }

  throw new Error(
    `${BIND} is "${asked}", which is not one of the two words it takes.\n\n` +
    `  loopback  ${BIND_ADDRESSES.loopback}, and the default. Only something inside this\n` +
    '            machine or this container\'s network namespace can reach the\n' +
    '            server, so publishing a container port reaches nothing.\n' +
    `  all       ${BIND_ADDRESSES.all}, every interface in the namespace. Anything that\n` +
    '            can route to this container reaches the sign-in gate, which is\n' +
    '            then the only thing in front of the catalogue.\n\n' +
    'It is a word rather than an address on purpose. Those two are the only ' +
    'answers that mean anything from inside a container: a narrower interface ' +
    'address is assigned by the runtime at start, is not knowable when this ' +
    'variable is set, and changes when the container is replaced. See ' +
    'docs/the-bind.md and deploy/contract.json.',
  )
}

/**
 * What the process says about its own front door on every start.
 *
 * Returned rather than logged so a test can read it, the same as
 * `describeSignIn`. `127.0.0.1` and `0.0.0.0` differ by one character and by
 * everything else, so this spells out what the bound address means.
 */
export function describeBind(bind: Bind): string[] {
  return [bind.name === 'loopback'
    ? `[api] bound to loopback only (${BIND} is unset or loopback, which is the ` +
      'default). Nothing outside this machine can reach it, and inside a ' +
      'container a published port reaches nothing: whatever fronts this app has ' +
      `to share the network namespace. Set ${BIND}=all to listen on every ` +
      'interface instead.'
    : `[api] bound to EVERY interface (${BIND}=all). Anything that can route to ` +
      'this machine or container can reach it, and the sign-in gate is the only ' +
      'thing in front of the catalogue.']
}
