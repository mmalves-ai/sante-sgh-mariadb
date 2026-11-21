// Montagem da API de teste da qualidade (F2.2): a app com o registro de teste (a configuração sintética, o cadastro e o
// módulo da qualidade com as portas dadas), no lugar das opções de porta do app.module antigo. Só para os specs.
import { type DynamicModule, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { criarApp } from '../../app.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import type { FontePlataforma } from '../../sessao/tipos-acesso.js';
import type { ArmazemSessao } from '../../sessao/armazem.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from '../cadastro/teste.spec-util.js';
import {
  CACHE_CONFIG,
  CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  PORTA_ONDA0,
  portaOnda0Memoria,
} from '../config/public-api.js';
import { criarFonteDocumento, FONTE_DOCUMENTO } from '../documento/public-api.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import type { ContextoNucleo } from '@sgh/nucleo';
import { type ContextoModulo, REGISTRO_MODULOS } from '../registro.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { modulo as moduloQualidade, type OpcoesModuloQualidade } from './modulo.js';

@Module({})
class ConfiguracaoQualidadeTeste {}

/** A configuração sintética com a fonte dada (parâmetros extras ou chaves desligadas). */
function configuracaoCom(fonte: FonteConfiguracao) {
  return (ctx: ContextoModulo): DynamicModule => ({
    module: ConfiguracaoQualidadeTeste,
    global: true,
    providers: [
      { provide: FONTE_CONFIGURACAO, useValue: fonte },
      { provide: CACHE_CONFIG, useValue: new CacheConfig(new ArmazemMemoria()) },
      { provide: PORTA_ONDA0, useValue: portaOnda0Memoria(fonte, ['aa', 'bb']) },
      { provide: FONTE_DOCUMENTO, useValue: criarFonteDocumento(ctx.configuracao, ctx.env) },
    ],
    exports: [FONTE_CONFIGURACAO, CACHE_CONFIG, PORTA_ONDA0, FONTE_DOCUMENTO],
  });
}

export interface OpcoesAppQualidade extends OpcoesModuloQualidade {
  readonly trilha?: RegistradorTrilha;
  readonly configuracao?: FonteConfiguracao;
  readonly armazem?: ArmazemSessao;
  readonly plataforma?: FontePlataforma;
  /** Liga o módulo suporte (a sessão "como"), quando registrado. */
  readonly suporte?: boolean;
  /** Aceitos e ignorados (as vigias eram do app.module antigo; o módulo migrado não as liga). */
  readonly vigia?: unknown;
  readonly vigiaEnfermagem?: unknown;
}

/** A app de teste com a qualidade montada pelo registro (o env ganha API_MODULOS do teste). */
export function criarAppQualidade(
  envBase: NodeJS.ProcessEnv | Record<string, string | undefined>,
  o: OpcoesAppQualidade = {},
): Promise<NestFastifyApplication> {
  const suporte = o.suporte ? REGISTRO_MODULOS['suporte'] : undefined;
  const env = {
    ...envBase,
    API_MODULOS: `configuracao_teste,cadastro,qualidade${suporte ? ',suporte' : ''}`,
  } as NodeJS.ProcessEnv;
  const { trilha, configuracao, armazem, plataforma, suporte: _s, vigia: _v, vigiaEnfermagem: _ve, ...portas } = o;
  void _s;
  void _v;
  void _ve;
  return criarApp(lerConfiguracao(env), null, env, {
    ...(trilha ? { trilha } : {}),
    ...(armazem ? { armazem } : {}),
    ...(plataforma ? { plataforma } : {}),
    registro: {
      ...registroDeTeste(
        {},
        {
          configuracao_teste: configuracao ? configuracaoCom(configuracao) : (ctx) => moduloConfiguracaoDeTeste(ctx),
          qualidade: (ctx) => moduloQualidade(ctx, portas),
        },
      ),
      ...(suporte ? { suporte } : {}),
    },
  });
}

/** O contexto sintético das chamadas diretas à porta em memória (o estabelecimento pelo código da sessão). */
export function ctxTeste(hospital: string): ContextoNucleo {
  return { cliente: 'teste', estabelecimento: null, usuario: null, correlacao: 'teste', hospital } as ContextoNucleo;
}

/** A linha de trilha das gravações diretas à porta em memória (a memória não grava trilha). */
export const TRILHA_TESTE: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'teste',
  entidadeId: null,
  correlacao: null,
};
