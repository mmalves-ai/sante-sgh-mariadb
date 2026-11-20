// Catálogo visual dos componentes (ferramenta interna, nunca publicada): `pnpm nx run ui:catalogo` (servidor
// local em 127.0.0.1:5301) e `pnpm nx run ui:catalogo-build` (build estático usado na regressão visual).
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  envDir: false,
  plugins: [vue()],
  resolve: { tsconfigPaths: true },
  server: { host: '127.0.0.1', port: 5301, strictPort: true },
  build: { outDir: '../dist/catalogo', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
