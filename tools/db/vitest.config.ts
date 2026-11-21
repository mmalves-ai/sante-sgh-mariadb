import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pacote = (p: string): string => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

// Projeto "db" (F2-L): regras puras das ferramentas do banco (catálogo de ações do "criar novo cliente"). Sem banco.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  // O semeador fica fora do tsconfig.json desta pasta (roda com transform-types; tsconfig.semear.json), então os
  // caminhos @sgh/* do tsconfig.base não valem para ele aqui: os dois pacotes que ele importa vão por alias.
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@sgh/dominio-acesso': pacote('dominio-acesso/src/index.ts'),
      '@sgh/nucleo': pacote('nucleo/src/index.ts'),
    },
  },
  test: { name: 'db', include: ['*.spec.ts'], environment: 'node', env: { TZ: 'UTC' } },
});
