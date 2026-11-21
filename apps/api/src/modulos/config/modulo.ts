// Módulo da configuração por estabelecimento na API migrada (F2.2 onda 1, integração): a liberação das funcionalidades
// (chaves de operação e de recurso, pré-requisitos) e os parâmetros, lidos e gravados pela FonteConfiguracaoPropria
// sobre o banco do cliente. É global: as telas de trabalho dos outros módulos (atendimento, cadastro, agenda, recepção)
// conferem a chave de recurso pela FONTE_CONFIGURACAO daqui. Sem ele montado, essas telas ficam em consulta (falha
// fechada).
// - Com núcleo e cliente: confere antes que o banco tem as tabelas da fonte (liberacao_chave, liberacao_lote,
//   recurso_prerequisito...) e recusa subir sem elas; depois registra a fonte própria.
// - Sem núcleo, só em dev/ci (fontesSinteticas): a fonte de memória com as chaves sintéticas.
// - Fora disso: o módulo sobe sem a fonte (as telas ficam em consulta) e as rotas de administração respondem 503.
// - Os domínios (CRUD genérico), a onda 0, a saúde das conexões, a homologação e a prontidão (lote 02-02): a fonte
//   própria dos domínios e a porta própria da onda 0 com o núcleo; a memória só em dev/ci sem núcleo; fora disso, a
//   fonte de domínios indisponível (503). A guarda das chaves de tela (GuardaChaveDeTela) entra como guarda global,
//   depois da guarda de permissão da base.
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MetricasExecutor } from '@sgh/nucleo';
import { VersaoService } from '../../versao.service.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { CACHE_CONFIG, CacheConfig } from './cache-config.js';
import { CATALOGO_OPERACOES, catalogoOperacoesProprio } from './catalogo-operacoes.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from './configuracao-fonte.js';
import { FonteConfiguracaoPropria } from './configuracao-propria.js';
import { CRITERIO_LIGAR_SETOR, criterioLigarSetor } from './criterio-ligar.js';
import { DominiosController } from './dominios.controller.js';
import {
  FONTE_DOMINIOS,
  type FonteDominios,
  FonteDominiosPropria,
  fonteDominiosIndisponivel,
  fonteDominiosMemoria,
} from './dominios-fonte.js';
import { GravacaoController } from './gravacao.controller.js';
import { criarFonteGravacao, FONTE_GRAVACAO, type FonteGravacao, METRICAS_EXECUTOR } from './gravacao.js';
import { GuardaChaveDeTela } from './guarda-chave-de-tela.js';
import { HomologacaoController } from './homologacao.controller.js';
import { caminhoHomologacao, FONTE_HOMOLOGACAO, fonteArquivoHomologacao, type FonteHomologacao } from './homologacao.js';
import { Onda0Controller } from './onda0.controller.js';
import { PORTA_ONDA0, type PortaOnda0, portaOnda0Memoria, portaOnda0Propria } from './onda0.js';
import { ProntidaoController } from './prontidao.controller.js';
import { caminhoProntidao, FONTE_PRONTIDAO, fonteArquivoProntidao, type FonteProntidao } from './prontidao.js';
import { LiberacaoController } from './liberacao.controller.js';
import { ParametrosController } from './parametros.controller.js';

export interface OpcoesModuloConfig {
  /** Fonte pronta (testes); null: sem fonte. */
  readonly fonte?: FonteConfiguracao | null;
  /** Fonte dos domínios pronta (testes). */
  readonly dominios?: FonteDominios;
  /** Porta da onda 0 pronta (testes). */
  readonly onda0?: PortaOnda0;
  /** Painéis de arquivo prontos (testes). */
  readonly prontidao?: FonteProntidao;
  readonly homologacao?: FonteHomologacao;
  readonly gravacao?: FonteGravacao;
  readonly metricas?: MetricasExecutor;
}

/** Estabelecimentos da sessão sintética de dev/ci (ESTABELECIMENTOS, a mesma lista da fonte sintética de acesso). */
const estabelecimentosSinteticos = (ctx: ContextoModulo): string[] =>
  (ctx.env['ESTABELECIMENTOS'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Estabelecimentos do cliente (códigos), lidos do banco na montagem; a onda 0 só responde por eles. */
async function estabelecimentosDoCliente(ctx: ContextoModulo, cliente: string): Promise<string[]> {
  const linhas = await ctx.nucleo!.lerSomente({ cliente, correlacao: 'config-estabelecimentos' }, (l) =>
    l.consultar<{ codigo: string }>(
      'SELECT codigo FROM estabelecimento WHERE excluido_em IS NULL ORDER BY codigo',
      [],
      { teto: 10_000 },
    ),
  );
  return linhas.map((x) => String(x.codigo));
}

/** A fonte da configuração pela regra do módulo. */
export async function fonteDaConfiguracao(ctx: ContextoModulo): Promise<FonteConfiguracao | null> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await FonteConfiguracaoPropria.conferirModelo(ctx.nucleo, cliente);
    return new FonteConfiguracaoPropria(ctx.nucleo, cliente);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return fonteConfiguracaoMemoria(ctx.trilha, {
      chavesIniciais: chavesIniciaisSinteticas,
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      parametrosIniciais: parametrosIniciaisSinteticos,
    });
  return null;
}

@Module({})
export class ModuloConfig {}

export async function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloConfig = {}): Promise<DynamicModule> {
  const fonte = opcoes.fonte !== undefined ? opcoes.fonte : await fonteDaConfiguracao(ctx);
  const comFonte = fonte ? [{ provide: FONTE_CONFIGURACAO, useValue: fonte }] : [];
  const cliente = ctx.configuracao.clientePadrao;
  const sintetico = !ctx.nucleo && fontesSinteticas(ctx.env);
  const catalogo = catalogoOperacoesProprio();
  const metricas = opcoes.metricas ?? new MetricasExecutor();
  const dominios: FonteDominios =
    opcoes.dominios ??
    (ctx.nucleo && cliente
      ? new FonteDominiosPropria(ctx.nucleo, cliente)
      : sintetico
        ? fonteDominiosMemoria()
        : fonteDominiosIndisponivel());
  // A onda 0 precisa da configuração (as chaves de tela): sem ela, não sobe (as telas ficam em consulta).
  const onda0: PortaOnda0 | null =
    opcoes.onda0 ??
    (fonte && ctx.nucleo && cliente
      ? portaOnda0Propria(ctx.nucleo, cliente, fonte, await estabelecimentosDoCliente(ctx, cliente), catalogo)
      : fonte && sintetico
        ? portaOnda0Memoria(fonte, estabelecimentosSinteticos(ctx), catalogo)
        : null);
  const gravacao =
    opcoes.gravacao ??
    criarFonteGravacao({
      cliente: cliente ?? 'sem-cliente',
      rede: ctx.configuracao.rede ?? 'rede',
      metricas,
      nucleo: ctx.nucleo,
    });
  const prontidao = opcoes.prontidao ?? fonteArquivoProntidao(caminhoProntidao(process.cwd(), ctx.env));
  const homologacao = opcoes.homologacao ?? fonteArquivoHomologacao(caminhoHomologacao(process.cwd(), ctx.env));
  return {
    module: ModuloConfig,
    global: true,
    controllers: [
      ...(fonte ? [LiberacaoController, ParametrosController] : []),
      ...(onda0 ? [Onda0Controller] : []),
      DominiosController,
      GravacaoController,
      HomologacaoController,
      ProntidaoController,
    ],
    providers: [
      ...comFonte,
      ...(onda0 ? [{ provide: PORTA_ONDA0, useValue: onda0 }] : []),
      { provide: FONTE_DOMINIOS, useValue: dominios },
      { provide: FONTE_GRAVACAO, useValue: gravacao },
      { provide: METRICAS_EXECUTOR, useValue: metricas },
      { provide: FONTE_PRONTIDAO, useValue: prontidao },
      { provide: FONTE_HOMOLOGACAO, useValue: homologacao },
      { provide: APP_GUARD, useClass: GuardaChaveDeTela },
      VersaoService,
      { provide: CACHE_CONFIG, useValue: new CacheConfig(ctx.armazem) },
      { provide: CATALOGO_OPERACOES, useValue: catalogo },
      { provide: CRITERIO_LIGAR_SETOR, useValue: criterioLigarSetor() },
    ],
    exports: [
      ...(fonte ? [FONTE_CONFIGURACAO] : []),
      ...(onda0 ? [PORTA_ONDA0] : []),
      CACHE_CONFIG,
      CATALOGO_OPERACOES,
      CRITERIO_LIGAR_SETOR,
      FONTE_DOMINIOS,
      METRICAS_EXECUTOR,
    ],
  };
}
