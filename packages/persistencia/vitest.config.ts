import { defineConfig } from 'vitest/config';

// @sgh/persistencia: as conversões puras (linha do banco → contrato) com teste de unidade. A gravação real fica nos
// *.int.spec.ts (vitest.integracao.config.ts), contra um cliente de teste criado pelo "criar novo cliente".
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'persistencia',
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.int.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
  },
});
