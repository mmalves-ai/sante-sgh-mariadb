import { describe, expect, it } from 'vitest';
import {
  conferirAliquotagem,
  conferirColetaDaRecoleta,
  conferirFechamentoRecoleta,
  destinoDosExamesAoCancelar,
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
    expect(conferirRecoleta('recebida', false, motivo)).toEqual({
      rejeitarOriginal: true,
      rejeitarAliquotas: [],
    });
    expect(conferirRecoleta('rejeitada', false, motivo)).toEqual({
      rejeitarOriginal: false,
      rejeitarAliquotas: [],
    });
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
  it('a primária aliquotada rejeita junto as alíquotas vivas; a alíquota não pede recoleta', () => {
    expect(
      conferirRecoleta('aliquotada', false, motivo, {
        ehAliquota: false,
        aliquotas: [
          { id: 5, situacao: 'recebida' },
          { id: 6, situacao: 'rejeitada' },
          { id: 7, situacao: 'em_analise' },
        ],
      }),
    ).toEqual({ rejeitarOriginal: true, rejeitarAliquotas: [5, 7] });
    expect(() => conferirRecoleta('recebida', false, motivo, { ehAliquota: true, aliquotas: [] })).toThrow(
      /primária/,
    );
  });
  it('coleta da recoleta: identificadores, estação e pulseira do próprio paciente no internado', () => {
    const base = {
      internado: true,
      identificadoresConferidos: true,
      pulseiraLida: 'P42|2026',
      pulseiraDoPaciente: ['P42', '1234'],
      estacao: 'posto-1',
    };
    expect(() => conferirColetaDaRecoleta(base)).not.toThrow();
    expect(() => conferirColetaDaRecoleta({ ...base, pulseiraLida: '1234' })).not.toThrow();
    expect(() => conferirColetaDaRecoleta({ ...base, identificadoresConferidos: false })).toThrow(
      /nome completo/,
    );
    expect(() => conferirColetaDaRecoleta({ ...base, estacao: ' ' })).toThrow(/estação/);
    expect(() => conferirColetaDaRecoleta({ ...base, pulseiraLida: null })).toThrow(/pulseira/);
    expect(() => conferirColetaDaRecoleta({ ...base, pulseiraLida: 'P421' })).toThrow(/não é do paciente/);
    expect(() => conferirColetaDaRecoleta({ ...base, internado: false, pulseiraLida: null })).not.toThrow();
  });
  it('cancelar a recoleta pede o destino dos exames', () => {
    expect(() => destinoDosExamesAoCancelar(null, null)).toThrow(/cancelar ou manter/);
    expect(() => destinoDosExamesAoCancelar('cancelar', null)).toThrow(/motivo/);
    expect(destinoDosExamesAoCancelar('cancelar', 3)).toEqual({ cancelarExames: true });
    expect(destinoDosExamesAoCancelar('manter', null)).toEqual({ cancelarExames: false });
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
    // Item sem setor não pega a regra de setor nenhum; a regra de outro setor não vale.
    expect(planoDeSubamostras([{ ...ex(1, 10), setor: null }], [regra({})])).toEqual([]);
    expect(planoDeSubamostras([ex(1, 10)], [regra({ setor: 2 })])).toEqual([]);
  });
  it('a primária se divide recebida, uma vez e com regra', () => {
    const p = [{ regra: 1, bancada: null, setor: 1, exameItens: [1] }];
    expect(() => conferirAliquotagem('recebida', false, p)).not.toThrow();
    expect(() => conferirAliquotagem('coletada', false, p)).toThrow(/Receba/);
    expect(() => conferirAliquotagem('recebida', true, p)).toThrow(/já foram/);
    expect(() => conferirAliquotagem('recebida', false, [])).toThrow(/regra/);
  });
});
