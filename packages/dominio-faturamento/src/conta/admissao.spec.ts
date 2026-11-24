import { describe, expect, it } from 'vitest';
import {
  apurarLancamentos,
  competenciaDaConta,
  type EntradaApuracao,
  escolherTipoConta,
  naturezaDaEntrada,
  numeroDaConta,
  type RegraDiaria,
  type TaxaAutomatica,
} from './admissao.js';

const ENF = 10;
const UTI = 20;
const regra = (x: Partial<RegraDiaria> & { id: number }): RegraDiaria => ({
  fontePagadora: null,
  plano: null,
  categoriaAcomodacao: ENF,
  modalidade: null,
  idadeMinima: null,
  idadeMaxima: null,
  acompanhante: false,
  item: 100,
  grupo: null,
  quantidade: 1,
  horaVirada: '12:00',
  toleranciaMinutos: 0,
  substituiGeral: false,
  prioridade: 100,
  vigenciaInicio: '2020-01-01',
  vigenciaFim: null,
  ...x,
});
const taxa = (x: Partial<TaxaAutomatica> & { regraItem: number }): TaxaAutomatica => ({
  regraLancamento: 1,
  gatilho: 'abertura_atendimento',
  acao: 'incluir',
  exigeConfirmacao: false,
  umaVezPorConta: false,
  item: 500,
  grupo: null,
  quantidade: 1,
  tipoValor: 'tabela',
  valor: null,
  aplica: { internacao: true, ambulatorial: true, externo: true, urgencia: true, domiciliar: true },
  vigenciaInicio: '2020-01-01',
  vigenciaFim: null,
  ...x,
});
const base = (x: Partial<EntradaApuracao> = {}): EntradaApuracao => ({
  natureza: 'internacao',
  entrada: '2026-11-20T13:00',
  limite: '2026-11-20T15:00',
  alta: false,
  trechos: [{ inicio: '2026-11-20T13:00', fim: null, categoriaAcomodacao: ENF }],
  fontePagadora: 7,
  plano: null,
  modalidade: null,
  idadeAnos: 40,
  acompanhante: false,
  regrasDiaria: [regra({ id: 1 }), regra({ id: 2, categoriaAcomodacao: UTI, item: 200 })],
  taxas: [],
  vigentes: [],
  ...x,
});
const dias = (r: ReturnType<typeof apurarLancamentos>, chave = 'diaria') =>
  r.lancar.filter((l) => l.chave === chave).map((l) => `${l.dia}:${l.item}`);

describe('conta na entrada: natureza, tipo, competência e número', () => {
  it('natureza pelo tipo base; tipo de conta único ou de menor ordem; empate recusa', () => {
    expect(naturezaDaEntrada('internacao')).toBe('internacao');
    expect(naturezaDaEntrada('pronto_atendimento')).toBe('pronto_atendimento');
    expect(naturezaDaEntrada('ambulatorio')).toBe('ambulatorial');
    expect(naturezaDaEntrada('outra')).toBeNull();
    expect(escolherTipoConta([{ id: 3, ordem: 0 }], 'internacao')).toEqual({ tipo: 3 });
    expect(escolherTipoConta([{ id: 3, ordem: 2 }, { id: 4, ordem: 1 }], 'internacao')).toEqual({ tipo: 4 });
    expect(escolherTipoConta([{ id: 3, ordem: 1 }, { id: 4, ordem: 1 }], 'internacao')).toMatchObject({
      recusa: 'tipo-conta-ambiguo',
    });
    expect(escolherTipoConta([], 'pronto_atendimento')).toMatchObject({ recusa: 'tipo-conta-inexistente' });
    expect(competenciaDaConta('2026-11-24')).toBe('2026-11-01');
    expect(numeroDaConta('000123', 1)).toBe('000123-1');
    expect(() => numeroDaConta('x'.repeat(19), 1)).toThrow();
  });
});

describe('diárias por dia de corte', () => {
  it('o dia da entrada gera a primeira diária; cada virada com o paciente internado gera outra', () => {
    expect(dias(apurarLancamentos(base()))).toEqual(['2026-11-20:100']);
    // Até o dia 22 às 11:59: viradas do dia 21 (12:00) contam, a do dia 22 ainda não.
    expect(dias(apurarLancamentos(base({ limite: '2026-11-22T11:59' })))).toEqual([
      '2026-11-20:100',
      '2026-11-21:100',
    ]);
    expect(dias(apurarLancamentos(base({ limite: '2026-11-22T12:00' })))).toHaveLength(3);
  });

  it('tolerância depois da virada não gera nova diária', () => {
    const r = base({ regrasDiaria: [regra({ id: 1, toleranciaMinutos: 60 })], limite: '2026-11-21T12:59' });
    expect(dias(apurarLancamentos(r))).toEqual(['2026-11-20:100']);
  });

  it('idempotente: com o devido já lançado, nada a lançar nem estornar', () => {
    const r1 = apurarLancamentos(base({ limite: '2026-11-21T13:00' }));
    const vigentes = r1.lancar.map((l, i) => ({
      id: i + 1,
      chave: l.chave,
      dia: l.dia,
      item: l.item,
      categoriaAcomodacao: l.categoriaAcomodacao,
    }));
    const r2 = apurarLancamentos(base({ limite: '2026-11-21T13:00', vigentes }));
    expect(r2.lancar).toEqual([]);
    expect(r2.estornar).toEqual([]);
  });

  it('troca de acomodação antes da virada: a diária do dia vai para a nova e a antiga é estornada', () => {
    const trechos = [
      { inicio: '2026-11-20T13:00', fim: '2026-11-21T10:00', categoriaAcomodacao: ENF },
      { inicio: '2026-11-21T10:00', fim: null, categoriaAcomodacao: UTI },
    ];
    const vigentes = [
      { id: 1, chave: 'diaria', dia: '2026-11-20', item: 100, categoriaAcomodacao: ENF },
      { id: 2, chave: 'diaria', dia: '2026-11-21', item: 100, categoriaAcomodacao: ENF },
    ];
    const r = apurarLancamentos(base({ trechos, vigentes, limite: '2026-11-21T14:00' }));
    expect(r.estornar).toEqual([{ id: 2, motivo: 'troca_acomodacao' }]);
    expect(dias(r)).toEqual(['2026-11-21:200']);
  });

  it('alta antes da virada fecha a contagem e estorna a diária do dia que deixou de ser devida', () => {
    const vigentes = [
      { id: 1, chave: 'diaria', dia: '2026-11-20', item: 100, categoriaAcomodacao: ENF },
      { id: 2, chave: 'diaria', dia: '2026-11-21', item: 100, categoriaAcomodacao: ENF },
    ];
    const trechos = [{ inicio: '2026-11-20T13:00', fim: '2026-11-21T09:00', categoriaAcomodacao: ENF }];
    const r = apurarLancamentos(base({ trechos, vigentes, limite: '2026-11-21T09:00', alta: true }));
    expect(r.estornar).toEqual([{ id: 2, motivo: 'alta' }]);
    expect(r.lancar).toEqual([]);
  });

  it('especificidade vence; empate é pendência; faixa etária adicional e acompanhante somam', () => {
    const r = apurarLancamentos(
      base({
        acompanhante: true,
        idadeAnos: 70,
        regrasDiaria: [
          regra({ id: 1 }),
          regra({ id: 3, fontePagadora: 7, item: 101 }),
          regra({ id: 4, idadeMinima: 60, item: 102 }),
          regra({ id: 5, acompanhante: true, item: 103 }),
        ],
      }),
    );
    expect(r.lancar.map((l) => `${l.chave}:${l.item}`)).toEqual(['diaria:101', 'diaria:4:102', 'diaria-acompanhante:103']);
    const empate = apurarLancamentos(base({ regrasDiaria: [regra({ id: 1 }), regra({ id: 2, item: 9 })] }));
    expect(empate.lancar).toEqual([]);
    expect(empate.pendencias).toEqual([{ dia: '2026-11-20', motivo: 'regra-ambigua' }]);
    const sem = apurarLancamentos(base({ regrasDiaria: [] }));
    expect(sem.pendencias).toEqual([{ dia: '2026-11-20', motivo: 'sem-regra' }]);
  });
});

describe('taxas automáticas', () => {
  it('abertura uma vez; por diária a cada dia (ou só na primeira); natureza, confirmação e percentual filtram', () => {
    const taxas = [
      taxa({ regraItem: 1 }),
      taxa({ regraItem: 2, gatilho: 'diaria_internacao', item: 501 }),
      taxa({ regraItem: 3, gatilho: 'diaria_internacao', umaVezPorConta: true, item: 502 }),
      taxa({ regraItem: 4, exigeConfirmacao: true }),
      taxa({ regraItem: 5, tipoValor: 'percentual', valor: null }),
      taxa({ regraItem: 6, aplica: { internacao: false, ambulatorial: true, externo: true, urgencia: true, domiciliar: true } }),
    ];
    const r = apurarLancamentos(base({ taxas, limite: '2026-11-21T13:00' }));
    expect(r.lancar.filter((l) => l.chave.startsWith('taxa:')).map((l) => `${l.chave}@${l.dia}`)).toEqual([
      'taxa:1@2026-11-20',
      'taxa:2@2026-11-20',
      'taxa:3@2026-11-20',
      'taxa:2@2026-11-21',
    ]);
    const pa = apurarLancamentos(base({ natureza: 'pronto_atendimento', taxas }));
    expect(pa.lancar.map((l) => l.chave)).toEqual(['taxa:1', 'taxa:6']);
  });
});
