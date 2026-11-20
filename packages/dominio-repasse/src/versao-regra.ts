// Regra 3 do M33: regra com vigência; no novo, regra usada não muda e a nova versão só vale aprovada. A versão nasce
// como rascunho em SGH_REP_REGRA_VERSAO, passa pelo simulador, é aprovada por outra pessoa (supervisor) e só então é
// incluída em TBREPGER (incluir antes faria o outro sistema já usá-la). Recusada não volta.
import type { EstadoVersaoRegra } from '@sgh/contratos';

export type AcaoVersaoRegra = 'editar' | 'simular' | 'aprovar' | 'recusar' | 'incluir';

export interface VersaoRegra {
  readonly estado: EstadoVersaoRegra;
  readonly autor: string;
  readonly vigencia: string;
}

export type ResultadoTransicao<E> =
  { readonly ok: true; readonly estado: E } | { readonly ok: false; readonly motivo: string };

const recusa = (motivo: string) => ({ ok: false, motivo }) as const;

export function transicaoVersaoRegra(
  v: VersaoRegra,
  acao: AcaoVersaoRegra,
  ator: { readonly usuario: string; readonly hoje: string },
): ResultadoTransicao<EstadoVersaoRegra> {
  switch (acao) {
    case 'editar':
      if (v.estado !== 'rascunho' && v.estado !== 'simulada') return recusa('Só o rascunho é editado.');
      if (ator.usuario !== v.autor) return recusa('Só quem propôs edita o rascunho.');
      return { ok: true, estado: 'rascunho' };
    case 'simular':
      if (v.estado !== 'rascunho' && v.estado !== 'simulada') return recusa('Só o rascunho é simulado.');
      return { ok: true, estado: 'simulada' };
    case 'aprovar':
      if (v.estado !== 'simulada') return recusa('Simule a regra antes de aprovar.');
      if (ator.usuario === v.autor) return recusa('Quem propôs a regra não aprova.');
      return { ok: true, estado: 'aprovada' };
    case 'recusar':
      if (v.estado !== 'rascunho' && v.estado !== 'simulada') return recusa('Só o rascunho é recusado.');
      if (ator.usuario === v.autor) return recusa('Quem propôs a regra não recusa; edite o rascunho.');
      return { ok: true, estado: 'recusada' };
    case 'incluir':
      if (v.estado !== 'aprovada') return recusa('Só a regra aprovada é incluída.');
      if (v.vigencia < ator.hoje)
        return recusa('A vigência já passou: proponha de novo com vigência futura.');
      return { ok: true, estado: 'incluida' };
  }
}

/**
 * Regra usada (com apuração gravada) não é alterada pelo novo: a mudança vira nova versão com vigência própria. O
 * outro sistema continua permitindo editar até o fim da coexistência (cap-06b §6.7).
 */
export function podeAlterarRegra(regra: number, usadas: ReadonlySet<number>): boolean {
  return !usadas.has(regra);
}
