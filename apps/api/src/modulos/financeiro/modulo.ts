// Módulo do financeiro e fiscal (F2.2, M32): o controlador do financeiro sobre a porta própria (MariaDB pelo
// @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a porta
// indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// Os arquivos (extrato, remessa, NFS-e, declarações, lote contábil) vão ao disco local, sob a raiz de arquivos, pela
// porta de arquivos do núcleo (ADR 0004); na memória, à guarda em memória. A liberação das funcionalidades e os
// parâmetros vêm da FONTE_CONFIGURACAO global do módulo de configuração; na memória, a fonte sintética da configuração.
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { localizadorDoNucleo } from '../tiss/armazem-xml.js';
import type { ContextoModulo } from '../registro.js';
import { type ArmazemFinanceiro, armazemFinanceiroLocal, armazemFinanceiroMemoria } from './armazem.js';
import { AlteracaoTituloPagarController } from './alteracao-titulo-pagar.controller.js';
import { CartaoController } from './cartao.controller.js';
import { comCartaoNoFluxo } from './cartao-propria.js';
import { CompensacaoPrevisaoController } from './compensacao-previsao.controller.js';
import { ContabilFiscalController } from './contabil-fiscal.controller.js';
import { EscrituracaoEfdController } from './escrituracao-efd.controller.js';
import { RetencaoSofridaController } from './retencao-sofrida.controller.js';
import { FinanceiroController } from './financeiro.controller.js';
import { FluxoAprovacaoController } from './fluxo-aprovacao.controller.js';
import { GestaoFinanceiroController } from './gestao.controller.js';
import { PagamentoEletronicoController } from './pagamento-eletronico.controller.js';
import { NotaCessaoController } from './nota-cessao.controller.js';
import { NotaServicoController } from './nota-servico.controller.js';
import { NUCLEO_PERIODO_FINANCEIRO, PeriodoFinanceiroController } from './periodo.controller.js';
import { ReceberAcordosController } from './receber-acordos.controller.js';
import { ReinfEventosController } from './reinf-eventos.controller.js';
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
      ? // F3.8 (07-FIN linha 89): as parcelas previstas de cartão entram no fluxo de caixa projetado.
        comCartaoNoFluxo(new PortaFinanceiroPropria(ctx.nucleo), ctx.nucleo)
      : memoria
        ? new PortaFinanceiroMemoria(null)
        : portaFinanceiroIndisponivel());
  const armazem: ArmazemFinanceiro =
    opcoes.armazem ??
    (porta.destino === 'memoria'
      ? armazemFinanceiroMemoria()
      : armazemFinanceiroLocal(
          localizadorDoNucleo(ctx.nucleo, ctx.env),
          ctx.configuracao.clientePadrao ?? '',
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
    controllers: [
      FinanceiroController,
      PeriodoFinanceiroController,
      GestaoFinanceiroController,
      ContabilFiscalController,
      EscrituracaoEfdController,
      RetencaoSofridaController,
      CompensacaoPrevisaoController,
      PagamentoEletronicoController,
      ReinfEventosController,
      ReceberAcordosController,
      NotaCessaoController,
      // F3.8, 07-FIN linha 113: o ciclo da nota de serviço (lote, cancelamento, substituição, histórico).
      NotaServicoController,
      CartaoController,
      // F3.8, 07-FIN linha 63: alterar o título a pagar não pago.
      AlteracaoTituloPagarController,
      // F8, 07-FIN linha 65: fluxo de aprovação configurável (título, pedido de compra e contrato; celular).
      FluxoAprovacaoController,
    ],
    providers: [
      { provide: PORTA_FINANCEIRO, useValue: porta },
      { provide: ARMAZEM_FINANCEIRO, useValue: armazem },
      { provide: NUCLEO_PERIODO_FINANCEIRO, useValue: ctx.nucleo ?? null },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloFinanceiro(ctx);
}
