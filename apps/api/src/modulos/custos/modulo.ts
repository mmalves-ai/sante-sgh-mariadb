// Módulo dos custos hospitalares (F2.2): a estrutura de custos, as estatísticas e a apuração sobre a porta própria
// (MariaDB pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a
// porta indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L. A liberação (chave `custos`) e os
// parâmetros vêm da FONTE_CONFIGURACAO do módulo de configuração; na memória, a fonte sintética. O PDF do relatório
// sai pelo conversor de PDF/A (GOTENBERG_URL).
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { converterHtmlEmPdfA } from '../documento/infra/gotenberg.js';
import { ApuracaoCustosController, GERADOR_PDF_CUSTOS } from './apuracao.controller.js';
import { CustosController } from './custos.controller.js';
import { FichaCustoPadraoController } from './ficha-custo-padrao.controller.js';
import {
  PORTA_FICHA_CUSTO_PADRAO,
  PortaFichaCustoPadraoPropria,
  portaFichaCustoPadraoIndisponivel,
} from './ficha-custo-padrao-propria.js';
import { PORTA_CUSTOS, type PortaCustos } from './porta.js';
import { PortaCustosMemoria } from './porta-memoria.js';
import { portaCustosIndisponivel, PortaCustosPropria } from './porta-propria.js';

export interface OpcoesModuloCustos {
  /** Testes: a porta já montada. */
  readonly porta?: PortaCustos;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
  /** Testes: o gerador de PDF (null: sem PDF). */
  readonly pdf?: ((html: string, titulo: string) => Promise<Buffer>) | null;
}

export function moduloCustos(ctx: ContextoModulo, opcoes: OpcoesModuloCustos = {}): DynamicModule {
  const cliente = ctx.configuracao.clientePadrao;
  const memoria = !ctx.nucleo && fontesSinteticas(ctx.env);
  const porta: PortaCustos =
    opcoes.porta ??
    (ctx.nucleo && cliente
      ? new PortaCustosPropria(ctx.nucleo, cliente)
      : memoria
        ? new PortaCustosMemoria()
        : portaCustosIndisponivel());
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
  const pdf =
    opcoes.pdf !== undefined
      ? opcoes.pdf
      : async (html: string, titulo: string) =>
          (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
  return {
    module: class ModuloCustos {},
    controllers: [CustosController, ApuracaoCustosController, FichaCustoPadraoController],
    providers: [
      { provide: PORTA_CUSTOS, useValue: porta },
      // C2-115: custo-padrão por procedimento (só no banco do cliente; sem ele, 503).
      {
        provide: PORTA_FICHA_CUSTO_PADRAO,
        useValue:
          ctx.nucleo && cliente
            ? new PortaFichaCustoPadraoPropria(ctx.nucleo, cliente)
            : portaFichaCustoPadraoIndisponivel(),
      },
      ...(pdf ? [{ provide: GERADOR_PDF_CUSTOS, useValue: pdf }] : []),
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloCustos(ctx);
}
