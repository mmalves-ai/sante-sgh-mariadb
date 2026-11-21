// Módulo da configuração por estabelecimento na API migrada (F2.2 onda 1, integração): a liberação das funcionalidades
// (chaves de operação e de recurso, pré-requisitos) e os parâmetros, lidos e gravados pela FonteConfiguracaoPropria
// sobre o banco do cliente. É global: as telas de trabalho dos outros módulos (atendimento, cadastro, agenda, recepção)
// conferem a chave de recurso pela FONTE_CONFIGURACAO daqui. Sem ele montado, essas telas ficam em consulta (falha
// fechada).
// - Com núcleo e cliente: confere antes que o banco tem as tabelas da fonte (liberacao_chave, liberacao_lote,
//   recurso_prerequisito...) e recusa subir sem elas; depois registra a fonte própria.
// - Sem núcleo, só em dev/ci (fontesSinteticas): a fonte de memória com as chaves sintéticas.
// - Fora disso: o módulo sobe sem a fonte (as telas ficam em consulta) e as rotas de administração respondem 503.
// - Os domínios (CRUD genérico), a saúde das conexões, a homologação e a prontidão (lote 02-02): a fonte própria dos
//   domínios com o núcleo; a memória só em dev/ci sem núcleo; fora disso, a fonte de domínios indisponível (503).
// - Lote 02-07 (ADR 0003, itens 5 e 9): a porta das telas "só consulta" por etapa de implantação e a guarda global das
//   chaves de tela saíram com o código de convivência herdado; o cliente tem o banco inteiro, sem liberação parcial.
import { type DynamicModule, Module } from '@nestjs/common';
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
import { HomologacaoController } from './homologacao.controller.js';
import { caminhoHomologacao, FONTE_HOMOLOGACAO, fonteArquivoHomologacao, type FonteHomologacao } from './homologacao.js';
import { ProntidaoController } from './prontidao.controller.js';
import { caminhoProntidao, FONTE_PRONTIDAO, fonteArquivoProntidao, type FonteProntidao } from './prontidao.js';
import { LiberacaoController } from './liberacao.controller.js';
import { ParametrosController } from './parametros.controller.js';

export interface OpcoesModuloConfig {
  /** Fonte pronta (testes); null: sem fonte. */
  readonly fonte?: FonteConfiguracao | null;
  /** Fonte dos domínios pronta (testes). */
  readonly dominios?: FonteDominios;
  /** Painéis de arquivo prontos (testes). */
  readonly prontidao?: FonteProntidao;
  readonly homologacao?: FonteHomologacao;
  readonly gravacao?: FonteGravacao;
  readonly metricas?: MetricasExecutor;
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
      DominiosController,
      GravacaoController,
      HomologacaoController,
      ProntidaoController,
    ],
    providers: [
      ...comFonte,
      { provide: FONTE_DOMINIOS, useValue: dominios },
      { provide: FONTE_GRAVACAO, useValue: gravacao },
      { provide: METRICAS_EXECUTOR, useValue: metricas },
      { provide: FONTE_PRONTIDAO, useValue: prontidao },
      { provide: FONTE_HOMOLOGACAO, useValue: homologacao },
      VersaoService,
      { provide: CACHE_CONFIG, useValue: new CacheConfig(ctx.armazem) },
      { provide: CATALOGO_OPERACOES, useValue: catalogo },
      { provide: CRITERIO_LIGAR_SETOR, useValue: criterioLigarSetor() },
    ],
    exports: [
      ...(fonte ? [FONTE_CONFIGURACAO] : []),
      CACHE_CONFIG,
      CATALOGO_OPERACOES,
      CRITERIO_LIGAR_SETOR,
      FONTE_DOMINIOS,
      METRICAS_EXECUTOR,
    ],
  };
}
