import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Safari will not hand out a camera stream unless the page is a secure
// context, and "secure" excludes http://192.168.x.x, so the dev server speaks
// HTTPS with a self-signed cert and the phone taps through one warning. Vite
// proxies /api to the separate plain-HTTP API process server-side, which
// keeps the page free of mixed-content errors Safari would otherwise block.
//
// Both the port and the proxy target come from the environment when Aspire
// supplies them, so several worktrees can run at once instead of fighting
// over 5173 and 3001.
//
// VITE_PORT rather than PORT: server/index.ts already reads PORT, and `npm
// run dev` starts both through concurrently in one shell, so reading PORT
// here would point the API and Vite at the same port whenever a developer
// happened to have it set.
const port = Number(process.env.VITE_PORT ?? 5173)
const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true, // bind 0.0.0.0 so the phone can reach it over the LAN
    port,
    // Fail loudly rather than silently drifting to another port: the phone is
    // told one address.
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
    /**
     * Kept on deliberately: anyone who can open this app's devtools can read
     * its original TypeScript, since the API serves `dist` from the same
     * origin. That is acceptable because the client bundle holds no secret,
     * the API key lives on the server, and the maps are what makes a fault on
     * somebody's phone readable on the one deployment with no compiler behind
     * it. It would need revisiting if this app became reachable by anybody
     * who is not the owner.
     */
    sourcemap: true,
  },
})
