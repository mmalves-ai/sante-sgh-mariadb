// Integração das ferramentas de verificação com as cópias de dev (M57, etapa 3: a carga do data mart dos dois
// estabelecimentos e o arquivo da Rede): fora do `pnpm verificar`, rodam por `./pnpm testes:integracao` (com as
// travas das cópias). Nenhum dado pessoal: só contagens.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'verificadores-integracao',
    include: ['src/**/*.int.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
