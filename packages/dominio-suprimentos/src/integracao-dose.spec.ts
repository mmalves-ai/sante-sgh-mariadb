// F3.6-04 (05-SUP linha 7): a regra de integração aplicada às doses da prescrição (local, momento e liberação).
import { describe, expect, it } from 'vitest';
import {
  type ContextoIntegracao,
  decidirDoses,
  liberacaoPorEvento,
  type RegraCandidata,
  situacaoDoseIntegrada,
} from '@sgh/contratos/regras-suprimentos';

const regra = (r: Partial<RegraCandidata>): RegraCandidata => ({
  regra: 1,
  centroCusto: null,
  setor: null,
  unidade: 7,
  tipoItem: null,
  grupo: null,
  subgrupo: null,
  item: null,
  localAtendente: 10,
  localSubstituto: 20,
  tipoIntegracao: 'dispensacao_direta',
  momento: 'na_prescricao',
  antecedenciaMinutos: null,
  geraManipulacao: false,
  prioridade: 100,
  ativo: true,
  ...r,
});
const ctx: ContextoIntegracao = {
  centroCusto: 3,
  setor: 5,
  unidade: 7,
  tipoItem: 1,
  grupo: 40,
  subgrupo: 41,
  item: 900,
};
const prescritoEm = new Date('2026-11-24T10:00:00Z');
const h8 = new Date('2026-11-24T14:00:00Z');
const h16 = new Date('2026-11-24T22:00:00Z');
const tudo = () => true;

describe('doses da prescrição pela regra de integração', () => {
  it('sem regra que atenda o item segue sem integração automática', () => {
    const r = decidirDoses([regra({ unidade: 99 })], ctx, {
      temSaldo: tudo,
      prescritoEm,
      horarios: [h8, h16],
    });
    expect(r).toEqual({ regra: null, doses: [] });
  });
  it('a regra mais específica (item) decide o local de todas as doses, liberadas na prescrição', () => {
    const r = decidirDoses([regra({}), regra({ regra: 2, item: 900, localAtendente: 30 })], ctx, {
      temSaldo: tudo,
      prescritoEm,
      horarios: [h8, h16],
    });
    expect(r.regra?.regra).toBe(2);
    expect(r.doses.map((d) => [d.local, d.liberarEm?.toISOString(), d.usouSubstituto])).toEqual([
      [30, prescritoEm.toISOString(), false],
      [30, prescritoEm.toISOString(), false],
    ]);
  });
  it('sem saldo no local que atende vai ao substituto; sem saldo em nenhum fica sem local', () => {
    const r = decidirDoses([regra({})], ctx, { temSaldo: (l) => l === 20, prescritoEm, horarios: [h8] });
    expect(r.doses[0]).toMatchObject({ integraEstoque: true, local: 20, usouSubstituto: true });
    const s = decidirDoses([regra({})], ctx, { temSaldo: () => false, prescritoEm, horarios: [h8] });
    expect(s.doses[0]).toMatchObject({ integraEstoque: true, local: null, usouSubstituto: false });
  });
  it('antes do horário: cada dose é liberada pela antecedência do seu horário', () => {
    const r = decidirDoses([regra({ momento: 'antes_do_horario', antecedenciaMinutos: 90 })], ctx, {
      temSaldo: tudo,
      prescritoEm,
      horarios: [h8, h16],
    });
    expect(r.doses.map((d) => d.liberarEm?.toISOString())).toEqual([
      '2026-11-24T12:30:00.000Z',
      '2026-11-24T20:30:00.000Z',
    ]);
  });
  it('regra sem integração: a dose fica fora do estoque', () => {
    const r = decidirDoses([regra({ tipoIntegracao: 'sem_integracao', localSubstituto: null })], ctx, {
      temSaldo: tudo,
      prescritoEm,
      horarios: [h8],
    });
    expect(r.regra?.regra).toBe(1);
    expect(r.doses[0]).toMatchObject({ integraEstoque: false, local: null, liberarEm: null });
  });
  it('liberação farmacêutica e aprazamento esperam o evento', () => {
    for (const momento of ['na_liberacao_farmaceutica', 'no_aprazamento'] as const) {
      const r = decidirDoses([regra({ momento })], ctx, { temSaldo: tudo, prescritoEm, horarios: [h8] });
      expect(r.doses[0]).toMatchObject({ integraEstoque: true, local: 10, liberarEm: null });
    }
  });
});

describe('liberação da dose por evento', () => {
  const quando = new Date('2026-11-24T11:00:00Z');
  const o = { quando, horarioDose: h8 };
  const r = (momento: string, antecedenciaMinutos: number | null = null) => ({
    momento,
    antecedenciaMinutos,
  });
  it('o parecer do farmacêutico libera só a regra da liberação farmacêutica', () => {
    expect(liberacaoPorEvento(r('na_liberacao_farmaceutica'), null, 'liberacao_farmaceutica', o)).toEqual(
      quando,
    );
    expect(liberacaoPorEvento(r('no_aprazamento'), null, 'liberacao_farmaceutica', o)).toBeNull();
    expect(liberacaoPorEvento(r('na_prescricao'), prescritoEm, 'liberacao_farmaceutica', o)).toEqual(
      prescritoEm,
    );
  });
  it('a primeira liberação vale: repetir o evento não adia a dose', () => {
    expect(
      liberacaoPorEvento(r('na_liberacao_farmaceutica'), prescritoEm, 'liberacao_farmaceutica', o),
    ).toEqual(prescritoEm);
    expect(liberacaoPorEvento(r('no_aprazamento'), prescritoEm, 'aprazamento', o)).toEqual(prescritoEm);
  });
  it('o aprazamento libera a regra do aprazamento e recalcula a de antes do horário', () => {
    expect(liberacaoPorEvento(r('no_aprazamento'), null, 'aprazamento', o)).toEqual(quando);
    expect(
      liberacaoPorEvento(r('antes_do_horario', 60), new Date('2026-11-24T09:00:00Z'), 'aprazamento', o),
    ).toEqual(new Date('2026-11-24T13:00:00Z'));
    expect(liberacaoPorEvento(r('na_liberacao_farmaceutica'), null, 'aprazamento', o)).toBeNull();
  });
});

describe('situação da dose para a farmácia', () => {
  const agora = new Date('2026-11-24T12:00:00Z');
  it('fora, sem saldo, aguardando e liberada', () => {
    expect(situacaoDoseIntegrada({ integraEstoque: false, local: null, liberarEm: null }, agora)).toBe(
      'fora',
    );
    expect(situacaoDoseIntegrada({ integraEstoque: true, local: null, liberarEm: agora }, agora)).toBe(
      'sem_saldo',
    );
    expect(situacaoDoseIntegrada({ integraEstoque: true, local: 10, liberarEm: null }, agora)).toBe(
      'aguardando',
    );
    expect(situacaoDoseIntegrada({ integraEstoque: true, local: 10, liberarEm: h8 }, agora)).toBe(
      'aguardando',
    );
    expect(situacaoDoseIntegrada({ integraEstoque: true, local: 10, liberarEm: prescritoEm }, agora)).toBe(
      'liberada',
    );
  });
});
