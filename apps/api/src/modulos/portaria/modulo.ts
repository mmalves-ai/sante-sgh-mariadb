// Módulo da portaria e dos visitantes (F2.2): o controlador sobre a porta própria (MariaDB pelo @sgh/nucleo) quando o
// núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a porta indisponível (503 em tudo,
// falha fechada) — a mesma regra do F2-L.
// A liberação (chaves portaria, portaria.catraca e portaria.biometria) e o prazo de guarda vêm da FONTE_CONFIGURACAO do
// módulo de configuração; sem ela, a portaria fica em consulta (falha fechada). Na memória, a fonte sintética.
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import type { ContextoModulo } from '../registro.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { ARMAZEM_FOTOS_PORTARIA, type ArmazemFotosPortaria, criarArmazemFotosPortaria } from './fotos.js';
import { PORTA_PORTARIA, type PortaPortaria } from './porta.js';
import { PortaPortariaMemoria } from './porta-memoria.js';
import { portaPortariaIndisponivel, PortaPortariaPropria } from './porta-propria.js';
import { OPCOES_PORTARIA, PortariaController } from './portaria.controller.js';

export interface OpcoesModuloPortaria {
  /** Testes: a porta já montada. */
  readonly porta?: PortaPortaria;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
  /** Testes: o armazém das fotos. */
  readonly fotos?: ArmazemFotosPortaria;
}

/** A porta da portaria pela regra do módulo (sem as opções de teste). */
export async function portaDaPortaria(ctx: ContextoModulo): Promise<PortaPortaria> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    // O código do estabelecimento da sessão vira o id do banco (o mesmo mapa dos outros módulos).
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaPortariaPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaPortariaMemoria();
  return portaPortariaIndisponivel();
}

export async function moduloPortaria(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloPortaria = {},
): Promise<DynamicModule> {
  const porta: PortaPortaria = opcoes.porta ?? (await portaDaPortaria(ctx));
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
    module: class ModuloPortaria {},
    controllers: [PortariaController],
    providers: [
      { provide: PORTA_PORTARIA, useValue: porta },
      {
        provide: ARMAZEM_FOTOS_PORTARIA,
        useValue: opcoes.fotos ?? criarArmazemFotosPortaria(ctx.configuracao, ctx.env, ctx.nucleo),
      },
      { provide: OPCOES_PORTARIA, useValue: { simulador: ctx.configuracao.ambiente !== 'producao' } },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_PORTARIA],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloPortaria(ctx);
}
