// Acompanhante com direito legal (M50, etapa 5; regra 9): o fundamento confere com o paciente (pessoa idosa: 60 anos ou
// mais, Lei 10.741/2003, art. 16; criança ou adolescente: menos de 18, Lei 8.069/1990, art. 12); a parturiente (Lei
// 11.108/2005) e a pessoa com deficiência (Lei 13.146/2015, art. 22) são declaradas por quem registra, com o aviso; o
// autorizado pela equipe não tem direito legal. Um acompanhante vigente por internação: o novo encerra o anterior (a
// troca). O relatório de contatos (investigação de surto, M48) junta as visitas do período. Regras puras.
import type { FundamentoAcompanhante } from '@sgh/contratos';

export type ConferenciaFundamento =
  { readonly ok: true; readonly aviso: string | null } | { readonly ok: false; readonly mensagem: string };

export function conferirFundamento(
  f: FundamentoAcompanhante,
  idadePaciente: number | null,
): ConferenciaFundamento {
  switch (f) {
    case 'idoso':
      if (idadePaciente === null)
        return { ok: true, aviso: 'Idade do paciente não lida: confira os 60 anos ou mais no documento.' };
      return idadePaciente >= 60
        ? { ok: true, aviso: null }
        : { ok: false, mensagem: 'O direito da pessoa idosa vale para o paciente com 60 anos ou mais.' };
    case 'crianca':
      if (idadePaciente === null)
        return {
          ok: true,
          aviso: 'Idade do paciente não lida: confira a idade (menos de 18 anos) no documento.',
        };
      return idadePaciente < 18
        ? { ok: true, aviso: null }
        : {
            ok: false,
            mensagem: 'O direito da criança e do adolescente vale para o paciente com menos de 18 anos.',
          };
    case 'parto':
      return {
        ok: true,
        aviso: 'Parturiente: o direito vale no trabalho de parto, no parto e no pós-parto imediato.',
      };
    case 'deficiencia':
      return { ok: true, aviso: 'Pessoa com deficiência: condição declarada por quem registra.' };
    case 'autorizado':
      return {
        ok: true,
        aviso: 'Acompanhante autorizado pela equipe, sem direito legal: segue o critério da unidade.',
      };
  }
}

export interface VisitaDoPeriodo {
  readonly entrada: string;
  readonly saida: string | null;
  /** A validade do crachá: a visita sem a saída e com o crachá vencido termina nela (não "até agora"). */
  readonly validoAte?: string;
}

/**
 * As visitas que estiveram no período [de 00:00, até 23:59] (a aberta conta até agora), da mais antiga à mais nova: o
 * relatório de contatos para a investigação de surto.
 */
export function contatosNoPeriodo<V extends VisitaDoPeriodo>(
  visitas: readonly V[],
  de: string,
  ate: string,
  agora: string,
): V[] {
  const ini = `${de}T00:00`;
  const fim = `${ate}T23:59`;
  return visitas
    .filter((v) => {
      const termino = v.saida ?? (v.validoAte !== undefined && v.validoAte < agora ? v.validoAte : agora);
      return v.entrada.slice(0, 16) <= fim && termino.slice(0, 16) >= ini;
    })
    .sort((a, b) => a.entrada.localeCompare(b.entrada));
}
