// W0-08, parte 9 (M3): aptos a operar pelo curso concluído, índice de obsolescência com as parcelas e a ordem dos eventos
// do ciclo de vida. Dados sintéticos.
import type { ConclusaoDeCurso, CursoDoModelo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  conferirEventoCiclo,
  indiceObsolescencia,
  mesesCompletos,
  normalizarModelo,
  operadoresDoModelo,
} from './ciclo-vida.js';

const curso = (c: number, ativo = true): CursoDoModelo => ({
  id: c * 10,
  fabricante: 'INFUSAO MEDICA',
  modelo: 'BI-200',
  curso: c,
  cursoCodigo: `C${c}`,
  cursoTitulo: `Curso ${c}`,
  cursoAtivo: ativo,
  validadeMeses: 12,
  criadoPor: 'TESTE',
  criadoEm: '2026-01-01T00:00:00Z',
});
const concl = (
  vinculo: number,
  c: number,
  conclusao: string,
  validoAte: string | null,
): ConclusaoDeCurso => ({
  vinculo,
  nome: `Pessoa ${vinculo}`,
  matricula: null,
  curso: c,
  conclusao,
  validoAte,
});

describe('aptos a operar o modelo', () => {
  const hoje = '2026-11-18';
  it('apto só com todos os cursos ativos dentro da validade; o resto é pendente', () => {
    const r = operadoresDoModelo(
      [curso(1), curso(2), curso(3, false)],
      [
        concl(1, 1, '2026-05-01', '2027-05-01'),
        concl(1, 2, '2026-06-01', null),
        concl(2, 1, '2026-05-01', '2027-05-01'),
        concl(3, 1, '2025-01-01', '2026-01-01'),
        concl(3, 2, '2026-02-01', '2027-02-01'),
        // A conclusão mais nova vale (renovou):
        concl(4, 1, '2025-01-01', '2026-01-01'),
        concl(4, 1, '2026-03-01', '2027-03-01'),
        concl(4, 2, '2026-03-01', '2027-02-01'),
        // Só o curso inativo não conta:
        concl(5, 3, '2026-03-01', null),
      ],
      hoje,
    );
    expect(r.aptos.map((a) => [a.vinculo, a.validoAte])).toEqual([
      [1, '2027-05-01'],
      [4, '2027-02-01'],
    ]);
    expect(r.pendentes.map((p) => [p.vinculo, p.faltam, p.vencidos])).toEqual([
      [2, [2], []],
      [3, [], [1]],
    ]);
  });
  it('sem curso ativo exigido ninguém é apto (o modelo não tem treinamento definido)', () => {
    const r = operadoresDoModelo([curso(3, false)], [concl(1, 3, '2026-01-01', null)], hoje);
    expect(r.aptos).toEqual([]);
    expect(r.pendentes).toEqual([]);
  });
  it('a chave do modelo ignora acento, caixa e espaços', () => {
    expect(normalizarModelo('  Infusão  médica ')).toBe('INFUSAO MEDICA');
  });
});

describe('índice de obsolescência', () => {
  it('as parcelas somam o índice e cada uma é impressa', () => {
    const r = indiceObsolescencia({
      idadeMeses: 96,
      vidaUtilMeses: 120,
      custoCent: 1_500_000,
      valorCent: 5_000_000,
      corretivas: 3,
    });
    // idade 96/120 = 0,8 × 40 = 32; custo 15.000 / 25.000 = 0,6 × 30 = 18; falhas 3/6 = 0,5 × 30 = 15.
    expect([r.idade.pontos, r.custo.pontos, r.falhas.pontos, r.indice]).toEqual([32, 18, 15, 65]);
    expect(r.faixa).toBe('acompanhar');
    expect(r.idade.pontos + r.custo.pontos + r.falhas.pontos).toBe(r.indice);
  });
  it('cada parcela fica no peso; sem bem ligado o custo fica sem base', () => {
    const r = indiceObsolescencia({
      idadeMeses: 200,
      vidaUtilMeses: 120,
      custoCent: 9_000_000,
      valorCent: null,
      corretivas: 12,
    });
    expect([r.idade.pontos, r.custo.pontos, r.custo.razao, r.falhas.pontos, r.indice]).toEqual([
      40,
      0,
      null,
      30,
      70,
    ]);
    expect(r.faixa).toBe('substituir');
  });
  it('equipamento novo e sem falha: manter', () => {
    const r = indiceObsolescencia({
      idadeMeses: 6,
      vidaUtilMeses: 120,
      custoCent: 0,
      valorCent: 100_000,
      corretivas: 0,
    });
    expect([r.indice, r.faixa]).toEqual([2, 'manter']);
  });
  it('meses completos', () => {
    expect(mesesCompletos('2018-11-19', '2026-11-18')).toBe(95);
    expect(mesesCompletos('2018-11-18', '2026-11-18')).toBe(96);
    expect(mesesCompletos('2027-01-01', '2026-11-18')).toBe(0);
  });
});

describe('eventos do ciclo de vida', () => {
  const hoje = '2026-11-18';
  it('ordem, um de cada tipo, descarte só depois da desativação e nada depois do descarte', () => {
    expect(conferirEventoCiclo([], { tipo: 'incorporacao', data: '2020-01-10' }, hoje)).toBeNull();
    expect(conferirEventoCiclo([], { tipo: 'incorporacao', data: '2026-12-01' }, hoje)).toBe('data-futura');
    const inc = { tipo: 'incorporacao' as const, data: '2020-01-10' };
    expect(conferirEventoCiclo([inc], { tipo: 'incorporacao', data: '2020-01-10' }, hoje)).toBe(
      'evento-repetido',
    );
    expect(conferirEventoCiclo([inc], { tipo: 'descarte', data: '2026-01-10' }, hoje)).toBe(
      'sem-desativacao',
    );
    expect(conferirEventoCiclo([inc], { tipo: 'desativacao', data: '2019-01-10' }, hoje)).toBe(
      'fora-de-ordem',
    );
    const des = { tipo: 'desativacao' as const, data: '2026-10-01' };
    expect(conferirEventoCiclo([inc, des], { tipo: 'descarte', data: '2026-09-30' }, hoje)).toBe(
      'fora-de-ordem',
    );
    expect(conferirEventoCiclo([des], { tipo: 'incorporacao', data: '2026-10-02' }, hoje)).toBe(
      'fora-de-ordem',
    );
    expect(conferirEventoCiclo([inc, des], { tipo: 'descarte', data: '2026-10-01' }, hoje)).toBeNull();
    const desc = { tipo: 'descarte' as const, data: '2026-10-05' };
    expect(conferirEventoCiclo([des, desc], { tipo: 'incorporacao', data: '2020-01-01' }, hoje)).toBe(
      'equipamento-descartado',
    );
  });
});
