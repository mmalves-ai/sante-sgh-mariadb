// Módulo portaria e visitantes da API (M50, etapa 5): a portaria (visitante, visita, crachá, saída), as regras e os
// bloqueios por paciente, o bloqueio clínico, o acompanhante com direito legal, o relatório de contatos, os terminais e
// a catraca; e a leitura dos acompanhantes com direito à refeição (a dieta do acompanhante na nutrição lê esta).
import type { FundamentoAcompanhante } from '@sgh/contratos';
import type { ContextoPortaria, PortaPortaria } from './porta.js';

export { OPCOES_PORTARIA, type OpcoesPortaria, PortariaController } from './portaria.controller.js';
export { PORTA_PORTARIA, type PortaPortaria } from './porta.js';
export { portaPortariaIndisponivel, portaPortariaLegado } from './porta-legado.js';
export { PortaPortariaMemoria } from './porta-memoria.js';
export { ARMAZEM_FOTOS_PORTARIA, criarArmazemFotosPortaria } from './fotos.js';

/** O acompanhante vigente registrado na portaria com direito à refeição, como a nutrição o lê. */
export interface AcompanhanteComRefeicao {
  readonly id: number;
  readonly internacao: number;
  readonly paciente: number;
  readonly unidade: string;
  readonly fundamento: FundamentoAcompanhante;
  readonly pernoite: boolean;
  /** AAAA-MM-DDTHH:mm. */
  readonly desde: string;
}

/**
 * Os acompanhantes vigentes com direito à refeição (por unidade): o mapa de dietas da nutrição (M45) lê esta, para
 * que o acompanhante registrado na portaria chegue à copa sem um segundo cadastro (fonte única: SGH_HOT_ACOMPANHANTE).
 */
export async function acompanhantesComRefeicao(
  porta: PortaPortaria,
  c: ContextoPortaria,
  unidade: string | null = null,
): Promise<AcompanhanteComRefeicao[]> {
  return (await porta.acompanhantes(c, unidade))
    .filter((a) => a.refeicao)
    .map((a) => ({
      id: a.id,
      internacao: a.internacao,
      paciente: a.paciente,
      unidade: a.bloco,
      fundamento: a.fundamento,
      pernoite: a.pernoite,
      desde: a.inicio,
    }));
}
