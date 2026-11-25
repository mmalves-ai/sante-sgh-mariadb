// F3.8, 07-FIN linha 67: o credor médico no lote. O participante externo do fato sai pelo de-para do PROFISSIONAL quando
// o credor não é fornecedor; os dois códigos nunca se misturam (o credor é o par tipo e código).
import { describe, expect, it } from 'vitest';
import {
  dePararFatos,
  fatoDaCompensacao,
  fatoDaConcessao,
  fatoDaDevolucao,
  fatosDaApropriacao,
} from './depara-contabil.js';

const base = {
  data: '2026-11-24',
  valor: 100,
  historico: 'ADIANTAMENTO 7 SINTETICO',
  documento: '7',
  natureza: null,
  centro: null,
};
const credores = new Map([[9, 'F-9']]);
const profissionais = new Map([[9, 'M-9']]);
const participantes = (fatos: Parameters<typeof dePararFatos>[0], p = profissionais) =>
  dePararFatos(fatos, [], new Map(), credores, p).eventos.map((e) => e.participanteExterno);

describe('credor médico no de-para do lote', () => {
  it('concessão, compensação e devolução do médico levam o código do profissional, nunca o do fornecedor de mesmo código', () => {
    const medico = { ...base, credor: null, profissional: 9 };
    expect(
      participantes([
        fatoDaConcessao(medico),
        fatoDaCompensacao(medico, 'competencia'),
        fatoDaCompensacao(medico, 'caixa'),
        fatoDaDevolucao(medico),
      ]),
    ).toEqual(['M-9', 'M-9', 'M-9', 'M-9']);
    expect(participantes([fatoDaConcessao({ ...base, credor: 9 })])).toEqual(['F-9']);
  });

  it('sem de-para do profissional o participante sai vazio; o fato sem credor também', () => {
    expect(participantes([fatoDaConcessao({ ...base, credor: null, profissional: 9 })], new Map())).toEqual([
      '',
    ]);
    expect(
      dePararFatos([fatoDaConcessao({ ...base, credor: null, profissional: 9 })], [], new Map(), credores)
        .eventos[0]?.participanteExterno,
    ).toBe('');
    expect(participantes([fatoDaConcessao({ ...base, credor: null })])).toEqual(['']);
  });

  it('o título de médico leva o profissional na despesa e em cada retido', () => {
    const fatos = fatosDaApropriacao(
      {
        ...base,
        valorDespesa: 100,
        credor: null,
        profissional: 9,
        retencoes: [{ tributo: 'IR', natureza: null, valor: 10 }],
      },
      'competencia',
    );
    expect(fatos.map((f) => [f.valor, f.profissional])).toEqual([
      [90, 9],
      [10, 9],
    ]);
    expect(participantes(fatos)).toEqual(['M-9', 'M-9']);
  });
});
