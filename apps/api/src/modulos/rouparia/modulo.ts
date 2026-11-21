// Módulo da rouparia e lavanderia (F2.2): o controlador sobre a porta própria (MariaDB pelo @sgh/nucleo) quando o
// núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a porta indisponível (503 em tudo,
// falha fechada) — a mesma regra do F2-L.
// A liberação da funcionalidade (chave `rouparia`) e os parâmetros vêm da FONTE_CONFIGURACAO do módulo de configuração;
// sem ela, a rouparia fica só em consulta (falha fechada). Na memória, a fonte sintética da configuração.
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { PORTA_ROUPARIA, type PortaRouparia } from './porta.js';
import { PortaRoupariaMemoria } from './porta-memoria.js';
import { portaRoupariaIndisponivel, PortaRoupariaPropria } from './porta-propria.js';
import { RoupariaController } from './rouparia.controller.js';

export interface OpcoesModuloRouparia {
  /** Testes: a porta já montada. */
  readonly porta?: PortaRouparia;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
}

export function moduloRouparia(ctx: ContextoModulo, opcoes: OpcoesModuloRouparia = {}): DynamicModule {
  const porta: PortaRouparia =
    opcoes.porta ??
    (ctx.nucleo
      ? new PortaRoupariaPropria(ctx.nucleo)
      : fontesSinteticas(ctx.env)
        ? new PortaRoupariaMemoria()
        : portaRoupariaIndisponivel());
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
    module: class ModuloRouparia {},
    controllers: [RoupariaController],
    providers: [
      { provide: PORTA_ROUPARIA, useValue: porta },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloRouparia(ctx);
}
