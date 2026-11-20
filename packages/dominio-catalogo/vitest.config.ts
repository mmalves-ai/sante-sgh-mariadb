import { defineConfig } from 'vitest/config';

// Regras puras dos catálogos oficiais e importadores (M13): códigos com zeros à esquerda, conversão para
// CP1252, leiautes dos arquivos oficiais, validação, comparação de edições, vigência e ciclo da carga.
// Cobertura de 80% (ficha do M13, seção 10).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-catalogo',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-catalogo',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
