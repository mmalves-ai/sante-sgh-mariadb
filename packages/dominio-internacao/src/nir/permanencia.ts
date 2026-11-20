// Quadro de permanência, alta prevista (DPA) e calibragem dos limites (M44, etapa 2; ficha, regra 13; cap-05a §5.4;
// ref 01 §2.4): a cor de cada internado — verde dentro do previsto, amarelo no dia anterior à DPA (ou no limite
// amarelo), vermelho com a DPA vencida (ou no limite vermelho) — com os dias contados pela Portaria 312 (o dia da saída
// não conta; a entrada e a saída no mesmo dia contam um), NUNCA pelas diárias faturáveis gravadas no sistema anterior
// (que contam a entrada e a alta e dão um dia a mais em boa parte das internações). A terapia intensiva sai da
// trajetória (os trechos nos tipos de acomodação intensivos), não da acomodação atual. Os limites vêm do mais específico
// (procedimento, CID, clínica) ao padrão do estabelecimento; a calibragem propõe o amarelo no percentil 75 e o vermelho
// no 90 da permanência histórica, com as duas réguas lado a lado. Regras puras.
import type { CorPermanencia, EscopoLimitePermanencia } from '@sgh/contratos';
import { permanenciaPortaria312 } from '../adt.js';

const dia = (iso: string) => iso.slice(0, 10);
const somaDias = (iso: string, n: number) => {
  const d = new Date(`${dia(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Dias de permanência do internado até hoje, pela Portaria 312 (a entrada hoje conta um). */
export function diasInternado312(entrada: string, hoje: string): number {
  return permanenciaPortaria312(dia(entrada), dia(hoje));
}

/** Dias em terapia intensiva pela trajetória: a soma dos trechos nos tipos intensivos (o trecho aberto vai até hoje). */
export function diasUtiPelaTrajetoria(
  trechos: readonly { tipo: number; entrada: string; saida: string | null }[],
  intensivas: readonly number[],
  hoje: string,
): number {
  let total = 0;
  for (const t of trechos) {
    if (!intensivas.includes(t.tipo)) continue;
    const fim = t.saida && !t.saida.startsWith('1899-12-30') ? dia(t.saida) : dia(hoje);
    const d = Math.round(
      (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${dia(t.entrada)}T00:00:00Z`)) / 86_400_000,
    );
    // O trecho que começa e termina no mesmo dia conta um dia (como a Portaria 312).
    if (Number.isFinite(d) && d >= 0) total += d === 0 ? 1 : d;
  }
  return total;
}

export interface LimitePermanencia {
  readonly escopo: EscopoLimitePermanencia | 'padrao';
  readonly chave: string;
  readonly amareloDias: number;
  readonly vermelhoDias: number;
  readonly origem: string;
}

/** O limite que vale para o internado: procedimento, depois CID, depois clínica, depois o padrão do estabelecimento. */
export function limiteAplicavel(
  limites: readonly LimitePermanencia[],
  i: { procedimento: string | null; cid: string | null; clinica: string | null },
  padrao: { amareloDias: number; vermelhoDias: number },
): LimitePermanencia {
  const achar = (escopo: EscopoLimitePermanencia, chave: string | null) =>
    chave ? limites.find((l) => l.escopo === escopo && l.chave === chave.trim().toUpperCase()) : undefined;
  return (
    achar('procedimento', i.procedimento) ??
    achar('cid', i.cid) ??
    achar('clinica', i.clinica) ?? { escopo: 'padrao', chave: '', ...padrao, origem: 'padrao' }
  );
}

const PESO: Readonly<Record<CorPermanencia, number>> = { verde: 0, amarelo: 1, vermelho: 2 };

/**
 * A cor do internado: a pior entre a da DPA (vencida → vermelho; hoje ou amanhã → amarelo) e a do limite (dias312 no
 * vermelho → vermelho; no amarelo → amarelo). O motivo diz qual das duas decidiu (o quadro mostra).
 */
export function corPermanencia(i: {
  hoje: string;
  dpa: string | null;
  dias312: number;
  limite: { amareloDias: number; vermelhoDias: number };
}): { cor: CorPermanencia; motivo: string } {
  let cor: CorPermanencia = 'verde';
  let motivo = i.dpa ? 'Dentro do previsto.' : 'Sem alta prevista registrada; dentro do limite.';
  const hoje = dia(i.hoje);
  if (i.dpa) {
    const dpa = dia(i.dpa);
    if (dpa < hoje) {
      cor = 'vermelho';
      motivo = 'Alta prevista vencida.';
    } else if (dpa === hoje || dpa === somaDias(hoje, 1)) {
      cor = 'amarelo';
      motivo = dpa === hoje ? 'Alta prevista para hoje.' : 'Alta prevista para amanhã.';
    }
  }
  const pelo: CorPermanencia =
    i.dias312 >= i.limite.vermelhoDias ? 'vermelho' : i.dias312 >= i.limite.amareloDias ? 'amarelo' : 'verde';
  if (PESO[pelo] > PESO[cor]) {
    cor = pelo;
    motivo =
      pelo === 'vermelho'
        ? `Permanência de ${i.dias312} dias, no limite vermelho (${i.limite.vermelhoDias}).`
        : `Permanência de ${i.dias312} dias, no limite amarelo (${i.limite.amareloDias}).`;
  }
  return { cor, motivo };
}

/** A barreira com o prazo vencido e ainda aberta. */
export function barreiraVencida(b: { situacao: string; prazo: string }, hoje: string): boolean {
  return b.situacao === 'aberta' && dia(b.prazo) < dia(hoje);
}

// ── Calibragem dos limites (duas réguas) ───────────────────────────────────────────────────────────

/** Linha agregada no banco: chave (clínica, CID ou procedimento), dias e quantas internações tiveram esses dias. */
export interface HistogramaPermanencia {
  readonly chave: string;
  readonly dias: number;
  readonly n: number;
}

export interface Regua {
  readonly n: number;
  readonly p50: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
  readonly media: number | null;
}

/** Percentil pelo método do posto mais próximo (o menor valor com ao menos p% da amostra até ele). */
function percentil(linhas: readonly { dias: number; n: number }[], total: number, p: number): number | null {
  if (total === 0) return null;
  const alvo = Math.ceil((p / 100) * total);
  let acumulado = 0;
  for (const l of [...linhas].sort((a, b) => a.dias - b.dias)) {
    acumulado += l.n;
    if (acumulado >= alvo) return l.dias;
  }
  return null;
}

/** A régua de uma chave a partir do histograma (só contagens agregadas: nenhuma internação individual). */
export function regua(linhas: readonly { dias: number; n: number }[]): Regua {
  const validas = linhas.filter((l) => l.n > 0 && l.dias >= 0);
  const n = validas.reduce((s, l) => s + l.n, 0);
  if (n === 0) return { n: 0, p50: null, p75: null, p90: null, media: null };
  const soma = validas.reduce((s, l) => s + l.dias * l.n, 0);
  return {
    n,
    p50: percentil(validas, n, 50),
    p75: percentil(validas, n, 75),
    p90: percentil(validas, n, 90),
    media: Math.round((soma / n) * 10) / 10,
  };
}

/** A proposta de limite pela régua da Portaria 312: amarelo no p75, vermelho no p90 (sempre maior que o amarelo). */
export function propostaDeLimite(
  r: Regua,
  amostraMinima: number,
): { amareloDias: number; vermelhoDias: number } | null {
  if (r.n < amostraMinima || r.p75 === null || r.p90 === null) return null;
  const amarelo = Math.max(1, r.p75);
  return { amareloDias: amarelo, vermelhoDias: Math.max(amarelo + 1, r.p90) };
}

/** As réguas por chave, lado a lado (Portaria 312, diárias faturáveis e terapia intensiva). */
export function calibrar(
  h: {
    portaria312: readonly HistogramaPermanencia[];
    diariasFaturaveis: readonly HistogramaPermanencia[];
    uti: readonly HistogramaPermanencia[];
  },
  amostraMinima: number,
): {
  chave: string;
  portaria312: Regua;
  diariasFaturaveis: Regua;
  uti: Regua;
  proposta: { amareloDias: number; vermelhoDias: number } | null;
}[] {
  const chaves = [...new Set(h.portaria312.map((x) => x.chave))].sort();
  const de = (lista: readonly HistogramaPermanencia[], c: string) => lista.filter((x) => x.chave === c);
  return chaves.map((chave) => {
    const p312 = regua(de(h.portaria312, chave));
    return {
      chave,
      portaria312: p312,
      diariasFaturaveis: regua(de(h.diariasFaturaveis, chave)),
      uti: regua(de(h.uti, chave)),
      proposta: propostaDeLimite(p312, amostraMinima),
    };
  });
}
