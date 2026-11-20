// Regra 12 do M32: glosa = VALOR_C − VLR_PG dos itens com GLOSADO = 'T' (baixados); 'F' nunca é glosa.
import { describe, expect, it } from 'vitest';
import { glosaDoTitulo, saldoMostrado } from './index.js';

describe('glosa no título (regra 12)', () => {
  it('três itens baixados e um sem retorno: glosa 15 + 5 = 20 sobre 300 cobrados (6,67%); 2 pagos a maior', () => {
    const g = glosaDoTitulo([
      { valorCobrado: 100, valorPago: 85, glosado: 'T' }, // glosa 15
      { valorCobrado: 100, valorPago: 95, glosado: 'T' }, // glosa 5
      { valorCobrado: 100, valorPago: 102, glosado: 'T' }, // pago a maior 2
      { valorCobrado: 500, valorPago: 0, glosado: 'F' }, // sem retorno: nunca é glosa
    ]);
    expect(g).toEqual({
      itens: 4,
      baixados: 3,
      cobradoBaixado: 300,
      pagoBaixado: 282,
      glosado: 20,
      pagoAMaior: 2,
      taxa: 6.67,
    });
  });
  it("ler 'F' como glosa daria 520 em vez de 20: a regra ignora", () => {
    expect(glosaDoTitulo([{ valorCobrado: 500, valorPago: 0, glosado: 'F' }]).glosado).toBe(0);
    expect(glosaDoTitulo([]).taxa).toBe(0);
  });
  it('saldo mostrado = 1.000 − 300 recebidos − 120 de glosa aceita = 580; recurso deferido 50 recebível à parte', () => {
    expect(
      saldoMostrado({ valorTitulo: 1_000, recebido: 300, glosaAceita: 120, recursoDeferido: 50 }),
    ).toEqual({
      saldo: 580,
      recebivelRecurso: 50,
    });
    expect(saldoMostrado({ valorTitulo: 100, recebido: 90, glosaAceita: 20, recursoDeferido: 0 }).saldo).toBe(
      0,
    );
  });
});
