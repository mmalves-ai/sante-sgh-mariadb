import { defineConfig } from 'vitest/config';

// Regras do centro cirúrgico (M18, ficha seção 10): sobreposição com intervalo de preparo, equipe e sentinelas,
// estados do agendamento, duração e ligação agendamento × cirurgia realizada. Cobertura de 90% (motor).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-cirurgia',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/index.ts'],
      reportsDirectory: '../../coverage/dominio-cirurgia',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
