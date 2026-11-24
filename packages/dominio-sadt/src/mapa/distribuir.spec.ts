import { describe, expect, it } from 'vitest';
import { conferirRetencao, distribuirPorBancada, NOME_SEM_BANCADA } from './distribuir.js';

const ex = (id: number, exame: number | null, urgente = false) => ({ id, exame: { id: exame }, urgente });
const bancadas = [
  { exame: 10, bancada: 1, nome: 'Hematologia', limite: 2, ordem: 1 },
  { exame: 20, bancada: 2, nome: 'Bioquímica', limite: null, ordem: 1 },
  { exame: 10, bancada: 2, nome: 'Bioquímica', limite: null, ordem: 5 },
];

describe('distribuirPorBancada', () => {
  it('põe cada exame na bancada do modelo, urgentes primeiro e "Sem bancada" no fim', () => {
    const r = distribuirPorBancada(
      [ex(1, 10), ex(2, 20), ex(3, 10, true), ex(4, 99), ex(5, null)],
      bancadas,
      [],
    );
    expect(r.map((b) => b.nome)).toEqual(['Bioquímica', 'Hematologia', NOME_SEM_BANCADA]);
    const hema = r[1]!;
    expect(hema.codigo).toBe(1);
    expect(hema.exames.map((e) => e.id)).toEqual([3, 1]);
    expect(hema.urgentes).toBe(1);
    expect(r[2]!.codigo).toBeNull();
    expect(r[2]!.exames.map((e) => e.id)).toEqual([4, 5]);
  });

  it('conta os lotes pelo limite do modelo e deixa os retidos fora do lote, à vista com o motivo', () => {
    const r = distribuirPorBancada([ex(1, 10), ex(2, 10), ex(3, 10), ex(4, 10)], bancadas, [
      { item: 2, motivo: 'Amostra hemolisada' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.limite).toBe(2);
    expect(r[0]!.lotes).toBe(2);
    expect(r[0]!.retidos).toEqual([{ exame: 2, motivo: 'Amostra hemolisada' }]);
    expect(r[0]!.exames).toHaveLength(4);
  });

  it('sem limite, um lote; só retidos, nenhum lote', () => {
    expect(distribuirPorBancada([ex(1, 20)], bancadas, [])[0]!.lotes).toBe(1);
    expect(
      distribuirPorBancada([ex(1, 20)], bancadas, [{ item: 1, motivo: 'Aguardando calibração' }])[0]!.lotes,
    ).toBe(0);
  });
});

describe('conferirRetencao', () => {
  const base = {
    reter: true,
    motivo: 'Controle fora',
    situacaoExame: 'coletado',
    retidoAgora: false,
    temBancada: true,
  };
  it('aceita a retenção com motivo e bancada e recusa o resto', () => {
    expect(conferirRetencao(base)).toBeNull();
    expect(conferirRetencao({ ...base, motivo: ' ab ' })).toBe('motivo-curto');
    expect(conferirRetencao({ ...base, situacaoExame: 'liberado' })).toBe('exame-fechado');
    expect(conferirRetencao({ ...base, retidoAgora: true })).toBe('ja-retido');
    expect(conferirRetencao({ ...base, temBancada: false })).toBe('sem-bancada');
  });
  it('solta só o retido', () => {
    expect(conferirRetencao({ ...base, reter: false, retidoAgora: true })).toBeNull();
    expect(conferirRetencao({ ...base, reter: false })).toBe('nao-retido');
  });
});
