// Provedores da equipe assistencial no módulo do PEP (03-PEP L94): a porta própria da equipe e, com ela, o provedor
// REAL de VINCULO_ASSISTENCIAL (a forma "equipe" pela conta da sessão). O módulo do PEP é global e exporta o vínculo:
// toda rota que monta a guarda do paciente (AcessoPacientePep), em qualquer módulo, passa a enxergar a equipe.
// Sem núcleo ou sem cliente padrão: a porta fica null (503 nas rotas da equipe) e o vínculo não é provido (cada
// controller cai na porta sintética sem pares: ninguém tem vínculo, falha fechada).
import type { Provider } from '@nestjs/common';
import { VINCULO_ASSISTENCIAL } from '../acesso/emergencia.controller.js';
import type { ContextoModulo } from '../registro.js';
import { PORTA_EQUIPE_PAINEL, PortaEquipePainelPropria } from './equipe-painel-propria.js';
import { VinculoAssistencialPelaEquipe } from './vinculo-pela-equipe.js';

export function provedoresDaEquipe(ctx: Pick<ContextoModulo, 'nucleo' | 'configuracao'>): {
  readonly providers: Provider[];
  readonly exports: symbol[];
} {
  const porta =
    ctx.nucleo && ctx.configuracao.clientePadrao
      ? new PortaEquipePainelPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
      : null;
  if (!porta) return { providers: [{ provide: PORTA_EQUIPE_PAINEL, useValue: null }], exports: [] };
  return {
    providers: [
      { provide: PORTA_EQUIPE_PAINEL, useValue: porta },
      { provide: VINCULO_ASSISTENCIAL, useValue: new VinculoAssistencialPelaEquipe(porta) },
    ],
    exports: [VINCULO_ASSISTENCIAL],
  };
}
