// Módulo dos relatórios (F2.2/F2.3, lote 04-04): o catálogo de relatórios parametrizados, a triagem dos relatórios do
// sistema de origem, os pedidos de relatório novo, o envio agendado (a fila do worker) e o BI consolidado da Rede.
// A porta é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci;
// fora disso, a indisponível (503, falha fechada) — a mesma regra do F2-L. Na memória, a fonte sintética da
// configuração. O BI da Rede resolve a lista da Rede e a internação nos módulos deles (rede e internacao), que precisam
// estar em API_MODULOS para a tela do BI responder.
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
import type { FilaEnvioRelatorio } from './aplicacao/gestao.js';
import { BiRedeController } from './bi-rede.controller.js';
import { CARGAS_DATAMART, PortaCargasDataMartPropria } from './datamart-cargas-propria.js';
import { CargasDataMartController } from './datamart-cargas.controller.js';
import { FilaEnvioPorValkey } from './infra/fila-envio.js';
import { PaginaInicialController } from './pagina-inicial.controller.js';
import { PORTA_PAGINA_INICIAL, PortaPaginaInicialPropria } from './pagina-inicial-propria.js';
import { PORTA_RELATORIO, type PortaRelatorio } from './porta.js';
import { PortaRelatorioMemoria } from './porta-memoria.js';
import { portaRelatorioIndisponivel, PortaRelatorioPropria } from './porta-propria.js';
import {
  CatalogoRelatoriosController,
  FILA_ENVIO_RELATORIO,
  GERADOR_PDF_RELATORIO,
} from './relatorio.controller.js';

export interface OpcoesModuloRelatorio {
  /** Testes: a porta já montada. */
  readonly porta?: PortaRelatorio;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
  /** Testes: a fila do envio (null: sem fila). */
  readonly fila?: FilaEnvioRelatorio | null;
  /** Testes: o gerador de PDF. */
  readonly geradorPdf?: ((html: string, titulo: string) => Promise<Buffer>) | null;
}

/** A porta dos relatórios pela regra do módulo (sem as opções de teste). */
export async function portaDosRelatorios(ctx: ContextoModulo): Promise<PortaRelatorio> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaRelatorioPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaRelatorioMemoria(ctx.trilha);
  return portaRelatorioIndisponivel();
}

export async function moduloRelatorio(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloRelatorio = {},
): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDosRelatorios(ctx));
  const configuracao =
    opcoes.configuracao ??
    (porta.destino === 'memoria'
      ? fonteConfiguracaoMemoria(ctx.trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : null);
  const valkey = ctx.env['VALKEY_URL']?.trim();
  const fila = opcoes.fila !== undefined ? opcoes.fila : valkey ? new FilaEnvioPorValkey(valkey) : null;
  const gotenberg = ctx.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
  const geradorPdf =
    opcoes.geradorPdf !== undefined
      ? opcoes.geradorPdf
      : async (html: string, titulo: string) =>
          (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
  return {
    module: class ModuloRelatorio {},
    controllers: [
      CatalogoRelatoriosController,
      BiRedeController,
      CargasDataMartController,
      PaginaInicialController,
    ],
    providers: [
      { provide: PORTA_RELATORIO, useValue: porta },
      // 01-REL L113: cargas do data mart na administração (só com o banco do cliente; sem ele, 503).
      {
        provide: CARGAS_DATAMART,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaCargasDataMartPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // 01-ADM L114: página inicial montada pelo hospital (só com o banco do cliente; sem ele, 503).
      {
        provide: PORTA_PAGINA_INICIAL,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaPaginaInicialPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      { provide: FILA_ENVIO_RELATORIO, useValue: fila },
      { provide: GERADOR_PDF_RELATORIO, useValue: geradorPdf },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_RELATORIO],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloRelatorio(ctx);
}
