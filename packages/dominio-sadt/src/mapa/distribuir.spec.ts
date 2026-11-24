import { describe, expect, it } from 'vitest';
import {
  conferirAvancoDoRetido,
  conferirRetencao,
  distribuirPorBancada,
  escolherBancada,
  NOME_SEM_BANCADA,
} from './distribuir.js';

const ex = (id: number, exame: number | null, urgente = false) => ({ id, exame: { id: exame }, urgente });
const hema = (item: number, modelo = 1) => ({ item, bancada: 1, nome: 'Hematologia', limite: 2, modelo });
const bio = (item: number, modelo = 2) => ({ item, bancada: 2, nome: 'Bioquímica', limite: null, modelo });

describe('escolherBancada', () => {
  it('o modelo mais antigo do setor vence; sem candidata, nenhuma', () => {
    expect(escolherBancada([bio(1, 9), hema(1, 3)])?.bancada).toBe(1);
    expect(escolherBancada([hema(1, 7), bio(1, 2)])?.bancada).toBe(2);
    expect(escolherBancada([])).toBeNull();
  });
});

describe('distribuirPorBancada', () => {
  it('põe cada exame na bancada escolhida, urgentes primeiro e "Sem bancada" no fim', () => {
    const r = distribuirPorBancada(
      [ex(1, 10), ex(2, 20), ex(3, 10, true), ex(4, 99), ex(5, null)],
      [hema(1), bio(2), hema(3), bio(3, 5)],
      [],
    );
    expect(r.map((b) => b.nome)).toEqual(['Bioquímica', 'Hematologia', NOME_SEM_BANCADA]);
    expect(r[1]!.codigo).toBe(1);
    expect(r[1]!.exames.map((e) => e.id)).toEqual([3, 1]);
    expect(r[1]!.urgentes).toBe(1);
    expect(r[2]!.codigo).toBeNull();
    expect(r[2]!.lotes).toBe(1);
    expect(r[2]!.exames.map((e) => e.id)).toEqual([4, 5]);
  });

  it('conta os lotes pelo limite e põe os retidos à parte, fora do lote e dos urgentes', () => {
    const r = distribuirPorBancada(
      [ex(1, 10), ex(2, 10, true), ex(3, 10), ex(4, 10), ex(5, 10), ex(6, 10, true)],
      [1, 2, 3, 4, 5, 6].map((i) => hema(i)),
      [{ item: 2, motivo: 'Amostra hemolisada' }],
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.limite).toBe(2);
    expect(r[0]!.exames.map((e) => e.id)).toEqual([6, 1, 3, 4, 5]);
    expect(r[0]!.lotes).toBe(3);
    expect(r[0]!.urgentes).toBe(1);
    expect(r[0]!.retidos).toEqual([{ ...ex(2, 10, true), motivo: 'Amostra hemolisada' }]);
  });

  it('sem limite, um lote; só retidos, nenhum lote', () => {
    expect(distribuirPorBancada([ex(1, 20)], [bio(1)], [])[0]!.lotes).toBe(1);
    const so = distribuirPorBancada(
      [ex(1, 20)],
      [bio(1)],
      [{ item: 1, motivo: 'Aguardando calibração' }],
    )[0]!;
    expect(so.lotes).toBe(0);
    expect(so.exames).toEqual([]);
  });
});

describe('conferirRetencao', () => {
  const base = {
    reter: true,
    motivo: 'Controle fora',
    situacaoExame: 'em_analise',
    retidoAgora: false,
    temBancada: true,
  };
  it('retém só o exame em análise, com motivo e bancada', () => {
    expect(conferirRetencao(base)).toBeNull();
    expect(conferirRetencao({ ...base, motivo: ' ab ' })).toBe('motivo-curto');
    expect(conferirRetencao({ ...base, situacaoExame: 'liberado' })).toBe('exame-fechado');
    expect(conferirRetencao({ ...base, situacaoExame: 'solicitado' })).toBe('exame-fechado');
    expect(conferirRetencao({ ...base, situacaoExame: 'coletado' })).toBe('exame-fechado');
    expect(conferirRetencao({ ...base, retidoAgora: true })).toBe('ja-retido');
    expect(conferirRetencao({ ...base, temBancada: false })).toBe('sem-bancada');
  });
  it('solta só o retido, em qualquer situação do exame (a retenção sempre se fecha)', () => {
    expect(conferirRetencao({ ...base, reter: false, retidoAgora: true })).toBeNull();
    expect(
      conferirRetencao({ ...base, reter: false, retidoAgora: true, situacaoExame: 'cancelado' }),
    ).toBeNull();
    expect(conferirRetencao({ ...base, reter: false })).toBe('nao-retido');
  });
  it('o retido não avança para resultado nem liberação', () => {
    expect(conferirAvancoDoRetido(true)).toBe('exame-retido');
    expect(conferirAvancoDoRetido(false)).toBeNull();
  });
});
