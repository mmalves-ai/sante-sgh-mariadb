// Módulo do pós-fechamento (M31/M42) na API migrada (F2.2 onda 3): guias, lotes TISS e protocolo, prazos,
// competências, demonstrativos, glosa e recurso, webservices, o painel de glosas e o acompanhamento da competência.
// A porta é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci;
// fora disso, a indisponível (503, falha fechada) — a mesma regra do F2-L. O XML TISS vai ao disco local, sob a raiz
// de arquivos, pela porta de arquivos do núcleo (ADR 0004; a memória na sessão sintética); a guia em PDF/A sai pelo conversor do projeto (GOTENBERG_URL).
// A liberação das funcionalidades e os parâmetros vêm da FONTE_CONFIGURACAO do módulo de configuração (global); na
// memória sem ela, a fonte sintética da configuração.
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
import type { ContextoModulo } from '../registro.js';
import { type ArmazemXmlTiss, armazemXmlLocal, localizadorDoNucleo } from './armazem-xml.js';
import {
  ApresentacaoTissController,
  SERVICO_APRESENTACAO_TISS,
  ServicoApresentacaoTiss,
} from './apresentacao.controller.js';
import { PORTA_TISS, type PortaTiss } from './porta.js';
import { PortaTissMemoria } from './porta-memoria.js';
import { portaTissIndisponivel, PortaTissPropria } from './porta-propria.js';
import {
  ARMAZEM_XML_TISS,
  GERADOR_PDF_TISS,
  type GeradorPdfTiss,
  TissController,
} from './tiss.controller.js';
import { ElegibilidadeController } from './elegibilidade.controller.js';
import { PORTA_ELEGIBILIDADE, PortaElegibilidadePropria } from './elegibilidade-propria.js';
import { AutorizacaoPreviaController } from './autorizacao-previa.controller.js';
import { PORTA_AUTORIZACAO_PREVIA, PortaAutorizacaoPreviaPropria } from './autorizacao-previa-propria.js';
import {
  CompetenciaTrabalhoController,
  SERVICO_COMPETENCIA_TRABALHO,
  ServicoCompetenciaTrabalho,
} from './competencia-trabalho.controller.js';

export interface OpcoesModuloTiss {
  /** Testes: a porta já montada. */
  readonly porta?: PortaTiss;
  /** Testes: a guarda do XML (padrão: a da memória, ou a do disco local). */
  readonly armazem?: ArmazemXmlTiss;
  /** Testes: a fonte da liberação e dos parâmetros (null: sem fonte). */
  readonly configuracao?: unknown;
}

/** A guarda do XML TISS do ambiente: o disco local (ARQUIVOS_RAIZ), na pasta do banco do cliente. */
function armazemDoAmbiente(ctx: ContextoModulo): ArmazemXmlTiss {
  return armazemXmlLocal(localizadorDoNucleo(ctx.nucleo, ctx.env), ctx.configuracao.clientePadrao ?? '');
}

/** A porta do pós-fechamento pela regra do módulo (sem as opções de teste). */
export async function portaDoTiss(ctx: ContextoModulo, armazem?: ArmazemXmlTiss): Promise<PortaTiss> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaTissPropria(ctx.nucleo, cliente, armazem ?? armazemDoAmbiente(ctx));
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaTissMemoria(null);
  return portaTissIndisponivel();
}

@Module({})
export class ModuloTiss {}

export async function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloTiss = {}): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDoTiss(ctx, opcoes.armazem));
  const armazem =
    opcoes.armazem ?? (porta instanceof PortaTissMemoria ? porta.armazem : armazemDoAmbiente(ctx));
  const gotenberg = ctx.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
  const geradorPdf: GeradorPdfTiss = async (html, titulo) =>
    (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
  const configuracao =
    opcoes.configuracao !== undefined
      ? opcoes.configuracao
      : porta.destino === 'memoria'
        ? fonteConfiguracaoMemoria(ctx.trilha, {
            chavesIniciais: chavesIniciaisSinteticas,
            prerequisitosIniciais: prerequisitosIniciaisSinteticos,
            parametrosIniciais: parametrosIniciaisSinteticos,
          })
        : null;
  return {
    module: ModuloTiss,
    controllers: [
      TissController,
      ElegibilidadeController,
      ApresentacaoTissController,
      AutorizacaoPreviaController,
      CompetenciaTrabalhoController,
    ],
    providers: [
      { provide: PORTA_TISS, useValue: porta },
      // F3.9 (08-INTG L128): consulta de elegibilidade e resposta da operadora; sem núcleo, 503.
      {
        provide: PORTA_ELEGIBILIDADE,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaElegibilidadePropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // 06-FAT L25 e L27: autorização prévia à operadora (pedido, envio, resposta, andamento); sem núcleo, 503.
      {
        provide: PORTA_AUTORIZACAO_PREVIA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaAutorizacaoPreviaPropria(ctx.nucleo, ctx.configuracao.clientePadrao, armazem)
            : null,
      },
      // 06-FAT linha 32: competência de trabalho do faturista (só com o banco próprio; sem ele, 503).
      {
        provide: SERVICO_COMPETENCIA_TRABALHO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao ? new ServicoCompetenciaTrabalho(ctx.nucleo) : null,
      },
      { provide: ARMAZEM_XML_TISS, useValue: armazem },
      { provide: GERADOR_PDF_TISS, useValue: geradorPdf },
      // 06-FAT linha 30: regra de apresentação TISS por fonte pagadora (só com o banco próprio; sem ele, 503).
      {
        provide: SERVICO_APRESENTACAO_TISS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao ? new ServicoApresentacaoTiss(ctx.nucleo) : null,
      },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_TISS],
  };
}
