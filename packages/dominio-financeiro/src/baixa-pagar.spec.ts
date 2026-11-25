// F3.8, 07-FIN linha 63: a regra da baixa do título a pagar com valor, desconto e acréscimos informados.
import { describe, expect, it } from 'vitest';
import { calcularBaixaPagar, conferirBaixaPagar, type EntradaBaixaPagar } from './baixa-pagar.js';

const e = (x: Partial<EntradaBaixaPagar> = {}): EntradaBaixaPagar => ({
  saldo: 1000,
  valorPago: null,
  desconto: 0,
  juros: 0,
  multa: 0,
  acrescimo: 0,
  ...x,
});

describe('baixa do título a pagar', () => {
  it('sem valor informado quita o saldo inteiro', () => {
    expect(conferirBaixaPagar(e())).toBeNull();
    expect(calcularBaixaPagar(e())).toMatchObject({
      principal: 1000,
      desembolso: 1000,
      saldo: 0,
      quita: true,
    });
  });

  it('sem valor informado, o desconto reduz o desembolso e os acréscimos o aumentam; a parcela quita', () => {
    const b = calcularBaixaPagar(e({ desconto: 50, juros: 12.3, multa: 20, acrescimo: 1.2 }));
    expect(b).toMatchObject({ principal: 1000, desembolso: 983.5, saldo: 0, quita: true });
    // A conta do registro: desembolso = principal + juros + multa + acréscimo − desconto.
    expect(b.desembolso).toBe(
      Math.round((b.principal + b.juros + b.multa + b.acrescimo - b.desconto) * 100) / 100,
    );
  });

  it('valor menor que o saldo é baixa parcial: o saldo que sobra fica em aberto', () => {
    const b = calcularBaixaPagar(e({ valorPago: 400 }));
    expect(conferirBaixaPagar(e({ valorPago: 400 }))).toBeNull();
    expect(b).toMatchObject({ principal: 400, desembolso: 400, saldo: 600, quita: false });
  });

  it('parcial com desconto e juros: o desconto liquida saldo, os juros não', () => {
    const x = e({ valorPago: 400, desconto: 30, juros: 10 });
    expect(conferirBaixaPagar(x)).toBeNull();
    expect(calcularBaixaPagar(x)).toMatchObject({
      principal: 420,
      desembolso: 400,
      saldo: 580,
      quita: false,
    });
  });

  it('a segunda baixa parcial sobre o saldo restante quita', () => {
    const b = calcularBaixaPagar(e({ saldo: 600, valorPago: 600 }));
    expect(b).toMatchObject({ principal: 600, saldo: 0, quita: true });
  });

  it('centavos não deixam resíduo', () => {
    const b = calcularBaixaPagar(e({ saldo: 0.3, valorPago: 0.1, desconto: 0.2 }));
    expect(b).toMatchObject({ principal: 0.3, saldo: 0, quita: true });
  });

  it('recusa valor acima do saldo, valor negativo e parcela sem saldo', () => {
    expect(conferirBaixaPagar(e({ valorPago: 1000.01 }))?.codigo).toBe('valor-acima-do-saldo');
    expect(conferirBaixaPagar(e({ valorPago: 990, desconto: 20 }))?.codigo).toBe('valor-acima-do-saldo');
    expect(conferirBaixaPagar(e({ desconto: -1 }))?.codigo).toBe('valor-invalido');
    expect(conferirBaixaPagar(e({ valorPago: 0 }))?.codigo).toBe('valor-invalido');
    expect(conferirBaixaPagar(e({ saldo: 0 }))?.codigo).toBe('titulo-ja-baixado');
  });

  it('recusa o desconto que zera o desembolso e o pagamento que só cobre encargos', () => {
    expect(conferirBaixaPagar(e({ desconto: 1000 }))?.codigo).toBe('desconto-acima-do-valor');
    expect(conferirBaixaPagar(e({ valorPago: 30, juros: 30 }))?.codigo).toBe('pagamento-so-de-encargos');
    expect(conferirBaixaPagar(e({ valorPago: 20, juros: 30 }))?.codigo).toBe('pagamento-so-de-encargos');
  });
});
