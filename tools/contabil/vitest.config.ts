import { defineConfig } from 'vitest/config';

// Ferramentas da contabilidade (M54.1): a conferência do reprocessamento de um período (`pnpm contabil:reprocessar`).
export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'contabil-ferramentas',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
  },
});
