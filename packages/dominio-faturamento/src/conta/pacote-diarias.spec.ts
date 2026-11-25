// F3.4 (04-INT linha 81): pacote de diárias por acomodação sobre as diárias devidas da apuração.
import { describe, expect, it } from 'vitest';
import { apurarLancamentos, type EntradaApuracao } from './admissao.js';
import { aplicarPacoteNasDiarias, type PacoteDeDiarias, validarDiariaDoPacote } from './pacote-diarias.js';

const ENF = 10;
const APTO = 30;
const entrada: EntradaApuracao = {
  natureza: 'internacao',
  entrada: '2026-11-20T13:00',
  limite: '2026-11-24T15:00',
  alta: true,
  trechos: [
    { inicio: '2026-11-20T13:00', fim: '2026-11-22T10:00', categoriaAcomodacao: ENF },
    { inicio: '2026-11-22T10:00', fim: '2026-11-24T15:00', categoriaAcomodacao: APTO },
  ],
  fontePagadora: 7,
  plano: null,
  modalidade: null,
  idadeAnos: 40,
  acompanhante: false,
  regrasDiaria: [ENF, APTO].map((c, k) => ({
    id: k + 1,
    fontePagadora: null,
    plano: null,
    categoriaAcomodacao: c,
    modalidade: null,
    idadeMinima: null,
    idadeMaxima: null,
    acompanhante: false,
    item: 100 + c,
    grupo: null,
    quantidade: 1,
    horaVirada: '12:00',
    toleranciaMinutos: 0,
    substituiGeral: false,
    prioridade: 100,
    vigenciaInicio: '2020-01-01',
    vigenciaFim: null,
  })),
  taxas: [],
  vigentes: [],
};
const acom = (
  categoriaAcomodacao: number,
  incluidas: number,
  extra: Partial<PacoteDeDiarias['acomodacoes'][number]> = {},
) => ({
  categoriaAcomodacao,
  incluidas,
  itemExcedente: null,
  valorExcedente: null,
  itemComplementar: null,
  quantidadeComplementar: null,
  itemAdicional: null,
  quantidadeAdicional: null,
  ...extra,
});
const resumo = (
  xs: readonly {
    chave: string;
    dia: string;
    item: number;
    valorFixo: number | null;
    semCobranca?: boolean;
  }[],
) => xs.map((x) => `${x.dia}:${x.chave}:${x.item}:${x.valorFixo ?? '-'}${x.semCobranca ? ':sem' : ''}`);

describe('pacote de diárias por acomodação', () => {
  it('sem pacote, as diárias de sempre (uma por dia de corte: 20, 21 e 22 na enfermaria pela virada; 23 e 24 no apartamento)', () => {
    expect(resumo(apurarLancamentos(entrada).lancar)).toEqual([
      '2026-11-20:diaria:110:-',
      '2026-11-21:diaria:110:-',
      '2026-11-22:diaria:130:-',
      '2026-11-23:diaria:130:-',
      '2026-11-24:diaria:130:-',
    ]);
  });

  it('as incluídas por acomodação entram sem cobrança; as excedentes com o item e o valor do pacote, mais o adicional', () => {
    const pacotes: PacoteDeDiarias[] = [
      {
        contaPacote: 5,
        incluidasGeral: null,
        acomodacoes: [
          acom(ENF, 1, { itemComplementar: 900, quantidadeComplementar: 2 }),
          acom(APTO, 2, {
            itemExcedente: 777,
            valorExcedente: 60,
            itemAdicional: 901,
            quantidadeAdicional: 1,
          }),
        ],
      },
    ];
    expect(resumo(apurarLancamentos({ ...entrada, pacotes }).lancar)).toEqual([
      '2026-11-20:pacote-diaria:5:110:-:sem',
      '2026-11-20:pacote-complementar:5:900:-',
      '2026-11-21:diaria:110:-',
      '2026-11-22:pacote-diaria:5:130:-:sem',
      '2026-11-23:pacote-diaria:5:130:-:sem',
      '2026-11-24:diaria:777:60',
      '2026-11-24:pacote-adicional:5:901:-',
    ]);
  });

  it('sem linha da acomodação vale o total do pacote, contado em todas as acomodações', () => {
    const pacotes: PacoteDeDiarias[] = [{ contaPacote: 8, incluidasGeral: 3, acomodacoes: [] }];
    const r = apurarLancamentos({ ...entrada, pacotes }).lancar;
    expect(r.filter((x) => x.semCobranca).map((x) => x.dia)).toEqual([
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    expect(r.filter((x) => x.chave === 'diaria').map((x) => x.dia)).toEqual(['2026-11-23', '2026-11-24']);
    expect(r.every((x) => !x.semCobranca || x.contaPacote === 8)).toBe(true);
  });

  it('aplicar o pacote depois estorna a diária incluída e lança a do pacote; repetir não muda nada', () => {
    const pacotes: PacoteDeDiarias[] = [
      { contaPacote: 5, incluidasGeral: null, acomodacoes: [acom(ENF, 2)] },
    ];
    const antes = apurarLancamentos(entrada).lancar;
    const vigentes = antes.map((x, k) => ({
      id: k + 1,
      chave: x.chave,
      dia: x.dia,
      item: x.item,
      categoriaAcomodacao: x.categoriaAcomodacao,
    }));
    const r = apurarLancamentos({ ...entrada, vigentes, pacotes });
    expect(r.estornar).toEqual([
      { id: 1, motivo: 'alta' },
      { id: 2, motivo: 'alta' },
    ]);
    expect(resumo(r.lancar)).toEqual([
      '2026-11-20:pacote-diaria:5:110:-:sem',
      '2026-11-21:pacote-diaria:5:110:-:sem',
    ]);
    const todos = [
      ...vigentes.slice(2),
      ...r.lancar.map((x, k) => ({
        id: 50 + k,
        chave: x.chave,
        dia: x.dia,
        item: x.item,
        categoriaAcomodacao: x.categoriaAcomodacao,
      })),
    ];
    expect(apurarLancamentos({ ...entrada, vigentes: todos, pacotes })).toMatchObject({
      lancar: [],
      estornar: [],
    });
  });

  it('a diária adicional da faixa etária e a do acompanhante não entram no pacote', () => {
    const devidos = apurarLancamentos(entrada).lancar;
    const outros = [{ ...devidos[0]!, chave: 'diaria-acompanhante', item: 555 }];
    const r = aplicarPacoteNasDiarias(
      [...devidos, ...outros],
      [{ contaPacote: 1, incluidasGeral: 9, acomodacoes: [] }],
    );
    expect(r.filter((x) => x.chave === 'diaria-acompanhante')).toHaveLength(1);
  });

  it('valida a composição na hora', () => {
    expect(validarDiariaDoPacote(acom(ENF, -1))).toMatch(/negativa/);
    expect(validarDiariaDoPacote(acom(ENF, 1, { valorExcedente: -2 }))).toMatch(/negativo/);
    expect(validarDiariaDoPacote(acom(ENF, 1, { itemAdicional: 3 }))).toMatch(/adicional/);
    expect(
      validarDiariaDoPacote(acom(ENF, 1, { itemComplementar: 3, quantidadeComplementar: 1 })),
    ).toBeNull();
  });
});
