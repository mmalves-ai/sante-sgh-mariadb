// Módulo de preços e convênios (F2.2): os controladores do M12 sobre a fonte própria (MariaDB pelo @sgh/nucleo)
// quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso, a fonte indisponível (503 em
// tudo, falha fechada) — a mesma regra do F2-L.
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import type { ContextoModulo } from '../registro.js';
import { AgendaPrecoController, SERVICO_AGENDA_PRECO } from './agenda-preco.controller.js';
import { ServicoAgendaPreco } from './agenda-preco.servico.js';
import { ConveniosController } from './convenios.controller.js';
import { FONTE_PRECOS, type FontePrecos, fontePrecosIndisponivel } from './fonte.js';
import { FontePrecosMemoria } from './fonte-memoria.js';
import { FontePrecosPropria } from './fonte-propria.js';
import { ImportacoesController } from './importacoes.controller.js';
import { MotorController } from './motor.controller.js';
import { PrecosController } from './precos.controller.js';
import { ServicoPrecos } from './servico.js';
import { SERVICO_PRECOS } from './simbolos.js';

export interface OpcoesModuloPrecos {
  /** Testes: a fonte já montada. */
  readonly fonte?: FontePrecos;
}

/** A fonte de preços pela regra do módulo (sem as opções de teste). */
export async function fonteDosPrecos(ctx: ContextoModulo): Promise<FontePrecos> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    // O código do estabelecimento da sessão vira o id do banco (o mesmo mapa dos outros módulos).
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new FontePrecosPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new FontePrecosMemoria(ctx.configuracao.ambiente);
  return fontePrecosIndisponivel();
}

export async function moduloPrecos(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloPrecos = {},
): Promise<DynamicModule> {
  const fonte = opcoes.fonte ?? (await fonteDosPrecos(ctx));
  return {
    module: class ModuloPrecos {},
    controllers: [
      ConveniosController,
      PrecosController,
      ImportacoesController,
      MotorController,
      AgendaPrecoController,
    ],
    providers: [
      { provide: FONTE_PRECOS, useValue: fonte },
      // ADR 0009: regra de preço particular, credenciamento e agenda estruturada (só com o banco próprio; sem ele, 503).
      {
        provide: SERVICO_AGENDA_PRECO,
        useValue: ctx.nucleo && ctx.configuracao.clientePadrao ? new ServicoAgendaPreco(ctx.nucleo) : null,
      },
      // O cache da lista de convênios fica de fora até o armazém compartilhado chegar ao boot mínimo.
      { provide: SERVICO_PRECOS, useValue: new ServicoPrecos(fonte, null) },
    ],
    exports: [FONTE_PRECOS, SERVICO_PRECOS],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloPrecos(ctx);
}
