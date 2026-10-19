import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export default defineConfig(({ command }) => {
  const commit = command === 'build' ? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: new URL('.', import.meta.url) }).trim() : 'development';
  return {
  define: { __PIKADO_COMMIT__: JSON.stringify(commit) },
  plugins: [{
    name: 'vbd-build-record',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'pikado-version.json', source: JSON.stringify({ repository: 'https://github.com/taotsky/pikado', commit, protocolVersion: 1 }) });
      this.emitFile({ type: 'asset', fileName: 'LICENSE', source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8') });
    },
  }],
  base: './',
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // The HEIC decoder ships as an asset (see src/io/heif-read.js) and is
        // published as `.mjs`. Plenty of servers — nginx's own mime.types among
        // them — do not know that extension, serve it as octet-stream, and the
        // browser refuses to run a module of that type. `.js` works everywhere.
        assetFileNames: (asset) => (/\.mjs$/.test(asset.names?.[0] || asset.name || '')
          ? 'assets/[name]-[hash].js'
          : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  };
});
