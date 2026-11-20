import { defineConfig } from 'vitest/config';

// Regras puras da operadora própria (M56): chaves por fatia, natureza do produto (cartão de desconto não é plano),
// registro na ANS, destino dos envios e das mensagens (nada sai fora de produção) e a conferência do inventário; F1:
// documentos, plano (RN 63), contrato, beneficiário, carteirinha e elegibilidade.
// Cobertura de 90% (ficha do M56, seção 10).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-operadora',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-operadora',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
