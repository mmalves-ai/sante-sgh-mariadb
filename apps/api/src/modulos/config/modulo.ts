// Módulo da configuração por estabelecimento na API migrada (F2.2 onda 1, integração): a liberação das funcionalidades
// (chaves de operação e de recurso, pré-requisitos) e os parâmetros, lidos e gravados pela FonteConfiguracaoPropria
// sobre o banco do cliente. É global: as telas de trabalho dos outros módulos (atendimento, cadastro, agenda, recepção)
// conferem a chave de recurso pela FONTE_CONFIGURACAO daqui. Sem ele montado, essas telas ficam em consulta (falha
// fechada).
// - Com núcleo e cliente: confere antes que o banco tem as tabelas da fonte (liberacao_chave, liberacao_lote,
//   recurso_prerequisito...) e recusa subir sem elas; depois registra a fonte própria.
// - Sem núcleo, só em dev/ci (fontesSinteticas): a fonte de memória com as chaves sintéticas.
// - Fora disso: o módulo sobe sem a fonte (as telas ficam em consulta) e as rotas de administração respondem 503.
// Os domínios (FONTE_DOMINIOS), a onda 0, a gravação, a homologação e a prontidão entram com o lote que os religar.
import { type DynamicModule, Module } from '@nestjs/common';
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
import { LiberacaoController } from './liberacao.controller.js';
import { ParametrosController } from './parametros.controller.js';

export interface OpcoesModuloConfig {
  /** Fonte pronta (testes); null: sem fonte. */
  readonly fonte?: FonteConfiguracao | null;
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
  return {
    module: ModuloConfig,
    global: true,
    controllers: fonte ? [LiberacaoController, ParametrosController] : [],
    providers: [
      ...comFonte,
      { provide: CACHE_CONFIG, useValue: new CacheConfig(ctx.armazem) },
      { provide: CATALOGO_OPERACOES, useValue: catalogoOperacoesProprio() },
      { provide: CRITERIO_LIGAR_SETOR, useValue: criterioLigarSetor() },
    ],
    exports: [...(fonte ? [FONTE_CONFIGURACAO] : []), CACHE_CONFIG, CATALOGO_OPERACOES, CRITERIO_LIGAR_SETOR],
  };
}
