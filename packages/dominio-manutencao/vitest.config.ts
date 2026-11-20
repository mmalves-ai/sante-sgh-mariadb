import { defineConfig } from 'vitest/config';

// Regras puras da manutenção e engenharia clínica (M55-F1): OS com prioridade e SLA, equipamento crítico parado,
// plano de manutenção com laudo, indicadores (disponibilidade, MTBF, MTTR) e cobertura por contrato. Cobertura de 90%.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-manutencao',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-manutencao',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
