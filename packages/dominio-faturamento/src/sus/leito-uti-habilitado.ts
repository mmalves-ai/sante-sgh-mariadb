// Leitos de UTI habilitados pelo SUS e diárias de UTI por competência (F7, 06-SUS linha 59). Regras puras:
//   - o cadastro dos leitos habilitados por tipo de UTI, unidade e vigência: a vigência começa no primeiro dia de uma
//     competência e termina no último dia de uma competência (ou fica aberta); a quantidade é positiva; duas
//     habilitações ativas do mesmo tipo e unidade não se sobrepõem. A nova quantidade a partir de uma competência
//     encerra a habilitação aberta anterior no último dia da competência anterior (um passo só, nada apagado);
//   - as diárias de UTI da trajetória separadas por competência (cada noite conta na competência do dia em que
//     começa; a entrada e a saída no mesmo dia contam 1), para guardar a diária por competência;
//   - a classe da UTI (adulto, pediátrica, neonatal, queimados, coronariana, intermediária) e o nível (I, II, III) pela
//     descrição do tipo de UTI do SIH (sistema de informações hospitalares do SUS);
//   - a habilitação vigente do tipo na competência (a diária aponta a habilitação que a cobre).
import { ACOMODACOES_UTI, type PassagemLeito, type UtiDaAcomodacao } from './aih.js';

export interface ProblemaLeitoUti {
  readonly campo: string;
  readonly mensagem: string;
}

/** Uma habilitação já gravada (para a crítica de sobreposição e a vigente da competência). */
export interface HabilitacaoUtiVigencia {
  readonly id: number;
  readonly tipo: number;
  readonly unidade: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

export interface NovaHabilitacaoUti {
  readonly tipo: number;
  readonly unidade: number | null;
  readonly quantidadeLeitos: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;
const valida = (d: string) => DIA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const somarDias = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const dias = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);
const primeiroDoMesSeguinte = (d: string) => {
  const [a, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
};
/** O último dia da competência da data. */
export const ultimoDiaDaCompetencia = (d: string) => somarDias(primeiroDoMesSeguinte(d), -1);
const sobrepoe = (a: { i: string; f: string | null }, b: { i: string; f: string | null }) =>
  (a.f === null || a.f >= b.i) && (b.f === null || b.f >= a.i);

/** A quantidade máxima de leitos de uma habilitação (coluna SMALLINT; nenhum hospital passa disso). */
export const MAXIMO_LEITOS_UTI = 9999;

/**
 * Confere a inclusão (ou a alteração, com `proprio`) de uma habilitação. Devolve os problemas e, na inclusão, a
 * habilitação aberta anterior do mesmo tipo e unidade que a nova encerra (fim = véspera do início da nova).
 */
export function conferirHabilitacaoUti(
  nova: NovaHabilitacaoUti,
  existentes: readonly HabilitacaoUtiVigencia[],
  proprio: number | null = null,
): { problemas: ProblemaLeitoUti[]; encerrar: { id: number; vigenciaFim: string } | null } {
  const p: ProblemaLeitoUti[] = [];
  if (!Number.isInteger(nova.quantidadeLeitos) || nova.quantidadeLeitos < 1)
    p.push({ campo: 'quantidadeLeitos', mensagem: 'Informe ao menos um leito habilitado.' });
  else if (nova.quantidadeLeitos > MAXIMO_LEITOS_UTI)
    p.push({ campo: 'quantidadeLeitos', mensagem: `No máximo ${MAXIMO_LEITOS_UTI} leitos por habilitação.` });
  if (!valida(nova.vigenciaInicio) || nova.vigenciaInicio.slice(8) !== '01')
    p.push({ campo: 'vigenciaInicio', mensagem: 'A vigência começa no primeiro dia de uma competência.' });
  if (nova.vigenciaFim !== null) {
    if (!valida(nova.vigenciaFim) || ultimoDiaDaCompetencia(nova.vigenciaFim) !== nova.vigenciaFim)
      p.push({ campo: 'vigenciaFim', mensagem: 'A vigência termina no último dia de uma competência.' });
    else if (valida(nova.vigenciaInicio) && nova.vigenciaFim < nova.vigenciaInicio)
      p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência é anterior ao início.' });
  }
  if (p.length) return { problemas: p, encerrar: null };
  const mesmas = existentes.filter(
    (x) => x.ativo && x.id !== proprio && x.tipo === nova.tipo && x.unidade === nova.unidade,
  );
  // A nova quantidade a partir de uma competência: a aberta que começou antes é encerrada na véspera.
  const aberta =
    proprio === null
      ? (mesmas.find((x) => x.vigenciaFim === null && x.vigenciaInicio < nova.vigenciaInicio) ?? null)
      : null;
  const encerrar = aberta ? { id: aberta.id, vigenciaFim: somarDias(nova.vigenciaInicio, -1) } : null;
  const nv = { i: nova.vigenciaInicio, f: nova.vigenciaFim };
  const conflito = mesmas.find((x) =>
    sobrepoe(nv, { i: x.vigenciaInicio, f: x.id === aberta?.id ? encerrar!.vigenciaFim : x.vigenciaFim }),
  );
  if (conflito)
    p.push({
      campo: 'vigenciaInicio',
      mensagem: `Já há leitos deste tipo e unidade habilitados de ${conflito.vigenciaInicio} a ${conflito.vigenciaFim ?? 'hoje'}.`,
    });
  return { problemas: p, encerrar: p.length ? null : encerrar };
}

/** A habilitação ativa do tipo que cobre o primeiro dia da competência (AAAAMM); null sem nenhuma. */
export function habilitacaoUtiDaCompetencia(
  lista: readonly HabilitacaoUtiVigencia[],
  tipo: number,
  competencia: string,
): number | null {
  const dia = `${competencia.slice(0, 4)}-${competencia.slice(4, 6)}-01`;
  const fim = ultimoDiaDaCompetencia(dia);
  const x = lista
    .filter(
      (h) =>
        h.ativo && h.tipo === tipo && sobrepoe({ i: dia, f: fim }, { i: h.vigenciaInicio, f: h.vigenciaFim }),
    )
    .sort((a, b) => a.vigenciaInicio.localeCompare(b.vigenciaInicio) || a.id - b.id);
  return x[0]?.id ?? null;
}

// ── Diárias por competência ──────────────────────────────────────────────────────────────────────────

export interface DiariaUtiCompetencia {
  readonly tipo: number;
  readonly procedimento: string;
  /** AAAAMM. */
  readonly competencia: string;
  readonly dataEntrada: string;
  readonly dataSaida: string;
  readonly diarias: number;
}

/**
 * As diárias de UTI da trajetória por competência: cada passagem numa acomodação de UTI com tipo do SIH é partida
 * nos meses que atravessa (a noite conta no mês em que começa); a passagem sem saída vai até a alta; sem alta e sem
 * saída, não conta (como na montagem). A soma por tipo é a mesma de `diariasUtiDaTrajetoria`.
 */
export function diariasUtiPorCompetencia(
  passagens: readonly PassagemLeito[],
  mapa: ReadonlyMap<number, UtiDaAcomodacao>,
  alta: string | null,
): DiariaUtiCompetencia[] {
  const saida: DiariaUtiCompetencia[] = [];
  for (const p of passagens) {
    if (!ACOMODACOES_UTI.has(p.acomodacao)) continue;
    const u = mapa.get(p.acomodacao);
    const fim = p.saida ?? alta;
    if (!u || !fim || !valida(p.entrada) || !valida(fim) || fim < p.entrada) continue;
    if (fim === p.entrada) {
      saida.push({ ...u, competencia: comp(p.entrada), dataEntrada: p.entrada, dataSaida: fim, diarias: 1 });
      continue;
    }
    let inicio = p.entrada;
    while (inicio < fim) {
      const proximo = primeiroDoMesSeguinte(inicio);
      const ate = proximo < fim ? proximo : fim;
      saida.push({
        ...u,
        competencia: comp(inicio),
        dataEntrada: inicio,
        dataSaida: ate,
        diarias: dias(inicio, ate),
      });
      inicio = ate;
    }
  }
  return saida.sort(
    (a, b) =>
      a.dataEntrada.localeCompare(b.dataEntrada) ||
      a.tipo - b.tipo ||
      a.competencia.localeCompare(b.competencia),
  );
}
const comp = (d: string) => `${d.slice(0, 4)}${d.slice(5, 7)}`;

// ── Classe da UTI ────────────────────────────────────────────────────────────────────────────────────

export type ClasseUtiSus =
  'adulto' | 'pediatrica' | 'neonatal' | 'queimados' | 'coronariana' | 'intermediaria';

const ROMANOS: Readonly<Record<string, number>> = { I: 1, II: 2, III: 3 };

/** A classe e o nível da UTI pela descrição do tipo (null quando a descrição não diz a classe). */
export function classeDaUtiSus(descricao: string): { classe: ClasseUtiSus; nivel: number | null } | null {
  const d = descricao.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const classe: ClasseUtiSus | null = /INTERMEDI/.test(d)
    ? 'intermediaria'
    : /QUEIMAD/.test(d)
      ? 'queimados'
      : /CORONAR|\bUCO\b/.test(d)
        ? 'coronariana'
        : /NEONAT/.test(d)
          ? 'neonatal'
          : /PEDIATR|INFANTIL/.test(d)
            ? 'pediatrica'
            : /ADULT/.test(d)
              ? 'adulto'
              : null;
  if (!classe) return null;
  const m = /\b(?:TIPO|NIVEL)?\s*(III|II|I|[123])\b(?!.*\b(?:III|II|I|[123])\b)/.exec(
    d.replace(/\(.*?\)/g, ' '),
  );
  const n = m?.[1];
  const nivel = n ? (ROMANOS[n] ?? Number(n)) : null;
  return { classe, nivel: nivel && nivel >= 1 && nivel <= 3 ? nivel : null };
}
