// Edições, competências e versões (ficha do M13, regras 4 e 11): onde o banco guarda edição ou vigência (SIGTAP
// por competência, Brasíndice e Simpro por edição, TISS por versão), a carga só INCLUI a edição nova; edição
// passada nunca é sobrescrita. Versão TISS que o banco não tem não é inserida (DP-37): a carga é recusada.
import type { EdicaoCatalogo } from '@sgh/contratos';
import { competenciaValida } from '../codigo.js';

export type DecisaoEdicao =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly codigo: 'edicao-ausente' | 'edicao-invalida' | 'edicao-passada' | 'versao-inexistente';
      readonly motivo: string;
    };

export interface ContextoEdicao {
  readonly tipo: EdicaoCatalogo;
  /** Edição do arquivo (ou informada). */
  readonly nova: string | null;
  /** Edição mais nova que o banco já tem (competência AAAAMM ou número da edição). */
  readonly ultimaNoBanco: string | null;
  /** Versões TISS que o banco já tem (x.yy.zz). */
  readonly versoesTiss?: readonly string[];
}

const recusa = (codigo: Exclude<DecisaoEdicao, { ok: true }>['codigo'], motivo: string): DecisaoEdicao => ({
  ok: false,
  codigo,
  motivo,
});

/**
 * A edição pode ser carregada? Competência e edição: maior ou IGUAL à última do banco (igual = a mesma edição
 * de novo: a comparação mostra o que muda, e nada é sobrescrito: só o que falta entra). Menor: recusada.
 */
export function conferirEdicao(c: ContextoEdicao): DecisaoEdicao {
  if (c.tipo === 'nenhuma') return { ok: true };
  if (!c.nova) return recusa('edicao-ausente', 'Informe a competência, a edição ou a versão do arquivo.');
  if (c.tipo === 'competencia') {
    if (!competenciaValida(c.nova))
      return recusa('edicao-invalida', `Competência inválida: ${c.nova} (AAAAMM).`);
    if (c.ultimaNoBanco && c.nova < c.ultimaNoBanco)
      return recusa(
        'edicao-passada',
        `A competência ${c.nova} é anterior à última carregada (${c.ultimaNoBanco}): edição passada não é sobrescrita.`,
      );
    return { ok: true };
  }
  if (c.tipo === 'edicao') {
    if (!/^\d{1,6}$/.test(c.nova)) return recusa('edicao-invalida', `Edição inválida: ${c.nova}.`);
    if (c.ultimaNoBanco && Number(c.nova) < Number(c.ultimaNoBanco))
      return recusa(
        'edicao-passada',
        `A edição ${c.nova} é anterior à última carregada (${c.ultimaNoBanco}).`,
      );
    return { ok: true };
  }
  if (!/^\d\.\d{2}\.\d{2}$/.test(c.nova))
    return recusa('edicao-invalida', `Versão TISS inválida: ${c.nova} (x.yy.zz).`);
  if (!(c.versoesTiss ?? []).includes(c.nova))
    return recusa(
      'versao-inexistente',
      `A versão TISS ${c.nova} não existe no banco do estabelecimento: versão nova não é incluída (DP-37); a terminologia é carregada nas versões que já existem.`,
    );
  return { ok: true };
}
