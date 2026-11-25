// F3.7 (06-FAT linha 37): receita prevista, recebido (baixa e estorno da baixa) e o estorno da reabertura espelhado do
// fechamento contabilizado do ciclo reaberto.
import { describe, expect, it } from 'vitest';
import {
  diferencaEventosReceita,
  type EventoGravado,
  eventoDoFato,
  estornosDaReabertura,
  type FatoFaturamento,
  type RegraContaReceita,
} from './receita-contabil.js';

const regra: RegraContaReceita = {
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
const comPrevista: RegraContaReceita = { ...regra, contaReceitaPrevistaId: 15 };
const fato = (f: Partial<FatoFaturamento>): FatoFaturamento => ({
  fato: 'fechamento',
  chave: 'conta:1:ciclo:1:item:9:fechamento',
  dataReferencia: '2026-10-01',
  valor: 100,
  fontePagadoraId: 7,
  tipoContaId: null,
  tipoLancamentoId: null,
  grupoFaturamentoId: null,
  subgrupoFaturamentoId: null,
  itemFaturavelId: null,
  setorFuncionalId: null,
  componente: null,
  ...f,
});

describe('receita prevista, recebido e estorno da reabertura (06-FAT linha 37)', () => {
  it('a previsão só existe com a conta de receita prevista na regra', () => {
    expect(eventoDoFato([regra], fato({ fato: 'previsao', chave: 'conta:1:item:9:previsao' }))).toBeNull();
    expect(
      eventoDoFato([comPrevista], fato({ fato: 'previsao', chave: 'conta:1:item:9:previsao' })),
    ).toMatchObject({ tipoAcao: 'previsao', debitoContaContabilId: 15, creditoContaContabilId: 10 });
  });
  it('o fechamento do item previsto transfere da prevista; sem previsão reconhece na receita', () => {
    expect(eventoDoFato([comPrevista], fato({ previsto: true }))).toMatchObject({
      tipoAcao: 'receita',
      debitoContaContabilId: 40,
      creditoContaContabilId: 15,
    });
    expect(eventoDoFato([comPrevista], fato({ previsto: false }))).toMatchObject({
      creditoContaContabilId: 10,
    });
    // Regra sem prevista: o "previsto" não muda nada.
    expect(eventoDoFato([regra], fato({ previsto: true }))).toMatchObject({ creditoContaContabilId: 10 });
    expect(eventoDoFato([comPrevista], fato({ fato: 'reabertura', previsto: true }))).toMatchObject({
      tipoAcao: 'estorno',
      debitoContaContabilId: 15,
      creditoContaContabilId: 40,
    });
  });
  it('o recebido sai do "a receber" para a conta de entrada; o estorno da baixa volta', () => {
    expect(eventoDoFato([regra], fato({ fato: 'recebimento', contaEntradaId: 50 }))).toMatchObject({
      tipoAcao: 'recebimento',
      debitoContaContabilId: 50,
      creditoContaContabilId: 40,
    });
    expect(eventoDoFato([regra], fato({ fato: 'recebimento_estornado', contaEntradaId: 50 }))).toMatchObject({
      tipoAcao: 'estorno',
      debitoContaContabilId: 40,
      creditoContaContabilId: 50,
    });
    expect(eventoDoFato([regra], fato({ fato: 'recebimento' }))).toMatchObject({
      motivo: expect.stringMatching(/conta de entrada/),
    });
    expect(eventoDoFato([regra], fato({ fato: 'recebimento', contaEntradaId: 40 }))).toMatchObject({
      motivo: expect.stringMatching(/mesma conta/),
    });
  });
  it('a reabertura estorna só o contabilizado do ciclo reaberto, uma vez, com a chave própria', () => {
    const g = (
      id: number,
      chave: string,
      situacao: EventoGravado['situacao'],
      tipo = 'receita',
    ): EventoGravado => ({
      id,
      chave,
      situacao,
      dataReferencia: '2026-10-01',
      tipoAcao: tipo as EventoGravado['tipoAcao'],
      debitoContaContabilId: tipo === 'desconto' ? 35 : 40,
      creditoContaContabilId: tipo === 'desconto' ? 40 : 10,
      valor: 80,
      regraId: 1,
    });
    const gravados = [
      g(1, 'conta:1:ciclo:1:item:9:fechamento', 'contabilizado'),
      g(2, 'conta:1:ciclo:1:item:9:desconto', 'contabilizado', 'desconto'),
      g(3, 'conta:1:ciclo:1:item:8:fechamento', 'pendente'),
      g(4, 'conta:1:ciclo:2:item:9:fechamento', 'contabilizado'),
      g(5, 'conta:1:item:9:previsao', 'contabilizado', 'previsao'),
    ];
    const est = estornosDaReabertura(gravados, new Map([[1, '2026-10-20']]));
    expect(est).toEqual([
      {
        chave: 'conta:1:ciclo:1:item:9:reabertura',
        dataReferencia: '2026-10-20',
        tipoAcao: 'estorno',
        debitoContaContabilId: 10,
        creditoContaContabilId: 40,
        valor: 80,
        regraId: 1,
      },
      expect.objectContaining({
        chave: 'conta:1:ciclo:1:item:9:reabertura-desconto',
        debitoContaContabilId: 40,
        creditoContaContabilId: 35,
      }),
    ]);
    // Apurar com o ciclo 2 vivo: o pendente do ciclo 1 é cancelado; os estornos entram uma vez só.
    const ciclo2 = { ...gravados[3]!, id: undefined } as unknown as EventoGravado;
    const d = diferencaEventosReceita(gravados, [...est, ciclo2, gravados[4]!]);
    expect(d.cancelar).toEqual([3]);
    expect(d.incluir.map((x) => x.chave)).toEqual([
      'conta:1:ciclo:1:item:9:reabertura',
      'conta:1:ciclo:1:item:9:reabertura-desconto',
    ]);
    const depois: EventoGravado[] = [
      ...gravados,
      ...est.map((x, i) => ({ ...x, id: 10 + i, situacao: 'pendente' as const })),
    ];
    expect(diferencaEventosReceita(depois, [...est, ciclo2, gravados[4]!]).incluir).toEqual([]);
  });
});
