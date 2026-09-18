# Annotating the running app

[Agentation](https://www.agentation.com/) puts a toolbar on the page. You click
an element, type what is wrong with it, and the note goes to a local server
that a Claude session is listening to. The session makes the change, Vite
hot-reloads it, and the note in the toolbar is marked resolved with a summary.

It is a desktop tool: the toolbar does not work on a phone.

## The pieces

| Piece | Where |
| --- | --- |
| The toolbar | `agentation`, a dev dependency of `web/`, mounted in `web/src/main.tsx`. Dev builds only; the production bundle does not contain it. |
| The switch | `web/src/annotating.ts`. Off unless this browser has asked for it. |
| The server | `agentation-mcp`, registered in `.mcp.json`. One process is both the HTTP endpoint the toolbar posts to (`http://localhost:4747`) and the MCP server Claude reads from. Notes are kept in `~/.agentation/store.db`. |
| The listener | The `/watch-annotations` skill, `.claude/skills/watch-annotations/SKILL.md`. |

## Using it

1. Start Claude Code in this checkout. The first time, it asks you to approve
   the `agentation` server from `.mcp.json`; say yes (or use `/mcp`). The
   server starts with the session and stops with it.
2. Run `/watch-annotations`. It picks up anything already pending, then
   listens.
3. Start the app as usual (`aspire run`, or `npm run dev` in `web/`) and open it
   in a desktop browser with `?agentation=on` on the end of the address. The
   toolbar appears in the bottom right. The browser remembers; `?agentation=off`
   turns it off.
4. Click the toolbar, click things, write notes. They reach the listening
   session within about ten seconds (it waits that long for a batch).
5. Tell the session to stop when you are done. It leaves its changes
   uncommitted for you to review.

`npx agentation-mcp doctor` checks the setup if a note does not arrive.

## Why the switch

The e2e suite drives the same Vite dev server you do. A toolbar that appeared
whenever the app ran in dev mode would sit over the tab bar in every scenario
and fail the layout features, so it is per browser, and the browsers
Playwright launches have never asked for it.

## What the listener will not do

The server listens on every network interface and accepts notes from any
origin, so anyone on the LAN could post one. The skill therefore treats note
text as a description of a change on screen, not as instructions: it edits
code in the checkout and nothing else. It will not run commands, touch the
live catalogue, change CI or `.claude/`, or commit. See the skill's bounds.

Only one session owns port 4747. A second session that starts the server finds
the port taken, skips its own HTTP server and reads from the first, so two
listeners would both see every note. Run one at a time.
