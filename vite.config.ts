import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  server: {
    // `cap sync` writes into android/. A watch there reloads the open app,
    // and a folder that `cap sync` deletes can stop the dev server.
    watch: { ignored: ['**/android/**'] },
  },
});
