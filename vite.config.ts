import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative asset paths, so the build runs from any location: the root of a
  // domain, or a project subpath like /cork./ on GitHub Pages. The app has no
  // client-side routing, so there is no nested path to break.
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    // three is most of the bytes and changes about once a year, while the app
    // changes every deploy. Split apart, a returning reader re-downloads the
    // few kilobytes that actually moved instead of the whole megabyte.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
          motion: ['framer-motion'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
