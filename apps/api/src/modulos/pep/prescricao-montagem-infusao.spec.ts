// C2-087: o serviço da prescrição passa à montagem a conversão da unidade de velocidade de infusão em mL/h pela
// sigla do cadastro (mL/h, gotas/min). A duração de cada etapa da solução sai do volume ÷ (velocidade × fator):
// 500 mL a 125 mL/h duram 240 min; 500 mL a 42 gotas/min (126 mL/h) duram 238 min.
import { esquemaItemPrescricao, type ItemPrescricao } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { ContextoPrescricao, PortaPrescricao } from './prescricao-porta.js';
import { ServicoPrescricao } from './prescricao-servico.js';

const porta = {
  relativos: async () => [],
  horariosDieta: async () => new Map<number, string[]>(),
  kits: async () => [],
  dominios: async () => ({
    unidadesInfusao: [
      { id: '1', nome: 'mL/h' },
      { id: '2', nome: 'gts/min' },
      { id: '3', nome: 'mg/kg/min' },
    ],
  }),
} as unknown as PortaPrescricao;

type Montar = (
  c: ContextoPrescricao,
  a: { tipo: string },
  vigencia: { inicio: string; fim: string },
  grade: ReadonlyMap<number, readonly string[]>,
  itens: readonly ItemPrescricao[],
  agora: string,
) => Promise<{ detalhe: { tipo: string; etapas?: { inicio: string; fim: string; volume: number }[] } }[]>;

const solucao = (unidadeInfusao: number, velocidade: number): ItemPrescricao =>
  esquemaItemPrescricao.parse({
    chave: `s${unidadeInfusao}`,
    detalhe: {
      tipo: 'solucao',
      via: 'EV',
      frequencia: null,
      componentes: [{ produto: 504, dose: 500, unidade: 'ML', principal: true }],
      etapas: [{ etapa: 1, velocidade, unidadeInfusao }],
    },
  });

const minutos = (civil: string) => Math.round(Date.parse(`${civil.slice(0, 16)}:00Z`) / 60_000);

describe('montagem da solução pelo serviço: unidade de infusão (C2-087)', () => {
  const servico = new ServicoPrescricao(porta);
  const montar = (servico as unknown as { montar: Montar }).montar.bind(servico);
  const vig = { inicio: '2026-10-21T13:00', fim: '2026-10-22T13:00' };

  it('aplica o fator da sigla do cadastro na duração da etapa (mL/h e gotas/min)', async () => {
    const r = await montar(
      {} as ContextoPrescricao,
      { tipo: 'I' },
      vig,
      new Map(),
      [solucao(1, 125), solucao(2, 42)],
      '2026-10-21T15:00',
    );
    const duracao = r.map((i) => {
      const e = i.detalhe.etapas?.[0];
      return e ? [e.volume, minutos(e.fim) - minutos(e.inicio)] : null;
    });
    expect(duracao).toEqual([
      [500, 240],
      [500, 238],
    ]);
  });

  it('unidade sem conversão conhecida fica em mL/h (fator 1), sem inventar outra', async () => {
    const r = await montar(
      {} as ContextoPrescricao,
      { tipo: 'I' },
      vig,
      new Map(),
      [solucao(3, 100)],
      '2026-10-21T15:00',
    );
    const e = r[0]?.detalhe.etapas?.[0];
    expect(e && minutos(e.fim) - minutos(e.inicio)).toBe(300);
  });
});
