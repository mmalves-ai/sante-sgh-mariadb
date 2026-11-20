import { defineConfig } from 'vitest/config';

// Regras do atendimento externo (M20, ficha seção 10): conta aberta antes do lançamento, caráter obrigatório,
// indicadores sobre ESPEC > 0, observação abaixo de 24 h, desfecho e ato médico, quadro do PA, fila do consultório,
// herança do atendimento anterior e os impressos em ZPL. Cobertura de 80% (ficha) — o pacote mira 90%.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-atendimento',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-atendimento',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
