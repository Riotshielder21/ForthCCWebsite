import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import publicSiteBuild from './scripts/publicSiteBuild.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || `http://${env.HOST || '127.0.0.1'}:${env.PORT || '3000'}`

  return {
    plugins: [
      react(),
      tailwindcss(),
      publicSiteBuild(),
    ],
    server: env.VITE_API_BASE_URL ? {} : {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        }
      }
    }
  }
})
