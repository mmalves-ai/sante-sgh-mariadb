// Módulo das especialidades sob demanda e do lactário (M45, etapa 6) na API migrada (F2.2): o controlador sobre a
// porta própria (MariaDB pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas;
// fora disso, a porta indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// A liberação (chaves pep.especialidade.* e lactário) e os parâmetros vêm da FONTE_CONFIGURACAO do módulo de
// configuração (global). Na memória sem o módulo de configuração pedido, a fonte sintética local.
// O estado curto do prontuário (motivo de acesso por sessão) é o do módulo do prontuário quando ele exporta
// ESTADO_PRONTUARIO; até o prontuário entrar no registro, um estado local (pedido ao integrador).
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
import { ESTADO_PRONTUARIO } from '../pep/prontuario.controller.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import type { ContextoModulo } from '../registro.js';
import { EspecialidadesController } from './especialidades.controller.js';
import { PORTA_ESPECIALIDADES, type PortaEspecialidades } from './porta.js';
import { PortaEspecialidadesMemoria } from './porta-memoria.js';
import { portaEspecialidadesIndisponivel, PortaEspecialidadesPropria } from './porta-propria.js';
import {
  PORTA_PRESCRICAO_LENTE,
  type PortaPrescricaoLente,
  PortaPrescricaoLenteMemoria,
  portaPrescricaoLenteIndisponivel,
  PortaPrescricaoLentePropria,
} from './prescricao-lente.js';
import { RegistroOncologicoController } from './registro-oncologico.controller.js';
import {
  PORTA_REGISTRO_ONCOLOGICO,
  portaRegistroOncologicoIndisponivel,
  PortaRegistroOncologicoPropria,
} from './registro-oncologico.js';

export interface OpcoesModuloEspecialidades {
  /** Testes: a porta já montada. */
  readonly porta?: PortaEspecialidades;
  /** Testes: a fonte da liberação e dos parâmetros (null: a do módulo de configuração, global). */
  readonly configuracao?: unknown;
}

/** A porta pela regra do módulo (sem as opções de teste). */
export async function portaDasEspecialidades(ctx: ContextoModulo): Promise<PortaEspecialidades> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaEspecialidadesPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaEspecialidadesMemoria();
  return portaEspecialidadesIndisponivel();
}

/** O módulo de configuração foi pedido junto (a fonte dele é global)? */
export function configuracaoPedida(ctx: ContextoModulo): boolean {
  const nomes = (ctx.env['API_MODULOS'] ?? '').split(',').map((n) => n.trim());
  return nomes.includes('config') || nomes.includes('todos');
}

@Module({})
export class ModuloEspecialidades {}

export async function moduloEspecialidades(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloEspecialidades = {},
): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDasEspecialidades(ctx));
  const configuracao =
    opcoes.configuracao !== undefined
      ? opcoes.configuracao
      : porta.destino === 'memoria' && !configuracaoPedida(ctx)
        ? fonteConfiguracaoMemoria(ctx.trilha, {
            chavesIniciais: chavesIniciaisSinteticas,
            prerequisitosIniciais: prerequisitosIniciaisSinteticos,
            parametrosIniciais: parametrosIniciaisSinteticos,
          })
        : null;
  // 03-PEP linha 139: a prescrição de lentes segue o destino da porta das especialidades.
  const lentes: PortaPrescricaoLente =
    porta.destino === 'banco' && ctx.nucleo
      ? new PortaPrescricaoLentePropria(ctx.nucleo)
      : porta.destino === 'memoria'
        ? new PortaPrescricaoLenteMemoria()
        : portaPrescricaoLenteIndisponivel();
  // 09-AREA linha 69: o registro oncológico e a radioterapia só no banco (o E2E usa respostas simuladas).
  const registroOnco =
    porta.destino === 'banco' && ctx.nucleo
      ? new PortaRegistroOncologicoPropria(ctx.nucleo)
      : portaRegistroOncologicoIndisponivel();
  return {
    module: ModuloEspecialidades,
    controllers: [EspecialidadesController, RegistroOncologicoController],
    providers: [
      { provide: PORTA_ESPECIALIDADES, useValue: porta },
      { provide: ESTADO_PRONTUARIO, useValue: new EstadoProntuario() },
      { provide: PORTA_PRESCRICAO_LENTE, useValue: lentes },
      { provide: PORTA_REGISTRO_ONCOLOGICO, useValue: registroOnco },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloEspecialidades(ctx);
}
