import { describe, expect, it } from 'vitest';
import {
  conferirAliquotagem,
  conferirFechamentoRecoleta,
  conferirRecoleta,
  planoDeSubamostras,
  type RegraSubamostra,
} from './recoleta.js';

const motivo = { ativo: true, geraNovaAmostra: true };
const regra = (o: Partial<RegraSubamostra>): RegraSubamostra => ({
  id: 1,
  exame: 10,
  setor: 1,
  material: null,
  bancada: 100,
  destinoSetor: null,
  geraSubamostra: true,
  examePrimario: false,
  agrupamento: 'por_exame',
  ...o,
});
const ex = (exameItem: number, exame: number) => ({ exameItem, exame, setor: 1, material: 7 });

describe('recoleta', () => {
  it('rejeita a original ainda ativa, aceita a já rejeitada e recusa as demais', () => {
    expect(conferirRecoleta('recebida', false, motivo)).toEqual({ rejeitarOriginal: true });
    expect(conferirRecoleta('rejeitada', false, motivo)).toEqual({ rejeitarOriginal: false });
    expect(() => conferirRecoleta('descartada', false, motivo)).toThrow(/situação/);
    expect(() => conferirRecoleta('recebida', true, motivo)).toThrow(/pendente/);
    expect(() => conferirRecoleta('recebida', false, null)).toThrow(/motivo/);
    expect(() => conferirRecoleta('recebida', false, { ...motivo, ativo: false })).toThrow(/motivo/);
  });
  it('fecha só a pendente; cancelar pede motivo', () => {
    expect(() => conferirFechamentoRecoleta('pendente', 'coletar')).not.toThrow();
    expect(() => conferirFechamentoRecoleta('coletada', 'coletar')).toThrow(/já foi/);
    expect(() => conferirFechamentoRecoleta('agendada', 'cancelar', '')).toThrow(/motivo/);
  });
});

describe('sub-amostras', () => {
  it('agrupa por exame, por bancada, por setor e único; a regra do material vence; primário não gera', () => {
    const exames = [ex(1, 10), ex(2, 11), ex(3, 12), ex(4, 13)];
    expect(planoDeSubamostras(exames, [regra({}), regra({ id: 2, exame: 11 })]).length).toBe(2);
    const porBancada = planoDeSubamostras(exames, [
      regra({ agrupamento: 'por_bancada' }),
      regra({ id: 2, exame: 11, agrupamento: 'por_bancada' }),
      regra({ id: 3, exame: 12, agrupamento: 'por_bancada', bancada: 200 }),
    ]);
    expect(porBancada.map((g) => g.exameItens)).toEqual([[1, 2], [3]]);
    expect(
      planoDeSubamostras(exames, [
        regra({ agrupamento: 'por_setor', destinoSetor: 9 }),
        regra({ id: 2, exame: 11, agrupamento: 'por_setor', destinoSetor: 9 }),
      ]),
    ).toEqual([{ regra: 1, bancada: 100, setor: 9, exameItens: [1, 2] }]);
    expect(
      planoDeSubamostras(exames, [
        regra({ examePrimario: true }),
        regra({ id: 2, exame: 11, geraSubamostra: false }),
      ]),
    ).toEqual([]);
    expect(
      planoDeSubamostras([ex(1, 10)], [regra({ id: 5 }), regra({ id: 6, material: 7, bancada: 300 })])[0],
    ).toMatchObject({ regra: 6, bancada: 300 });
    expect(planoDeSubamostras([ex(1, 10)], [regra({ material: 8 })])).toEqual([]);
  });
  it('a primária se divide recebida, uma vez e com regra', () => {
    const p = [{ regra: 1, bancada: null, setor: 1, exameItens: [1] }];
    expect(() => conferirAliquotagem('recebida', false, p)).not.toThrow();
    expect(() => conferirAliquotagem('coletada', false, p)).toThrow(/Receba/);
    expect(() => conferirAliquotagem('recebida', true, p)).toThrow(/já foram/);
    expect(() => conferirAliquotagem('recebida', false, [])).toThrow(/regra/);
  });
});
