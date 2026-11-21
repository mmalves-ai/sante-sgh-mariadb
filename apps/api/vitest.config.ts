import { defineConfig } from 'vitest/config';
import { FORA, SUITE_BASE } from './suite-base.js';

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    name: 'api',
    // F2-L: só a base do boot (fecho do login) e os módulos registrados (suite-base.ts). O código não migrado fica fora
    // por configuração, como no boot (API_MODULOS), e roda pelo projeto api-pendente (vitest.pendente.config.ts).
    // Integração (Gotenberg, S3, Valkey, cópia): `./pnpm testes:integracao` (vitest.integracao.config.ts).
    include: SUITE_BASE,
    exclude: FORA,
    environment: 'node',
    env: { TZ: 'UTC' },
    // M41: os testes pela HTTP (app inteira em memória) levam 1 s isolados e passavam de 5 s sob a carga do
    // `nx affected` em paralelo; o limite de 20 s evita a falha por tempo sem esconder teste travado.
    testTimeout: 20_000,
    // M48.1 (integração): o `beforeAll` que monta a app (`criarApp` + `init`) passava dos 10 s padrão sob a carga da VM
    // (load acima de 15); 60 s, o mesmo prazo que os specs da operadora já davam ao próprio gancho.
    hookTimeout: 60_000,
  },
});
