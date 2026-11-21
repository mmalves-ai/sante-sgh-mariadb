// Módulo do financeiro e fiscal (F2.2, M32): o controlador do financeiro sobre a porta própria (MariaDB pelo
// @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a porta
// indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// Os arquivos (extrato, remessa, NFS-e, declarações, lote contábil) vão ao S3 com Object Lock; na memória, à guarda
// em memória. A liberação das funcionalidades e os parâmetros vêm da FONTE_CONFIGURACAO global do módulo de
// configuração; na memória, a fonte sintética da configuração.
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { ClienteS3 } from '../documento/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { type ArmazemFinanceiro, armazemFinanceiroMemoria, armazemFinanceiroS3 } from './armazem.js';
import { FinanceiroController } from './financeiro.controller.js';
import { PORTA_FINANCEIRO, type PortaFinanceiro } from './porta.js';
import { PortaFinanceiroMemoria } from './porta-memoria.js';
import { portaFinanceiroIndisponivel, PortaFinanceiroPropria } from './porta-propria.js';
import { ARMAZEM_FINANCEIRO } from './simbolos.js';

export interface OpcoesModuloFinanceiro {
  /** Testes: a porta já montada. */
  readonly porta?: PortaFinanceiro;
  /** Testes: a guarda dos arquivos. */
  readonly armazem?: ArmazemFinanceiro;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
}

export function moduloFinanceiro(ctx: ContextoModulo, opcoes: OpcoesModuloFinanceiro = {}): DynamicModule {
  const memoria = !ctx.nucleo && fontesSinteticas(ctx.env);
  const porta: PortaFinanceiro =
    opcoes.porta ??
    (ctx.nucleo
      ? new PortaFinanceiroPropria(ctx.nucleo)
      : memoria
        ? new PortaFinanceiroMemoria(null)
        : portaFinanceiroIndisponivel());
  const ambiente = (ctx.env['AMBIENTE'] ?? 'dev').trim() || 'dev';
  const armazem: ArmazemFinanceiro =
    opcoes.armazem ??
    (porta.destino === 'memoria'
      ? armazemFinanceiroMemoria()
      : armazemFinanceiroS3(
          new ClienteS3({
            endpoint: ctx.env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318',
            regiao: ctx.env['S3_REGIAO']?.trim() || 'us-east-1',
            acesso: ctx.env['S3_SEGREDO']?.trim() ? ctx.env['S3_ACESSO']?.trim() : undefined,
            segredo: ctx.env['S3_SEGREDO']?.trim() || undefined,
          }),
          ctx.env['S3_BUCKET_FINANCEIRO']?.trim() || `sgh-${ctx.configuracao.rede ?? 'rede'}-financeiro`,
          ambiente,
        ));
  const configuracao =
    opcoes.configuracao ??
    (porta.destino === 'memoria'
      ? fonteConfiguracaoMemoria(ctx.trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : null);
  return {
    module: class ModuloFinanceiro {},
    controllers: [FinanceiroController],
    providers: [
      { provide: PORTA_FINANCEIRO, useValue: porta },
      { provide: ARMAZEM_FINANCEIRO, useValue: armazem },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloFinanceiro(ctx);
}
