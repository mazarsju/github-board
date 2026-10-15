import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En développement, l'API est servie par le backend (npm run dev).
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
