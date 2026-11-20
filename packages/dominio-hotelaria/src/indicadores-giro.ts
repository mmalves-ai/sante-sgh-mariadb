// Indicadores de higienização e giro de leito (W0-07, M3; mercado: tempo de turnaround do leito e cumprimento do SLA
// da limpeza): calculados só sobre as etapas já gravadas (SGH_HOT_LIMPEZA_ETAPA) e a hora da solicitação. Cada valor
// sai com o numerador e o denominador impressos (a conta se confere na tela e no CSV), no total e por tipo de limpeza,
// área (bloco do leito) e profissional. Regras puras: sem banco, sem HTTP.
import type { EtapaLimpeza } from '@sgh/contratos';
import { minutosEmExecucao } from './limpeza.js';

/** Os códigos dos indicadores (os mesmos das fichas no catálogo de indicadores da qualidade). */
export const INDICADORES_GIRO = ['tempoGiroLeito', 'higienizacaoNoPrazo', 'tempoExecucaoLimpeza'] as const;
export type CodigoIndicadorGiro = (typeof INDICADORES_GIRO)[number];

export const NOMES_INDICADOR_GIRO: Readonly<Record<CodigoIndicadorGiro, string>> = {
  tempoGiroLeito: 'Tempo médio de giro do leito (solicitação da limpeza até o leito liberado)',
  higienizacaoNoPrazo: 'Higienizações liberadas dentro do prazo',
  tempoExecucaoLimpeza: 'Tempo médio de execução da limpeza (sem as pausas)',
};

export const RECORTES_GIRO = ['total', 'tipo', 'area', 'profissional'] as const;
export type RecorteGiro = (typeof RECORTES_GIRO)[number];

/** Uma etapa gravada da limpeza (a linha de SGH_HOT_LIMPEZA_ETAPA). */
export interface EtapaGravadaGiro {
  readonly etapa: EtapaLimpeza;
  readonly em: string;
  readonly prazo: string | null;
  readonly tipoLimpeza: number | null;
  readonly profissional: number | null;
}

/** A solicitação de limpeza com as etapas (em ordem de gravação). */
export interface LimpezaDoPeriodo {
  readonly solicitacao: number;
  readonly solicitadaEm: string;
  /** A área do leito (o bloco). */
  readonly area: string;
  readonly etapas: readonly EtapaGravadaGiro[];
}

/** A limpeza liberada, apurada: os minutos de giro e de execução, o prazo e as chaves dos recortes. */
export interface LimpezaApurada {
  readonly solicitacao: number;
  readonly minutosGiro: number;
  readonly minutosExecucao: number;
  /** null: sem prazo gravado (fica fora do denominador do percentual no prazo). */
  readonly noPrazo: boolean | null;
  readonly tipo: number | null;
  readonly area: string;
  readonly profissional: number | null;
}

const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
const ultimoCom = <K extends 'prazo' | 'tipoLimpeza' | 'profissional'>(
  etapas: readonly EtapaGravadaGiro[],
  k: K,
): EtapaGravadaGiro[K] | null =>
  [...etapas].reverse().find((e) => e[k] !== null && e[k] !== undefined)?.[k] ?? null;

/**
 * Apura a limpeza liberada no período [de, ate] (datas AAAA-MM-DD; vale a primeira etapa 'liberado'). A não liberada,
 * a cancelada ou a liberada fora do período não entra (null).
 */
export function apurarLimpeza(l: LimpezaDoPeriodo, de: string, ate: string): LimpezaApurada | null {
  const liberada = l.etapas.find((e) => e.etapa === 'liberado');
  if (!liberada) return null;
  const dia = liberada.em.slice(0, 10);
  if (dia < de || dia > ate) return null;
  const fim = ms(liberada.em);
  const prazo = ultimoCom(l.etapas, 'prazo');
  return {
    solicitacao: l.solicitacao,
    minutosGiro: Math.max(0, Math.round((fim - ms(l.solicitadaEm)) / 60_000)),
    minutosExecucao: minutosEmExecucao(
      l.etapas.map((e) => ({ etapa: e.etapa, em: ms(e.em) })),
      fim,
    ),
    noPrazo: prazo === null ? null : fim <= ms(prazo),
    tipo: ultimoCom(l.etapas, 'tipoLimpeza'),
    area: l.area,
    profissional: ultimoCom(l.etapas, 'profissional'),
  };
}

/** Uma linha exportável: o indicador num recorte, com numerador, denominador e valor. */
export interface LinhaIndicadorGiro {
  readonly codigo: CodigoIndicadorGiro;
  readonly indicador: string;
  readonly recorte: RecorteGiro;
  /** A chave do recorte ('' no total) e o rótulo mostrado. */
  readonly chave: string;
  readonly rotulo: string;
  readonly numerador: number;
  readonly denominador: number;
  readonly valor: number | null;
  readonly unidade: 'minutos' | 'percentual';
}

const razao = (n: number, d: number, fator = 1) => (d === 0 ? null : Math.round(((n * fator) / d) * 10) / 10);

/** Os três indicadores de um grupo de limpezas apuradas. */
export function valoresGiro(
  itens: readonly LimpezaApurada[],
): Record<CodigoIndicadorGiro, { numerador: number; denominador: number; valor: number | null }> {
  const giro = itens.reduce((s, x) => s + x.minutosGiro, 0);
  const execucao = itens.reduce((s, x) => s + x.minutosExecucao, 0);
  const comPrazo = itens.filter((x) => x.noPrazo !== null);
  const noPrazo = comPrazo.filter((x) => x.noPrazo === true).length;
  return {
    tempoGiroLeito: { numerador: giro, denominador: itens.length, valor: razao(giro, itens.length) },
    higienizacaoNoPrazo: {
      numerador: noPrazo,
      denominador: comPrazo.length,
      valor: razao(noPrazo, comPrazo.length, 100),
    },
    tempoExecucaoLimpeza: {
      numerador: execucao,
      denominador: itens.length,
      valor: razao(execucao, itens.length),
    },
  };
}

export interface NomesGiro {
  readonly tipo?: (codigo: number) => string;
  readonly area?: (codigo: string) => string;
  readonly profissional?: (codigo: number) => string;
}

/** As linhas de todos os indicadores: o total, depois por tipo, área e profissional (ordenados pelo rótulo). */
export function linhasIndicadoresGiro(
  itens: readonly LimpezaApurada[],
  nomes: NomesGiro = {},
): LinhaIndicadorGiro[] {
  const grupos: { recorte: RecorteGiro; chave: string; rotulo: string; itens: LimpezaApurada[] }[] = [
    { recorte: 'total', chave: '', rotulo: 'Total', itens: [...itens] },
  ];
  const agrupar = (
    recorte: RecorteGiro,
    chaveDe: (x: LimpezaApurada) => string,
    rotulo: (k: string) => string,
  ) => {
    const m = new Map<string, LimpezaApurada[]>();
    for (const x of itens) m.set(chaveDe(x), [...(m.get(chaveDe(x)) ?? []), x]);
    grupos.push(
      ...[...m.entries()]
        .map(([chave, g]) => ({ recorte, chave, rotulo: rotulo(chave), itens: g }))
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    );
  };
  const sem = 'Não informado';
  agrupar(
    'tipo',
    (x) => (x.tipo === null ? '' : String(x.tipo)),
    (k) => (k === '' ? sem : (nomes.tipo?.(Number(k)) ?? `Tipo ${k}`)),
  );
  agrupar(
    'area',
    (x) => x.area,
    (k) => (k === '' ? sem : (nomes.area?.(k) ?? k)),
  );
  agrupar(
    'profissional',
    (x) => (x.profissional === null ? '' : String(x.profissional)),
    (k) => (k === '' ? sem : (nomes.profissional?.(Number(k)) ?? `Profissional ${k}`)),
  );
  const linhas: LinhaIndicadorGiro[] = [];
  for (const codigo of INDICADORES_GIRO)
    for (const g of grupos) {
      const v = valoresGiro(g.itens)[codigo];
      linhas.push({
        codigo,
        indicador: NOMES_INDICADOR_GIRO[codigo],
        recorte: g.recorte,
        chave: g.chave,
        rotulo: g.rotulo,
        ...v,
        unidade: codigo === 'higienizacaoNoPrazo' ? 'percentual' : 'minutos',
      });
    }
  return linhas;
}

const ROTULO_RECORTE: Readonly<Record<RecorteGiro, string>> = {
  total: 'Total',
  tipo: 'Tipo de limpeza',
  area: 'Área',
  profissional: 'Profissional',
};

/** O CSV (separador ';', vírgula decimal) com o período, o recorte, o numerador, o denominador e o valor. */
export function csvIndicadoresGiro(
  periodo: { de: string; ate: string },
  linhas: readonly LinhaIndicadorGiro[],
): string {
  const cel = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const tabela = [
    ['Início', 'Fim', 'Indicador', 'Recorte', 'Grupo', 'Numerador', 'Denominador', 'Valor', 'Unidade'],
    ...linhas.map((l) => [
      periodo.de,
      periodo.ate,
      l.indicador,
      ROTULO_RECORTE[l.recorte],
      l.rotulo,
      String(l.numerador),
      String(l.denominador),
      l.valor === null ? '' : String(l.valor).replace('.', ','),
      l.unidade === 'percentual' ? '%' : 'minutos',
    ]),
  ];
  return tabela.map((l) => `${l.map(cel).join(';')}\r\n`).join('');
}
