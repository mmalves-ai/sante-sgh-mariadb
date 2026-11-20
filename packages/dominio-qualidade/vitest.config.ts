import { defineConfig } from 'vitest/config';

// Regras puras da qualidade e segurança do paciente (M48). Etapa 1 (NSP): classificação da OMS, prazos regulatórios
// com dias úteis e feriados, fluxo da notificação, visão de cada leitor (regra 1, não punitiva), campos do Notivisa e
// código de acompanhamento. Cobertura de 90% (ficha do M48, seção 10: prazos, denominadores e DDD).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-qualidade',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts', 'src/*/index.ts'],
      reportsDirectory: '../../coverage/dominio-qualidade',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
