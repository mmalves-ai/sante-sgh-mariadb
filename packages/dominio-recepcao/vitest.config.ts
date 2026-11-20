import { defineConfig } from 'vitest/config';

// Regras da recepção (M19, ficha seção 10): máquina de estados da senha sobre as letras do legado, ordem da fila,
// prioridade legal, encaminhamento entre locais, obrigatoriedades por hospital, painel (iniciais, fala) e esperas.
// Cobertura de 80% (ficha) — o pacote mira 90%.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-recepcao',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-recepcao',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
