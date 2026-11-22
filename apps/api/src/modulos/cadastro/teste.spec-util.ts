// Apoio dos testes do cadastro e do atendimento sobre a app migrada (F2.2): o registro dos módulos com as portas em
// memória passadas pelo teste, e o contexto da porta (o do núcleo mais a rede e o código do estabelecimento).
import { type DynamicModule, Module } from '@nestjs/common';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import {
  CACHE_CONFIG,
  CacheConfig,
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { criarFonteDocumento, FONTE_DOCUMENTO } from '../documento/public-api.js';
import type { CarregadorModulo, ContextoModulo } from '../registro.js';
import { modulo as moduloCadastro } from './modulo.js';
import type { ContextoPorta, PortaCadastro } from './porta.js';

/** Contexto da porta para chamadas diretas nos testes (sem banco: cliente de teste, ids nulos). */
export function contextoDeTeste(hospital: string, rede = 'rede-teste'): ContextoPorta {
  return { cliente: 'teste', estabelecimento: null, usuario: null, correlacao: 'teste', rede, hospital };
}

/** Montadores extras (outros módulos do teste), por nome. */
export type MontadorTeste = (ctx: ContextoModulo) => DynamicModule | Promise<DynamicModule>;

/** Registro dos módulos do teste: o cadastro com a porta dada e os montadores extras. */
export function registroDeTeste(
  portas: { readonly cadastro?: PortaCadastro },
  extras: Readonly<Record<string, MontadorTeste>> = {},
): Record<string, CarregadorModulo> {
  const r: Record<string, CarregadorModulo> = {
    cadastro: async () => ({
      modulo: (ctx) => moduloCadastro(ctx, portas.cadastro ? { porta: portas.cadastro } : {}),
    }),
  };
  for (const [nome, montar] of Object.entries(extras)) r[nome] = async () => ({ modulo: montar });
  return r;
}

@Module({})
class ConfiguracaoDeTeste {}

/**
 * A configuração sintética de dev/ci (chaves de liberação, parâmetros e a fila de impressão em memória), como a
 * sessão sintética tinha: os controladores do cadastro e do atendimento a injetam como opcional. Global, para os módulos do teste.
 */
export function moduloConfiguracaoDeTeste(
  ctx: ContextoModulo,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _hospitais: readonly string[] = ['aa', 'bb'],
): DynamicModule {
  const fonte = fonteConfiguracaoMemoria(ctx.trilha, {
    chavesIniciais: chavesIniciaisSinteticas,
    prerequisitosIniciais: prerequisitosIniciaisSinteticos,
    parametrosIniciais: parametrosIniciaisSinteticos,
  });
  return {
    module: ConfiguracaoDeTeste,
    global: true,
    providers: [
      { provide: FONTE_CONFIGURACAO, useValue: fonte },
      { provide: CACHE_CONFIG, useValue: new CacheConfig(new ArmazemMemoria()) },
      // A fila de impressão da estação (ZPL), como a sessão sintética tinha.
      { provide: FONTE_DOCUMENTO, useValue: criarFonteDocumento(ctx.configuracao, ctx.env) },
    ],
    exports: [FONTE_CONFIGURACAO, CACHE_CONFIG, FONTE_DOCUMENTO],
  };
}
