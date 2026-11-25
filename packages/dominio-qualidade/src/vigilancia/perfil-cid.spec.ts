// Hierarquia da CID-10 e perfil epidemiológico por capítulo (F7, 09-AREA linha 83). Amostra sintética da hierarquia.
import { describe, expect, it } from 'vitest';
import {
  type HierarquiaCid,
  localizarCid,
  normalizarCid,
  perfilPorCapitulo,
  periodoDoPerfilCid,
} from './perfil-cid.js';

const H: HierarquiaCid = {
  capitulos: [
    { codigo: 'IX', numero: 9, inicial: 'I00', final: 'I99', descricao: 'Doenças do aparelho circulatório' },
    { codigo: 'I', numero: 1, inicial: 'A00', final: 'B99', descricao: 'Algumas doenças infecciosas' },
  ],
  agrupamentos: [
    {
      codigo: 'A15-A19',
      capitulo: 'I',
      pai: null,
      nivel: 'grupo',
      inicial: 'A15',
      final: 'A19',
      descricao: 'Tuberculose',
    },
    {
      codigo: 'I20-I25',
      capitulo: 'IX',
      pai: null,
      nivel: 'grupo',
      inicial: 'I20',
      final: 'I25',
      descricao: 'Isquêmicas',
    },
    {
      codigo: 'I21-I22',
      capitulo: 'IX',
      pai: 'I20-I25',
      nivel: 'subgrupo',
      inicial: 'I21',
      final: 'I22',
      descricao: 'IAM',
    },
    {
      codigo: 'I10-I15',
      capitulo: 'IX',
      pai: null,
      nivel: 'grupo',
      inicial: 'I10',
      final: 'I15',
      descricao: 'Hipertensivas',
    },
  ],
};

describe('código da CID-10', () => {
  it('normaliza ponto, espaço e caixa; recusa formato fora da CID', () => {
    expect(normalizarCid(' i21.9 ')).toBe('I219');
    expect(normalizarCid('I21')).toBe('I21');
    expect(normalizarCid('U07.1')).toBe('U071');
    expect(normalizarCid('I2')).toBeNull();
    expect(normalizarCid('121')).toBeNull();
    expect(normalizarCid('I21.99')).toBeNull();
    expect(normalizarCid(null)).toBeNull();
  });

  it('localiza capítulo, grupo e subgrupo (do mais largo ao mais estreito)', () => {
    const l = localizarCid(H, 'I21.9')!;
    expect(l.cid).toBe('I219');
    expect(l.categoria).toBe('I21');
    expect(l.capitulo.codigo).toBe('IX');
    expect(l.agrupamentos.map((a) => a.codigo)).toEqual(['I20-I25', 'I21-I22']);
    expect(localizarCid(H, 'I25')!.agrupamentos.map((a) => a.codigo)).toEqual(['I20-I25']);
    // categoria no capítulo, mas sem agrupamento na amostra
    expect(localizarCid(H, 'B20')!.agrupamentos).toEqual([]);
    expect(localizarCid(H, 'Z00')).toBeNull();
    expect(localizarCid(H, 'xx')).toBeNull();
  });
});

describe('perfil por capítulo', () => {
  it('soma a categoria em todos os níveis que a contêm, com percentual do total', () => {
    const p = perfilPorCapitulo(H, [
      { categoria: 'I21', diagnosticos: 3 },
      { categoria: 'I22', diagnosticos: 1 },
      { categoria: 'I10', diagnosticos: 2 },
      { categoria: 'A15', diagnosticos: 1 },
      { categoria: 'B20', diagnosticos: 1 },
      { categoria: 'Z00', diagnosticos: 2 },
    ]);
    expect(p.total).toBe(10);
    expect(p.semCapitulo).toBe(2);
    // capítulos por número: I (2 = A15 + B20), IX (6)
    expect(p.capitulos.map((c) => [c.codigo, c.diagnosticos, c.percentual])).toEqual([
      ['I', 2, 20],
      ['IX', 6, 60],
    ]);
    const ix = p.capitulos[1]!;
    expect(ix.filhos.map((g) => [g.codigo, g.diagnosticos])).toEqual([
      ['I10-I15', 2],
      ['I20-I25', 4],
    ]);
    const isq = ix.filhos[1]!;
    expect(isq.filhos).toEqual([
      { codigo: 'I21-I22', descricao: 'IAM', nivel: 'subgrupo', diagnosticos: 4, percentual: 40, filhos: [] },
    ]);
    // grupo sem ocorrência não aparece; B20 fica só no capítulo
    expect(p.capitulos[0]!.filhos.map((g) => g.codigo)).toEqual(['A15-A19']);
  });

  it('junta categorias repetidas e devolve vazio sem ocorrência', () => {
    const p = perfilPorCapitulo(H, [
      { categoria: 'i21', diagnosticos: 1 },
      { categoria: 'I219', diagnosticos: 2 },
    ]);
    expect(p.total).toBe(3);
    expect(p.capitulos[0]!.diagnosticos).toBe(3);
    expect(perfilPorCapitulo(H, [])).toEqual({ total: 0, capitulos: [], semCapitulo: 0 });
  });
});

describe('período do perfil', () => {
  it('aceita até 366 dias com início antes do fim', () => {
    expect(periodoDoPerfilCid('2026-01-01', '2026-12-31')).toEqual({
      desde: '2026-01-01',
      ate: '2026-12-31',
    });
    expect(periodoDoPerfilCid('2024-01-01', '2024-12-31')).not.toBeNull(); // bissexto: 366 dias
    expect(periodoDoPerfilCid('2026-11-25', '2026-11-25')).not.toBeNull();
  });
  it('recusa período invertido, longo demais ou data inexistente', () => {
    expect(periodoDoPerfilCid('2026-02-01', '2026-01-01')).toBeNull();
    expect(periodoDoPerfilCid('2025-01-01', '2026-01-02')).toBeNull();
    expect(periodoDoPerfilCid('2026-02-30', '2026-03-01')).toBeNull();
    expect(periodoDoPerfilCid('01/01/2026', '2026-03-01')).toBeNull();
  });
});
