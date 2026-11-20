import { defineConfig } from 'vitest/config';

// Projeto "dominio-documento": regras puras de documentos e etiquetas (cap-09 §9.8): modelos ZPL de pulseira
// e etiqueta (motor, cobertura ≥ 90%), assinatura da mensagem do QZ Tray, idempotência da fila zpl, modelo
// HTML do PDF/A de prova, QR de validação e regras de emissão e 2ª via.
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'dominio-documento',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.spec-util.ts', 'src/index.ts', 'src/assinatura/index.ts'],
      reportsDirectory: '../../coverage/dominio-documento',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
