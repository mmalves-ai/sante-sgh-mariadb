// Módulo da agenda de sessões (F2.2): o controlador sobre a porta própria (MariaDB pelo @sgh/nucleo) quando o núcleo
// existe; a de memória só em dev/ci com as fontes sintéticas (pacientes SINTÉTICOS 1001 a 1010); fora disso, a porta
// indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// A liberação da funcionalidade (chave `sessoes`) vem da FONTE_CONFIGURACAO do módulo de configuração; sem ela, a agenda
// de sessões fica só em consulta (falha fechada). Na memória, a fonte sintética da configuração.
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
import { PORTA_SESSOES, type PortaSessoes } from './porta.js';
import { type LerPacientesSinteticos, PortaSessoesMemoria } from './porta-memoria.js';
import { portaSessoesIndisponivel, PortaSessoesPropria } from './porta-propria.js';
import { DialisadorController } from './dialisador.controller.js';
import { PORTA_DIALISADOR, PortaDialisadorPropria } from './dialisador-propria.js';
import { SessoesController } from './sessoes.controller.js';

/** Pacientes SINTÉTICOS da memória (dev/ci): nenhum nome é de pessoa real. */
export const pacientesSinteticosSessoes: LerPacientesSinteticos = async (_c, ids) =>
  ids
    .filter((id) => id >= 1001 && id <= 1010)
    .map((id) => ({
      id,
      prontuario: 9000 + (id - 1000),
      nome: `PACIENTE SINTETICO ${id - 1000} TESTE`,
      nomeSocial: null,
      nascimento: null,
    }));

export interface OpcoesModuloSessoes {
  /** Testes: a porta já montada. */
  readonly porta?: PortaSessoes;
  /** Testes: a fonte da liberação. */
  readonly configuracao?: unknown;
}

export function moduloSessoes(ctx: ContextoModulo, opcoes: OpcoesModuloSessoes = {}): DynamicModule {
  const porta: PortaSessoes =
    opcoes.porta ??
    (ctx.nucleo
      ? new PortaSessoesPropria(ctx.nucleo)
      : fontesSinteticas(ctx.env)
        ? new PortaSessoesMemoria(pacientesSinteticosSessoes)
        : portaSessoesIndisponivel());
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
    module: class ModuloSessoes {},
    controllers: [SessoesController, DialisadorController],
    providers: [
      { provide: PORTA_SESSOES, useValue: porta },
      // C1-096 (03-PEP linha 146): reuso do dialisador no banco do cliente; sem núcleo, 503.
      {
        provide: PORTA_DIALISADOR,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaDialisadorPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloSessoes(ctx);
}
