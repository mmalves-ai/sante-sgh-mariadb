import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.int.spec.ts'],
    environment: 'node',
    env: { VIGIA_BANCO: 'desligado', OUTBOX_RELAY: 'desligado', TRANSMISSOR_TISS: 'desligado' },
  },
});
