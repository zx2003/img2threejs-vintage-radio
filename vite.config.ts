import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        radio: resolve(__dirname, 'index.html'),
        room: resolve(__dirname, 'room.html'),
      },
    },
  },
});
