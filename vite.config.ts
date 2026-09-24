import { defineConfig } from 'vite';

/**
 * The dev proxy makes the subread.space API and its engine assets
 * same-origin in the browser, so the app uses the same relative paths on
 * the web as it does in the Android app (where native HTTP takes over).
 */
const SUBREAD = 'https://subread.space';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Pre-bundling would break the worker URL inside the ffmpeg wrapper.
    exclude: ['@ffmpeg/ffmpeg'],
  },
  server: {
    proxy: {
      '/api': {
        target: SUBREAD,
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
        // The SRT download redirects to a presigned URL. Follow it here, so
        // the browser sees one same-origin answer.
        followRedirects: true,
      },
      '/vendor': {
        target: SUBREAD,
        changeOrigin: true,
      },
    },
  },
});
