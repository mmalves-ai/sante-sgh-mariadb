// Integração da API com os serviços sgh-* do Compose (M05: sessão no Valkey; M09: Gotenberg, S3, Valkey) e a
// cópia de dev: fora do `pnpm verificar`, rodam por `./pnpm testes:integracao` (com a trava da cópia), com
// `./pnpm infra:subir` no ar. Nenhum dado pessoal.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'api-integracao',
    include: ['src/**/*.int.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
