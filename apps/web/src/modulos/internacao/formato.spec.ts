import { describe, expect, it } from 'vitest';
import {
  formatarData,
  formatarDataHora,
  formatarMes,
  formatarNumero,
  formatarValor,
  hojeNoEstabelecimento,
  segundosDesde,
  semMovimentoRecente,
} from './formato.js';

describe('formatação do M16', () => {
  it('datas no fuso do estabelecimento', () => {
    expect(formatarDataHora('2026-10-21T13:05:00.000Z')).toBe('21/10/2026 10:05');
    expect(formatarDataHora(null)).toBe('—');
    expect(formatarDataHora('x')).toBe('—');
    expect(formatarData('2026-07-05')).toBe('05/07/2026');
    expect(formatarData('x')).toBe('—');
    expect(formatarMes('2026-07')).toBe('07/2026');
    expect(formatarMes('x')).toBe('x');
    expect(hojeNoEstabelecimento(Date.UTC(2026, 9, 21, 2, 0))).toBe('2026-10-20');
  });

  it('há N segundos; valores por unidade', () => {
    expect(segundosDesde('2026-10-21T13:00:00.000Z', Date.UTC(2026, 9, 21, 13, 0, 7))).toBe(7);
    expect(segundosDesde(null, 0)).toBeNull();
    expect(segundosDesde('x', 0)).toBeNull();
    expect(formatarValor(85.5, 'percentual')).toBe('85,5%');
    expect(formatarValor(4, 'dias')).toBe('4 dia(s)');
    expect(formatarValor(1234.5, 'quantidade')).toBe('1.234,5');
    expect(formatarValor(null, 'razao')).toBe('—');
    expect(formatarValor(1000, 'reais')).toMatch(/R\$\s?1\.000/);
    expect(formatarNumero(null)).toBe('—');
    expect(formatarNumero(2)).toBe('2');
  });

  it('aviso de movimento parado', () => {
    expect(semMovimentoRecente('2026-07-05', '2026-10-21')).toBe(true);
    expect(semMovimentoRecente('2026-10-20', '2026-10-21')).toBe(false);
    expect(semMovimentoRecente(null, '2026-10-21')).toBe(false);
  });
});
