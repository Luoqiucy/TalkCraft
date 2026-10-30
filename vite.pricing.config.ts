import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'pricing-site',
  base: './',
  build: { outDir: '../dist/pricing-site', emptyOutDir: true },
});
