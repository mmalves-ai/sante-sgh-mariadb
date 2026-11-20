// SIGTAP por competência (ficha do M51, regra 2): toda crítica e todo valor usam a tabela da competência do atendimento,
// nunca a vigente hoje. O legado guarda o procedimento atual em TBPROSUS (com COMP_INICIAL e COMP_FINAL), os
// atributos de competências anteriores em HTPROSUS (ANO_MES_COMPETENCIA + ID_TBPROSUS) e os valores datados em
// TBVLRSUS (DATA). O importador do M13 (`catalogo.importarSigtap`) é quem mantém as três.
import type { CompetenciaSus } from '@sgh/contratos';
import { vigenteNaData } from '@sgh/contratos/regras-faturamento';
import { intervaloDaCompetencia } from './competencia.js';

/** Sexo aceito pelo procedimento na SIGTAP: M, F ou ambos (I/N/vazio no legado). */
export type SexoSigtap = 'M' | 'F' | 'ambos';

/** Atributos do procedimento que a crítica usa (idades em meses, como na SIGTAP; null = sem limite). */
export interface AtributosSigtap {
  readonly idadeMinimaMeses: number | null;
  readonly idadeMaximaMeses: number | null;
  readonly sexo: SexoSigtap;
  readonly quantidadeMaxima: number | null;
  readonly permanencia: number | null;
  readonly complexidade: string | null;
}

/** O procedimento atual (TBPROSUS). */
export interface ProcedimentoSigtap {
  readonly id: number;
  /** Código SIGTAP de 10 dígitos (TBPROSUS.CODSUS ou CODSUS10). */
  readonly codigo: string;
  /** AAAAMM; 0 = sem limite. */
  readonly competenciaInicial: number;
  readonly competenciaFinal: number;
  readonly atuais: AtributosSigtap;
}

/** Uma linha de HTPROSUS: os atributos como eram na competência. */
export interface HistoricoSigtap {
  readonly competencia: number;
  readonly atributos: AtributosSigtap;
}

/** Uma linha de TBVLRSUS (valores em reais; DATA é o início da vigência). */
export interface ValorSigtap {
  readonly data: string;
  readonly servicoHospitalar: number;
  readonly servicoProfissional: number;
  readonly sadt: number;
  readonly ambulatorial: number;
}

export type FonteAtributos = 'historico' | 'historico-aproximado' | 'atual';

export interface AtributosNaCompetencia {
  readonly fonte: FonteAtributos;
  readonly atributos: AtributosSigtap;
}

/** Limite de idade do legado em atributo: 9999 (e negativos) é "sem limite" na SIGTAP. */
export function limiteIdade(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0 || v >= 9999) return null;
  return v;
}

/**
 * O limite de idade do outro sistema em meses. TBPROSUS.IDMIN/IDMAX e HTPROSUS.IDADE_MINIMA/MAXIMA guardam ANOS (na
 * cópia de 2026-10-24: maior IDMAX abaixo de 9999 = 110 e nenhum valor entre 131 e 9998; a SIGTAP oficial, em meses,
 * teria valores até 1560). Decisão do preparo (POL-5): converter anos × 12; 9999 continua "sem limite".
 */
export function idadeLegadoEmMeses(anos: number | null | undefined): number | null {
  const v = limiteIdade(anos);
  return v === null ? null : v * 12;
}

export function sexoSigtap(v: string | null | undefined): SexoSigtap {
  const s = (v ?? '').trim().toUpperCase();
  return s === 'M' || s === 'F' ? s : 'ambos';
}

/** O procedimento existe na competência (COMP_INICIAL ≤ c ≤ COMP_FINAL; 0 é sem limite)? */
export function procedimentoVigenteNaCompetencia(p: ProcedimentoSigtap, c: CompetenciaSus): boolean {
  const n = Number(c);
  if (p.competenciaInicial > 0 && n < p.competenciaInicial) return false;
  if (p.competenciaFinal > 0 && n > p.competenciaFinal) return false;
  return true;
}

/**
 * Os atributos que valiam na competência (regra 2). Linha de HTPROSUS com ANO_MES_COMPETENCIA = X é o retrato do
 * procedimento durante X. Decisão do preparo (POL-5): depois do último retrato vale o atual (TBPROSUS), porque o
 * importador só grava o retrato quando a competência muda; até o último retrato vale o maior retrato ≤ c; antes do
 * primeiro retrato, o primeiro (marcado "aproximado", que a crítica avisa). Retrato com competência 0 é ignorado.
 */
export function atributosNaCompetencia(
  p: ProcedimentoSigtap,
  historico: readonly HistoricoSigtap[],
  c: CompetenciaSus,
): AtributosNaCompetencia | null {
  if (!procedimentoVigenteNaCompetencia(p, c)) return null;
  const n = Number(c);
  const validos = historico.filter((h) => h.competencia > 0);
  if (validos.length === 0 || n > Math.max(...validos.map((h) => h.competencia)))
    return { fonte: 'atual', atributos: p.atuais };
  let ate: HistoricoSigtap | null = null;
  let depois: HistoricoSigtap | null = null;
  for (const h of validos) {
    if (h.competencia <= n) {
      if (!ate || h.competencia > ate.competencia) ate = h;
    } else if (!depois || h.competencia < depois.competencia) depois = h;
  }
  if (ate) return { fonte: 'historico', atributos: ate.atributos };
  return { fonte: 'historico-aproximado', atributos: (depois as HistoricoSigtap).atributos };
}

/** O valor vigente no primeiro dia da competência (a SIGTAP publica por competência; decisão do preparo, POL-5). */
export function valorNaCompetencia(valores: readonly ValorSigtap[], c: CompetenciaSus): ValorSigtap | null {
  const { inicio } = intervaloDaCompetencia(c);
  const v = vigenteNaData(
    valores.map((x) => ({ data: x.data, valor: x })),
    inicio,
  );
  return v ? v.valor : null;
}

/** Idade em meses completos entre o nascimento e a data de referência (AAAA-MM-DD). */
export function idadeEmMeses(nascimento: string, referencia: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(nascimento);
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(referencia);
  if (!a || !b || a[1]! < '1900') return null;
  let meses = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
  if (Number(b[3]) < Number(a[3])) meses -= 1;
  return meses < 0 ? null : meses;
}

export type IncompatibilidadeSigtap =
  'sexo-incompativel' | 'idade-incompativel' | 'quantidade-acima-do-maximo';

/** Confere sexo, idade (em meses, na data do atendimento) e quantidade contra os atributos da competência. */
export function incompatibilidades(
  a: AtributosSigtap,
  paciente: { readonly sexo: string | null; readonly idadeMeses: number | null },
  quantidade: number,
): IncompatibilidadeSigtap[] {
  const r: IncompatibilidadeSigtap[] = [];
  const sexo = (paciente.sexo ?? '').trim().toUpperCase();
  if (a.sexo !== 'ambos' && (sexo === 'M' || sexo === 'F') && sexo !== a.sexo) r.push('sexo-incompativel');
  const idade = paciente.idadeMeses;
  if (
    idade !== null &&
    ((a.idadeMinimaMeses !== null && idade < a.idadeMinimaMeses) ||
      (a.idadeMaximaMeses !== null && idade > a.idadeMaximaMeses))
  )
    r.push('idade-incompativel');
  if (a.quantidadeMaxima !== null && a.quantidadeMaxima > 0 && quantidade > a.quantidadeMaxima)
    r.push('quantidade-acima-do-maximo');
  return r;
}
