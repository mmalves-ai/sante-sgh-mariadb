// Integração do worker (M04): relay da outbox no BullMQ do Valkey do Compose (sgh-valkey, 127.0.0.1:63718).
// Fora do `pnpm verificar`: roda por `./pnpm testes:integracao`; sem o Valkey no ar, o teste é pulado.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'worker-integracao',
    include: ['src/**/*.int.spec.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
