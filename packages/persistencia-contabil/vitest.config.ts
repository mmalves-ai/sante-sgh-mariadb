import { defineConfig } from 'vitest/config';

// Consultas e gravador comuns da contabilidade (API e worker): as partes puras (chave do lançamento, bloqueio do
// período, leitura das linhas) com teste de unidade; a gravação real é coberta pelos testes de integração da API e do
// worker.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'persistencia-contabil',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
  },
});
