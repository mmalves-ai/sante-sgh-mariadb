import { defineConfig } from 'vitest/config';

// Regras das integrações novas (M34, ficha seção 10): retentativa crescente com limite por parceiro e fila de mortos
// (regra 9), alerta da fila de mortos (regra 10), chave anti-duplicação dos fatos e do consumidor (regras 8 e 11),
// HL7 v2 (regra 12), FHIR R4 contra os perfis BR Core fixados e a identificação para a RNDS (regra 14), o retorno do
// laboratório de apoio (regra 13), sem canal próprio de mensagem (regra 15a) e os pacotes aos parceiros que leem o
// banco (regra 16). Cobertura de 80% (ficha) — o pacote mira 90%.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-integracao',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reportsDirectory: '../../coverage/dominio-integracao',
      reporter: ['text-summary'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
