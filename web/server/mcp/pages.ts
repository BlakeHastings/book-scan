/**
 * The three pages a person sees while connecting an MCP client: sign in first,
 * not let in yet, and the consent page itself.
 *
 * Server-rendered and tiny, because they are reached by a browser the MCP
 * client opened, at a path outside `/api` the React client does not route, and
 * they must work on a deployment with no built client at all. Every value that
 * came from a client's registration or a query string goes through `escape`,
 * since a client chooses its own name and a stranger can register one.
 */

import type express from 'express'

export function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Headers every one of these pages carries.
 *
 * `frame-ancestors 'none'` and `X-Frame-Options` because a consent page that
 * can be framed can be clickjacked into an approval. `form-action` names this
 * origin and, for the consent page, the origin of the redirect the approval
 * ends in: browsers apply `form-action` to the redirect a submission is
 * answered with, so leaving it out would stop the approval at the last hop.
 * `no-referrer` because the address carries the client's `state`.
 */
function send(res: express.Response, status: number, html: string, formTarget = ''): void {
  res.status(status)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; " +
    `form-action 'self'${formTarget ? ` ${formTarget}` : ''}`,
  )
  res.end(html)
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #faf8f5; color: #1d1b18; }
  main { max-width: 28rem; margin: 0 auto; }
  h1 { font-size: 1.3rem; margin: 0 0 1rem; }
  .where { font-family: ui-monospace, monospace; background: #efebe4; padding: 2px 6px; border-radius: 4px; word-break: break-all; }
  .warn { border-left: 3px solid #b4572e; padding-left: 12px; }
  .row { display: flex; gap: 12px; margin-top: 1.5rem; }
  button, a.button { font: inherit; padding: 10px 18px; border-radius: 8px; border: 1px solid #1d1b18; background: #fff; color: inherit; text-decoration: none; cursor: pointer; }
  button[value="approve"] { background: #1d1b18; color: #fff; }
  @media (prefers-color-scheme: dark) {
    body { background: #1b1a18; color: #ece8e1; }
    .where { background: #2c2a27; }
    button, a.button { background: #2c2a27; border-color: #ece8e1; }
    button[value="approve"] { background: #ece8e1; color: #1b1a18; }
  }
</style>
</head>
<body><main>${body}</main></body>
</html>`
}

export function signInFirst(
  res: express.Response,
  clientName: string,
  ways: { label: string; start: string }[],
): void {
  const buttons = ways.length
    ? ways.map((way) => `<a class="button" href="${escape(way.start)}">Sign in with ${escape(way.label)}</a>`).join('\n')
    : '<p>Nobody can sign in to this server yet: no sign-in provider is configured.</p>'
  send(res, 200, page('Sign in to connect', `
<h1>Sign in to connect ${escape(clientName)}</h1>
<p><strong>${escape(clientName)}</strong> is asking to use this book catalogue as you. Sign in first, and you will be asked whether to allow it.</p>
<div class="row">${buttons}</div>`))
}

export function notLetInYet(res: express.Response, clientName: string): void {
  send(res, 403, page('Not let in yet', `
<h1>You are signed in, but not let in yet</h1>
<p>This catalogue's owner has not let this account in, so <strong>${escape(clientName)}</strong> cannot be connected to it. Once they have, start the connection again.</p>`))
}

export function consent(
  res: express.Response,
  args: {
    clientName: string
    /** The host of a metadata document's URL, for a client that named itself with one. */
    clientHost?: string
    redirectUri: string
    who: string
    consentToken: string
  },
): void {
  const target = new URL(args.redirectUri)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  const warning = loopback
    ? `<p class="warn">This client receives the answer on <span class="where">${escape(target.host)}</span>, which is a program on the computer you are using. Any program there could claim this name, so allow it only if you started this connection yourself just now.</p>`
    : ''
  /*
   * A document may give itself any name, so the host it was fetched from is
   * shown beside it: that is the part nobody else can claim.
   */
  const vouched = args.clientHost
    ? `<p>This client describes itself in a document at <span class="where">${escape(args.clientHost)}</span>. The name above is what that document says; the address is who published it.</p>`
    : ''
  send(res, 200, page('Allow access?', `
<h1>Allow ${escape(args.clientName)} to use this catalogue as you?</h1>
${vouched}
<p>Signed in as <strong>${escape(args.who)}</strong>.</p>
<p>If you allow it, <strong>${escape(args.clientName)}</strong> can read and change this book catalogue as you until you disconnect it. The answer will be sent to <span class="where">${escape(target.host)}</span>.</p>
${warning}
<form method="post" action="/api/mcp/consent">
  <input type="hidden" name="consent" value="${escape(args.consentToken)}">
  <div class="row">
    <button type="submit" name="decision" value="approve">Allow</button>
    <button type="submit" name="decision" value="deny">Deny</button>
  </div>
</form>`), target.origin)
}

export function consentGone(res: express.Response): void {
  send(res, 400, page('This request has expired', `
<h1>This request has expired</h1>
<p>It was already answered, it is more than ten minutes old, or it was opened while signed in as somebody else. Start the connection again from the app that asked.</p>`))
}
