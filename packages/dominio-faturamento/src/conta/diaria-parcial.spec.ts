// F3.4 (04-INT linha 81): diária parcial no dia da alta. A regra que gera parcial troca a diária cheia do último dia
// pela parcial quando a saída passa da virada (mais a tolerância) mas fica até a hora limite; o primeiro dia é sempre
// cheio; sem alta (internação em curso) o dia é cheio; dada a alta, a apuração estorna a cheia e lança a parcial, e
// repetida não muda nada.
import { describe, expect, it } from 'vitest';
import { apurarLancamentos, cobraParcial, type EntradaApuracao, type RegraDiaria } from './admissao.js';

const ENF = 10;
const regra = (x: Partial<RegraDiaria> = {}): RegraDiaria => ({
  id: 1,
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
  parcial: { horaLimite: '18:00', item: 150, quantidade: 0.5 },
  ...x,
});
const base = (x: Partial<EntradaApuracao> = {}): EntradaApuracao => ({
  natureza: 'internacao',
  entrada: '2026-11-20T13:00',
  limite: '2026-11-22T15:00',
  alta: true,
  trechos: [{ inicio: '2026-11-20T13:00', fim: '2026-11-22T15:00', categoriaAcomodacao: ENF }],
  fontePagadora: 7,
  plano: null,
  modalidade: null,
  idadeAnos: 40,
  acompanhante: false,
  regrasDiaria: [regra()],
  taxas: [],
  vigentes: [],
  ...x,
});
const linhas = (r: ReturnType<typeof apurarLancamentos>) =>
  r.lancar.map((l) => `${l.dia}:${l.chave}:${l.item}:${l.quantidade}`);

describe('diária parcial no dia da alta', () => {
  it('saída depois da virada e até a hora limite: o último dia é a parcial (item e quantidade da parcial)', () => {
    expect(linhas(apurarLancamentos(base()))).toEqual([
      '2026-11-20:diaria:100:1',
      '2026-11-21:diaria:100:1',
      '2026-11-22:diaria-parcial:150:0.5',
    ]);
  });

  it('saída depois da hora limite: diária cheia; antes da virada: nenhuma diária no dia', () => {
    const tarde = base({ limite: '2026-11-22T18:01' });
    expect(linhas(apurarLancamentos(tarde)).at(-1)).toBe('2026-11-22:diaria:100:1');
    const cedo = base({ limite: '2026-11-22T11:00' });
    expect(linhas(apurarLancamentos(cedo)).at(-1)).toBe('2026-11-21:diaria:100:1');
  });

  it('na hora limite exata ainda é parcial; sem item e quantidade próprios usa os da diária', () => {
    const r = base({
      limite: '2026-11-22T18:00',
      regrasDiaria: [regra({ parcial: { horaLimite: '18:00', item: null, quantidade: null } })],
    });
    expect(linhas(apurarLancamentos(r)).at(-1)).toBe('2026-11-22:diaria-parcial:100:1');
  });

  it('o primeiro dia é sempre cheio, mesmo com a alta no mesmo dia', () => {
    const r = base({ limite: '2026-11-20T15:00' });
    expect(linhas(apurarLancamentos(r))).toEqual(['2026-11-20:diaria:100:1']);
  });

  it('sem alta o dia é cheio; regra sem parcial nunca gera parcial', () => {
    expect(linhas(apurarLancamentos(base({ alta: false }))).at(-1)).toBe('2026-11-22:diaria:100:1');
    const sem = base({ regrasDiaria: [regra({ parcial: null })] });
    expect(linhas(apurarLancamentos(sem)).at(-1)).toBe('2026-11-22:diaria:100:1');
    expect(cobraParcial(regra(), '2026-11-22', '2026-11-22T15:00', false)).toBe(false);
  });

  it('dada a alta, estorna a cheia do dia com o motivo "alta" e lança a parcial; repetida, nada muda', () => {
    const vigentes = [
      { id: 1, chave: 'diaria', dia: '2026-11-20', item: 100, categoriaAcomodacao: ENF },
      { id: 2, chave: 'diaria', dia: '2026-11-21', item: 100, categoriaAcomodacao: ENF },
      { id: 3, chave: 'diaria', dia: '2026-11-22', item: 100, categoriaAcomodacao: ENF },
    ];
    const r = apurarLancamentos(base({ vigentes }));
    expect(r.estornar).toEqual([{ id: 3, motivo: 'alta' }]);
    expect(linhas(r)).toEqual(['2026-11-22:diaria-parcial:150:0.5']);
    const depois = [
      ...vigentes.slice(0, 2),
      { id: 4, chave: 'diaria-parcial', dia: '2026-11-22', item: 150, categoriaAcomodacao: ENF },
    ];
    const r2 = apurarLancamentos(base({ vigentes: depois }));
    expect(r2.lancar).toEqual([]);
    expect(r2.estornar).toEqual([]);
  });
});
