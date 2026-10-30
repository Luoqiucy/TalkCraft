import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src-ui',
  base: '/react/',
  build: {
    outDir: '../public/react',
    emptyOutDir: true,
  },
  esbuild: {
    legalComments: 'none',
  },
});
