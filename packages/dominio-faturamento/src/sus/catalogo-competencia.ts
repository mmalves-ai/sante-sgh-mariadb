// O catálogo SIGTAP de UMA competência para a montagem da CIHA (regra 2): a partir das linhas lidas do banco (o
// procedimento atual, os retratos por competência e os instrumentos de registro com a vigência), devolve o resolvedor
// que `montarCiha` usa. Os limites de idade do outro sistema estão em anos (idadeLegadoEmMeses); o instrumento de
// registro vale quando a competência está dentro da vigência dele. Puro: as leituras ficam no adaptador.
import type { CompetenciaSus } from '@sgh/contratos';
import type { ProcedimentoNaCiha } from './ciha.js';
import { type RegistroSigtap, registroSigtap } from './instrumento.js';
import {
  type AtributosSigtap,
  atributosNaCompetencia,
  type HistoricoSigtap,
  idadeLegadoEmMeses,
  type ProcedimentoSigtap,
  sexoSigtap,
} from './sigtap-competencia.js';

/** Atributos como o banco guarda (idades em anos; sexo I/N/vazio é "ambos"). */
export interface AtributosLidos {
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly sexo: string | null;
  readonly quantidadeMaxima: number | null;
  readonly permanencia: number | null;
  readonly complexidade: string | null;
}

export interface ProcedimentoLido extends AtributosLidos {
  readonly id: number;
  readonly codigo: string;
  readonly competenciaInicial: number;
  readonly competenciaFinal: number;
}

export interface RetratoLido extends AtributosLidos {
  readonly id: number;
  readonly competencia: number;
}

export interface RegistroLido {
  readonly id: number;
  readonly registro: string;
  readonly competenciaInicial: number;
  readonly competenciaFinal: number;
}

export function atributosDoBanco(a: AtributosLidos): AtributosSigtap {
  return {
    idadeMinimaMeses: idadeLegadoEmMeses(a.idadeMinima),
    idadeMaximaMeses: idadeLegadoEmMeses(a.idadeMaxima),
    sexo: sexoSigtap(a.sexo),
    quantidadeMaxima: a.quantidadeMaxima !== null && a.quantidadeMaxima > 0 ? a.quantidadeMaxima : null,
    permanencia: a.permanencia,
    complexidade: a.complexidade,
  };
}

const vigente = (r: { competenciaInicial: number; competenciaFinal: number }, n: number) =>
  (r.competenciaInicial <= 0 || n >= r.competenciaInicial) &&
  (r.competenciaFinal <= 0 || n <= r.competenciaFinal);

/** O resolvedor `procedimento(id)` da competência, com os atributos e os registros dela (cache por ID). */
export function catalogoSigtapDaCompetencia(
  competencia: CompetenciaSus,
  procedimentos: readonly ProcedimentoLido[],
  retratos: readonly RetratoLido[],
  registros: readonly RegistroLido[] = [],
): (id: number) => ProcedimentoNaCiha | null {
  const n = Number(competencia);
  const porId = new Map(procedimentos.map((p) => [p.id, p]));
  const historico = new Map<number, HistoricoSigtap[]>();
  for (const h of retratos) {
    const lista = historico.get(h.id) ?? [];
    lista.push({ competencia: h.competencia, atributos: atributosDoBanco(h) });
    historico.set(h.id, lista);
  }
  const regs = new Map<number, RegistroSigtap[]>();
  for (const r of registros) {
    const reg = registroSigtap(r.registro);
    if (!reg || !vigente(r, n)) continue;
    const lista = regs.get(r.id) ?? [];
    if (!lista.includes(reg)) lista.push(reg);
    regs.set(r.id, lista);
  }
  const cache = new Map<number, ProcedimentoNaCiha | null>();
  return (id) => {
    if (cache.has(id)) return cache.get(id) ?? null;
    const lido = porId.get(id);
    let r: ProcedimentoNaCiha | null = null;
    if (lido) {
      const procedimento: ProcedimentoSigtap = {
        id: lido.id,
        codigo: lido.codigo,
        competenciaInicial: lido.competenciaInicial,
        competenciaFinal: lido.competenciaFinal,
        atuais: atributosDoBanco(lido),
      };
      r = {
        procedimento,
        naCompetencia: atributosNaCompetencia(procedimento, historico.get(id) ?? [], competencia),
        registros: regs.get(id) ?? [],
      };
    }
    cache.set(id, r);
    return r;
  };
}

/** O mapa de fontes do parâmetro ("10:particular-pf;55:dpvat"); entrada malformada é ignorada (o formato é conferido no cadastro). */
export function fontesDoParametro(texto: string): ReadonlyMap<number, string> {
  const m = new Map<number, string>();
  for (const par of texto.split(';')) {
    const [c, f] = par.split(':').map((x) => x.trim());
    if (c && f && /^\d+$/.test(c)) m.set(Number(c), f);
  }
  return m;
}

/** A lista de convênios do parâmetro ("1,2"). */
export function conveniosDoParametro(texto: string): number[] {
  return texto
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x))
    .map(Number);
}
