import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Deployed under https://tee-time.io/app/ (marketing stays at /)
  base: '/app/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@supabase/supabase-js')) return 'supabase';
          if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) return 'map';
          if (id.includes('node_modules/react-router')) return 'router';
        },
      },
    },
  },
  server: {
    proxy: {
      // Local dev: same catalog as production Pages
      '/courses.json': { target: 'https://tee-time.io', changeOrigin: true, secure: true },
    },
  },
})
