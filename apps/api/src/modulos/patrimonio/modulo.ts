// Módulo do patrimônio na API migrada (F2.2): bens, movimentos, depreciação, ajustes e inventário. A porta é a própria
// sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora disso, a
// indisponível (503, falha fechada). O PDF do laudo vai ao disco local, sob a raiz de arquivos (ADR 0004; com a porta em
// memória, em memória); os documentos (termo de baixa) pelo Gotenberg. Os testes passam a porta, o armazém e o gerador pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import { converterHtmlEmPdfA } from '../documento/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { localizadorDoNucleo } from '../tiss/armazem-xml.js';
import {
  ARMAZEM_LAUDO_PATRIMONIO,
  type ArmazemLaudoPatrimonio,
  armazemLaudoLocal,
  ArmazemLaudoMemoria,
} from './armazem-laudo.js';
import { GERADOR_PDF_PATRIMONIO, PatrimonioController } from './patrimonio.controller.js';
import { PORTA_PATRIMONIO, type PortaPatrimonio, portaPatrimonioIndisponivel } from './porta.js';
import { PortaPatrimonioMemoria } from './porta-memoria.js';
import { PortaPatrimonioPropria } from './porta-propria.js';

export interface OpcoesModuloPatrimonio {
  /** Porta pronta (testes). */
  readonly porta?: PortaPatrimonio;
  /** Armazém do laudo (testes). */
  readonly armazemLaudo?: ArmazemLaudoPatrimonio;
  /** Conversor HTML → PDF/A (testes; null: a rota devolve o HTML). */
  readonly geradorPdf?: ((html: string, titulo: string) => Promise<Buffer>) | null;
}

/** A porta do patrimônio pela regra do módulo (sem as opções de teste). */
export async function portaDoPatrimonio(ctx: ContextoModulo): Promise<PortaPatrimonio> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaPatrimonioPropria(ctx.nucleo, cliente);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaPatrimonioMemoria();
  return portaPatrimonioIndisponivel();
}

@Module({})
export class ModuloPatrimonio {}

export async function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloPatrimonio = {}): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDoPatrimonio(ctx));
  const env = ctx.env;
  const armazemLaudo =
    opcoes.armazemLaudo ??
    (porta.destino !== 'banco'
      ? new ArmazemLaudoMemoria()
      : armazemLaudoLocal(localizadorDoNucleo(ctx.nucleo, env), ctx.configuracao.clientePadrao ?? ''));
  const gotenberg = env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
  const geradorPdf =
    opcoes.geradorPdf !== undefined
      ? opcoes.geradorPdf
      : async (html: string, titulo: string) =>
          (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
  return {
    module: ModuloPatrimonio,
    controllers: [PatrimonioController],
    providers: [
      { provide: PORTA_PATRIMONIO, useValue: porta },
      { provide: ARMAZEM_LAUDO_PATRIMONIO, useValue: armazemLaudo },
      { provide: GERADOR_PDF_PATRIMONIO, useValue: geradorPdf },
    ],
    exports: [PORTA_PATRIMONIO],
  };
}
