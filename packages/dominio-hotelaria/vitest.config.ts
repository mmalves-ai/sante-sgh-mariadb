import { defineConfig } from 'vitest/config';

// Regras da higienização e do SAME (M21, ficha seções 8 e 10): os estados da limpeza (regra 9), o cronômetro com as
// pausas, o prazo por tipo × criticidade, a precaução que exige a terminal com o protocolo, a situação do legado só nos
// valores vistos; um lugar por vez, o movimento que não se apaga e o descarte com o aval (regra 10). Cobertura de 80%.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-hotelaria',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-hotelaria',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
