// Regra do direito à refeição do acompanhante (F7, 04-HOT linha 133): a regra que vale e a decisão da refeição.
import { describe, expect, it } from 'vitest';
import {
  decidirAutorizacao,
  decidirRefeicaoAcompanhante,
  idadeNaData,
  precoVigenteDaRefeicao,
  type RegraDireitoRefeicao,
  regraRefeicaoVigente,
  type SituacaoDaRefeicao,
  validarRegraDireitoRefeicao,
} from './direito-refeicao.js';

const regra = (x: Partial<RegraDireitoRefeicao> & { id: number }): RegraDireitoRefeicao => ({
  descricao: `Regra ${x.id}`,
  fundamento: 'convenio',
  fontePagadora: null,
  acomodacao: null,
  idadeMinima: null,
  idadeMaxima: null,
  cobertoPelaFonte: false,
  exigeAutorizacao: false,
  incluidoNaDiaria: false,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  ativo: true,
  refeicoes: [],
  ...x,
});

const sit = (x: Partial<SituacaoDaRefeicao> = {}): SituacaoDaRefeicao => ({
  data: '2026-11-25',
  refeicao: 3,
  fontePagadora: 10,
  acomodacao: 20,
  idadePaciente: 40,
  direitoLegal: false,
  ...x,
});

describe('idade do paciente na data', () => {
  it('conta anos completos e devolve nula sem nascimento', () => {
    expect(idadeNaData('1966-11-25', '2026-11-25')).toBe(60);
    expect(idadeNaData('1966-11-26', '2026-11-25')).toBe(59);
    expect(idadeNaData(null, '2026-11-25')).toBeNull();
  });
});

describe('validação da regra', () => {
  const ok = {
    descricao: 'Convênio cobre almoço',
    fundamento: 'convenio' as const,
    fontePagadora: 10,
    idadeMinima: null,
    idadeMaxima: null,
    cobertoPelaFonte: true,
    exigeAutorizacao: false,
    incluidoNaDiaria: false,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
  };
  it('aceita a regra completa', () => expect(validarRegraDireitoRefeicao(ok)).toEqual([]));
  it('recusa convênio sem fonte, faixa invertida, vigência invertida e diária com autorização', () => {
    const campos = validarRegraDireitoRefeicao({
      ...ok,
      fontePagadora: null,
      idadeMinima: 60,
      idadeMaxima: 18,
      vigenciaFim: '2025-12-31',
      incluidoNaDiaria: true,
      exigeAutorizacao: true,
    }).map((p) => p.campo);
    expect(campos).toEqual(['vigenciaFim', 'idadeMaxima', 'fontePagadora', 'exigeAutorizacao']);
  });
  it('recusa a regra do convênio que não diz o que cobre', () => {
    expect(validarRegraDireitoRefeicao({ ...ok, cobertoPelaFonte: false }).map((p) => p.campo)).toEqual([
      'cobertoPelaFonte',
    ]);
  });
});

describe('regra vigente', () => {
  it('a regra de lei vale pela base legal registrada ou pela faixa de idade e ganha das demais', () => {
    const lei = regra({ id: 1, fundamento: 'lei', idadeMinima: 60 });
    const conv = regra({ id: 2, fontePagadora: 10, cobertoPelaFonte: true });
    expect(regraRefeicaoVigente([lei, conv], sit({ idadePaciente: 70 }))?.id).toBe(1);
    expect(regraRefeicaoVigente([lei, conv], sit({ idadePaciente: 30, direitoLegal: true }))?.id).toBe(1);
    expect(regraRefeicaoVigente([lei, conv], sit({ idadePaciente: 30 }))?.id).toBe(2);
  });
  it('a mais específica ganha; fora da vigência, inativa, de outra fonte ou de outra refeição não vale', () => {
    const geral = regra({ id: 1, fundamento: 'politica_interna' });
    const daFonte = regra({ id: 2, fontePagadora: 10, cobertoPelaFonte: true });
    const daFonteEQuarto = regra({ id: 3, fontePagadora: 10, acomodacao: 20, exigeAutorizacao: true });
    expect(regraRefeicaoVigente([geral, daFonte, daFonteEQuarto], sit())?.id).toBe(3);
    expect(regraRefeicaoVigente([geral, daFonte, daFonteEQuarto], sit({ acomodacao: 21 }))?.id).toBe(2);
    expect(regraRefeicaoVigente([geral, daFonte], sit({ fontePagadora: 11 }))?.id).toBe(1);
    expect(regraRefeicaoVigente([regra({ id: 4, vigenciaFim: '2026-10-31' })], sit())).toBeNull();
    expect(regraRefeicaoVigente([regra({ id: 5, ativo: false })], sit())).toBeNull();
    expect(regraRefeicaoVigente([regra({ id: 6, refeicoes: [1, 2] })], sit())).toBeNull();
    expect(
      regraRefeicaoVigente([regra({ id: 7, idadeMinima: 18 })], sit({ idadePaciente: null })),
    ).toBeNull();
  });
  it('empatando, a de vigência mais recente', () => {
    const velha = regra({ id: 8, fontePagadora: 10, cobertoPelaFonte: true, vigenciaInicio: '2025-01-01' });
    const nova = regra({ id: 9, fontePagadora: 10, cobertoPelaFonte: true, vigenciaInicio: '2026-06-01' });
    expect(regraRefeicaoVigente([velha, nova], sit())?.id).toBe(9);
  });
});

describe('decisão da refeição', () => {
  it('sem regra: coberta pelo direito legal; sem ele, cobrável', () => {
    expect(decidirRefeicaoAcompanhante([], sit({ direitoLegal: true }))).toMatchObject({
      cobertura: 'coberta',
      regra: null,
      fundamento: 'lei',
    });
    expect(decidirRefeicaoAcompanhante([], sit())).toMatchObject({ cobertura: 'cobravel', regra: null });
  });
  it('pela regra: diária, autorização, convênio que não cobre e convênio que cobre', () => {
    expect(
      decidirRefeicaoAcompanhante([regra({ id: 1, fontePagadora: 10, incluidoNaDiaria: true })], sit()),
    ).toMatchObject({ cobertura: 'coberta', incluidaNaDiaria: true, regra: 1 });
    expect(
      decidirRefeicaoAcompanhante([regra({ id: 2, fontePagadora: 10, exigeAutorizacao: true })], sit()),
    ).toMatchObject({ cobertura: 'a_autorizar', regra: 2 });
    expect(decidirRefeicaoAcompanhante([regra({ id: 3, fontePagadora: 10 })], sit())).toMatchObject({
      cobertura: 'cobravel',
      regra: 3,
    });
    expect(
      decidirRefeicaoAcompanhante([regra({ id: 4, fontePagadora: 10, cobertoPelaFonte: true })], sit()),
    ).toMatchObject({ cobertura: 'coberta', regra: 4, fundamento: 'convenio' });
    expect(
      decidirRefeicaoAcompanhante([regra({ id: 5, fundamento: 'politica_interna' })], sit()),
    ).toMatchObject({ cobertura: 'coberta', regra: 5 });
  });
  it('a autorização decide: autorizada é coberta, negada é cobrável', () => {
    expect(decidirAutorizacao(true)).toBe('coberta');
    expect(decidirAutorizacao(false)).toBe('cobravel');
  });
});

describe('preço da refeição', () => {
  const p = (id: number, fonte: number | null, inicio: string, fim: string | null = null) => ({
    id,
    fontePagadora: fonte,
    itemFaturavel: 100 + id,
    valor: 10 * id,
    vigenciaInicio: inicio,
    vigenciaFim: fim,
  });
  it('o do convênio antes do geral, só o vigente, o mais recente', () => {
    const precos = [
      p(1, null, '2026-01-01'),
      p(2, 10, '2026-01-01'),
      p(3, 10, '2026-12-01'),
      p(4, null, '2026-06-01'),
    ];
    expect(precoVigenteDaRefeicao(precos, 10, '2026-11-25')?.id).toBe(2);
    expect(precoVigenteDaRefeicao(precos, 11, '2026-11-25')?.id).toBe(4);
    expect(precoVigenteDaRefeicao([p(5, null, '2026-01-01', '2026-02-01')], 10, '2026-11-25')).toBeNull();
  });
});
