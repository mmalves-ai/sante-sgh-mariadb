// F2-L: specs do código trazido que ainda não foi migrado para o banco próprio (importam o pacote antigo ou dependem
// de módulos fora do API_MODULOS). PENDENTE DE MIGRAÇÃO: não é portão do marco; mede o que falta. Cada módulo que a
// F2.2/F2.3 migrar entra em src/modulos/registro.ts e, com isso, passa sozinho para a suíte padrão (suite-base.ts).
// uso: node_modules/.bin/vitest run --config apps/api/vitest.pendente.config.ts
import { defineConfig } from 'vitest/config';
import { FORA, SUITE_BASE } from './suite-base.js';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'api-pendente',
    include: ['src/**/*.spec.ts'],
    exclude: [...FORA, ...SUITE_BASE],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
