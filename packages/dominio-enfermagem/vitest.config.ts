import { defineConfig } from 'vitest/config';

// Regras da enfermagem beira-leito (M25, ficha seções 8 e 10): aprazamento (quem apraza e a proposta pela grade),
// tolerância e estado do horário no turno, nove certos, pulseira, motivos, dupla checagem, sincronização sem rede,
// infusão contínua, glicemia pela escala, sinais vitais com faixa e retificação, passagem de plantão com aceite.
// Cobertura de 80%; o balanço hídrico do M45 (etapa 3), 90% de linhas.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-enfermagem',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-enfermagem',
      reporter: ['text-summary'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
        // M45 (etapa 3; critério de aceite): 90% de linhas no motor do balanço.
        'src/balanco/**': { lines: 90 },
        // M45 (etapa 2; ficha, seção 10): os motores de escore e da classificação com 90% das linhas.
        'src/escores/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/classificacao/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
        // M45 (etapa 4): o processo de enfermagem, a prescrição de enfermagem, a do enfermeiro e a vacina.
        'src/sae/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
      },
    },
  },
});
