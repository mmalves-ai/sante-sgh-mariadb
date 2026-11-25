import { describe, expect, it } from 'vitest';
import { avaliarResposta, type RespostaDoAnalito, respostaDoTexto } from './resposta-padrao.js';

const r = (id: number, codigo: string, descricao: string, extra: Partial<RespostaDoAnalito> = {}) => ({
  id,
  codigo,
  descricao,
  mnemonico: null,
  anormal: false,
  critico: false,
  ...extra,
});
const grupo: RespostaDoAnalito[] = [
  r(1, 'NR', 'Não reagente', { mnemonico: 'n' }),
  r(2, 'RG', 'Reagente', { anormal: true, mnemonico: 'r' }),
  r(3, 'IND', 'Indeterminado', { anormal: true }),
  r(4, 'PAN', 'Pânico', { critico: true }),
];

describe('resposta padronizada na digitação', () => {
  it('liga pela descrição sem diferença de maiúsculas, acento e espaços', () => {
    expect(respostaDoTexto('  nao   REAGENTE ', grupo)?.id).toBe(1);
    expect(respostaDoTexto('Indeterminado', grupo)?.id).toBe(3);
  });

  it('liga pelo atalho e pelo código; a descrição vence o atalho', () => {
    expect(respostaDoTexto('n', grupo)?.id).toBe(1);
    expect(respostaDoTexto('R', grupo)?.id).toBe(2);
    expect(respostaDoTexto('ind', grupo)?.id).toBe(3);
    const ambiguo = [r(7, 'X', 'Y', { mnemonico: 'z' }), r(8, 'W', 'Z')];
    expect(respostaDoTexto('z', ambiguo)?.id).toBe(8);
  });

  it('texto livre, vazio ou nulo não leva resposta', () => {
    expect(respostaDoTexto('Amostra hemolisada', grupo)).toBeNull();
    expect(respostaDoTexto('   ', grupo)).toBeNull();
    expect(respostaDoTexto(null, grupo)).toBeNull();
    expect(respostaDoTexto('Reagente', [])).toBeNull();
  });

  it('a marca da resposta vira a avaliação do valor', () => {
    expect(avaliarResposta(grupo[0] ?? null)).toEqual({
      interpretacao: 'normal',
      anormal: false,
      critico: false,
    });
    expect(avaliarResposta(grupo[1] ?? null)).toEqual({
      interpretacao: 'anormal',
      anormal: true,
      critico: false,
    });
    expect(avaliarResposta(grupo[3] ?? null)).toEqual({
      interpretacao: 'critico',
      anormal: true,
      critico: true,
    });
    expect(avaliarResposta(null)).toEqual({ interpretacao: null, anormal: false, critico: false });
  });
});
