// Aspire TypeScript AppHost
// For more information, see: https://aspire.dev
//
// Two resources, both living in ./web:
//   api  the Express server (web/server/index.ts)
//   web  the Vite React client
//
// Ports are assigned by Aspire rather than hardcoded, which is what lets
// several worktrees run at once.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createBuilder } from './.aspire/modules/aspire.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Scan data for THIS checkout only.
//
// Set explicitly rather than left to the server's `process.env.BOOKSCAN_DATA
// ?? 'data'` default. The default would inherit BOOKSCAN_DATA from the
// surrounding shell, and if that pointed at the live catalogue a development
// run would write to real data. An explicit value here overrides anything
// inherited, so an Aspire run can only ever touch this checkout.
const dataDir = join(here, 'web', 'data');

const builder = await createBuilder();

const api = await builder
  .addNodeApp('api', './web', 'server/index.ts')
  // tsx, because the server is TypeScript and is not built before running.
  .withRunScript('dev:server')
  // Aspire picks the port and passes it as PORT, which server/index.ts
  // already reads.
  .withHttpEndpoint({ env: 'PORT' })
  .withEnvironment('BOOKSCAN_DATA', dataDir);

const web = await builder
  .addViteApp('web', './web', { runScriptName: 'dev:client' })
  // VITE_PORT, not PORT: the api reads PORT, and `npm run dev` runs both
  // through concurrently in one shell, so a shared name would collide.
  .withHttpEndpoint({ env: 'VITE_PORT' })
  // The client is served to a phone on the LAN, so the browser resolves
  // /api against its own origin and Vite proxies it. The proxy target comes
  // from here rather than a literal in vite.config.ts.
  .withEnvironment('API_URL', api.getEndpoint('http'))
  // The phone is a different device, so this endpoint has to leave localhost.
  .withExternalHttpEndpoints()
  // Aspire manages lifecycle; opening a browser per restart is noise.
  .withEnvironment('BROWSER', 'none')
  .waitFor(api);

await builder.build().run();
