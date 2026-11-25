import { describe, expect, it } from 'vitest';
import {
  acrescentarSubstituto,
  type LinhaRefeicao,
  linhaVazia,
  percentualDaComposicao,
  recusaDaComposicao,
  refeicoesDoContrato,
  removerLinha,
} from './composicao-refeicoes.js';

const linha = (x: Partial<LinhaRefeicao>): LinhaRefeicao => ({ ...linhaVazia('1'), quantidade: '50', ...x });

describe('composição da dieta por refeição na tela (03-PEP L112)', () => {
  it('converte para o contrato: vírgula decimal, medida caseira e o substituto sem parte das calorias', () => {
    const r = refeicoesDoContrato([
      linha({ alimento: '31', quantidade: '50,5', percentualDiario: '20' }),
      linha({
        alimento: '32',
        medidaCaseira: '3',
        quantidadeMedidaCaseira: '2',
        substitui: 1,
        percentualDiario: '9',
      }),
    ]);
    expect(r).toEqual([
      expect.objectContaining({
        refeicao: 1,
        alimento: 31,
        quantidade: 50.5,
        medidaCaseira: null,
        percentualDiario: 20,
      }),
      expect.objectContaining({
        alimento: 32,
        medidaCaseira: 3,
        quantidadeMedidaCaseira: 2,
        substitui: 1,
        percentualDiario: null,
      }),
    ]);
  });

  it('confere na hora pela regra do domínio, só com as linhas completas', () => {
    const repetido = [linha({ alimento: '31' }), linha({ alimento: '31' })];
    expect(recusaDaComposicao('livre', repetido)).toMatch(/duas vezes na mesma refeição/);
    expect(recusaDaComposicao('enteral', [linha({ alimento: '31' })])).toMatch(/não têm composição/);
    expect(
      recusaDaComposicao('oral', [
        linha({ alimento: '31', percentualDiario: '60' }),
        linha({ alimento: '32', percentualDiario: '50' }),
      ]),
    ).toMatch(/passa de 100%/);
    expect(recusaDaComposicao('oral', [linha({ alimento: '31', medidaCaseira: '3' })])).toMatch(
      /medida caseira/,
    );
    expect(recusaDaComposicao('livre', [linha({ alimento: '' }), linha({ alimento: '31' })])).toBeNull();
    expect(
      recusaDaComposicao('livre', [linha({ alimento: '31' }), linha({ alimento: '32', substitui: 1 })]),
    ).toBeNull();
  });

  it('substituto entra logo abaixo do titular, na mesma refeição; remover leva os substitutos e renumera', () => {
    const base = [
      linha({ alimento: '31' }),
      linha({ refeicao: '2', alimento: '40' }),
      linha({ refeicao: '2', alimento: '41', substitui: 2 }),
    ];
    const com = acrescentarSubstituto(base, 0);
    expect(com.map((l) => [l.refeicao, l.alimento, l.substitui])).toEqual([
      ['1', '31', null],
      ['1', '', 1],
      ['2', '40', null],
      ['2', '41', 3],
    ]);
    expect(removerLinha(com, 0).map((l) => [l.alimento, l.substitui])).toEqual([
      ['40', null],
      ['41', 1],
    ]);
    expect(
      percentualDaComposicao([
        linha({ percentualDiario: '25,5' }),
        linha({ percentualDiario: '30', substitui: 1 }),
      ]),
    ).toBe(25.5);
  });
});
