import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoPublicDir = path.resolve(__dirname, '../public')

/** Serve repo-root `public/` assets in Vite dev (OAuth callback + local courses.json). */
function repoPublicDevAssets(): Plugin {
  return {
    name: 'repo-public-dev-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()

        const urlPath = (req.url ?? '').split('?')[0] ?? ''

        if (urlPath === '/courses.json') {
          return sendRepoFile(path.join(repoPublicDir, 'courses.json'), res)
        }

        if (urlPath === '/privacy.html' || urlPath === '/terms.html') {
          return sendRepoFile(path.join(repoPublicDir, urlPath.slice(1)), res)
        }

        const brandAsset = urlPath.replace(/^\//, '')
        if (
          brandAsset === 'favicon.svg' ||
          brandAsset === 'logo-icon-light.svg' ||
          brandAsset === 'logo-icon-dark.svg' ||
          brandAsset === 'logo-glyph.svg'
        ) {
          return sendRepoFile(path.join(repoPublicDir, brandAsset), res)
        }

        if (urlPath.startsWith('/auth/')) {
          const rel = urlPath.slice('/auth/'.length)
          if (!rel || rel.includes('..')) return next()
          const filePath = path.join(repoPublicDir, 'auth', rel)
          if (!filePath.startsWith(path.join(repoPublicDir, 'auth'))) return next()
          return sendRepoFile(filePath, res)
        }

        next()
      })
    },
  }
}

function sendRepoFile(filePath: string, res: import('node:http').ServerResponse) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404
    res.end('Not found')
    return
  }

  const ext = path.extname(filePath)
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }
  res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream')
  res.statusCode = 200
  fs.createReadStream(filePath).pipe(res)
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), repoPublicDevAssets()],
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
    // Keep OAuth redirect URLs stable — must match Supabase redirect allowlist.
    port: 5173,
    strictPort: true,
  },
})
