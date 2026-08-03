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
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true, // bind 0.0.0.0 so the phone can reach it over the LAN
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
