import { defineConfig } from 'vitest/config';

// Regras puras do MPI da Rede (M57; ficha, seções 8 e 10): o MPI nunca toca cadastro de paciente (regra 1), vínculo
// automático só com CPF ou CNS iguais e o resto coerente (regra 2), pontuação em que nome, mãe e nascimento só sugerem
// (regra 3), gravação por banco idempotente e divergência entre os índices (regra 4), duplicado no mesmo
// estabelecimento fora do MPI (regra 5) e isolamento da rede (regra 12). Cobertura de 90% no pareamento (seção 10).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-rede',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts', 'src/**/*.spec-util.ts'],
      reportsDirectory: '../../coverage/dominio-rede',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
