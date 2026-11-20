// Regra 10 do M37 (proposta): setor migrado com os parâmetros configuráveis.
import { describe, expect, it } from 'vitest';
import { avaliarSetorMigrado, type EntradaSetorMigrado, filaCaindo, filaS2PorDia } from './setor-migrado.js';

const base: EntradaSetorMigrado = {
  hoje: '2026-11-30',
  diasComS1: ['2026-11-10'],
  filaS2: [
    { dia: '2026-11-20', abertos: 3 },
    { dia: '2026-11-25', abertos: 1 },
  ],
  conexoes: [
    { dia: '2026-11-17', pessoas: 20 },
    { dia: '2026-11-24', pessoas: 8 },
    { dia: '2026-11-30', pessoas: 1 },
  ],
  metasNoAlvo: true,
  aceiteCoordenador: true,
  diasSemS1: 14,
  diasConexoes: 14,
};

describe('setor migrado (regra 10)', () => {
  it('cumprido com 14 dias sem S1, S2 caindo, conexões em queda, metas e aceite', () => {
    const r = avaliarSetorMigrado(base);
    expect(r.cumprido).toBe(true);
    expect(r.criterios.map((c) => c.criterio)).toEqual([
      'sem-s1',
      's2-caindo',
      'conexoes-em-queda',
      'metas',
      'aceite',
    ]);
  });

  it('o parâmetro de dias sem S1 decide (configurável)', () => {
    expect(avaliarSetorMigrado({ ...base, diasSemS1: 30 }).cumprido).toBe(false);
    const sem = avaliarSetorMigrado({ ...base, diasComS1: [] });
    expect(sem.criterios[0]?.detalhe).toContain('nenhum S1');
  });

  it('cada critério que falta impede (sem medida das metas, sem aceite, sem retrato)', () => {
    const r = avaliarSetorMigrado({
      ...base,
      metasNoAlvo: null,
      aceiteCoordenador: false,
      conexoes: [],
      filaS2: [],
    });
    expect(r.cumprido).toBe(false);
    expect(r.criterios.filter((c) => !c.atendido).map((c) => c.criterio)).toEqual([
      'conexoes-em-queda',
      'metas',
      'aceite',
    ]);
    expect(avaliarSetorMigrado({ ...base, metasNoAlvo: false }).criterios[3]?.detalhe).toBe('fora do alvo');
  });

  it('fila de S2: vazia cai; um só dia, só zerada; subida reprova', () => {
    expect(filaCaindo([])).toBe(true);
    expect(filaCaindo([{ dia: 'a', abertos: 0 }])).toBe(true);
    expect(filaCaindo([{ dia: 'a', abertos: 2 }])).toBe(false);
    expect(
      filaCaindo([
        { dia: 'a', abertos: 2 },
        { dia: 'b', abertos: 3 },
      ]),
    ).toBe(false);
    expect(
      filaCaindo([
        { dia: 'a', abertos: 2 },
        { dia: 'b', abertos: 2 },
      ]),
    ).toBe(false);
  });

  it('fila de S2 por dia a partir dos chamados: S2 aberto no setor reprova o critério', () => {
    const fila = filaS2PorDia(
      [
        { abertoEm: '2026-11-27', encerradoEm: null },
        { abertoEm: '2026-11-26', encerradoEm: '2026-11-28' },
      ],
      '2026-11-25',
      '2026-11-30',
    );
    expect(fila.map((x) => x.abertos)).toEqual([0, 1, 2, 1, 1, 1]);
    const r = avaliarSetorMigrado({ ...base, filaS2: fila });
    expect(r.criterios[1]).toMatchObject({ criterio: 's2-caindo', atendido: false });
    expect(r.criterios[1]?.detalhe).toContain('0 → 1 → 2');
    // Sem S2 na janela: a fila zerada atende, com o texto certo.
    const zerada = avaliarSetorMigrado({ ...base, filaS2: filaS2PorDia([], '2026-11-25', '2026-11-30') });
    expect(zerada.criterios[1]).toMatchObject({ atendido: true, detalhe: 'nenhum S2 aberto na janela' });
  });
});
