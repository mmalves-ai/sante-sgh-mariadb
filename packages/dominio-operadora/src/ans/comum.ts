// Peças comuns dos envios à ANS (M56, etapa 7, F6): o período de cada competência, o XML mínimo dos leiautes (sem
// biblioteca: elementos com texto escapado), o nome do arquivo, os valores em emCentavos, o problema com a mensagem e o
// plano de geração (o sequencial e o que o novo arquivo substitui). Puro: sem banco, sem relógio, sem hash (o SHA-256
// sai na API).
import {
  MENSAGENS_ANS,
  OBRIGACOES_ANS,
  type ObrigacaoAns,
  type ProblemaAns,
  type SituacaoEnvioAns,
} from '@sgh/contratos';
import { competenciaValida } from './envio.js';

export interface Periodo {
  readonly inicio: string;
  readonly fim: string;
}

const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const dois = (n: number) => String(n).padStart(2, '0');

/** Período coberto pela competência (mensal: o mês; trimestral: os três meses; sob demanda: o dia). */
export function periodoDaCompetencia(obrigacao: ObrigacaoAns, competencia: string): Periodo {
  if (!competenciaValida(obrigacao, competencia)) throw new Error(`Competência inválida: ${competencia}`);
  const per = OBRIGACOES_ANS[obrigacao].periodicidade;
  const a = Number(competencia.slice(0, 4));
  if (per === 'mensal') {
    const m = Number(competencia.slice(5, 7));
    return { inicio: `${a}-${dois(m)}-01`, fim: `${a}-${dois(m)}-${dois(ultimoDia(a, m))}` };
  }
  if (per === 'trimestral') {
    const t = Number(competencia.slice(6));
    const m1 = (t - 1) * 3 + 1;
    const m3 = m1 + 2;
    return { inicio: `${a}-${dois(m1)}-01`, fim: `${a}-${dois(m3)}-${dois(ultimoDia(a, m3))}` };
  }
  return { inicio: competencia, fim: competencia };
}

/** Os meses (AAAA-MM) do período, com o último dia de cada um. */
export function mesesDoPeriodo(p: Periodo): { mes: string; ultimoDia: string }[] {
  const r: { mes: string; ultimoDia: string }[] = [];
  let a = Number(p.inicio.slice(0, 4));
  let m = Number(p.inicio.slice(5, 7));
  const fim = p.fim.slice(0, 7);
  for (;;) {
    const mes = `${a}-${dois(m)}`;
    r.push({ mes, ultimoDia: `${mes}-${dois(ultimoDia(a, m))}` });
    if (mes >= fim) break;
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
  return r;
}

/** A competência terminou antes de hoje (o arquivo só sai com o período fechado; o sob demanda vale no dia). */
export function competenciaEncerrada(obrigacao: ObrigacaoAns, competencia: string, hoje: string): boolean {
  const p = periodoDaCompetencia(obrigacao, competencia);
  return OBRIGACOES_ANS[obrigacao].periodicidade === 'sob demanda' ? p.fim <= hoje : p.fim < hoje;
}

// ── Valores ─────────────────────────────────────────────────────────────────────────────────────

export const emCentavos = (v: number): number => Math.round(v * 100);
export const deCentavos = (c: number): number => Math.round(c) / 100;
/** Texto do valor no arquivo (ponto decimal, duas casas). */
export const valorNoArquivo = (v: number): string => (Math.round(v * 100) / 100).toFixed(2);

// ── Problemas ───────────────────────────────────────────────────────────────────────────────────

export function problema(
  codigo: string,
  alcance: ProblemaAns['alcance'] = 'arquivo',
  referencia: string | null = null,
): ProblemaAns {
  return { codigo, alcance, referencia, mensagem: MENSAGENS_ANS[codigo] ?? codigo };
}

export const bloqueiaArquivo = (ps: readonly ProblemaAns[]): boolean =>
  ps.some((p) => p.alcance === 'arquivo');

// ── XML mínimo ──────────────────────────────────────────────────────────────────────────────────

export function escaparXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export type NoXml = string | number | boolean | null | undefined | readonly NoXml[] | ElementoXml;

export interface ElementoXml {
  readonly nome: string;
  readonly atributos?: Readonly<Record<string, string | number>>;
  readonly filhos: readonly NoXml[];
}

/** Elemento; filho nulo ou indefinido some (campo opcional sem valor não vai ao arquivo). */
export const el = (
  nome: string,
  filhos: NoXml | readonly NoXml[] = [],
  atributos?: Readonly<Record<string, string | number>>,
): ElementoXml => ({
  nome,
  filhos: Array.isArray(filhos) ? (filhos as readonly NoXml[]) : [filhos as NoXml],
  ...(atributos ? { atributos } : {}),
});

/** Elemento opcional: só sai com valor. */
export const opcional = (nome: string, v: string | number | null | undefined): ElementoXml | null =>
  v === null || v === undefined || v === '' ? null : el(nome, v);

function serializar(n: NoXml, nivel: number, saida: string[]): void {
  if (n === null || n === undefined) return;
  if (Array.isArray(n)) {
    for (const x of n as readonly NoXml[]) serializar(x, nivel, saida);
    return;
  }
  const recuo = '  '.repeat(nivel);
  if (typeof n !== 'object') {
    saida.push(`${recuo}${escaparXml(String(n))}`);
    return;
  }
  const e = n as ElementoXml;
  const attrs = Object.entries(e.atributos ?? {})
    .map(([k, v]) => ` ${k}="${escaparXml(String(v))}"`)
    .join('');
  const filhos = e.filhos.filter((f) => f !== null && f !== undefined && f !== '');
  if (filhos.length === 0) {
    saida.push(`${recuo}<${e.nome}${attrs}/>`);
    return;
  }
  if (filhos.every((f) => typeof f !== 'object')) {
    saida.push(`${recuo}<${e.nome}${attrs}>${filhos.map((f) => escaparXml(String(f))).join('')}</${e.nome}>`);
    return;
  }
  saida.push(`${recuo}<${e.nome}${attrs}>`);
  for (const f of filhos) serializar(f, nivel + 1, saida);
  saida.push(`${recuo}</${e.nome}>`);
}

/** Documento XML em UTF-8, com uma linha por elemento (o arquivo é lido por gente na conferência). */
export function documentoXml(raiz: ElementoXml): string {
  const saida = ['<?xml version="1.0" encoding="UTF-8"?>'];
  serializar(raiz, 0, saida);
  return `${saida.join('\n')}\n`;
}

// ── Nome do arquivo e plano da geração ──────────────────────────────────────────────────────────

/** Nome do arquivo: obrigação, registro da operadora, competência sem traços e o sequencial. */
export function nomeArquivoAns(
  obrigacao: ObrigacaoAns,
  registroAns: string,
  competencia: string,
  sequencial: number,
): string {
  const prefixo =
    obrigacao === 'MONITORAMENTO_TISS' ? 'MON' : obrigacao === 'RESSARCIMENTO_SUS' ? 'RES' : obrigacao;
  return `${prefixo}_${registroAns}_${competencia.replace(/-/g, '')}_${String(sequencial).padStart(3, '0')}.xml`;
}

export interface EnvioExistente {
  readonly id: number;
  readonly obrigacao: ObrigacaoAns;
  readonly competencia: string;
  readonly sequencial: number;
  readonly situacao: SituacaoEnvioAns;
}

export type PlanoGeracao =
  | { readonly recusa: string }
  | {
      readonly recusa: null;
      readonly sequencial: number;
      readonly substituir: readonly number[];
      readonly retificador: boolean;
    };

/**
 * O que a geração faz com os envios já existentes da operadora: o arquivo enviado e sem retorno impede outro (a ANS
 * ainda não respondeu); o só gerado (não enviado) é substituído; o aceito faz do novo um retificador. No SIB, a regra
 * vale para a operadora inteira (os movimentos são contra o último aceito, de qualquer competência).
 */
export function planoDaGeracao(
  obrigacao: ObrigacaoAns,
  competencia: string,
  existentes: readonly EnvioExistente[],
): PlanoGeracao {
  const mesmos = existentes.filter(
    (e) => e.obrigacao === obrigacao && (obrigacao === 'SIB' || e.competencia === competencia),
  );
  if (mesmos.some((e) => e.situacao === 'enviado')) return { recusa: 'aguardando-retorno' };
  const daCompetencia = mesmos.filter((e) => e.competencia === competencia);
  const sequencial = daCompetencia.reduce((m, e) => Math.max(m, e.sequencial), 0) + 1;
  return {
    recusa: null,
    sequencial,
    substituir: mesmos.filter((e) => e.situacao === 'gerado').map((e) => e.id),
    retificador:
      obrigacao !== 'SIB' &&
      daCompetencia.some((e) => e.situacao === 'aceito' || e.situacao === 'aceitoParcial'),
  };
}
