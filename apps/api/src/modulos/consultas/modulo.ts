// Módulo das consultas somente leitura (M14; F2.2): o controlador sobre a fonte própria (MariaDB pelo @sgh/nucleo, em
// transação somente leitura) quando o núcleo existe; a de memória (linhas sintéticas) só em dev/ci com as fontes
// sintéticas; fora disso, a fonte indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// O painel da matriz de cobertura das tabelas de origem (convivência) saiu do produto (ADR 0003): a análise fica em
// docs/analise, uso interno.
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { ConsultasController } from './consultas.controller.js';
import {
  FONTE_CONSULTAS,
  type FonteConsultas,
  fonteConsultasIndisponivel,
  fonteConsultasMemoria,
} from './fonte.js';
import { FonteConsultasPropria } from './fonte-propria.js';

export interface OpcoesModuloConsultas {
  /** Testes: a fonte já montada. */
  readonly fonte?: FonteConsultas;
}

export function moduloConsultas(ctx: ContextoModulo, opcoes: OpcoesModuloConsultas = {}): DynamicModule {
  const cliente = ctx.configuracao.clientePadrao;
  const fonte: FonteConsultas =
    opcoes.fonte ??
    (ctx.nucleo && cliente
      ? new FonteConsultasPropria(ctx.nucleo, cliente)
      : !ctx.nucleo && fontesSinteticas(ctx.env)
        ? fonteConsultasMemoria()
        : fonteConsultasIndisponivel());
  return {
    module: class ModuloConsultas {},
    controllers: [ConsultasController],
    providers: [{ provide: FONTE_CONSULTAS, useValue: fonte }],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloConsultas(ctx);
}
