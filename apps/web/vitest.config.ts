import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  plugins: [vue()],
  resolve: { tsconfigPaths: true },
  // D-PRAZO-539: a VM é compartilhada pelos marcos em construção (carga média acima de 30); as telas montadas no jsdom
  // passam do prazo padrão de 5 s sob carga sem falha real. O prazo de cada teste é 30 s (o mesmo das telas da F8).
  test: { include: ['src/**/*.spec.ts'], environment: 'jsdom', testTimeout: 30_000 },
});
