import { defineConfig } from 'vitest/config';

// Motor da agenda de consultas (M17, ficha seção 10): gerador de horários, estados do horário e da marcação,
// encaixe, cobertura, próximo livre, fechamento do dia e indicadores. Cobertura de 90% (motor).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-agenda',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-agenda',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
