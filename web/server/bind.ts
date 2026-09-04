/**
 * Which interface this server listens on, decided by configuration rather than
 * by editing one line (#539).
 *
 * ## What this is for
 *
 * The bind is the last thing in this repository between the app and something
 * that can reach it. It has been `127.0.0.1` since the app was a development
 * server on the owner's own machine, and #520, #532 and #533 each left it there
 * deliberately, because opening it in a change about something else is the wrong
 * place to take that decision.
 *
 * Inside a container that default has a consequence nobody expects the first
 * time: **a published port reaches nothing.** `docker run -p 8080:3001` sets up
 * a route to the container's own address and there is nothing listening there.
 * The container is up, the log says it is listening, and every request from
 * outside is refused at the socket, which does not look like a configuration
 * mistake.
 *
 * So this makes the bind a choice with a safe default, declared in
 * `deploy/contract.json` like every other input. **The default does not move.**
 * A deployment that wants the container's own network to be its boundary sets
 * one variable and says so; a deployment that says nothing gets exactly what it
 * gets today.
 *
 * ## Why the default stays closed even though the gate exists
 *
 * `docs/auth-surface.md` measured seventy-two unauthenticated doors on an app
 * that had been reachable on a home network for months, and #523 closed them.
 * With a gate in front, opening the bind is no longer the act it was before it
 * existed. That is the argument for the option, and it is exactly the argument
 * against changing the default: **the safety came from the gate, not from the
 * bind**, and a default that assumes the gate is correct stops being safe the
 * day the gate has a hole. Two things that have to be wrong at once is worth
 * keeping when the cost of keeping it is one variable.
 *
 * ## Two words rather than an address
 *
 * An address is the obvious shape and it is the wrong one here.
 *
 * There are only two answers that mean anything from inside a container: *only
 * something sharing this network namespace*, and *anything that can route to
 * me*. A narrower interface address is assigned by the runtime when the
 * container starts, is not knowable when the variable is set, and changes when
 * the container is replaced. A value that was right once is then a container that
 * will not start the next time, with `EADDRNOTAVAIL` and nothing else to read.
 *
 * A word also says what was meant. `0.0.0.0` in a deployment's configuration
 * records what somebody typed; `all` records what they decided, in the same
 * vocabulary the start log and `deploy/check-config.mjs` use back to them.
 *
 * `all` is IPv4 (`0.0.0.0`), which is what a published port maps and what
 * `EXPOSE` documents. There is deliberately no third word for IPv6: nothing has
 * asked for one, and an option nobody exercises is an option nobody knows is
 * broken.
 */

/**
 * The variable, named once and read once.
 *
 * `BOOKSCAN_BIND` rather than `HOST` or `BIND_ADDRESS`, for the reason
 * `ConnectionStrings__bookscan` is spelled the way it is: an inherited shell
 * variable must not be able to decide this. Docker sets `HOSTNAME` in every
 * container it starts, orchestrators set `HOST` for their own purposes, and a
 * server that took either would be one `docker run` away from listening
 * somewhere nobody chose.
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

/** Unset, empty and unstated all mean this. It is the whole point of the change. */
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
 * Refuses rather than guesses, for the same reason `signInFrom` does: a process
 * that exits naming a variable is recoverable in one command, and one that comes
 * up listening somewhere nobody chose is not obviously anything. **Silently
 * falling back to the default would be the worst of the three**, because a
 * deployment that asked to be reachable and was not would look identical to the
 * bind it was trying to change.
 *
 * Empty means unset, which is the rule `BOOKSCAN_DATA` and `BOOKSCAN_BACKUP_DIR`
 * already follow: a checkout or a compose file can switch this off by setting it
 * blank rather than by hoping nothing in the shell has set it.
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
 * What the process says about its own front door on every start, both ways
 * round.
 *
 * Returned rather than logged so a test can read it, exactly as `describeSignIn`
 * is. The line beside it already prints the address that was bound; this one
 * says what that address means, because "127.0.0.1" and "0.0.0.0" differ by one
 * character and by everything else. It should be impossible to read a start log
 * and be wrong about which interface is listening.
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
