// F3.8, 07-FIN linha 67: contrato de efeito do adiantamento contra o MariaDB real (massa SINTÉTICA "L0207").
// Pedir: a linha do adiantamento em aberto, sem movimento nem grupo (o pedido não tira dinheiro). Aprovar: a decisão no
// pedido de aprovação da alçada (a mesma faixa do título a pagar); quem pediu não aprova. Pagar: o grupo e a saída
// (débito) na conta, no mesmo grupo; quem pediu ou aprovou não paga. Compensar: só em título aprovado na alçada, por quem
// não lançou nem aprovou o título; a baixa "compensacao" sem conta, a linha de compensação, a parcela, o título e o saldo
// do adiantamento. Devolver (parcial e total): a entrada (crédito) na conta. Cada recusa deixa todas as tabelas tocadas
// como estavam; a mesma chave repetida não grava de novo; a trilha leva a entidade e o id do adiantamento.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const comChave = (c: ContextoNucleo, chave = `t0207-ad-${randomUUID()}`) => ({
  ...c,
  chaveIdempotencia: chave,
});
const trilhaDo = (id: number) => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao' as const,
  entidade: 'adiantamento',
  entidadeId: id,
  correlacao: null,
});
const hoje = () => new Date().toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('adiantamento: pedir, aprovar, pagar, compensar e devolver (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  const uma = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente(
      { cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2', correlacao: 'ad-02-07' },
      (l) => l.uma(sql, p),
    );
  const contar = async (sql: string, p: unknown[]) => Number((await uma(sql, p))?.['n'] ?? 0);
  /** As contagens de todas as tabelas que as gravações do adiantamento tocam (a recusa não muda nenhuma). */
  const retrato = async () => ({
    adiantamento: await contar('SELECT COUNT(*) AS n FROM adiantamento WHERE estabelecimento_id = ?', [
      m.est,
    ]),
    movimento: await contar('SELECT COUNT(*) AS n FROM movimento_bancario WHERE estabelecimento_id = ?', [
      m.est,
    ]),
    grupo: await contar(
      'SELECT COUNT(*) AS n FROM grupo_lancamento_financeiro WHERE estabelecimento_id = ?',
      [m.est],
    ),
    baixa: await contar('SELECT COUNT(*) AS n FROM baixa_titulo WHERE estabelecimento_id = ?', [m.est]),
    compensacao: await contar(
      'SELECT COUNT(*) AS n FROM compensacao_adiantamento c JOIN adiantamento a ON a.id = c.adiantamento_id WHERE a.estabelecimento_id = ?',
      [m.est],
    ),
    decisao: await contar(
      'SELECT COUNT(*) AS n FROM decisao_aprovacao d JOIN pedido_aprovacao p ON p.id = d.pedido_aprovacao_id WHERE p.estabelecimento_id = ?',
      [m.est],
    ),
  });
  const recusada = async (p: Promise<unknown>) => {
    const antes = await retrato();
    const codigo = await codigoDaGravacao(p);
    expect(await retrato()).toEqual(antes);
    return codigo;
  };

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    // A faixa da alçada (uma aprovação, qualquer valor): vale para o título e para o adiantamento.
    await porta.gravarSgh(comChave(m.ctx(m.lanca)), trilhaDo(0), (g) =>
      g.salvarFaixa({
        id: null,
        centroCusto: null,
        tipoCredor: null,
        valorDe: 0,
        valorAte: null,
        aprovacoes: 1,
        permissao: 'financeiro.tituloPagar.aprovar',
        vigenciaInicio: '2000-01-01',
        vigenciaFim: null,
        ativa: true,
        usuario: 'x',
      }),
    );
  }, 180_000);
  afterAll(async () => {
    if (m) {
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  const pedir = (credor: number, valor: number, conta = m.contaA) =>
    porta.gravarSgh(comChave(m.ctx(m.lanca)), trilhaDo(0), (g) =>
      g.concederAdiantamento({
        tipoCredor: 'fornecedor',
        credor,
        conta,
        valor,
        data: hoje(),
        prazo: null,
        referente: 'SINTETICO L0207 adiantamento',
        usuario: 'x',
        contasEscopo: [m.contaA, m.contaB],
      }),
    );
  const aprovar = (id: number, u: number) =>
    porta.gravarSgh(comChave(m.ctx(u)), trilhaDo(id), (g) =>
      g.aprovarAdiantamento({ adiantamento: id, observacao: '', usuario: 'x', temPermissao: () => true }),
    );
  const pagar = (id: number, u: number) =>
    porta.gravarSgh(comChave(m.ctx(u)), trilhaDo(id), (g) =>
      g.pagarAdiantamento({
        adiantamento: id,
        data: hoje(),
        usuario: 'x',
        contasEscopo: [m.contaA, m.contaB],
      }),
    );
  const compensar = (id: number, parcela: number, valor: number, u = m.paga, chave?: string) =>
    porta.gravarSgh(comChave(m.ctx(u), chave), trilhaDo(id), (g) =>
      g.compensarAdiantamento({ adiantamento: id, parcela, valor, data: hoje(), usuario: 'x' }),
    );
  const devolver = (id: number, valor: number, motivo = 'Sobra devolvida') =>
    porta.gravarSgh(comChave(m.ctx(m.paga)), trilhaDo(id), (g) =>
      g.devolverAdiantamento({
        adiantamento: id,
        conta: m.contaA,
        valor,
        data: hoje(),
        motivo,
        usuario: 'x',
        contasEscopo: [m.contaA, m.contaB],
      }),
    );
  const titulo = async (documento: number, valor: number) => {
    const c = m.ctx(m.lanca);
    const t = await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, documento, valor), {
      ...c,
      chaveIdempotencia: `t0207-ad-${randomUUID()}`,
    });
    return { parcela: Number(t.resultado['titulo']), titulo: Number(t.resultado['tituloPagar']) };
  };
  const aprovarTitulo = (parcela: number) =>
    porta.gravarSgh(comChave(m.ctx(m.aprova)), trilhaDo(0), (g) =>
      g.aprovarTitulo({ titulo: parcela, observacao: '', usuario: 'x', temPermissao: () => true }),
    );
  const pago = async (credor: number, valor: number) => {
    const ad = await pedir(credor, valor);
    await aprovar(ad.id, m.aprova);
    await pagar(ad.id, m.paga);
    return ad;
  };

  it('pede, aprova na alçada, paga, compensa no título aprovado e devolve, com o efeito de cada passo', async () => {
    const r0 = await retrato();
    const ad = await pedir(m.fornecedor, 500);
    expect(ad.numero).toMatch(/^AD-/);
    // O pedido não tira dinheiro: só a linha do adiantamento, em aberto.
    expect(await retrato()).toEqual({ ...r0, adiantamento: r0.adiantamento + 1 });
    const a0 = await uma(
      'SELECT situacao, valor, valor_pago, grupo_lancamento_financeiro_id AS g FROM adiantamento WHERE id = ?',
      [ad.id],
    );
    expect([
      String(a0?.['situacao']),
      Number(a0?.['valor']),
      Number(a0?.['valor_pago']),
      a0?.['g'] ?? null,
    ]).toEqual(['aberto', 500, 0, null]);

    // Sem aprovação não sai; quem pediu não aprova.
    expect(await recusada(pagar(ad.id, m.paga))).toBe('sem-aprovacao');
    expect(await recusada(aprovar(ad.id, m.lanca))).toBe('segregacao-lancou-aprova');
    const ap = await aprovar(ad.id, m.aprova);
    expect([ap.aprovado, ap.faltam]).toEqual([true, 0]);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM pedido_aprovacao WHERE entidade = 'adiantamento' AND entidade_id = ? AND situacao = 'aprovado'",
        [ad.id],
      ),
    ).toBe(1);
    expect(String((await uma('SELECT situacao FROM adiantamento WHERE id = ?', [ad.id]))?.['situacao'])).toBe(
      'aprovado',
    );
    expect(await recusada(aprovar(ad.id, m.paga))).toBe('adiantamento-ja-aprovado');

    // Quem pediu ou aprovou não paga; a outra pessoa paga: o grupo e a saída na conta.
    expect(await recusada(pagar(ad.id, m.lanca))).toBe('segregacao-lancou-paga');
    expect(await recusada(pagar(ad.id, m.aprova))).toBe('segregacao-aprovou-paga');
    const r1 = await retrato();
    const pg = await pagar(ad.id, m.paga);
    expect(await retrato()).toEqual({ ...r1, movimento: r1.movimento + 1, grupo: r1.grupo + 1 });
    const a1 = await uma(
      'SELECT situacao, valor_pago AS p, saldo_compensar AS s, grupo_lancamento_financeiro_id AS g FROM adiantamento WHERE id = ?',
      [ad.id],
    );
    const mv = await uma(
      'SELECT natureza, valor, conta_bancaria_id AS c, grupo_lancamento_financeiro_id AS g FROM movimento_bancario WHERE id = ?',
      [pg.movimento],
    );
    expect([String(a1?.['situacao']), Number(a1?.['p']), Number(a1?.['s'])]).toEqual(['pago', 500, 500]);
    expect([String(mv?.['natureza']), Number(mv?.['valor']), Number(mv?.['c']), Number(mv?.['g'])]).toEqual([
      'debito',
      500,
      m.contaA,
      Number(a1?.['g']),
    ]);
    expect(await recusada(pagar(ad.id, m.paga))).toBe('adiantamento-ja-pago');

    // O título do mesmo credor (300): sem aprovação na alçada a compensação é recusada (é uma baixa).
    const t = await titulo(7401, 300);
    expect(await recusada(compensar(ad.id, t.parcela, 300))).toBe('sem-aprovacao');
    expect((await aprovarTitulo(t.parcela)).aprovado).toBe(true);
    expect(await recusada(compensar(ad.id, t.parcela, 300, m.lanca))).toBe('segregacao-lancou-paga');
    expect(await recusada(compensar(ad.id, t.parcela, 300, m.aprova))).toBe('segregacao-aprovou-paga');
    const r2 = await retrato();
    const chave = `t0207-ad-${randomUUID()}`;
    const comp = await compensar(ad.id, t.parcela, 300, m.paga, chave);
    expect(comp.saldo).toBe(200);
    // Nenhum dinheiro passa pela conta: só a baixa e a linha de compensação.
    expect(await retrato()).toEqual({ ...r2, baixa: r2.baixa + 1, compensacao: r2.compensacao + 1 });
    // A mesma chave repetida devolve o resultado gravado, sem gravar de novo.
    expect(await compensar(ad.id, t.parcela, 300, m.paga, chave)).toEqual(comp);
    expect(await retrato()).toEqual({ ...r2, baixa: r2.baixa + 1, compensacao: r2.compensacao + 1 });
    const b = await uma(
      'SELECT forma_pagamento AS f, conta_bancaria_id AS c, valor_pago AS v FROM baixa_titulo WHERE id = ?',
      [comp.baixa],
    );
    expect([String(b?.['f']), b?.['c'] ?? null, Number(b?.['v'])]).toEqual(['compensacao', null, 300]);
    const p = await uma('SELECT situacao, saldo FROM parcela_pagar WHERE id = ?', [t.parcela]);
    expect([String(p?.['situacao']), Number(p?.['saldo'])]).toEqual(['paga', 0]);
    const tp = await uma('SELECT situacao FROM titulo_pagar WHERE id = ?', [t.titulo]);
    expect(String(tp?.['situacao'])).toBe('pago');
    const ca = await uma(
      'SELECT valor_compensado AS v FROM compensacao_adiantamento WHERE adiantamento_id = ? AND baixa_titulo_id = ?',
      [ad.id, comp.baixa],
    );
    expect(Number(ca?.['v'])).toBe(300);
    const a2 = await uma('SELECT situacao, saldo_compensar AS s FROM adiantamento WHERE id = ?', [ad.id]);
    expect([String(a2?.['situacao']), Number(a2?.['s'])]).toEqual(['compensado_parcial', 200]);

    // Compensar de novo a parcela já paga é recusado; devolver mais do que o saldo também.
    expect(await recusada(compensar(ad.id, t.parcela, 1))).toBe('titulo-inexistente');
    expect(await recusada(devolver(ad.id, 200.01))).toBe('acima-do-saldo');
    expect(await recusada(devolver(ad.id, 50, ' '))).toBe('motivo-obrigatorio');
    // Devolução parcial (50) e depois a do resto (150): duas entradas na conta.
    const dv1 = await devolver(ad.id, 50);
    expect(dv1.saldo).toBe(150);
    const a3 = await uma('SELECT situacao, saldo_compensar AS s FROM adiantamento WHERE id = ?', [ad.id]);
    expect([String(a3?.['situacao']), Number(a3?.['s'])]).toEqual(['compensado_parcial', 150]);
    const dv = await devolver(ad.id, 150);
    expect(dv.saldo).toBe(0);
    const mv2 = await uma('SELECT natureza, valor FROM movimento_bancario WHERE id = ?', [dv.movimento]);
    expect([String(mv2?.['natureza']), Number(mv2?.['valor'])]).toEqual(['credito', 150]);
    const a4 = await uma(
      'SELECT situacao, saldo_compensar AS s, encerrado_em AS e FROM adiantamento WHERE id = ?',
      [ad.id],
    );
    expect([String(a4?.['situacao']), Number(a4?.['s']), a4?.['e'] != null]).toEqual(['compensado', 0, true]);
    // A trilha de cada passo leva a entidade e o id do adiantamento (aprovar, pagar, compensar, duas devoluções).
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'adiantamento' AND entidade_id = ?",
        [ad.id],
      ),
    ).toBeGreaterThanOrEqual(5);
    // O adiantamento encerrado segue na consulta (registro nunca apagado), com o compensado e o saldo.
    const lista = await porta.adiantamentos(m.ctx(m.paga));
    expect(lista.find((x) => x.id === ad.id)).toMatchObject({
      tipoCredor: 'fornecedor',
      situacao: 'compensado',
      compensado: 500,
      saldo: 0,
      aprovacoes: 1,
      exigidas: 1,
      conta: m.contaA,
    });
  });

  it('recusa: outro credor, conta fora do escopo e valor zero não gravam; o credor é o par (tipo, id)', async () => {
    const ad = await pago(m.tributo, 100);
    const t = await titulo(7402, 50);
    await aprovarTitulo(t.parcela);
    expect(await recusada(compensar(ad.id, t.parcela, 50))).toBe('credor-diferente');
    expect(await recusada(pedir(m.fornecedor, 10, m.contaOutroEst))).toBe('fora-do-escopo');
    expect(await recusada(pedir(m.fornecedor, 0))).toBe('valor-obrigatorio');
    // A lista de títulos do credor pelo par (tipo, id): o título do fornecedor N não aparece para o profissional N.
    const filtro = {
      situacao: null,
      vencimentoDe: null,
      vencimentoAte: null,
      credor: m.fornecedor,
      tipo: null,
      pagina: 0,
      hoje: hoje(),
    };
    const doFornecedor = await porta.titulosPagar(m.ctx(m.paga), { ...filtro, credorDe: 'fornecedor' });
    expect(doFornecedor.itens.some((x) => x.id === t.parcela)).toBe(true);
    const doProfissional = await porta.titulosPagar(m.ctx(m.paga), { ...filtro, credorDe: 'profissional' });
    expect(doProfissional.itens.some((x) => x.id === t.parcela)).toBe(false);
  });
});
