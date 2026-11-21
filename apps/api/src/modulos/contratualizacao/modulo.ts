// Módulo da contratualização SUS (F2.2): o controlador sobre a porta própria (MariaDB pelo @sgh/nucleo) quando o núcleo
// existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a porta indisponível (503 em tudo, falha
// fechada) — a mesma regra do F2-L. A liberação (chave `contratualizacao`) e os parâmetros (faixas de cumprimento,
// CNES, fontes pagadoras SUS) vêm da FONTE_CONFIGURACAO do módulo de configuração; sem ela, as telas ficam em
// consulta (falha fechada). Na memória, a fonte sintética da configuração.
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
import { ContratualizacaoController } from './contratualizacao.controller.js';
import { PORTA_CONTRATUALIZACAO, type PortaContratualizacao } from './porta.js';
import { PortaContratualizacaoMemoria } from './porta-memoria.js';
import { portaContratualizacaoIndisponivel, PortaContratualizacaoPropria } from './porta-propria.js';

export interface OpcoesModuloContratualizacao {
  /** Testes: a porta já montada. */
  readonly porta?: PortaContratualizacao;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
}

export function moduloContratualizacao(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloContratualizacao = {},
): DynamicModule {
  const memoria = !ctx.nucleo && fontesSinteticas(ctx.env);
  const porta: PortaContratualizacao =
    opcoes.porta ??
    (ctx.nucleo
      ? new PortaContratualizacaoPropria(ctx.nucleo)
      : memoria
        ? new PortaContratualizacaoMemoria()
        : portaContratualizacaoIndisponivel());
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
    module: class ModuloContratualizacao {},
    controllers: [ContratualizacaoController],
    providers: [
      { provide: PORTA_CONTRATUALIZACAO, useValue: porta },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloContratualizacao(ctx);
}
