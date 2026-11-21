// App de teste da operadora (specs HTTP do lote 02-09): a base da API (sessão sintética, autorização, trilha) com o
// módulo da operadora montado pelas opções (portas em memória prontas e a fonte de configuração do teste). Sem portas,
// o módulo usa a regra de dev/ci (memória com as chaves sintéticas: as fatias da operadora desligadas).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { criarApp } from '../../../app.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { moduloOperadora, type OpcoesModuloOperadora } from '../modulo.js';

export interface OpcoesAppOperadora extends OpcoesModuloOperadora {
  readonly trilha?: RegistradorTrilha;
}

export async function criarAppOperadora(
  env: Record<string, string>,
  opcoes: OpcoesAppOperadora = {},
): Promise<NestFastifyApplication> {
  const e = { ...env, API_MODULOS: 'operadora' };
  const { trilha, ...portas } = opcoes;
  return criarApp(lerConfiguracao(e), null, e, {
    ...(trilha ? { trilha } : {}),
    registro: { operadora: async () => ({ modulo: (ctx) => moduloOperadora(ctx, portas) }) },
  });
}
