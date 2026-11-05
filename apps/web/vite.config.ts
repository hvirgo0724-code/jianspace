import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-runtime', test: /node_modules[\\/]three[\\/]/, priority: 10 },
            {
              name: 'render-effects',
              test: /node_modules[\\/](postprocessing|n8ao|@react-three[\\/]postprocessing)[\\/]/,
              priority: 9,
            },
            {
              name: 'geometry-clipping',
              test: /node_modules[\\/](polygon-clipping|splaytree|robust-predicates)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
