import { defineConfig } from 'vitest/config';

// Regras puras da gestão de pessoas (M52): colaborador e vínculos (F1), escala e dimensionamento (F2 e F3), ponto (F4),
// SESMT (F5) e treinamentos (F6). Cobertura de 90% (ficha do M52, seção 10: escala, ponto e dimensionamento).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-pessoas',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-pessoas',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
