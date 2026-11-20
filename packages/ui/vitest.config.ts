import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  plugins: [vue()],
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'jsdom',
    setupFiles: ['src/testes/preparar.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.vue'],
      exclude: [
        'src/**/*.spec.ts',
        'src/testes/**',
        'src/env.d.ts',
        'src/i18n/openvue-pt-BR.ts',
        'src/tokens/relatorio.ts',
      ],
      reportsDirectory: '../../coverage/packages/ui',
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 80 },
    },
  },
});
