// Módulo da agenda de exames (M18) na API migrada (F2.2): o controlador da agenda de exames sobre a porta própria
// (MariaDB pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a
// porta indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// A liberação da funcionalidade (chave agenda.exame) e os parâmetros vêm da FONTE_CONFIGURACAO do módulo de
// configuração (global); sem ele, na memória, a fonte sintética da configuração; no banco, a agenda fica em consulta.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { pacientesSinteticos } from '../agenda/modulo.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { ExamesController } from './exames.controller.js';
import { PORTA_EXAME, type PortaExame } from './porta.js';
import { PortaExameMemoria } from './porta-memoria.js';
import { portaExameIndisponivel, PortaExamePropria } from './porta-propria.js';

export interface OpcoesModuloExames {
  /** Testes: a porta já montada. */
  readonly porta?: PortaExame;
  /** Testes: a fonte da liberação e dos parâmetros (null: sem fonte). */
  readonly configuracao?: unknown;
}

/** A porta da agenda de exames pela regra do módulo (sem as opções de teste). */
export async function portaDosExames(ctx: ContextoModulo): Promise<PortaExame> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaExamePropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return new PortaExameMemoria(null, async (_c, ids) => pacientesSinteticos(ids));
  return portaExameIndisponivel();
}

@Module({})
export class ModuloExames {}

export async function moduloExames(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloExames = {},
): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDosExames(ctx));
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
    module: ModuloExames,
    controllers: [ExamesController],
    providers: [
      { provide: PORTA_EXAME, useValue: porta },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_EXAME],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloExames(ctx);
}
