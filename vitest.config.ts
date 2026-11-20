// Projetos do Vitest na raiz: `pnpm vitest run --project <nome>` (ex.: --project legado).
// A cobertura no modo de projetos é da raiz, nos motores críticos (cap-14 §14.2.1, ≥ 90%): o núcleo do
// adaptador (M02) e a ferramenta de assinatura (M03; sem as entradas de linha de comando e a integração).
// Os testes de integração (vitest.integracao.config.ts) ficam de fora: rodam por `pnpm testes:integracao`.
import { defineConfig } from 'vitest/config';

// Com --project, os caminhos ficam relativos ao projeto (src/…); sem, à raiz (packages/legado/src/…).
// Por projeto: na ferramenta de assinatura, `src/**` e o adaptador de perfil e captura do legado
// (packages/legado/src/assinatura, fora da raiz do projeto: allowExternal, medido pelos testes da
// ferramenta); no legado, o núcleo; nos verificadores, o sem-pessoal (M03, seção 10 da ficha: ≥ 90% também nele).
const i = process.argv.indexOf('--project');
const projeto =
  i >= 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith('--project='))?.slice(10);

/** Partes críticas do adaptador da assinatura: o SQL agregado do perfil e o retrato antes e depois. */
const ADAPTADOR_ASSINATURA = ['perfil.ts', 'captura.ts'];

export default defineConfig({
  envDir: false,
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts', 'tools/*/vitest.config.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      allowExternal: projeto === 'assinatura',
      include:
        projeto === 'assinatura'
          ? ['src/**/*.ts', ...ADAPTADOR_ASSINATURA.map((f) => `**/legado/src/assinatura/${f}`)]
          : [
              '**/legado/src/nucleo/**/*.ts',
              ...ADAPTADOR_ASSINATURA.map((f) => `**/legado/src/assinatura/${f}`),
              '**/tools/assinatura/src/**/*.ts',
              '**/tools/verificadores/src/sem-pessoal.ts',
              // M04: as receitas das operações (src/<grupo>/gravacao) entram com o executor (≥ 90%).
              '**/legado/src/*/gravacao/**/*.ts',
              ...(projeto === 'legado'
                ? ['src/nucleo/**/*.ts', 'src/*/gravacao/**/*.ts', 'src/operacoes.ts']
                : []),
              ...(projeto === 'verificadores' ? ['src/sem-pessoal.ts'] : []),
            ],
      exclude: [
        '**/*.spec.ts',
        '**/*.spec-util.ts',
        '**/nucleo/driver-nativo.ts',
        '**/node_modules/**',
        '**/cli/**',
        '**/integracao/**',
        '**/__fixtures__/**',
      ],
      reportsDirectory: 'coverage/nucleo',
      reporter: ['text-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
