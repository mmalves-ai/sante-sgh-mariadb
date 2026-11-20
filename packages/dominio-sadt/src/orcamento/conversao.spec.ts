// Regra 13 (ficha do M26): orçamento com validade; convertido com os mesmos exames e valores.
import { describe, expect, it } from 'vitest';
import {
  conferirConversao,
  itensDaConversao,
  situacaoDoOrcamento,
  totalDoOrcamento,
  validadeDoOrcamento,
  valorDoLegado,
} from './conversao.js';

const itens = [
  { exame: 'HMG', valor: 25.5 },
  { exame: 'GLI', valor: 12.345 },
  { exame: 'URE ', valor: 10 },
];

describe('orçamento particular (regra 13)', () => {
  it('valores com as 2 casas do legado e o total', () => {
    expect(valorDoLegado(12.345)).toBe(12.35);
    expect(totalDoOrcamento(itens)).toBe(47.85);
  });

  it('validade e situação', () => {
    expect(validadeDoOrcamento('2026-10-22', 30)).toBe('2026-11-21');
    expect(situacaoDoOrcamento({ validade: '2026-11-21', convertido: false, hoje: '2026-11-21' })).toBe(
      'aberto',
    );
    expect(situacaoDoOrcamento({ validade: '2026-11-21', convertido: false, hoje: '2026-11-22' })).toBe(
      'vencido',
    );
    expect(situacaoDoOrcamento({ validade: '2026-11-21', convertido: true, hoje: '2026-12-01' })).toBe(
      'convertido',
    );
  });

  it('a conversão leva os mesmos exames, na mesma ordem, com os mesmos valores (sem repetir)', () => {
    expect(itensDaConversao([...itens, { exame: 'HMG', valor: 99 }])).toEqual([
      { exame: 'HMG', valor: 25.5 },
      { exame: 'GLI', valor: 12.35 },
      { exame: 'URE', valor: 10 },
    ]);
  });

  it('confere a conversão: vencido, já convertido, sem exames e valores diferentes', () => {
    const o = { validade: '2026-11-21', convertido: false, itens };
    expect(conferirConversao(o, '2026-10-30')).toEqual({ pode: true, motivo: null });
    expect(conferirConversao(o, '2026-12-01').motivo).toMatch(/validade/);
    expect(conferirConversao({ ...o, convertido: true }, '2026-10-30').motivo).toMatch(/já foi convertido/);
    expect(conferirConversao({ ...o, itens: [] }, '2026-10-30').motivo).toMatch(/não tem exames/);
    expect(conferirConversao(o, '2026-10-30', itensDaConversao(itens)).pode).toBe(true);
    expect(
      conferirConversao(o, '2026-10-30', [
        { exame: 'HMG', valor: 25.5 },
        { exame: 'GLI', valor: 13 },
        { exame: 'URE', valor: 10 },
      ]).motivo,
    ).toMatch(/diferem/);
  });
});
