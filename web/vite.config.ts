import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Safari will not hand out a camera stream unless the page is a secure
// context, and "secure" excludes http://192.168.x.x. So the dev server speaks
// HTTPS with a self-signed cert and the phone taps through one warning.
//
// The API runs as a separate plain-HTTP process. The phone never talks to it
// directly; Vite proxies /api server-side, which keeps the page free of
// mixed-content errors that Safari would otherwise block outright.
//
// Both the port and the proxy target come from the environment when it
// supplies them. Under Aspire each checkout is handed its own values, which is
// what lets several worktrees run at once instead of fighting over 5173 and
// 3001. The fallbacks are the old fixed values, so `npm run dev` on its own
// still behaves exactly as it did before Aspire existed.
//
// VITE_PORT rather than PORT, deliberately. server/index.ts already reads
// PORT, and `npm run dev` starts both through concurrently in one shell, so
// reading PORT here would point the API and Vite at the same port whenever a
// developer happened to have it set. strictPort would then turn that into a
// hard failure that did not exist before.
const port = Number(process.env.VITE_PORT ?? 5173)
const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true, // bind 0.0.0.0 so the phone can reach it over the LAN
    port,
    // Fail loudly rather than silently drifting to another port: the phone is
    // told one address and a silent move would just look like a broken app.
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    /*
     * Kept on, deliberately, and this is the decision rather than the default
     * it looks like (#512).
     *
     * It is about 2.4 MB of maps against about 450 kB of code, and since the
     * API now serves `dist` they are fetched from the same origin as everything
     * else, so anyone who can open this app's devtools can read its original
     * TypeScript. That was worth stating out loud rather than leaving as a line
     * nobody had looked at.
     *
     * Why on: what a map discloses is the shape of the client's code. It is not
     * a credential and it is not a row. The client bundle holds no secret to
     * find: every origin it talks to is the same origin, the API key lives on
     * the server (`server/secrets.ts`) and the connection never leaves it. The
     * exposure this app actually has is the seventy-two unauthenticated doors
     * `docs/auth-surface.md` counted, and a source map is not one of them.
     * Against that, the maps are what makes a fault on somebody's phone
     * readable, on the one deployment that has no compiler and no watcher
     * behind it. They are served once and cached.
     *
     * What would flip it: this app becoming reachable by anybody who is not the
     * owner. A build that strangers can fetch, or more than one person's
     * catalogue on one origin, and disclosure stops being free. That is #510
     * and #471's decision to take with the gate in hand, and it is this one
     * line and nothing else.
     */
    sourcemap: true,
  },
})
