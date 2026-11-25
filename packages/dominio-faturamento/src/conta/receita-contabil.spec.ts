import { describe, expect, it } from 'vitest';
import {
  diferencaEventosReceita,
  type EventoReceita,
  eventoDoFato,
  type FatoFaturamento,
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
  subgrupoFaturamentoId: null,
  itemFaturavelId: null,
  setorFuncionalId: null,
  componente: 'todos',
  contaReceitaId: 10,
  contaReceitaPrevistaId: null,
  contaGlosaId: 20,
  contaGlosaAceitaId: 25,
  contaRecuperacaoGlosaId: 30,
  contaDeducaoId: 35,
  contaTransitoriaClienteId: 40,
};
const especifica: RegraContaReceita = { ...base, id: 2, fontePagadoraId: 7, contaReceitaId: 11 };
const fato: FatoFaturamento = {
  fato: 'fechamento',
  chave: 'conta:1:ciclo:1:item:9:fechamento',
  dataReferencia: '2026-10-01',
  valor: 150.5,
  fontePagadoraId: 7,
  tipoContaId: 3,
  tipoLancamentoId: null,
  grupoFaturamentoId: 4,
  subgrupoFaturamentoId: 41,
  itemFaturavelId: 900,
  setorFuncionalId: 60,
  componente: 'servico_hospitalar',
};
const ev = (f: FatoFaturamento, regras = [base]): EventoReceita => {
  const e = eventoDoFato(regras, f);
  if (e === null) throw new Error('esperava evento: o fato não se aplica');
  if (!('tipoAcao' in e)) throw new Error(`esperava evento: ${e.motivo}`);
  return e;
};

describe('evento contábil da receita do faturamento (06-FAT linha 37)', () => {
  it('escolhe a regra mais específica na mesma prioridade e respeita a prioridade', () => {
    expect(regraDoFatoReceita([base, especifica], fato)?.id).toBe(2);
    expect(regraDoFatoReceita([{ ...base, prioridade: 1 }, especifica], fato)?.id).toBe(1);
    expect(regraDoFatoReceita([{ ...especifica, ativo: false }], fato)).toBeNull();
    expect(regraDoFatoReceita([{ ...base, componente: 'sadt' }], fato)).toBeNull();
  });
  it('regra de item e de setor só vale para o próprio item e setor, mesmo com prioridade melhor', () => {
    const doItem: RegraContaReceita = {
      ...base,
      id: 3,
      prioridade: 10,
      itemFaturavelId: 900,
      contaReceitaId: 12,
    };
    const doSetor: RegraContaReceita = {
      ...base,
      id: 4,
      prioridade: 20,
      setorFuncionalId: 60,
      contaReceitaId: 13,
    };
    const doSubgrupo: RegraContaReceita = {
      ...base,
      id: 5,
      prioridade: 30,
      subgrupoFaturamentoId: 41,
      contaReceitaId: 14,
    };
    const regras = [base, doItem, doSetor, doSubgrupo];
    expect(regraDoFatoReceita(regras, fato)?.id).toBe(3);
    expect(regraDoFatoReceita(regras, { ...fato, itemFaturavelId: 901 })?.id).toBe(4);
    expect(regraDoFatoReceita(regras, { ...fato, itemFaturavelId: 901, setorFuncionalId: 61 })?.id).toBe(5);
    // Outro item, outro setor e outro subgrupo: só a genérica (de prioridade pior) casa.
    expect(
      regraDoFatoReceita(regras, {
        ...fato,
        itemFaturavelId: 901,
        setorFuncionalId: 61,
        subgrupoFaturamentoId: 42,
      })?.id,
    ).toBe(1);
    expect(regraDoFatoReceita(regras, { ...fato, itemFaturavelId: null, setorFuncionalId: null })?.id).toBe(
      5,
    );
    expect(
      ev({ ...fato, itemFaturavelId: 901, setorFuncionalId: 61, subgrupoFaturamentoId: 42 }, regras),
    ).toMatchObject({
      creditoContaContabilId: 10,
      regraId: 1,
    });
  });
  it('fechamento, reabertura, glosa, glosa aceita, recurso e desconto com débito e crédito pela regra', () => {
    expect(ev(fato)).toMatchObject({
      tipoAcao: 'receita',
      debitoContaContabilId: 40,
      creditoContaContabilId: 10,
      valor: 150.5,
      dataReferencia: '2026-10-01',
    });
    expect(ev({ ...fato, fato: 'reabertura' })).toMatchObject({
      tipoAcao: 'estorno',
      debitoContaContabilId: 10,
      creditoContaContabilId: 40,
    });
    expect(ev({ ...fato, fato: 'glosa' })).toMatchObject({
      tipoAcao: 'glosa',
      debitoContaContabilId: 20,
      creditoContaContabilId: 40,
    });
    expect(ev({ ...fato, fato: 'glosa_aceita' })).toMatchObject({
      tipoAcao: 'glosa',
      debitoContaContabilId: 25,
      creditoContaContabilId: 40,
    });
    expect(ev({ ...fato, fato: 'recurso_acatado' })).toMatchObject({
      tipoAcao: 'recurso',
      debitoContaContabilId: 40,
      creditoContaContabilId: 30,
    });
    expect(ev({ ...fato, fato: 'desconto' })).toMatchObject({
      tipoAcao: 'desconto',
      debitoContaContabilId: 35,
      creditoContaContabilId: 40,
    });
  });
  it('sem regra, sem conta exigida, sem data, valor zero ou mesma conta vira pendência com motivo', () => {
    expect(eventoDoFato([], fato)).toMatchObject({ motivo: expect.stringMatching(/nenhuma regra/) });
    expect(eventoDoFato([{ ...base, contaGlosaId: null }], { ...fato, fato: 'glosa' })).toMatchObject({
      motivo: expect.stringMatching(/glosa/),
    });
    expect(
      eventoDoFato([{ ...base, contaGlosaAceitaId: null }], { ...fato, fato: 'glosa_aceita' }),
    ).toMatchObject({
      motivo: expect.stringMatching(/glosa aceita/),
    });
    expect(eventoDoFato([base], { ...fato, valor: 0 })).toMatchObject({
      motivo: expect.stringMatching(/zero/),
    });
    expect(eventoDoFato([base], { ...fato, dataReferencia: '2026-02-30' })).toMatchObject({
      motivo: expect.stringMatching(/data de referência/),
    });
    expect(eventoDoFato([{ ...base, contaTransitoriaClienteId: 10 }], fato)).toMatchObject({
      motivo: expect.stringMatching(/mesma conta/),
    });
  });
  it('apuração idempotente: igual fica, pendente diferente cancela, contabilizado nunca é estornado pela diferença', () => {
    const e = ev(fato);
    expect(diferencaEventosReceita([{ ...e, id: 1, situacao: 'pendente' }], [e])).toEqual({
      incluir: [],
      cancelar: [],
      divergentes: [],
    });
    const novo = { ...e, valor: 200 };
    expect(diferencaEventosReceita([{ ...e, id: 1, situacao: 'pendente' }], [novo])).toEqual({
      incluir: [novo],
      cancelar: [1],
      divergentes: [],
    });
    // Contabilizado que deixou de ser apurado: fica (o estorno só vem pelo fato de reabertura).
    expect(diferencaEventosReceita([{ ...e, id: 2, situacao: 'contabilizado' }], [])).toEqual({
      incluir: [],
      cancelar: [],
      divergentes: [],
    });
    // Contabilizado que diverge: volta como divergência, sem incluir outro evento com a mesma chave.
    const r = diferencaEventosReceita([{ ...e, id: 2, situacao: 'contabilizado' }], [novo]);
    expect(r.incluir).toEqual([]);
    expect(r.divergentes.map((d) => d.gravado.id)).toEqual([2]);
  });
  it('reabrir uma conta contabilizada gera um único estorno, apurado uma ou duas vezes', () => {
    const fech = ev(fato);
    const estorno = ev({ ...fato, fato: 'reabertura', chave: 'conta:1:ciclo:1:item:9:reabertura' });
    const gravados = [{ ...fech, id: 1, situacao: 'contabilizado' as const }];
    for (const apurados of [[fech, estorno], [estorno]]) {
      const r = diferencaEventosReceita(gravados, apurados);
      expect(r.incluir).toEqual([estorno]);
      expect(r.cancelar).toEqual([]);
      expect(r.divergentes).toEqual([]);
    }
    // Apurar de novo com o estorno já gravado não inclui outro.
    const depois = [...gravados, { ...estorno, id: 2, situacao: 'pendente' as const }];
    expect(diferencaEventosReceita(depois, [fech, estorno]).incluir).toEqual([]);
  });
});
