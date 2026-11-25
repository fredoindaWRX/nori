import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Release snapshots contain their own HTML and dependency trees. Scanning
  // those as app entries can bundle a second React instance into development.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    // Packaged snapshots are not live source. Watching their copied trees can
    // exhaust the development server before it serves the renderer modules.
    watch: { ignored: ['**/release/**'] },
    // Honour PORT so a second instance can run alongside the first. The bridge
    // only accepts sockets from localhost:5173-5199, so stay inside that range
    // or set NORI_ALLOWED_ORIGINS to match.
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    // Keep production bundles lean: no sourcemaps, esbuild for fast minification.
    sourcemap: false,
    minify: 'esbuild',
    // Split heavy vendor libraries into their own chunks so they are cached
    // independently of app code and only re-downloaded when a dependency changes.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('cesium') || id.includes('@cesium')) return 'vendor-cesium'
          if (id.includes('three') || id.includes('troika') || id.includes('@tweenjs') || id.includes('@dimforge')) return 'vendor-three'
          if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) return 'vendor-react'
          if (id.includes('@react-three')) return 'vendor-r3f'
          if (id.includes('framer-motion') || id.includes('zustand') || id.includes('zod')) return 'vendor-ui'
          if (id.includes('@mediapipe') || id.includes('mediapipe')) return 'vendor-mediapipe'
          if (id.includes('leaflet')) return 'vendor-leaflet'
          if (id.includes('playwright')) return 'vendor-playwright'
          if (id.includes('dompurify') || id.includes('ws') || id.includes('undici')) return 'vendor-net'
        },
      },
    },
  },
})
