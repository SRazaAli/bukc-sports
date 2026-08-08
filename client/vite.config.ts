import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // dev: proxy API calls to the Express server, so cookies are same-origin
      '/api': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
});
