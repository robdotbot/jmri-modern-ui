import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// JMRI's web server (default port 12080). Override with JMRI_URL=http://host:port npm run dev
const jmri = process.env.JMRI_URL ?? 'http://localhost:12080'

export default defineConfig({
  // Relative base so the built bundle works from any folder JMRI serves, e.g. /web/modern/
  base: './',
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/json': { target: jmri, ws: true, changeOrigin: true },
      // Everything else the app reads from JMRI's web server: roster images, panel XML and icons,
      // operations manifests, signal appearance files and the decoder index.
      ...Object.fromEntries(
        ['/roster', '/panel', '/operations', '/resources', '/dist', '/xml', '/prefs', '/project'].map((p) => [
          p,
          { target: jmri, changeOrigin: true },
        ]),
      ),
    },
  },
})
