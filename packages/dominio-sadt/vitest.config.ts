import { defineConfig } from 'vitest/config';

// Regras do SADT (M26, ficha seção 10): estados do exame (regra 1), referência vigente no dia do exame (regra 5),
// restrições de sexo, idade e repetição (regra 6), valor crítico e escalonamento (regra 7), TAT (regra 12) e
// orçamento convertido (regra 13), mais o rastreio da amostra, a habilitação de quem libera e lauda (regra 8) e o
// acesso ao portal (regra 9). Cobertura de 80% (ficha) — o pacote mira 90%.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-sadt',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-sadt',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
