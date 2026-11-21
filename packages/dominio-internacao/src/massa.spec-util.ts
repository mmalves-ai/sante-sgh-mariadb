// Massa SINTÉTICA do motor da internação (testes): internações, trechos e unidades montados à mão, sem dado de
// pessoa (paciente é um número inventado). Datas ISO e horas "HH:MM".
import type {
  InternacaoMovimento,
  MovimentoInternacao,
  TrechoMovimento,
  TransferenciaMovimento,
  UnidadeMovimento,
} from '@sgh/contratos';

export const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Relógio de parede (ms) da data "AAAA-MM-DD" e da hora "HH:MM". */
export const em = (iso: string, hora = '00:00'): number =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) +
  (Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5))) * 60_000;

export const UNIDADES: UnidadeMovimento[] = [
  { bloco: '1', acomodacao: 'ENF', nome: 'Enfermaria', tipo: 1, leitos: 4, leitosAtivos: 4 },
  { bloco: '1', acomodacao: 'APTO', nome: 'Apartamentos', tipo: 2, leitos: 3, leitosAtivos: 2 },
  { bloco: '2', acomodacao: 'UTI', nome: 'Terapia intensiva', tipo: 3, leitos: 2, leitosAtivos: 2 },
];

export const TIPOS = new Map<number, string>([
  [0, 'Não informado'],
  [1, 'Enfermaria'],
  [2, 'Apartamento'],
  [3, 'U.T.I.'],
]);

let reg = 1000;

export interface Estada {
  readonly paciente?: number;
  readonly entrada: [string, string];
  readonly alta?: [string, string];
  readonly motivo?: number;
  readonly carater?: '1' | '2';
  readonly clinica?: 'M' | 'C';
  readonly permanencia?: number;
  /** Trechos: unidade, tipo, entrada [data, hora] e saída (ausente = em aberto). */
  readonly trechos?: readonly {
    readonly unidade: 'ENF' | 'APTO' | 'UTI';
    readonly tipo?: number;
    readonly de: [string, string];
    readonly ate?: [string, string];
    readonly leito?: string;
  }[];
}

const BLOCO: Record<string, string> = { ENF: '1', APTO: '1', UTI: '2' };
const TIPO: Record<string, number> = { ENF: 1, APTO: 2, UTI: 3 };

/** Monta o movimento de uma lista de estadas (cada uma vira uma internação e os trechos dela). */
export function movimento(
  estadas: readonly Estada[],
  extra: { transferencias?: TransferenciaMovimento[]; trechosSoltos?: TrechoMovimento[] } = {},
): MovimentoInternacao {
  const internacoes: InternacaoMovimento[] = [];
  const trechos: TrechoMovimento[] = [];
  let cod = 1;
  for (const e of estadas) {
    const r = ++reg;
    const ultimo = e.trechos?.[e.trechos.length - 1];
    internacoes.push({
      reg: r,
      paciente: e.paciente ?? r,
      bloco: BLOCO[ultimo?.unidade ?? 'ENF']!,
      acomodacao: ultimo?.unidade ?? 'ENF',
      leito: ultimo?.leito ?? '01',
      entrada: d(e.entrada[0]),
      horaEntrada: e.entrada[1],
      alta: e.alta ? d(e.alta[0]) : null,
      horaAlta: e.alta ? e.alta[1] : null,
      motivo: e.alta ? (e.motivo ?? 12) : null,
      carater: e.carater ?? '1',
      clinica: e.clinica ?? 'M',
      permanencia: e.permanencia ?? null,
    });
    for (const t of e.trechos ?? []) {
      trechos.push({
        reg: r,
        cod: cod++,
        bloco: BLOCO[t.unidade]!,
        acomodacao: t.unidade,
        leito: t.leito ?? '01',
        entrada: d(t.de[0]),
        horaEntrada: t.de[1],
        saida: t.ate ? d(t.ate[0]) : null,
        horaSaida: t.ate ? t.ate[1] : null,
        tipo: t.tipo ?? TIPO[t.unidade]!,
      });
    }
  }
  return {
    internacoes,
    trechos: [...trechos, ...(extra.trechosSoltos ?? [])],
    transferencias: extra.transferencias ?? [],
    unidades: UNIDADES,
    tipos: TIPOS,
    dadosAte: d('2026-07-05'),
  };
}
