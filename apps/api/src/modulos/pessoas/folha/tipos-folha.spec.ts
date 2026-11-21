// Regras puras da folha: tipo do vínculo pela categoria do trabalhador, grau de insalubridade em centésimos de ponto e
// competências do contrato sem folha (base da recusa da soma do FGTS).
import { describe, expect, it } from 'vitest';
import {
  competenciasDescobertas,
  insalubridadeDoGrau,
  situacaoDoAfastamento,
  tipoVinculoDaFolha,
} from './tipos-folha.js';

describe('tipoVinculoDaFolha', () => {
  it('estagiário (901) e residente (902) não saem como CLT, qualquer que seja o regime', () => {
    expect(tipoVinculoDaFolha('901', 'bolsista', 'clt')).toBe('estagiario');
    expect(tipoVinculoDaFolha('902', 'bolsista', 'clt')).toBe('residente');
  });
  it('empregado e agente público seguem o regime', () => {
    expect(tipoVinculoDaFolha('101', 'empregado', 'clt')).toBe('clt');
    expect(tipoVinculoDaFolha('301', 'agente_publico', 'estatutario')).toBe('estatutario');
    expect(tipoVinculoDaFolha('103', 'empregado', 'estatutario')).toBe('estatutario');
  });
  it('categoria fora da folha de empregados não entra', () => {
    expect(tipoVinculoDaFolha('701', 'contribuinte_individual', 'clt')).toBeNull();
    expect(tipoVinculoDaFolha('201', 'avulso', 'clt')).toBeNull();
    expect(tipoVinculoDaFolha('903', 'bolsista', 'clt')).toBeNull();
  });
});

describe('insalubridadeDoGrau', () => {
  it('NR-15 em centésimos de ponto do salário mínimo', () => {
    expect([null, 'nenhum', 'minimo', 'medio', 'maximo'].map(insalubridadeDoGrau)).toEqual([
      0, 0, 1000, 2000, 4000,
    ]);
  });
});

describe('competenciasDescobertas', () => {
  it('lista os meses do contrato sem folha, virando o ano', () => {
    expect(competenciasDescobertas('2025-11-20', '2026-02', new Set(['2025-12']))).toEqual([
      '2025-11',
      '2026-01',
      '2026-02',
    ]);
  });
  it('contrato todo coberto ou admissão depois do fim: nada falta', () => {
    expect(competenciasDescobertas('2026-08-03', '2026-08', new Set(['2026-08']))).toEqual([]);
    expect(competenciasDescobertas('2026-09-01', '2026-08', new Set())).toEqual([]);
  });
});

describe('situacaoDoAfastamento (calculada na leitura, nunca gravada)', () => {
  it('previsto, em andamento e encerrado pelo dia', () => {
    expect(situacaoDoAfastamento('2026-10-01', null, '2026-09-30')).toBe('previsto');
    expect(situacaoDoAfastamento('2026-09-01', '2026-09-30', '2026-09-30')).toBe('em_andamento');
    expect(situacaoDoAfastamento('2026-09-01', '2026-09-10', '2026-09-30')).toBe('encerrado');
  });
});
