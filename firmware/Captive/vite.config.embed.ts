import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

// Embed build configuration for ESP32 firmware
// Produces a single HTML file with all JS, CSS, and images inlined
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile({
      removeViteModuleLoader: true,
      useRecommendedBuildConfig: true,
      inlinePattern: [],
      deleteInlinedFiles: true,
    }),
    {
      name: 'move-script-to-body-end',
      enforce: 'post',
      transformIndexHtml(html) {
        // Move script tags from head to end of body for loading spinner visibility
        const scriptMatch = html.match(/<script[^>]*type="module"[^>]*>[\s\S]*?<\/script>/i);
        if (scriptMatch) {
          html = html.replace(scriptMatch[0], '');
          html = html.replace('</body>', `${scriptMatch[0]}\n</body>`);
        }
        return html;
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist-embed',
    assetsDir: '',
    // Inline all assets (no size limit)
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    sourcemap: false,
    // Required for singlefile plugin
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Single chunk
        manualChunks: undefined,
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
});
