import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        friends: resolve(process.cwd(), 'friends.html'),
        mediaAudit: resolve(process.cwd(), 'media-audit.html'),
        localCamera: resolve(process.cwd(), 'local-camera.html'),
        practice: resolve(process.cwd(), 'practice.html'),
        fingerspell: resolve(process.cwd(), 'fingerspell.html'),
        neuralAlphabet: resolve(process.cwd(), 'neural-alphabet.html'),
      },
    },
  },
});
