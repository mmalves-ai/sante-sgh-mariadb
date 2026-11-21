// Módulo da farmácia hospitalar e da farmácia clínica (M29) na API migrada (F2.2): o controlador sobre a porta própria
// (MariaDB pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a
// porta indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// A liberação e os parâmetros vêm da FONTE_CONFIGURACAO do módulo de configuração (global); na memória sem ele, a
// fonte sintética local. O PDF do livro de controlados sai pelo conversor HTML → PDF/A do módulo do documento.
// Os avisos de atendimento (tempo real da enfermagem) entram com o lote que migrar o vigia (pedido ao integrador).
import { type DynamicModule, Module } from '@nestjs/common';
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
import { configuracaoPedida } from '../especialidades/modulo.js';
import type { ContextoModulo } from '../registro.js';
import { FarmaciaController, GERADOR_PDF_FARMACIA } from './farmacia.controller.js';
import { PORTA_FARMACIA, type PortaFarmacia } from './porta.js';
import { PortaFarmaciaMemoria } from './porta-memoria.js';
import { portaFarmaciaIndisponivel, PortaFarmaciaPropria } from './porta-propria.js';

export interface OpcoesModuloFarmacia {
  /** Testes: a porta já montada. */
  readonly porta?: PortaFarmacia;
  /** Testes: a fonte da liberação e dos parâmetros (null: a do módulo de configuração, global). */
  readonly configuracao?: unknown;
}

/** A porta pela regra do módulo (sem as opções de teste). */
export async function portaDaFarmacia(ctx: ContextoModulo): Promise<PortaFarmacia> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaFarmaciaPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaFarmaciaMemoria();
  return portaFarmaciaIndisponivel();
}

@Module({})
export class ModuloFarmacia {}

export async function moduloFarmacia(ctx: ContextoModulo, opcoes: OpcoesModuloFarmacia = {}): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDaFarmacia(ctx));
  const configuracao =
    opcoes.configuracao !== undefined
      ? opcoes.configuracao
      : porta.destino === 'memoria' && !configuracaoPedida(ctx)
        ? fonteConfiguracaoMemoria(ctx.trilha, {
            chavesIniciais: chavesIniciaisSinteticas,
            prerequisitosIniciais: prerequisitosIniciaisSinteticos,
            parametrosIniciais: parametrosIniciaisSinteticos,
          })
        : null;
  const gotenberg = ctx.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
  const geradorPdf = async (html: string, titulo: string) =>
    (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
  return {
    module: ModuloFarmacia,
    controllers: [FarmaciaController],
    providers: [
      { provide: PORTA_FARMACIA, useValue: porta },
      { provide: GERADOR_PDF_FARMACIA, useValue: geradorPdf },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloFarmacia(ctx);
}
