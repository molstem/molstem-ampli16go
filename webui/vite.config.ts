import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Use relative paths for Electron compatibility
  define: {
    '__APP_VERSION__': JSON.stringify(packageJson.version),
    '__EMBEDDED_BUILD__': 'false',
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/auth': {
        target: 'https://app.molstem.com',
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: 'localhost',
        headers: {
          'X-Forwarded-Host': 'localhost:3000',
          'X-Forwarded-Proto': 'http',
        },
      },
      '/v0': {
        target: 'https://app.molstem.com',
        changeOrigin: true,
        secure: true,
        ws: true,  // Enable WebSocket proxying
        cookieDomainRewrite: 'localhost',
        headers: {
          'X-Forwarded-Host': 'localhost:3000',
          'X-Forwarded-Proto': 'http',
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
