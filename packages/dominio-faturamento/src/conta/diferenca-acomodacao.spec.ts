// F3.4 (04-INT linha 81): diferença de acomodação cobrada do paciente sobre as diárias devidas.
import { describe, expect, it } from 'vitest';
import { apurarLancamentos, type EntradaApuracao } from './admissao.js';
import { cobrancasDeDiferenca, type DiferencaAcomodacao, validarDiferenca } from './diferenca-acomodacao.js';

const ENF = 10;
const APTO = 30;
const entrada: EntradaApuracao = {
  natureza: 'internacao',
  entrada: '2026-11-20T13:00',
  limite: '2026-11-23T15:00',
  alta: true,
  trechos: [
    { inicio: '2026-11-20T13:00', fim: '2026-11-21T10:00', categoriaAcomodacao: ENF },
    { inicio: '2026-11-21T10:00', fim: '2026-11-23T15:00', categoriaAcomodacao: APTO },
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
const dif = (x: Partial<DiferencaAcomodacao> = {}): DiferencaAcomodacao => ({
  id: 9,
  direito: ENF,
  utilizada: APTO,
  item: 900,
  valorDiario: 120,
  inicio: '2026-11-21',
  fim: null,
  situacao: 'aceita',
  aceite: true,
  ...x,
});
const diarias = apurarLancamentos(entrada).lancar;

describe('diferença de acomodação', () => {
  it('aceita: cada diária na acomodação utilizada dentro do período cobra o valor diário', () => {
    const r = cobrancasDeDiferenca(diarias, [dif()]);
    expect(r.devidos.map((d) => `${d.dia}:${d.chave}:${d.item}:${d.valorFixo}`)).toEqual([
      '2026-11-21:diferenca:9:900:120',
      '2026-11-22:diferenca:9:900:120',
      '2026-11-23:diferenca:9:900:120',
    ]);
    expect(r.pendencias).toEqual([]);
  });

  it('o fim do período limita os dias; a encerrada cobra até o fim', () => {
    const r = cobrancasDeDiferenca(diarias, [dif({ situacao: 'encerrada', fim: '2026-11-22' })]);
    expect(r.devidos.map((d) => d.dia)).toEqual(['2026-11-21', '2026-11-22']);
  });

  it('proposta, recusada, cancelada ou sem aceite não cobram', () => {
    for (const situacao of ['proposta', 'recusada', 'cancelada'] as const)
      expect(cobrancasDeDiferenca(diarias, [dif({ situacao })]).devidos).toEqual([]);
    expect(cobrancasDeDiferenca(diarias, [dif({ aceite: false })]).devidos).toEqual([]);
  });

  it('sem item faturável: nenhuma cobrança e a pendência volta para o faturista', () => {
    const r = cobrancasDeDiferenca(diarias, [dif({ item: null })]);
    expect(r.devidos).toEqual([]);
    expect(r.pendencias).toEqual([{ diferenca: 9, motivo: 'sem-item' }]);
  });

  it('validação na hora: mesma acomodação, valor negativo, período invertido, aceita sem aceite', () => {
    expect(validarDiferenca(dif())).toBeNull();
    expect(validarDiferenca(dif({ utilizada: ENF }))).toMatch(/mesma/);
    expect(validarDiferenca(dif({ valorDiario: -1 }))).toMatch(/negativo/);
    expect(validarDiferenca(dif({ fim: '2026-11-01' }))).toMatch(/anterior/);
    expect(validarDiferenca(dif({ aceite: false }))).toMatch(/aceite/);
    expect(cobrancasDeDiferenca(diarias, [dif({ utilizada: ENF })]).devidos).toEqual([]);
  });
});
