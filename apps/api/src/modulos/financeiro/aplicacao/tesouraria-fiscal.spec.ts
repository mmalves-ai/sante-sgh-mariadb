// Correções do M32 pela HTTP (porta em memória, dados sintéticos):
//   - D-MODULO-32: quem é só da tesouraria ou só do fiscal (sem as opções de contas a pagar) abre o módulo (a situação,
//     o apoio e a fila), lança o movimento e gera a DMED;
//   - D-DECLARACAO-32: a DMED e a EFD-REINF com permissões e rotas próprias;
//   - regra 15 (anti-IDOR): a conciliação, a atribuição do crédito, a fila de créditos e as remessas só nas contas do
//     escopo do usuário (SINT.FIN.TESFIS tem só a conta 1);
//   - D-SALDO-32: o saldo calculado da conta conta os títulos pagos e recebidos depois do fechamento;
//   - o cartão do fiscal na fila.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppFinanceiro, appFinanceiro, type Sessao, tituloSintetico } from './comum.spec-util.js';

let a: AppFinanceiro;
let hoje = '';
let tesfis: Sessao;
let concilia: Sessao;
beforeAll(async () => {
  a = await appFinanceiro();
  tesfis = await a.entrar('SINT.FIN.TESFIS');
  concilia = await a.entrar('SINT.FIN.CONCILIA');
  hoje = (await a.get(tesfis, '/financeiro/apoio')).json().hoje;
});
afterAll(async () => {
  await a.app.close();
});

const competenciaAnterior = (d: string) => {
  const ano = Number(d.slice(0, 4));
  const mes = Number(d.slice(5, 7));
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
};
const movimento = (conta: number, valor: number) => ({
  tipo: 'C',
  data: hoje,
  contaCredito: conta,
  contaDebito: null,
  valor,
  historico: 'SINTETICO CREDITO AVULSO',
  classificacao: { grupo: 100, subgrupo: 1, item: 1 },
});

describe('tesouraria e fiscal sem as opções de contas a pagar (memória)', () => {
  it('abre o módulo (situação, apoio só com as contas do escopo, fila) e não lê os títulos a pagar', async () => {
    expect((await a.get(tesfis, '/financeiro/gravacao')).statusCode).toBe(200);
    const apoio = (await a.get(tesfis, '/financeiro/apoio')).json();
    expect(apoio.contas.map((c: { id: number }) => c.id)).toEqual([1]);
    expect(apoio.contas[0].saldo).toBeGreaterThan(0);
    expect((await a.get(tesfis, '/financeiro/worklist')).statusCode).toBe(200);
    expect((await a.get(tesfis, '/financeiro/pagar/titulos')).statusCode).toBe(403);
  });

  it('lança o movimento na conta do escopo; na conta de fora, recusa', async () => {
    const r = await a.post(tesfis, '/financeiro/tesouraria/movimento', movimento(1, 10));
    expect(r.statusCode).toBe(200);
    const fora = await a.post(tesfis, '/financeiro/tesouraria/movimento', movimento(2, 10));
    expect(fora.json().codigo).toBe('fora-do-escopo');
  });

  it('gera a DMED com a permissão da DMED; a EFD-REINF exige a dela; o tipo tem de ser o da rota', async () => {
    const ano = String(Number(hoje.slice(0, 4)) - 1);
    const d = await a.post(tesfis, '/financeiro/fiscal/declaracoes/dmed', { tipo: 'dmed', periodo: ano });
    expect(d.statusCode).toBe(200);
    expect((await a.get(tesfis, '/financeiro/fiscal/declaracoes/dmed')).json()).toHaveLength(1);
    const r = await a.post(tesfis, '/financeiro/fiscal/declaracoes/reinf', {
      tipo: 'reinf-r4000',
      periodo: competenciaAnterior(hoje),
    });
    expect(r.statusCode).toBe(403);
    const lanca = await a.entrar('SINT.FIN.LANCA');
    const trocado = await a.post(lanca, '/financeiro/fiscal/declaracoes/reinf', {
      tipo: 'dmed',
      periodo: ano,
    });
    expect(trocado.statusCode).toBe(400);
    // A rota antiga, que exigia a REINF para gerar a DMED, não existe mais.
    expect(
      (await a.post(lanca, '/financeiro/fiscal/declaracoes', { tipo: 'dmed', periodo: ano })).statusCode,
    ).toBe(404);
  });
});

describe('regra 15: conciliação, crédito e remessas só nas contas do escopo (memória)', () => {
  it('a linha do extrato da conta 2 não se concilia por quem só tem a conta 1; o crédito dela não aparece nem se atribui', async () => {
    const imp = await a.post(concilia, '/financeiro/tesouraria/extratos', {
      conta: 2,
      origem: 'csv',
      conteudo: `${hoje};777,77;SINTETICO DEPOSITO;1\n${hoje};555,55;SINTETICO DEPOSITO;2`,
    });
    expect(imp.statusCode).toBe(200);
    const linhas = (await a.get(concilia, '/financeiro/tesouraria/conciliacao?conta=2')).json().linhas as {
      id: number;
    }[];
    expect(linhas).toHaveLength(2);
    const [l1, l2] = linhas;
    // Quem não tem a conta 2 não chega à linha dela pelo ID.
    const idor = await a.post(tesfis, '/financeiro/tesouraria/conciliacao', {
      linha: l1?.id,
      alvo: { tipo: 'credito-pendente' },
      regra: 'manual',
    });
    expect(idor.statusCode).toBe(403);
    expect(idor.json().codigo).toBe('fora-do-escopo');
    // O alvo da conciliação tem de ser da mesma conta da linha (o movimento da conta 1 não concilia a linha da 2).
    const mov = (await a.post(tesfis, '/financeiro/tesouraria/movimento', movimento(1, 555.55))).json().ids;
    const outra = await a.post(concilia, '/financeiro/tesouraria/conciliacao', {
      linha: l2?.id,
      alvo: { tipo: 'movimento', id: Number(mov.movimento ?? mov.id) },
      regra: 'manual',
    });
    expect(outra.json().codigo).toBe('alvo-de-outra-conta');
    // Quem tem a conta 2 manda a linha à fila de crédito não identificado.
    const ok = await a.post(concilia, '/financeiro/tesouraria/conciliacao', {
      linha: l1?.id,
      alvo: { tipo: 'credito-pendente' },
      regra: 'manual',
    });
    expect(ok.statusCode).toBe(200);
    const deTodos = (await a.get(concilia, '/financeiro/tesouraria/creditos')).json() as {
      id: number;
      conta: number;
    }[];
    const credito = deTodos.find((c) => c.conta === 2);
    expect(credito).toBeDefined();
    const doEscopo = (await a.get(tesfis, '/financeiro/tesouraria/creditos')).json() as { conta: number }[];
    expect(doEscopo.every((c) => c.conta === 1)).toBe(true);
    const cartao = (await a.get(tesfis, '/financeiro/worklist'))
      .json()
      .cartoes.find((c: { codigo: string }) => c.codigo === 'creditos');
    expect(cartao.quantidade).toBe(doEscopo.length);
    const atr = await a.post(tesfis, `/financeiro/tesouraria/creditos/${credito?.id}/atribuir`, {
      tituloReceber: 1,
    });
    expect(atr.statusCode).toBe(403);
    expect(atr.json().codigo).toBe('fora-do-escopo');
  });

  it('as remessas da conta de fora do escopo não aparecem', async () => {
    const [hospital] = [...(a.porta as unknown as { estados: Map<string, unknown> }).estados.keys()];
    for (const conta of [1, 2])
      await a.porta.gravarSgh({ hospital } as never, null, (g) =>
        g.registrarRemessa({
          usuario: 'SINT.FIN.PAGA',
          conta,
          leiaute: 'cnab240',
          titulos: 1,
          valorTotal: 10,
          hashArquivo: `h${conta}`,
          chaveObjeto: null,
          destino: 'simulador',
          situacao: 'gerada',
          hashRetorno: null,
          ocorrencias: null,
        }),
      );
    const lista = (await a.get(tesfis, '/financeiro/pagar/remessas')).json() as { ID_TBCTABAN: number }[];
    expect(lista.map((r) => r.ID_TBCTABAN)).toEqual([1]);
    const paga = await a.entrar('SINT.FIN.PAGA');
    const todas = (await a.get(paga, '/financeiro/pagar/remessas')).json() as { ID_TBCTABAN: number }[];
    expect(todas.map((r) => r.ID_TBCTABAN).sort()).toEqual([1, 2]);
  });
});

describe('D-SALDO-32 e o cartão do fiscal (memória)', () => {
  it('o título pago pela conta depois do fechamento sai do saldo calculado', async () => {
    const lanca = await a.entrar('SINT.FIN.LANCA');
    const aprova = await a.entrar('SINT.FIN.APROVA');
    const paga = await a.entrar('SINT.FIN.PAGA');
    const saldo = async () =>
      ((await a.get(paga, '/financeiro/apoio')).json().contas as { id: number; saldo: number }[]).find(
        (c) => c.id === 1,
      )?.saldo ?? 0;
    const antes = await saldo();
    const id = (await a.post(lanca, '/financeiro/pagar/titulos', tituloSintetico(8801, hoje, 321.45))).json()
      .ids.titulo as number;
    expect((await a.post(aprova, `/financeiro/pagar/titulos/${id}/aprovar`, {})).statusCode).toBe(200);
    const r = await a.post(paga, '/financeiro/pagar/baixa', {
      titulos: [{ titulo: id }],
      conta: 1,
      dataPagamento: hoje,
      formaPagamento: 1,
      porBordero: false,
    });
    expect(r.statusCode).toBe(200);
    expect(Math.round((antes - (await saldo())) * 100) / 100).toBe(321.45);
  });

  it('sem a leitura do movimento, o apoio não leva o saldo da conta', async () => {
    const aprova = await a.entrar('SINT.FIN.APROVA');
    const contas = (await a.get(aprova, '/financeiro/apoio')).json().contas as {
      saldo: number;
      saldoApuradoOutroSistema: number | null;
    }[];
    expect(contas.length).toBeGreaterThan(0);
    expect(contas.every((c) => c.saldo === 0 && c.saldoApuradoOutroSistema === null)).toBe(true);
  });

  it('o cartão do fiscal conta o que falta gerar e diminui depois de gerar', async () => {
    const lanca = await a.entrar('SINT.FIN.LANCA');
    const fiscal = async () =>
      (await a.get(lanca, '/financeiro/worklist'))
        .json()
        .cartoes.find((c: { codigo: string }) => c.codigo === 'fiscal') as {
        quantidade: number;
        rota: string;
      };
    const antes = await fiscal();
    expect(antes.quantidade).toBeGreaterThanOrEqual(2);
    expect(antes.rota).toBe('/financeiro/fiscal/reinf');
    const comp = competenciaAnterior(hoje);
    expect(
      (await a.post(lanca, '/financeiro/fiscal/declaracoes/reinf', { tipo: 'reinf-r4000', periodo: comp }))
        .statusCode,
    ).toBe(200);
    expect(
      (await a.post(lanca, '/financeiro/contabil/lotes', { periodo: comp, regua: 'competencia' })).statusCode,
    ).toBe(200);
    expect((await fiscal()).quantidade).toBe(antes.quantidade - 2);
    // Quem não tem nenhuma permissão de gerar não vê o cartão.
    const aprova = await a.entrar('SINT.FIN.APROVA');
    const cartoes = (await a.get(aprova, '/financeiro/worklist')).json().cartoes as { codigo: string }[];
    expect(cartoes.some((c) => c.codigo === 'fiscal')).toBe(false);
  });
});

describe('apropriação gerencial dos documentos a pagar (memória)', () => {
  it('lista a classificação do documento no período, filtra pelo grupo e exige a leitura da classificação', async () => {
    const lanca = await a.entrar('SINT.FIN.LANCA');
    const r = await a.post(
      lanca,
      '/financeiro/pagar/titulos',
      tituloSintetico(8802, hoje, 500, { classificacao: { grupo: 210, subgrupo: 1, item: 1 } }),
    );
    expect(r.statusCode).toBe(200);
    const id = r.json().ids.titulo as number;
    const lista = (
      await a.get(lanca, `/financeiro/gerencial/apropriacoes?de=${hoje}&ate=${hoje}&grupo=210`)
    ).json();
    const doc = lista.itens.find((x: { documento: number }) => x.documento === 8802);
    expect(doc).toMatchObject({ titulo: id, grupo: 210, subgrupo: 1, item: 1, valor: 500, centrosCusto: 0 });
    expect(doc.nome).toBe('SINTETICO SERVICOS DE TERCEIROS');
    const outro = (
      await a.get(lanca, `/financeiro/gerencial/apropriacoes?de=${hoje}&ate=${hoje}&grupo=216`)
    ).json();
    expect(outro.itens.some((x: { documento: number }) => x.documento === 8802)).toBe(false);
    expect(
      (await a.get(lanca, `/financeiro/gerencial/apropriacoes?de=${hoje}&ate=2000-01-01`)).statusCode,
    ).toBe(400);
    expect((await a.get(tesfis, '/financeiro/gerencial/apropriacoes')).statusCode).toBe(403);
  });
});
