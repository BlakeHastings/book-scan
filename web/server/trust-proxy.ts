/**
 * How many proxies in front of this server are trusted to say who the client
 * is, decided by configuration and handed to Express as `trust proxy`.
 *
 * Express answers `req.ip` by walking `X-Forwarded-For` from the right, one
 * entry per trusted hop, starting at the socket. A proxy appends the address it
 * received the request from, so the rightmost `n` entries were written by the
 * `n` proxies in front of this one and everything to their left was written by
 * whoever sent the request. A count is therefore the only setting that cannot
 * be talked past: `true` takes the leftmost entry, which the client chose, and
 * express-rate-limit refuses it as `ERR_ERL_PERMISSIVE_TRUST_PROXY` for that
 * reason.
 *
 * Zero is the default, and it means the socket's own address is the client,
 * which is the truth in a development checkout and on any deployment with
 * nothing in front of it.
 */

/**
 * `BOOKSCAN_PROXY_HOPS` rather than `TRUST_PROXY`: an inherited shell variable
 * must not be able to decide whose address a rate limit keys on.
 */
export const PROXY_HOPS = 'BOOKSCAN_PROXY_HOPS'

/**
 * Read the environment and say how many proxy hops to trust.
 *
 * Refuses rather than guesses, for the reason `bindFrom` does: a value that
 * fell back to zero would put every client behind one address, which is the
 * defect this setting exists to end, and nothing would say so.
 *
 * Empty means unset, the same rule `BOOKSCAN_BIND` follows.
 */
export function proxyHopsFrom(env: NodeJS.ProcessEnv): number {
  const asked = (env[PROXY_HOPS] ?? '').trim()
  if (!asked) return 0
  if (/^\d+$/.test(asked)) return Number(asked)

  throw new Error(
    `${PROXY_HOPS} is "${asked}", which is not a count.\n\n` +
    'It is how many proxies stand between the internet and this server, each of ' +
    'which appends to X-Forwarded-For: 0 (the default) when nothing does, 1 for one ' +
    'reverse proxy, 2 for a CDN in front of a reverse proxy, and so on. ' +
    (/^(true|yes|on|all)$/i.test(asked)
      ? 'It is deliberately not a yes: trusting every hop takes the client address ' +
        'from the leftmost entry, which the client wrote, so anybody could choose ' +
        'the address their rate limit is counted against. '
      : '') +
    'See deploy/contract.json.',
  )
}

/**
 * The value handed to `app.set('trust proxy', ...)`.
 *
 * Zero is `false` rather than `0`. Express treats the two alike, but
 * express-rate-limit warns `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` only when the
 * setting is exactly `false`, and that warning is how a deployment that forgot
 * this variable finds out.
 */
export function trustProxySetting(hops: number): number | false {
  return hops > 0 ? hops : false
}

/** What the process says about it on every start, both ways round. */
export function describeProxyHops(hops: number): string[] {
  return [hops === 0
    ? `[api] trusting no proxy (${PROXY_HOPS} is unset or 0): a client's address is ` +
      'the socket\'s, so behind a proxy every client shares the proxy\'s address and ' +
      'one rate limit. Set it to the number of proxies in front of this server.'
    : `[api] trusting ${hops} proxy ${hops === 1 ? 'hop' : 'hops'} (${PROXY_HOPS}=${hops}): ` +
      `a client's address is the ${ordinal(hops)} entry from the right of X-Forwarded-For. ` +
      'If fewer proxies than that stand in front of this server, a client can choose its own address.']
}

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}
