import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'nico-glass-kit': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
});
