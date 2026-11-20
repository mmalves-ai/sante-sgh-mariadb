// Validador de compatibilidade da SIGTAP (ficha do M51, seção 5: `faturamento.criticarSus` — "CID, CBO, sexo, idade,
// habilitação, leito, instrumento e quantidade, pela SIGTAP da competência"; regra 2). As compatibilidades vêm das
// tabelas que o importador do M13 mantém no outro sistema, cada linha com a vigência (COMP_INICIAL e COMP_FINAL,
// AAAAMM; 0 ou vazio = sem limite):
//   - TBSUSCID (procedimento × CID): com lista vigente, o CID principal tem de estar nela;
//   - TBSUSCBO (procedimento × CBO): com lista vigente, o CBO do executante tem de estar nela;
//   - TBPROHAB (procedimento × habilitação): com lista vigente, o estabelecimento precisa de uma das habilitações (as do
//     CNES, parâmetro `faturamento.sus.habilitacoes`; o outro sistema não as guarda);
//   - TBPROLEI (procedimento × especialidade do leito): com lista, o leito da internação tem de estar nela (AIH);
//   - TBPROREG (procedimento × instrumento de registro): o instrumento de saída tem de ser um dos registros;
//   - sexo, idade e quantidade máxima: os atributos da competência (sigtap-competencia.ts).
// Sem lista (o procedimento não restringe), passa. Puro: as leituras ficam no adaptador.
import type { CompetenciaSus, RegraCriticaSus } from '@sgh/contratos';
import type { ProcedimentoNaCiha } from './ciha.js';
import { cboValido } from './identificacao-sus.js';
import type { RegistroSigtap } from './instrumento.js';
import { type AtributosNaCompetencia, incompatibilidades } from './sigtap-competencia.js';

/** Uma linha de compatibilidade como o banco guarda (o código já resolvido: CID, CBO, habilitação ou leito). */
export interface CompatibilidadeLida {
  /** TBPROSUS.ID. */
  readonly id: number;
  readonly codigo: string;
  readonly competenciaInicial: number;
  readonly competenciaFinal: number;
}

export interface CompatibilidadesLidas {
  readonly cids: readonly CompatibilidadeLida[];
  readonly cbos: readonly CompatibilidadeLida[];
  readonly habilitacoes: readonly CompatibilidadeLida[];
  readonly leitos: readonly CompatibilidadeLida[];
}

export const SEM_COMPATIBILIDADES: CompatibilidadesLidas = {
  cids: [],
  cbos: [],
  habilitacoes: [],
  leitos: [],
};

/** As listas vigentes na competência por procedimento (null: o procedimento não restringe). */
export interface CompatibilidadesDaCompetencia {
  cids(id: number): ReadonlySet<string> | null;
  cbos(id: number): ReadonlySet<string> | null;
  habilitacoes(id: number): ReadonlySet<string> | null;
  leitos(id: number): ReadonlySet<string> | null;
}

const vigente = (r: CompatibilidadeLida, n: number) =>
  (!(r.competenciaInicial > 0) || n >= r.competenciaInicial) &&
  (!(r.competenciaFinal > 0) || n <= r.competenciaFinal);

const normalCid = (c: string) =>
  c
    .trim()
    .toUpperCase()
    .replace(/[.\s-]/g, '');
const normalCbo = (c: string) => c.trim().toUpperCase();
const normalNum = (c: string) => String(Number(c.trim()) || 0);

function indexar(
  linhas: readonly CompatibilidadeLida[],
  n: number,
  normal: (c: string) => string,
): (id: number) => ReadonlySet<string> | null {
  const m = new Map<number, Set<string>>();
  for (const r of linhas) {
    if (!vigente(r, n)) continue;
    const s = m.get(r.id) ?? new Set<string>();
    s.add(normal(r.codigo));
    m.set(r.id, s);
  }
  return (id) => m.get(id) ?? null;
}

/** As compatibilidades vigentes na competência (regra 2: a da competência do atendimento, nunca a de hoje). */
export function compatibilidadesDaCompetencia(
  competencia: CompetenciaSus,
  lidas: CompatibilidadesLidas,
): CompatibilidadesDaCompetencia {
  const n = Number(competencia);
  return {
    cids: indexar(lidas.cids, n, normalCid),
    cbos: indexar(lidas.cbos, n, normalCbo),
    habilitacoes: indexar(lidas.habilitacoes, n, normalNum),
    leitos: indexar(lidas.leitos, n, normalNum),
  };
}

/** O instrumento de registro que a saída vai usar (BPA consolidado ou individualizado, APAC ou AIH). */
export type InstrumentoDeRegistro = 'bpa-c' | 'bpa-i' | 'apac' | 'aih';

const REGISTROS_DO_INSTRUMENTO: Readonly<Record<InstrumentoDeRegistro, readonly RegistroSigtap[]>> = {
  'bpa-c': ['bpa-c'],
  'bpa-i': ['bpa-i'],
  apac: ['apac-principal', 'apac-secundario'],
  aih: ['aih-principal', 'aih-especial', 'aih-secundario'],
};

/** Uma ocorrência do procedimento a validar (o que a saída vai informar). */
export interface OcorrenciaSus {
  readonly procedimento: ProcedimentoNaCiha;
  readonly instrumento: InstrumentoDeRegistro;
  readonly quantidade: number;
  readonly paciente: { readonly sexo: string | null; readonly idadeMeses: number | null };
  /** CID principal sem ponto (null: não informado). O BPA consolidado não leva CID: passe `conferirCid: false`. */
  readonly cid: string | null;
  readonly conferirCid?: boolean;
  /** CBO do executante (null: não informado). */
  readonly cbo: string | null;
  readonly conferirCbo?: boolean;
  /** Especialidade do leito (TBESPLEI.COD) na internação; null fora dela. */
  readonly leito?: string | number | null;
}

export interface IncompatibilidadeSus {
  readonly regra: RegraCriticaSus;
  readonly detalhe: Readonly<Record<string, string | number | null>>;
}

/**
 * O validador. A ordem das regras é a da ficha; cada incompatibilidade vira uma crítica (a gravidade é a do catálogo:
 * todas bloqueantes, salvo a quantidade acima do máximo, que é aviso).
 */
export function validarCompatibilidade(
  o: OcorrenciaSus,
  compat: CompatibilidadesDaCompetencia,
  habilitacoesDoEstabelecimento: ReadonlySet<string>,
): IncompatibilidadeSus[] {
  const p = o.procedimento;
  const codigo = p.procedimento.codigo;
  if (!p.naCompetencia) return [{ regra: 'sigtap-fora-da-competencia', detalhe: { sigtap: codigo } }];
  const r: IncompatibilidadeSus[] = [];
  const id = p.procedimento.id;
  // CID
  if (o.conferirCid !== false) {
    const lista = compat.cids(id);
    if (lista && lista.size > 0) {
      const cid = o.cid ? normalCid(o.cid) : null;
      if (!cid) r.push({ regra: 'sem-cid-principal', detalhe: { sigtap: codigo } });
      else if (!lista.has(cid) && !(cid.length === 4 && lista.has(cid.slice(0, 3))))
        r.push({ regra: 'cid-incompativel', detalhe: { sigtap: codigo, cid } });
    }
  }
  // CBO
  if (o.conferirCbo !== false) {
    const cbo = o.cbo && cboValido(o.cbo) ? normalCbo(o.cbo) : null;
    if (!cbo) r.push({ regra: 'sem-cbo', detalhe: { sigtap: codigo } });
    else {
      const lista = compat.cbos(id);
      if (lista && lista.size > 0 && !lista.has(cbo))
        r.push({ regra: 'cbo-incompativel', detalhe: { sigtap: codigo, cbo } });
    }
  }
  // Sexo, idade e quantidade
  for (const x of incompatibilidades(
    (p.naCompetencia as AtributosNaCompetencia).atributos,
    o.paciente,
    o.quantidade,
  ))
    r.push({ regra: x, detalhe: { sigtap: codigo } });
  // Habilitação
  const hab = compat.habilitacoes(id);
  if (hab && hab.size > 0 && ![...hab].some((h) => habilitacoesDoEstabelecimento.has(h)))
    r.push({
      regra: 'habilitacao-ausente',
      detalhe: { sigtap: codigo, exigidas: [...hab].sort().slice(0, 5).join(',') },
    });
  // Leito
  if (o.leito !== undefined && o.leito !== null) {
    const leitos = compat.leitos(id);
    const leito = normalNum(String(o.leito));
    if (leitos && leitos.size > 0 && !leitos.has(leito))
      r.push({ regra: 'leito-incompativel', detalhe: { sigtap: codigo, leito } });
  }
  // Instrumento de registro
  const registros = p.registros ?? [];
  if (!REGISTROS_DO_INSTRUMENTO[o.instrumento].some((x) => registros.includes(x)))
    r.push({
      regra: 'instrumento-incompativel',
      detalhe: { sigtap: codigo, instrumento: o.instrumento, registros: registros.join(',') || null },
    });
  return r;
}

/** As habilitações do parâmetro ("801,802") normalizadas como o validador compara. */
export function habilitacoesDoParametro(texto: string): ReadonlySet<string> {
  return new Set(
    texto
      .split(',')
      .map((x) => x.trim())
      .filter((x) => /^\d+$/.test(x))
      .map(normalNum),
  );
}
