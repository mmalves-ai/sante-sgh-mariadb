// Módulo da manutenção e engenharia clínica na API migrada (F2.2): equipamentos, OS, planos, contratos e indicadores.
// A porta é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci;
// fora disso, a indisponível (503, falha fechada). O patrimônio (bem ligado ao equipamento) é lido pela porta do
// patrimônio montada pela mesma regra; os documentos (OS, laudo, PMOC, PGTS) saem em PDF/A pelo Gotenberg. Os testes
// passam a porta, o patrimônio e o gerador pelas opções.
// Pendente (pedido ao lote do ADT): a integração da OS com o leito (INTEGRACAO_OS_LEITO) é opcional no controlador e
// fica ligada quando o módulo do ADT a exportar.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import { converterHtmlEmPdfA } from '../documento/public-api.js';
import { portaDoPatrimonio } from '../patrimonio/modulo.js';
import { PORTA_PATRIMONIO, type PortaPatrimonio } from '../patrimonio/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { GERADOR_PDF_MANUTENCAO, ManutencaoController } from './manutencao.controller.js';
import { PORTA_MANUTENCAO, type PortaManutencao, portaManutencaoIndisponivel } from './porta.js';
import { PortaManutencaoMemoria } from './porta-memoria.js';
import { PortaManutencaoPropria } from './porta-propria.js';

export interface OpcoesModuloManutencao {
  /** Porta pronta (testes). */
  readonly porta?: PortaManutencao;
  /** Porta do patrimônio (testes; null: sem patrimônio). */
  readonly patrimonio?: PortaPatrimonio | null;
  /** Conversor HTML → PDF/A (testes; null: a rota devolve o HTML). */
  readonly geradorPdf?: ((html: string, titulo: string) => Promise<Buffer>) | null;
}

/** A porta da manutenção pela regra do módulo (sem as opções de teste). */
export async function portaDaManutencao(ctx: ContextoModulo): Promise<PortaManutencao> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaManutencaoPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaManutencaoMemoria();
  return portaManutencaoIndisponivel();
}

@Module({})
export class ModuloManutencao {}

export async function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloManutencao = {}): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDaManutencao(ctx));
  const patrimonio = opcoes.patrimonio !== undefined ? opcoes.patrimonio : await portaDoPatrimonio(ctx);
  const gotenberg = ctx.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
  const geradorPdf =
    opcoes.geradorPdf !== undefined
      ? opcoes.geradorPdf
      : async (html: string, titulo: string) =>
          (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
  return {
    module: ModuloManutencao,
    controllers: [ManutencaoController],
    providers: [
      { provide: PORTA_MANUTENCAO, useValue: porta },
      { provide: GERADOR_PDF_MANUTENCAO, useValue: geradorPdf },
      ...(patrimonio ? [{ provide: PORTA_PATRIMONIO, useValue: patrimonio }] : []),
    ],
    exports: [PORTA_MANUTENCAO],
  };
}
