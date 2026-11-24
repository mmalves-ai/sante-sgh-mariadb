import { describe, expect, it } from 'vitest';
import {
  apurarLancamentos,
  competenciaDaConta,
  type EntradaApuracao,
  escolherTipoConta,
  type ExcecaoRegraLancamento,
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

describe('entrada excluída', () => {
  it('nada é devido (nem a taxa de abertura) e tudo o que estava vigente é estornado com o motivo "cancelamento"', () => {
    const taxas = [taxa({ regraItem: 1 })];
    const aberta = apurarLancamentos(base({ taxas }));
    expect(aberta.lancar.map((l) => l.chave).sort()).toEqual(['diaria', 'taxa:1']);
    const vigentes = [
      { id: 1, chave: 'taxa:1', dia: '2026-11-20', item: 500, categoriaAcomodacao: ENF },
      { id: 2, chave: 'diaria', dia: '2026-11-20', item: 100, categoriaAcomodacao: ENF },
    ];
    const r = apurarLancamentos(base({ taxas, vigentes, cancelada: true, alta: true }));
    expect(r.lancar).toEqual([]);
    expect(r.estornar).toEqual([
      { id: 1, motivo: 'cancelamento' },
      { id: 2, motivo: 'cancelamento' },
    ]);
    // A mesma regra sem cancelamento e com alta: o motivo da diária que sobra é "alta", nunca "cancelamento".
    const alta = apurarLancamentos(
      base({ taxas, vigentes: [...vigentes, { id: 3, chave: 'diaria', dia: '2026-11-21', item: 100, categoriaAcomodacao: ENF }], alta: true }),
    );
    expect(alta.estornar).toEqual([{ id: 3, motivo: 'alta' }]);
  });
});

describe('exceções da regra de lançamento e tabela forçada', () => {
  const todas = { internacao: true, ambulatorial: true, externo: true, urgencia: true, domiciliar: true };
  const excecao = (x: Partial<ExcecaoRegraLancamento>): ExcecaoRegraLancamento => ({
    estabelecimento: null,
    fontePagadora: null,
    plano: null,
    setor: null,
    especialidade: null,
    item: null,
    grupo: null,
    efeito: 'nao_aplicar',
    aplica: todas,
    vigenciaInicio: null,
    vigenciaFim: null,
    ...x,
  });
  const recorte = { estabelecimento: 3, setor: 40, especialidade: null };
  const taxas = (excecoes: ExcecaoRegraLancamento[]) => [taxa({ regraItem: 1, excecoes, tabelaPreco: 77 })];
  const chaves = (x: Partial<EntradaApuracao>) =>
    apurarLancamentos(base({ natureza: 'ambulatorial', recorte, ...x })).lancar.map((l) => l.chave);

  it('"nao_aplicar" tira a regra só do recorte (estabelecimento, fonte, setor); fora dele a regra vale', () => {
    expect(chaves({ taxas: taxas([excecao({ estabelecimento: 3 })]) })).toEqual([]);
    expect(chaves({ taxas: taxas([excecao({ estabelecimento: 4 })]) })).toEqual(['taxa:1']);
    expect(chaves({ taxas: taxas([excecao({ fontePagadora: 7, setor: 40 })]) })).toEqual([]);
    expect(chaves({ taxas: taxas([excecao({ fontePagadora: 7, setor: 41 })]) })).toEqual(['taxa:1']);
    // Exceção fora da vigência ou de outra natureza não vale.
    expect(chaves({ taxas: taxas([excecao({ estabelecimento: 3, vigenciaFim: '2026-01-01' })]) })).toEqual(['taxa:1']);
    expect(
      chaves({ taxas: taxas([excecao({ estabelecimento: 3, aplica: { ...todas, ambulatorial: false } })]) }),
    ).toEqual(['taxa:1']);
  });

  it('"aplicar_somente": a regra só vale onde uma exceção casa', () => {
    expect(chaves({ taxas: taxas([excecao({ efeito: 'aplicar_somente', fontePagadora: 8 })]) })).toEqual([]);
    expect(
      chaves({
        taxas: taxas([
          excecao({ efeito: 'aplicar_somente', fontePagadora: 8 }),
          excecao({ efeito: 'aplicar_somente', fontePagadora: 7 }),
        ]),
      }),
    ).toEqual(['taxa:1']);
  });

  it('a tabela forçada do item da regra segue no lançamento; a diária usa a da conta', () => {
    const r = apurarLancamentos(base({ taxas: taxas([]) }));
    expect(r.lancar.find((l) => l.chave === 'taxa:1')?.tabelaPreco).toBe(77);
    expect(r.lancar.find((l) => l.chave === 'diaria')?.tabelaPreco).toBeNull();
  });
});

describe('troca de acomodação e taxas', () => {
  it('a diária do dia é refeita na nova acomodação; a taxa do mesmo dia continua (não depende da acomodação)', () => {
    const taxas = [taxa({ regraItem: 1 })];
    const r = apurarLancamentos(
      base({
        taxas,
        trechos: [{ inicio: '2026-11-20T13:00', fim: null, categoriaAcomodacao: UTI }],
        vigentes: [
          { id: 1, chave: 'diaria', dia: '2026-11-20', item: 100, categoriaAcomodacao: ENF },
          { id: 2, chave: 'taxa:1', dia: '2026-11-20', item: 500, categoriaAcomodacao: ENF },
        ],
      }),
    );
    expect(r.estornar).toEqual([{ id: 1, motivo: 'troca_acomodacao' }]);
    expect(r.lancar.map((l) => `${l.chave}:${l.item}`)).toEqual(['diaria:200']);
  });
});
