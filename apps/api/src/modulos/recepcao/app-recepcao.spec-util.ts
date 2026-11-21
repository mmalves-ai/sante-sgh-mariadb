// App da API com a base (sessão, autorização) e o módulo da recepção montado pelo registro (API_MODULOS=recepcao),
// sobre as portas em memória dos testes; `extras` acrescenta providers de módulos ainda não montados (ex.: a porta do
// atendimento em memória). Nada conecta a banco.
import type { Provider } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { criarApp } from '../../app.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import type { ContextoModulo } from '../registro.js';
import { modulo as moduloAtendimento } from '../atendimento/modulo.js';
import type { PortaAtendimento } from '../atendimento/public-api.js';
import { moduloRecepcao, type OpcoesModuloRecepcao } from './modulo.js';

export async function criarAppRecepcao(
  env: Record<string, string>,
  opcoes: OpcoesModuloRecepcao & {
    readonly trilha: RegistradorTrilha;
    readonly extras?: Provider[];
    /** A porta do atendimento em memória: monta também o módulo do atendimento (global), com as rotas do PA. */
    readonly atendimento?: PortaAtendimento;
  },
): Promise<NestFastifyApplication> {
  const envModulos = { ...env, API_MODULOS: opcoes.atendimento ? 'atendimento,recepcao' : 'recepcao' };
  const registro = {
    ...(opcoes.atendimento
      ? {
          atendimento: async () => ({
            modulo: async (ctx: ContextoModulo) => ({
              ...(await moduloAtendimento(ctx, { porta: opcoes.atendimento! })),
              global: true,
            }),
          }),
        }
      : {}),
    recepcao: async () => ({
      modulo: (ctx: ContextoModulo) => {
        const m = moduloRecepcao(ctx, opcoes);
        return { ...m, providers: [...(m.providers ?? []), ...(opcoes.extras ?? [])] };
      },
    }),
  };
  const app = await criarApp(lerConfiguracao(envModulos), null, envModulos, {
    trilha: opcoes.trilha,
    registro,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
