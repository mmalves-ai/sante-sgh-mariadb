import { describe, expect, it } from 'vitest';
import {
  type CompetenciaSigtapLida,
  type ParSigtapLido,
  competenciaDaVigencia,
  competenciaEmUso,
  competenciasOrdenadas,
  conferirSecundarios,
  paresDaCompetencia,
  parVigenteNaCompetencia,
} from './tabela-competencia.js';

const comp = (
  codigo: string,
  situacao: CompetenciaSigtapLida['situacao'],
  vigente = false,
): CompetenciaSigtapLida => ({
  codigo,
  situacao,
  vigente,
  publicacao: null,
  vigenciaInicio: `${codigo.slice(0, 4)}-${codigo.slice(4)}-01`,
  vigenciaFim: null,
  procedimentos: null,
});
const par = (
  secundario: string,
  tipo: ParSigtapLido['tipo'],
  ini = '2026-01-01',
  fim: string | null = null,
  quantidadeMaxima: number | null = null,
): ParSigtapLido => ({
  principal: '0301010072',
  secundario,
  tipo,
  quantidadeMaxima,
  vigenciaInicio: ini,
  vigenciaFim: fim,
});

describe('competência da tabela unificada', () => {
  it('competência de uma data', () => {
    expect(competenciaDaVigencia('2026-11-01')).toBe(202611);
    expect(competenciaDaVigencia('2026-13-01')).toBeNull();
    expect(competenciaDaVigencia(null)).toBeNull();
  });
  it('em uso: a marcada vigente e carregada; senão a carregada mais nova; falha e substituída nunca', () => {
    expect(competenciaEmUso([comp('202609', 'carregada', true), comp('202610', 'carregada')])?.codigo).toBe(
      '202609',
    );
    expect(
      competenciaEmUso([
        comp('202609', 'carregada'),
        comp('202610', 'carregada'),
        comp('202611', 'falha', true),
      ])?.codigo,
    ).toBe('202610');
    expect(competenciaEmUso([comp('202608', 'substituida', true), comp('202611', 'pendente')])).toBeNull();
    expect(competenciaEmUso([])).toBeNull();
  });
  it('ordena da mais nova para a mais antiga e recusa código inválido', () => {
    expect(
      competenciasOrdenadas([comp('202512', 'carregada'), comp('202611', 'carregada')]).map((c) => c.codigo),
    ).toEqual(['202611', '202512']);
    expect(() => competenciasOrdenadas([comp('202613', 'carregada'), comp('202611', 'carregada')])).toThrow();
  });
});

describe('compatibilidades entre procedimentos por competência', () => {
  it('o par vale entre a competência inicial e a final', () => {
    const p = par('0211020036', 'compativel', '2026-03-01', '2026-08-31');
    expect(parVigenteNaCompetencia(p, '202602')).toBe(false);
    expect(parVigenteNaCompetencia(p, '202603')).toBe(true);
    expect(parVigenteNaCompetencia(p, '202608')).toBe(true);
    expect(parVigenteNaCompetencia(p, '202609')).toBe(false);
  });
  it('um par por tipo na competência, o de início mais recente prevalece', () => {
    const r = paresDaCompetencia(
      [
        par('0211020036', 'compativel', '2026-01-01', null, 1),
        par('0211020036', 'compativel', '2026-06-01', null, 3),
      ],
      '202607',
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.quantidadeMaxima).toBe(3);
  });
  it('incompatível recusa; fora da lista de compatíveis recusa; quantidade acima do máximo recusa', () => {
    const pares = [
      par('0211020036', 'compativel', '2026-01-01', null, 2),
      par('0202010317', 'incompativel'),
      par('0205020046', 'concomitante'),
    ];
    expect(
      conferirSecundarios(
        '0301010072',
        [
          { codigo: '0211020036', quantidade: 3 },
          { codigo: '0202010317', quantidade: 1 },
          { codigo: '0205020046', quantidade: 5 },
          { codigo: '0204030153', quantidade: 1 },
          { codigo: '0301010072', quantidade: 1 },
        ],
        '202611',
        pares,
      ),
    ).toEqual([
      { secundario: '0211020036', motivo: 'quantidade-acima', quantidadeMaxima: 2 },
      { secundario: '0202010317', motivo: 'incompativel' },
      { secundario: '0204030153', motivo: 'fora-dos-compativeis' },
    ]);
  });
  it('a competência do atendimento decide: par encerrado antes não vale; principal sem linhas não restringe', () => {
    const pares = [par('0202010317', 'incompativel', '2026-01-01', '2026-05-31')];
    expect(
      conferirSecundarios('0301010072', [{ codigo: '0202010317', quantidade: 1 }], '202605', pares),
    ).toHaveLength(1);
    expect(
      conferirSecundarios('0301010072', [{ codigo: '0202010317', quantidade: 1 }], '202606', pares),
    ).toEqual([]);
    expect(
      conferirSecundarios('0401010015', [{ codigo: '0202010317', quantidade: 9 }], '202605', pares),
    ).toEqual([]);
  });
});
