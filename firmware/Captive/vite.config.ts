import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { mockApiPlugin } from './server/vite-plugin-mock';

const apiTarget = process.env.VITE_API_TARGET;

export default defineConfig({
  plugins: [
    react(),
    // Only use mock API when not targeting real hardware
    !apiTarget && mockApiPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Use proxy when targeting real hardware
    ...(apiTarget && {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    }),
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
});
