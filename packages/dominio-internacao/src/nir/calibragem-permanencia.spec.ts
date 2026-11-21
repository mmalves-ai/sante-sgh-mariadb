// Ficha do M44, regra 13: o quadro de permanência (verde, amarelo no dia anterior à DPA, vermelho com a DPA vencida),
// os dias pela Portaria 312 (nunca as diárias faturáveis), a UTI pela trajetória e a calibragem com as duas réguas lado a
// lado, em massa sintética.
import { describe, expect, it } from 'vitest';
import { diariasFaturaveis } from '../adt.js';
import {
  barreiraVencida,
  calibrar,
  corPermanencia,
  diasInternado312,
  diasUtiPelaTrajetoria,
  type HistogramaPermanencia,
  limiteAplicavel,
  propostaDeLimite,
  regua,
} from './permanencia.js';

const limite = { amareloDias: 7, vermelhoDias: 10 };

describe('quadro de permanência (regra 13)', () => {
  it('a cor pela DPA: verde, amarelo hoje e amanhã, vermelho vencida', () => {
    const hoje = '2026-10-24';
    expect(corPermanencia({ hoje, dpa: '2026-10-27', dias312: 2, limite }).cor).toBe('verde');
    expect(corPermanencia({ hoje, dpa: '2026-10-25', dias312: 2, limite })).toEqual({
      cor: 'amarelo',
      motivo: 'Alta prevista para amanhã.',
    });
    expect(corPermanencia({ hoje, dpa: '2026-10-24', dias312: 2, limite }).motivo).toBe(
      'Alta prevista para hoje.',
    );
    expect(corPermanencia({ hoje, dpa: '2026-10-23', dias312: 2, limite })).toEqual({
      cor: 'vermelho',
      motivo: 'Alta prevista vencida.',
    });
  });

  it('a cor pelo limite quando pior que a da DPA (ou sem DPA)', () => {
    const hoje = '2026-10-24';
    expect(corPermanencia({ hoje, dpa: null, dias312: 3, limite })).toEqual({
      cor: 'verde',
      motivo: 'Sem alta prevista registrada; dentro do limite.',
    });
    expect(corPermanencia({ hoje, dpa: null, dias312: 7, limite }).cor).toBe('amarelo');
    expect(corPermanencia({ hoje, dpa: '2026-10-30', dias312: 11, limite }).motivo).toMatch(
      /limite vermelho \(10\)/,
    );
    expect(corPermanencia({ hoje, dpa: '2026-10-23', dias312: 8, limite }).cor).toBe('vermelho');
  });

  it('os dias pela Portaria 312, nunca pelas diárias faturáveis; a UTI pela trajetória', () => {
    expect(diasInternado312('2026-10-24', '2026-10-24')).toBe(1);
    expect(diasInternado312('2026-10-20T10:00:00', '2026-10-24')).toBe(4);
    // As diárias faturáveis contam a entrada e a alta (um dia a mais): réguas diferentes, nomes diferentes.
    expect(diariasFaturaveis('2026-10-20', '2026-10-24', '13:00')).toBe(5);
    const trechos = [
      { tipo: 1, entrada: '2026-10-18', saida: '2026-10-20' },
      { tipo: 3, entrada: '2026-10-20', saida: '2026-10-23' },
      { tipo: 17, entrada: '2026-10-23', saida: '1899-12-30' },
      { tipo: 7, entrada: '2026-10-24', saida: '2026-10-24' },
    ];
    expect(diasUtiPelaTrajetoria(trechos, [3, 7, 8, 9, 17], '2026-10-24')).toBe(3 + 1 + 1);
  });

  it('o limite mais específico vale: procedimento, CID, clínica, padrão', () => {
    const limites = [
      { escopo: 'clinica' as const, chave: 'M', amareloDias: 5, vermelhoDias: 8, origem: 'calibrado' },
      { escopo: 'cid' as const, chave: 'J18', amareloDias: 6, vermelhoDias: 9, origem: 'manual' },
      {
        escopo: 'procedimento' as const,
        chave: '303010037',
        amareloDias: 4,
        vermelhoDias: 6,
        origem: 'calibrado',
      },
    ];
    expect(
      limiteAplicavel(limites, { procedimento: '303010037', cid: 'J18', clinica: 'M' }, limite).escopo,
    ).toBe('procedimento');
    expect(limiteAplicavel(limites, { procedimento: '1', cid: 'j18 ', clinica: 'M' }, limite).escopo).toBe(
      'cid',
    );
    expect(
      limiteAplicavel(limites, { procedimento: null, cid: null, clinica: 'M' }, limite).amareloDias,
    ).toBe(5);
    expect(limiteAplicavel(limites, { procedimento: null, cid: null, clinica: 'C' }, limite)).toMatchObject({
      escopo: 'padrao',
      ...limite,
    });
  });

  it('a barreira vencida é a aberta com o prazo passado', () => {
    expect(barreiraVencida({ situacao: 'aberta', prazo: '2026-10-23' }, '2026-10-24')).toBe(true);
    expect(barreiraVencida({ situacao: 'resolvida', prazo: '2026-10-23' }, '2026-10-24')).toBe(false);
    expect(barreiraVencida({ situacao: 'aberta', prazo: '2026-10-24' }, '2026-10-24')).toBe(false);
  });
});

describe('calibragem dos limites: duas réguas lado a lado (massa sintética)', () => {
  // 40 internações sintéticas da clínica M: 312 de 1 a 10 dias; as diárias faturáveis um dia a mais em cada uma.
  const p312: HistogramaPermanencia[] = Array.from({ length: 10 }, (_, i) => ({
    chave: 'M',
    dias: i + 1,
    n: 4,
  }));
  const fat: HistogramaPermanencia[] = p312.map((x) => ({ ...x, dias: x.dias + 1 }));
  const uti: HistogramaPermanencia[] = [
    { chave: 'M', dias: 0, n: 30 },
    { chave: 'M', dias: 3, n: 10 },
  ];

  it('os percentis e a média de cada régua; a proposta pela Portaria 312', () => {
    const [m] = calibrar({ portaria312: p312, diariasFaturaveis: fat, uti }, 20);
    expect(m?.portaria312).toEqual({ n: 40, p50: 5, p75: 8, p90: 9, media: 5.5 });
    expect(m?.diariasFaturaveis).toEqual({ n: 40, p50: 6, p75: 9, p90: 10, media: 6.5 });
    expect(m?.uti).toMatchObject({ n: 40, p50: 0, p90: 3 });
    expect(m?.proposta).toEqual({ amareloDias: 8, vermelhoDias: 9 });
  });

  it('sem amostra mínima, sem proposta; vermelho sempre acima do amarelo', () => {
    expect(propostaDeLimite(regua([{ dias: 3, n: 5 }]), 20)).toBeNull();
    expect(propostaDeLimite(regua([{ dias: 3, n: 30 }]), 20)).toEqual({ amareloDias: 3, vermelhoDias: 4 });
    expect(regua([])).toEqual({ n: 0, p50: null, p75: null, p90: null, media: null });
    expect(regua([{ dias: -1, n: 3 }]).n).toBe(0);
    expect(calibrar({ portaria312: [], diariasFaturaveis: [], uti: [] }, 20)).toEqual([]);
  });
});
