import { describe, expect, it } from 'vitest';
import {
  diferencaEventosReceita,
  type FatoFaturamento,
  eventoDoFato,
  type RegraContaReceita,
  regraDoFatoReceita,
} from './receita-contabil.js';

const base: RegraContaReceita = {
  id: 1,
  ativo: true,
  prioridade: 100,
  fontePagadoraId: null,
  tipoContaId: null,
  tipoLancamentoId: null,
  grupoFaturamentoId: null,
  componente: 'todos',
  contaReceitaId: 10,
  contaGlosaId: 20,
  contaRecuperacaoGlosaId: 30,
  contaTransitoriaClienteId: 40,
};
const especifica: RegraContaReceita = { ...base, id: 2, fontePagadoraId: 7, contaReceitaId: 11 };
const fato: FatoFaturamento = {
  fato: 'fechamento',
  chave: 'conta:1:item:9:fechamento',
  valor: 150.5,
  fontePagadoraId: 7,
  tipoContaId: 3,
  tipoLancamentoId: null,
  grupoFaturamentoId: 4,
  componente: 'servico_hospitalar',
};

describe('evento contábil da receita do faturamento (06-FAT linha 37)', () => {
  it('escolhe a regra mais específica na mesma prioridade e respeita a prioridade', () => {
    expect(regraDoFatoReceita([base, especifica], fato)?.id).toBe(2);
    expect(regraDoFatoReceita([{ ...base, prioridade: 1 }, especifica], fato)?.id).toBe(1);
    expect(regraDoFatoReceita([{ ...especifica, ativo: false }], fato)).toBeNull();
    expect(regraDoFatoReceita([{ ...base, componente: 'sadt' }], fato)).toBeNull();
  });
  it('fechamento, reabertura, glosa e recurso com débito e crédito pela regra', () => {
    expect(eventoDoFato([base], fato)).toMatchObject({
      tipoAcao: 'receita',
      debitoContaContabilId: 40,
      creditoContaContabilId: 10,
      valor: 150.5,
    });
    expect(eventoDoFato([base], { ...fato, fato: 'reabertura' })).toMatchObject({
      tipoAcao: 'estorno',
      debitoContaContabilId: 10,
      creditoContaContabilId: 40,
    });
    expect(eventoDoFato([base], { ...fato, fato: 'glosa' })).toMatchObject({
      tipoAcao: 'glosa',
      debitoContaContabilId: 20,
      creditoContaContabilId: 40,
    });
    expect(eventoDoFato([base], { ...fato, fato: 'recurso_acatado' })).toMatchObject({
      tipoAcao: 'recurso',
      debitoContaContabilId: 40,
      creditoContaContabilId: 30,
    });
  });
  it('sem regra, sem conta exigida ou valor zero vira pendência com motivo', () => {
    expect(eventoDoFato([], fato)).toMatchObject({ motivo: expect.stringMatching(/nenhuma regra/) });
    expect(eventoDoFato([{ ...base, contaGlosaId: null }], { ...fato, fato: 'glosa' })).toMatchObject({
      motivo: expect.stringMatching(/glosa/),
    });
    expect(eventoDoFato([base], { ...fato, valor: 0 })).toMatchObject({
      motivo: expect.stringMatching(/zero/),
    });
    expect(eventoDoFato([{ ...base, contaTransitoriaClienteId: 10 }], fato)).toMatchObject({
      motivo: expect.stringMatching(/mesma conta/),
    });
  });
  it('apuração idempotente: igual fica, pendente diferente cancela, contabilizado diferente estorna', () => {
    const ev = eventoDoFato([base], fato);
    if (!('tipoAcao' in ev)) throw new Error('esperava evento');
    expect(diferencaEventosReceita([{ ...ev, id: 1, situacao: 'pendente' }], [ev])).toEqual({
      incluir: [],
      cancelar: [],
      estornar: [],
    });
    const novo = { ...ev, valor: 200 };
    expect(diferencaEventosReceita([{ ...ev, id: 1, situacao: 'pendente' }], [novo])).toEqual({
      incluir: [novo],
      cancelar: [1],
      estornar: [],
    });
    const r = diferencaEventosReceita([{ ...ev, id: 2, situacao: 'contabilizado' }], []);
    expect(r.estornar.map((e) => e.id)).toEqual([2]);
    expect(r.cancelar).toEqual([]);
  });
});
