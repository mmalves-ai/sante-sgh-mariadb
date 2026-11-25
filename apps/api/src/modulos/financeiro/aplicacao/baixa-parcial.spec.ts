// F3.8, 07-FIN linha 63, pela HTTP (porta em memória): a baixa do título a pagar com o valor pago, o desconto e os
// acréscimos informados. A parcial deixa o título "pago-parcial" com o saldo e ainda na fila de pagamento; a segunda
// quita; valor acima do saldo e desconto total são recusados com o campo apontado. Sintéticos.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppFinanceiro, appFinanceiro, tituloSintetico } from './comum.spec-util.js';

let a: AppFinanceiro;
let hoje = '';
beforeAll(async () => {
  a = await appFinanceiro();
  hoje = (await a.get(await a.entrar('SINT.FIN.LANCA'), '/financeiro/apoio')).json().hoje;
});
afterAll(async () => {
  await a.app.close();
});

describe('baixa parcial do título a pagar pela HTTP (memória)', () => {
  it('parcial com desconto deixa saldo e fica na fila; a segunda baixa quita; recusas apontam o campo', async () => {
    const lanca = await a.entrar('SINT.FIN.LANCA');
    const aprova = await a.entrar('SINT.FIN.APROVA');
    const paga = await a.entrar('SINT.FIN.PAGA');
    const id = (await a.post(lanca, '/financeiro/pagar/titulos', tituloSintetico(96401, hoje, 964))).json()
      .ids.titulo as number;
    const valor = (await a.get(paga, `/financeiro/pagar/titulos/${id}`)).json().valor as number;
    expect((await a.post(aprova, `/financeiro/pagar/titulos/${id}/aprovar`, {})).statusCode).toBe(200);
    const pagar = (extra: Record<string, number>) =>
      a.post(paga, '/financeiro/pagar/baixa', {
        titulos: [{ titulo: id, ...extra }],
        conta: 1,
        dataPagamento: hoje,
        formaPagamento: 0,
        porBordero: false,
      });
    const acima = await pagar({ valorPago: valor + 0.01 });
    expect(acima.json().codigo).toBe('valor-acima-do-saldo');
    expect((await pagar({ desconto: valor })).json().codigo).toBe('desconto-acima-do-valor');
    expect((await pagar({ valorPago: -1 })).statusCode).toBeGreaterThanOrEqual(400);

    const parte = Math.round(valor * 40) / 100;
    const r = await pagar({ valorPago: parte, desconto: 1 });
    expect(r.statusCode).toBe(200);
    const d = (await a.get(paga, `/financeiro/pagar/titulos/${id}`)).json();
    expect(d.situacao).toBe('pago-parcial');
    expect(d.saldo).toBeCloseTo(valor - parte - 1, 2);
    expect(d.pago).toBeCloseTo(parte, 2);
    const lida = (await a.get(paga, '/financeiro/pagar/aprovacao?dias=60')).json();
    const fila = (Array.isArray(lida) ? lida : lida.itens) as { id: number }[];
    expect(fila.map((x) => x.id)).toContain(id);

    // Sem valor informado, a segunda baixa quita o saldo que sobrou.
    expect((await pagar({})).statusCode).toBe(200);
    const f = (await a.get(paga, `/financeiro/pagar/titulos/${id}`)).json();
    expect(f.situacao).toBe('pago');
    expect(f.saldo).toBe(0);
    expect((await pagar({})).json().codigo).toBe('titulo-ja-baixado');
  });
});
