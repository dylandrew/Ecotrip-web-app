import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  publicDir: 'public',
  plugins: [react()],
  server: {
    strictPort: true,
    proxy: {
      '/api/v1': 'http://127.0.0.1:8080',
      '/uploads': 'http://127.0.0.1:8080',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: 'index.html',
      output: {
        entryFileNames: 'ecotrip.js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: (asset) => asset.name?.endsWith('.css')
          ? 'ecotrip.css'
          : 'assets/[name][extname]',
      },
    },
  },
});
