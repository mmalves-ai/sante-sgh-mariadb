// Módulo da nutrição, do mapa de dietas e do serviço social (F2.2): o controlador sobre a porta própria (MariaDB pelo
// @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a porta
// indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// O acompanhante com direito à refeição registrado na portaria entra no mapa pela porta da portaria (fonte única da
// pessoa): a do próprio banco, ou a de memória em dev/ci.
import type { DynamicModule } from '@nestjs/common';
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
import { portaDaPortaria } from '../portaria/modulo.js';
import { PORTA_PORTARIA, type PortaPortaria } from '../portaria/porta.js';
import type { ContextoModulo } from '../registro.js';
import { NutricaoController } from './nutricao.controller.js';
import { PORTA_NUTRICAO, type PortaNutricao } from './porta.js';
import { PortaNutricaoMemoria } from './porta-memoria.js';
import { portaNutricaoIndisponivel, PortaNutricaoPropria } from './porta-propria.js';

export interface OpcoesModuloNutricao {
  /** Testes: a porta já montada. */
  readonly porta?: PortaNutricao;
  /** Testes: a porta da portaria (o acompanhante com direito à refeição). */
  readonly portaria?: PortaPortaria | null;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
}

/** A porta da nutrição pela regra do módulo (sem as opções de teste). */
export async function portaDaNutricao(ctx: ContextoModulo): Promise<PortaNutricao> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaNutricaoPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaNutricaoMemoria();
  return portaNutricaoIndisponivel();
}

export async function moduloNutricao(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloNutricao = {},
): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDaNutricao(ctx));
  const portaria = opcoes.portaria !== undefined ? opcoes.portaria : await portaDaPortaria(ctx);
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
    module: class ModuloNutricao {},
    controllers: [NutricaoController],
    providers: [
      { provide: PORTA_NUTRICAO, useValue: porta },
      { provide: ESTADO_PRONTUARIO, useValue: new EstadoProntuario() },
      ...(portaria ? [{ provide: PORTA_PORTARIA, useValue: portaria }] : []),
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_NUTRICAO],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloNutricao(ctx);
}
