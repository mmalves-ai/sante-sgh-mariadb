// Módulo do pós-fechamento (M31/M42) na API migrada (F2.2 onda 3): guias, lotes TISS e protocolo, prazos,
// competências, demonstrativos, glosa e recurso, webservices, o painel de glosas e o acompanhamento da competência.
// A porta é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci;
// fora disso, a indisponível (503, falha fechada) — a mesma regra do F2-L. O XML TISS vai ao S3 com Object Lock (a
// memória na sessão sintética); a guia em PDF/A sai pelo conversor do projeto (GOTENBERG_URL).
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
import { ClienteS3 } from '../documento/infra/s3.js';
import type { ContextoModulo } from '../registro.js';
import { type ArmazemXmlTiss, armazemXmlS3 } from './armazem-xml.js';
import { PORTA_TISS, type PortaTiss } from './porta.js';
import { PortaTissMemoria } from './porta-memoria.js';
import { portaTissIndisponivel, PortaTissPropria } from './porta-propria.js';
import {
  ARMAZEM_XML_TISS,
  GERADOR_PDF_TISS,
  type GeradorPdfTiss,
  TissController,
} from './tiss.controller.js';

export interface OpcoesModuloTiss {
  /** Testes: a porta já montada. */
  readonly porta?: PortaTiss;
  /** Testes: a guarda do XML (padrão: a da memória, ou o S3 do ambiente). */
  readonly armazem?: ArmazemXmlTiss;
  /** Testes: a fonte da liberação e dos parâmetros (null: sem fonte). */
  readonly configuracao?: unknown;
}

/** A guarda do XML TISS do ambiente: S3 com Object Lock (bucket por rede). */
function armazemDoAmbiente(ctx: ContextoModulo): ArmazemXmlTiss {
  const env = ctx.env;
  return armazemXmlS3(
    new ClienteS3({
      endpoint: env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318',
      regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
      acesso: env['S3_SEGREDO']?.trim() ? env['S3_ACESSO']?.trim() : undefined,
      segredo: env['S3_SEGREDO']?.trim() || undefined,
    }),
    env['S3_BUCKET_TISS']?.trim() || `sgh-${ctx.configuracao.rede ?? 'rede'}-tiss`,
    (env['AMBIENTE'] ?? 'dev').trim() || 'dev',
  );
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
    controllers: [TissController],
    providers: [
      { provide: PORTA_TISS, useValue: porta },
      { provide: ARMAZEM_XML_TISS, useValue: armazem },
      { provide: GERADOR_PDF_TISS, useValue: geradorPdf },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_TISS],
  };
}
