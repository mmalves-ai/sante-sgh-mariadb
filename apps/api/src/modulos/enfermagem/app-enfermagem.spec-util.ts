// Aplicação de teste da enfermagem sobre a app migrada (F2.2): a base (sessão, autorização) e o módulo da enfermagem
// montado pelo registro (API_MODULOS=config,enfermagem), com as portas em memória passadas pelo teste e o módulo da
// configuração sobre a fonte sintética de dev/ci (chaves de liberação, parâmetros; uma chave pode vir desligada).
// Nada conecta a banco.
import type { Provider } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ContextoNucleo } from '@sgh/nucleo';
import { criarApp } from '../../app.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import {
  chavesIniciaisSinteticas,
  type FonteConfiguracao,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { modulo as moduloConfig } from '../config/modulo.js';
import type { CarregadorModulo, ContextoModulo } from '../registro.js';
import { moduloRecepcao, type OpcoesModuloRecepcao } from '../recepcao/modulo.js';
import { modulo as moduloEnfermagem, type OpcoesModuloEnfermagem } from './modulo.js';

/** O contexto do estabelecimento sintético dos testes em memória (sem banco: o mapa dos estabelecimentos não liga). */
export const CONTEXTO_SINTETICO: ContextoNucleo = {
  cliente: '',
  estabelecimento: null,
  usuario: null,
  correlacao: 'teste-enfermagem',
  // O código da sessão sintética: as portas em memória guardam o estado por ele.
  ...{ hospital: 'aa' },
};

export interface OpcoesAppEnfermagem extends OpcoesModuloEnfermagem {
  readonly trilha: RegistradorTrilha;
  /** A configuração das funcionalidades (padrão: a sintética, com todas as chaves ligadas). */
  readonly configuracao?: FonteConfiguracao;
  /** Uma chave de liberação desligada pelo administrador (atalho para a configuração sintética sem ela). */
  readonly semChave?: string;
  /** Providers a mais no módulo da enfermagem. */
  readonly extras?: readonly Provider[];
  /** Monta também a recepção (global: a classificação de risco e os protocolos gerenciados do PA), com estas portas. */
  readonly recepcao?: OpcoesModuloRecepcao;
}

/** A fonte da configuração do teste: a dada, ou a sintética (com a chave desligada, se pedida). */
function fonteDoTeste(ctx: ContextoModulo, o: OpcoesAppEnfermagem): FonteConfiguracao {
  return (
    o.configuracao ??
    fonteConfiguracaoMemoria(ctx.trilha, {
      chavesIniciais: o.semChave
        ? () => chavesIniciaisSinteticas().filter((c) => c.chave !== o.semChave)
        : chavesIniciaisSinteticas,
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      parametrosIniciais: parametrosIniciaisSinteticos,
    })
  );
}

/** A app de teste (sem init): o lugar do criarApp antigo com as portas da enfermagem. */
export async function criarAppComEnfermagem(
  env: Record<string, string>,
  o: OpcoesAppEnfermagem,
): Promise<NestFastifyApplication> {
  const envModulos = { ...env, API_MODULOS: o.recepcao ? 'config,recepcao,enfermagem' : 'config,enfermagem' };
  const registro: Record<string, CarregadorModulo> = {
    config: async () => ({ modulo: (ctx) => moduloConfig(ctx, { fonte: fonteDoTeste(ctx, o) }) }),
    ...(o.recepcao ? { recepcao: async () => ({ modulo: (ctx: ContextoModulo) => moduloRecepcao(ctx, o.recepcao) }) } : {}),
    enfermagem: async () => ({
      modulo: async (ctx) => {
        const m = await moduloEnfermagem(ctx, o);
        return { ...m, providers: [...(m.providers ?? []), ...(o.extras ?? [])] };
      },
    }),
  };
  return criarApp(lerConfiguracao(envModulos), null, envModulos, { trilha: o.trilha, registro });
}
