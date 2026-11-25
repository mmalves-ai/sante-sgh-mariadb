// F3.8, 07-FIN linha 64 (alçada) pela HTTP, na sessão sintética (porta em memória, a mesma do E2E @F3.8): nenhuma saída
// sem as aprovações da faixa. O adiantamento não é pago sem aprovação nem aprovado por quem pediu; a compensação é uma
// baixa e recusa o título ainda não aprovado; depois de aprovado por outra pessoa, compensa. A saída do pagamento e a
// entrada da devolução aparecem no movimento da conta, com a finalidade e o motivo no histórico.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppFinanceiro, appFinanceiro, type Sessao, tituloSintetico } from './comum.spec-util.js';

let a: AppFinanceiro;
let hoje = '';
let lanca: Sessao;
let aprova: Sessao;
let paga: Sessao;
beforeAll(async () => {
  a = await appFinanceiro();
  lanca = await a.entrar('SINT.FIN.LANCA');
  aprova = await a.entrar('SINT.FIN.APROVA');
  paga = await a.entrar('SINT.FIN.PAGA');
  hoje = (await a.get(lanca, '/financeiro/apoio')).json().hoje;
});
afterAll(async () => {
  await a.app.close();
});

interface LinhaMovimento {
  historico: string;
  valor: number;
  contaCredito: number | null;
  contaDebito: number | null;
  data: string;
}
const movimentoDaConta = async (conta: number): Promise<LinhaMovimento[]> =>
  (await a.get(paga, `/financeiro/tesouraria/movimento?conta=${conta}`)).json();

describe('alçada no adiantamento e na compensação; saída e devolução no movimento (memória)', () => {
  it('sem aprovação não paga nem compensa; aprovado por outra pessoa, paga, compensa e devolve; o movimento mostra os dois', async () => {
    const finalidade = 'SINTETICO VIAGEM TECNICA';
    const motivo = 'SINTETICO SOBRA DEVOLVIDA';
    const titulo = (
      await a.post(lanca, '/financeiro/pagar/titulos', tituloSintetico(640_001, hoje, 1500))
    ).json().ids.titulo as number;
    const pedido = await a.post(lanca, '/financeiro/pagar/adiantamentos', {
      tipoCredor: 'fornecedor',
      credor: 5001,
      conta: 1,
      valor: 2000,
      data: hoje,
      prazo: null,
      referente: finalidade,
    });
    expect(pedido.statusCode).toBe(200);
    const id = pedido.json().ids.adiantamento as number;
    const antes = (await movimentoDaConta(1)).length;

    // O pedido não é saída: nada no movimento; sem aprovação, o pagamento é recusado.
    const semAprovacao = await a.post(paga, `/financeiro/pagar/adiantamentos/${id}/pagar`, { data: hoje });
    expect(semAprovacao.statusCode).not.toBe(200);
    expect((await movimentoDaConta(1)).length).toBe(antes);
    // Quem pediu não aprova.
    const proprio = await a.post(lanca, `/financeiro/pagar/adiantamentos/${id}/aprovar`, { observacao: '' });
    expect(proprio.json().codigo).toBe('segregacao-lancou-aprova');
    expect(
      (await a.post(aprova, `/financeiro/pagar/adiantamentos/${id}/aprovar`, { observacao: '' })).statusCode,
    ).toBe(200);
    // Quem aprovou não paga; um terceiro paga: a saída na conta.
    const aprovouPaga = await a.post(aprova, `/financeiro/pagar/adiantamentos/${id}/pagar`, { data: hoje });
    expect(aprovouPaga.statusCode).not.toBe(200);
    expect(
      (await a.post(paga, `/financeiro/pagar/adiantamentos/${id}/pagar`, { data: hoje })).statusCode,
    ).toBe(200);
    const saida = (await movimentoDaConta(1)).find((m) => m.historico.includes(finalidade));
    expect(saida).toMatchObject({ valor: 2000, contaDebito: 1, contaCredito: null, data: hoje });

    // A compensação é uma baixa: o título sem aprovação é recusado e nada muda.
    const semTitulo = await a.post(paga, `/financeiro/pagar/adiantamentos/${id}/compensar`, {
      parcela: titulo,
      valor: 1500,
      data: hoje,
    });
    expect(semTitulo.json().codigo).toBe('sem-aprovacao');
    expect((await a.post(aprova, `/financeiro/pagar/titulos/${titulo}/aprovar`, {})).statusCode).toBe(200);
    const compensado = await a.post(paga, `/financeiro/pagar/adiantamentos/${id}/compensar`, {
      parcela: titulo,
      valor: 1500,
      data: hoje,
    });
    expect(compensado.statusCode).toBe(200);
    expect(compensado.json().ids.saldo).toBe(500);

    // A devolução do saldo: a entrada na conta escolhida, com o motivo.
    const devolvido = await a.post(paga, `/financeiro/pagar/adiantamentos/${id}/devolver`, {
      conta: 1,
      valor: 500,
      data: hoje,
      motivo,
    });
    expect(devolvido.statusCode).toBe(200);
    const lista = await movimentoDaConta(1);
    expect(lista.find((m) => m.historico.includes(motivo))).toMatchObject({
      valor: 500,
      contaCredito: 1,
      contaDebito: null,
      data: hoje,
    });
    // Só a saída e a entrada: a compensação não movimenta a conta.
    expect(lista.length).toBe(antes + 2);
  });
});
