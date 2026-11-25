// Módulo do repasse médico (F2.2): o controlador sobre a porta própria (MariaDB pelo @sgh/nucleo) quando o núcleo
// existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a porta indisponível (503 em tudo, falha
// fechada) — a mesma regra do F2-L. O documento do RPA vai ao Gotenberg (PDF/A) do ambiente.
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { converterHtmlEmPdfA } from '../documento/infra/gotenberg.js';
import type { ContextoModulo } from '../registro.js';
import { PORTA_REPASSE, type PortaRepasse } from './porta.js';
import { PortaRepasseMemoria } from './porta-memoria.js';
import { portaRepasseIndisponivel, PortaRepassePropria } from './porta-propria.js';
import { GERADOR_PDF_REPASSE, RepasseController } from './repasse.controller.js';
import { FavorecidosRepasseController } from './favorecidos.controller.js';
import { PORTA_FAVORECIDOS_REPASSE, PortaFavorecidosRepassePropria } from './favorecidos-propria.js';
import { FONTE_FISCAL_REPASSE, fonteFiscalRepasse } from './fonte-fiscal.js';
import { RemuneracaoVariavelController } from './remuneracao-variavel.controller.js';
import { VariavelFaixaController } from './variavel-faixa.controller.js';
import { RateioCustoController } from './rateio-custo.controller.js';
import { PORTA_RATEIO_CUSTO_REPASSE, PortaRateioCustoRepassePropria } from './rateio-custo-propria.js';
import { PORTA_VARIAVEL_FAIXA, PortaVariavelFaixaPropria } from './variavel-faixa-propria.js';
import {
  PORTA_REMUNERACAO_VARIAVEL,
  PortaRemuneracaoVariavelPropria,
} from './remuneracao-variavel-propria.js';

export interface OpcoesModuloRepasse {
  /** Testes: a porta já montada. */
  readonly porta?: PortaRepasse;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
  /** Testes: o gerador de PDF (null: o documento sai em HTML). */
  readonly geradorPdf?: ((html: string, titulo: string) => Promise<Buffer>) | null;
}

/** A porta do repasse pela regra do módulo (sem as opções de teste). */
export async function portaDoRepasse(ctx: ContextoModulo): Promise<PortaRepasse> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaRepassePropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaRepasseMemoria(null);
  return portaRepasseIndisponivel();
}

export async function moduloRepasse(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloRepasse = {},
): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDoRepasse(ctx));
  const configuracao =
    opcoes.configuracao ??
    (porta.destino === 'memoria'
      ? fonteConfiguracaoMemoria(ctx.trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : null);
  const gotenberg = ctx.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
  const geradorPdf =
    opcoes.geradorPdf !== undefined
      ? opcoes.geradorPdf
      : async (html: string, titulo: string) =>
          (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
  return {
    module: class ModuloRepasse {},
    // Global: o portal-medico injeta as portas deste módulo (montagem da onda 4).
    global: true,
    controllers: [
      RepasseController,
      FavorecidosRepasseController,
      RemuneracaoVariavelController,
      VariavelFaixaController,
      RateioCustoController,
    ],
    providers: [
      // Favorecidos e prestadores terceiros (06-FAT linha 46): só com o banco do cliente (sem ele, 503).
      ...(ctx.nucleo && ctx.configuracao.clientePadrao
        ? [
            {
              provide: PORTA_FAVORECIDOS_REPASSE,
              useValue: new PortaFavorecidosRepassePropria(ctx.nucleo, ctx.configuracao.clientePadrao),
            },
            // Remuneração variável (07-FIN linha 157): mínimo, resultado, meta e custo do prestador.
            {
              provide: PORTA_REMUNERACAO_VARIAVEL,
              useValue: new PortaRemuneracaoVariavelPropria(ctx.nucleo, ctx.configuracao.clientePadrao),
            },
            // Rateio do repasse por setor e custos do prestador (06-FAT linha 49).
            {
              provide: PORTA_RATEIO_CUSTO_REPASSE,
              useValue: new PortaRateioCustoRepassePropria(ctx.nucleo, ctx.configuracao.clientePadrao),
            },
            // Remuneração variável por faixa e rateio da equipe (06-FAT linha 48).
            {
              provide: PORTA_VARIAVEL_FAIXA,
              useValue: new PortaVariavelFaixaPropria(ctx.nucleo, ctx.configuracao.clientePadrao),
            },
            // O dado fiscal e a conta do profissional (cadastro, F3.1) no cálculo do RPA.
            {
              provide: FONTE_FISCAL_REPASSE,
              useValue: fonteFiscalRepasse(ctx.nucleo, ctx.configuracao.clientePadrao),
            },
          ]
        : []),
      { provide: PORTA_REPASSE, useValue: porta },
      { provide: GERADOR_PDF_REPASSE, useValue: geradorPdf },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_REPASSE],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloRepasse(ctx);
}
