import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Deployed under https://tee-time.io/app/ (marketing stays at /)
  base: '/app/',
  server: {
    proxy: {
      // Local dev: same catalog as production Pages
      '/courses.json': { target: 'https://tee-time.io', changeOrigin: true, secure: true },
    },
  },
})
