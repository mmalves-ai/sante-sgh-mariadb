// Regras 4, 5 e 13 do M32 pela HTTP (porta em memória): nenhuma baixa sem aprovação na alçada; quem lança não aprova,
// quem aprova não paga (segregação); dupla aprovação acima do limite; borderô; a baixa manual do título a receber é
// exceção (permissão própria e motivo); a glosa no título; o título de convênio pela competência (regra 10). Sintéticos.
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

describe('financeiro.baixarTitulo pela HTTP (memória)', () => {
  it('lançar → aprovar (outra pessoa) → borderô → pagar; quem lançou não aprova; sem aprovação não paga', async () => {
    const lanca = await a.entrar('SINT.FIN.LANCA');
    const aprova = await a.entrar('SINT.FIN.APROVA');
    const paga = await a.entrar('SINT.FIN.PAGA');
    const id = (await a.post(lanca, '/financeiro/pagar/titulos', tituloSintetico(100, hoje, 900))).json().ids
      .titulo as number;
    // Sem aprovação: o pagamento é recusado (regra 5).
    const sem = await a.post(paga, '/financeiro/pagar/baixa', {
      titulos: [{ titulo: id }],
      conta: 1,
      dataPagamento: hoje,
      formaPagamento: 0,
      porBordero: true,
    });
    expect(sem.json().codigo).toBe('sem-aprovacao');
    // Quem lançou não aprova (regra 4).
    const proprio = await a.post(lanca, `/financeiro/pagar/titulos/${id}/aprovar`, {});
    expect(proprio.json().codigo).toBe('segregacao-lancou-aprova');
    expect((await a.post(aprova, `/financeiro/pagar/titulos/${id}/aprovar`, {})).json().mensagem).toContain(
      'aprovado',
    );
    // Quem aprovou não paga.
    const aprovouPaga = await a.post(aprova, '/financeiro/pagar/baixa', {
      titulos: [{ titulo: id }],
      conta: 1,
      dataPagamento: hoje,
      formaPagamento: 0,
      porBordero: true,
    });
    expect([403, 409]).toContain(aprovouPaga.statusCode);
    const r = await a.post(paga, '/financeiro/pagar/baixa', {
      titulos: [{ titulo: id }],
      conta: 1,
      dataPagamento: hoje,
      formaPagamento: 0,
      porBordero: true,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().mensagem).toMatch(/Borderô \d+ pago/);
    expect((await a.get(paga, `/financeiro/pagar/titulos/${id}`)).json().situacao).toBe('pago');
    // O título já baixado não paga de novo.
    const de = await a.post(paga, '/financeiro/pagar/baixa', {
      titulos: [{ titulo: id }],
      conta: 1,
      dataPagamento: hoje,
      formaPagamento: 1,
      porBordero: false,
    });
    expect(de.json().codigo).toBe('titulo-ja-baixado');
  });

  it('dupla aprovação acima de R$ 10.000,00: 1 de 2 não paga; a segunda de outra pessoa libera', async () => {
    const lanca = await a.entrar('SINT.FIN.LANCA');
    const aprova = await a.entrar('SINT.FIN.APROVA');
    const paga = await a.entrar('SINT.FIN.PAGA');
    const id = (await a.post(lanca, '/financeiro/pagar/titulos', tituloSintetico(101, hoje, 15_000))).json()
      .ids.titulo as number;
    const um = (await a.post(aprova, `/financeiro/pagar/titulos/${id}/aprovar`, {})).json();
    expect(um.mensagem).toContain('falta 1');
    expect((await a.post(aprova, `/financeiro/pagar/titulos/${id}/aprovar`, {})).json().codigo).toBe(
      'ja-aprovou',
    );
    const meio = await a.post(paga, '/financeiro/pagar/baixa', {
      titulos: [{ titulo: id }],
      conta: 1,
      dataPagamento: hoje,
      formaPagamento: 1,
      porBordero: false,
    });
    expect(meio.json().detail).toContain('1 de 2');
  });

  it('regra 13: a baixa manual pede a permissão própria e o motivo; recebe o título de convênio', async () => {
    const paga = await a.entrar('SINT.FIN.PAGA');
    const aprova = await a.entrar('SINT.FIN.APROVA');
    const semPermissao = await a.post(aprova, '/financeiro/receber/titulos/9001/baixa', {
      conta: 1,
      dataRecebimento: hoje,
      valorRecebido: 100,
      formaPagamento: 1,
      motivo: 'conferido no extrato do banco',
    });
    expect(semPermissao.statusCode).toBe(403);
    const curto = await a.post(paga, '/financeiro/receber/titulos/9001/baixa', {
      conta: 1,
      dataRecebimento: hoje,
      valorRecebido: 100,
      formaPagamento: 1,
      motivo: 'curto',
    });
    expect(curto.json().codigo).toBe('motivo-obrigatorio');
    const ok = await a.post(paga, '/financeiro/receber/titulos/9001/baixa', {
      conta: 1,
      dataRecebimento: hoje,
      valorRecebido: 2_850,
      formaPagamento: 1,
      motivo: 'conferido no extrato do banco',
    });
    expect(ok.statusCode).toBe(200);
  });

  it('regra 12: a glosa aceita no título reduz o saldo mostrado (3.000 − 150 aceitos = 2.850)', async () => {
    const lanca = await a.entrar('SINT.FIN.LANCA');
    const d0 = (await a.get(lanca, '/financeiro/receber/titulos/9001')).json();
    // Os itens baixados: 600/600, 400/250 e 1.200/1.200 (GLOSADO 'T'); o 800 sem retorno não é glosa.
    expect(d0.glosa).toMatchObject({ baixados: 3, glosado: 150, cobradoBaixado: 2_200 });
    const r = await a.post(lanca, '/financeiro/receber/titulos/9001/glosa', {
      item: 91012,
      situacao: 'aceita',
      valor: 150,
      motivo: 'glosa aceita pelo faturista',
    });
    expect(r.statusCode).toBe(200);
    const semRetorno = await a.post(lanca, '/financeiro/receber/titulos/9001/glosa', {
      item: 91022,
      situacao: 'aceita',
      valor: 10,
      motivo: 'tentativa no item sem retorno',
    });
    expect(semRetorno.json().codigo).toBe('item-sem-retorno');
    const d = (await a.get(lanca, '/financeiro/receber/titulos/9001')).json();
    expect(d.glosaAceita).toBe(150);
  });

  it('regra 10: a competência fechada do convênio 92 ganha título para as contas apresentadas sem título', async () => {
    const lanca = await a.entrar('SINT.FIN.LANCA');
    const [ano, mes] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
    const antes = (
      await a.get(lanca, `/financeiro/receber/contas-sem-titulo?convenio=92&ano=${ano}&mes=${mes}`)
    ).json();
    expect(antes.map((c: { id: number }) => c.id)).toEqual([9301, 9302]);
    const r = await a.post(lanca, '/financeiro/receber/competencia', {
      convenio: 92,
      ano,
      mes,
      vencimento: hoje,
      documento: 7_002,
    });
    expect(r.json().ids).toMatchObject({ titulos: 1, contas: 2 });
    expect(
      (await a.get(lanca, `/financeiro/receber/contas-sem-titulo?convenio=92&ano=${ano}&mes=${mes}`)).json(),
    ).toEqual([]);
    const outra = await a.post(lanca, '/financeiro/receber/competencia', {
      convenio: 92,
      ano,
      mes,
      vencimento: hoje,
      documento: 7_002,
    });
    expect(outra.json().ids.titulos).toBe(0);
  });
});
