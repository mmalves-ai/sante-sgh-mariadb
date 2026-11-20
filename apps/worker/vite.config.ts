// Build do worker: pacote ESM único para o Node 24 (node_modules fica externo).
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  build: { ssr: 'src/main.ts', outDir: 'dist', emptyOutDir: true, target: 'node24', sourcemap: true },
});
