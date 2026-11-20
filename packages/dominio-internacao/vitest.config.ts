import { defineConfig } from 'vitest/config';

// Motor da internação (M16): trajetória do paciente, ocupação, censo pela hora de fechamento, as duas réguas de
// permanência, reinternação calculada e o painel de leitos. Cobertura de 90% (ficha do M16, seção 10: motor de
// indicadores).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-internacao',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.spec-util.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-internacao',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
