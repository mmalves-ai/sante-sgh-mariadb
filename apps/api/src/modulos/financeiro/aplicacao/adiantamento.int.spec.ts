// F3.8, 07-FIN linha 67: contrato de efeito do adiantamento contra o MariaDB real (massa SINTÉTICA "L0207").
// Conceder: a linha do adiantamento (saldo = valor, situação "pago"), o grupo de lançamentos e a saída (débito) na conta,
// no mesmo grupo. Compensar: a baixa "compensacao" sem conta, a linha de compensação, a parcela e o saldo do adiantamento
// reduzidos. Devolver: a entrada (crédito) na conta e o saldo zerado. As recusas não gravam nada.
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

const comChave = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-ad-${randomUUID()}` });
const trilha = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao' as const,
  entidade: 'teste',
  entidadeId: null,
  correlacao: null,
};
const hoje = () => new Date().toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('adiantamento: conceder, compensar e devolver (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  const uma = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente(
      { cliente: process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2', correlacao: 'ad-02-07' },
      (l) => l.uma(sql, p),
    );

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
  }, 180_000);
  afterAll(async () => {
    if (m) {
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  const conceder = (credor: number, valor: number, conta = m.contaA) =>
    porta.gravarSgh(comChave(m.ctx(m.paga)), trilha, (g) =>
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

  it('concede, compensa no título do mesmo credor e devolve o saldo, com o efeito de cada passo', async () => {
    const ad = await conceder(m.fornecedor, 500);
    expect(ad.numero).toMatch(/^AD-/);
    const a0 = await uma(
      'SELECT situacao, valor, saldo_compensar, grupo_lancamento_financeiro_id AS g FROM adiantamento WHERE id = ?',
      [ad.id],
    );
    expect([String(a0?.['situacao']), Number(a0?.['valor']), Number(a0?.['saldo_compensar'])]).toEqual([
      'pago',
      500,
      500,
    ]);
    const mv = await uma(
      'SELECT natureza, valor, conta_bancaria_id AS c, grupo_lancamento_financeiro_id AS g FROM movimento_bancario WHERE id = ?',
      [ad.movimento],
    );
    expect([String(mv?.['natureza']), Number(mv?.['valor']), Number(mv?.['c']), Number(mv?.['g'])]).toEqual([
      'debito',
      500,
      m.contaA,
      Number(a0?.['g']),
    ]);

    // O título do mesmo credor (300) é compensado com 300 do adiantamento: a parcela fica paga, o saldo cai a 200.
    const c = m.ctx(m.lanca);
    const t = await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, 7401, 300), {
      ...c,
      chaveIdempotencia: `t0207-ad-${randomUUID()}`,
    });
    const parcela = Number(t.resultado['titulo']);
    const comp = await porta.gravarSgh(comChave(m.ctx(m.paga)), trilha, (g) =>
      g.compensarAdiantamento({ adiantamento: ad.id, parcela, valor: 300, data: hoje(), usuario: 'x' }),
    );
    expect(comp.saldo).toBe(200);
    const b = await uma(
      'SELECT forma_pagamento AS f, conta_bancaria_id AS c, valor_pago AS v FROM baixa_titulo WHERE id = ?',
      [comp.baixa],
    );
    expect([String(b?.['f']), b?.['c'] ?? null, Number(b?.['v'])]).toEqual(['compensacao', null, 300]);
    const p = await uma('SELECT situacao, saldo FROM parcela_pagar WHERE id = ?', [parcela]);
    expect([String(p?.['situacao']), Number(p?.['saldo'])]).toEqual(['paga', 0]);
    const ca = await uma(
      'SELECT valor_compensado AS v FROM compensacao_adiantamento WHERE adiantamento_id = ? AND baixa_titulo_id = ?',
      [ad.id, comp.baixa],
    );
    expect(Number(ca?.['v'])).toBe(300);
    const a1 = await uma('SELECT situacao, saldo_compensar AS s FROM adiantamento WHERE id = ?', [ad.id]);
    expect([String(a1?.['situacao']), Number(a1?.['s'])]).toEqual(['compensado_parcial', 200]);

    // Compensar de novo a parcela já paga é recusado; devolver mais do que o saldo também.
    expect(
      await codigoDaGravacao(
        porta.gravarSgh(comChave(m.ctx(m.paga)), trilha, (g) =>
          g.compensarAdiantamento({ adiantamento: ad.id, parcela, valor: 1, data: hoje(), usuario: 'x' }),
        ),
      ),
    ).toBe('titulo-inexistente');
    const devolver = (valor: number, motivo = 'Sobra devolvida') =>
      porta.gravarSgh(comChave(m.ctx(m.paga)), trilha, (g) =>
        g.devolverAdiantamento({
          adiantamento: ad.id,
          conta: m.contaA,
          valor,
          data: hoje(),
          motivo,
          usuario: 'x',
          contasEscopo: [m.contaA, m.contaB],
        }),
      );
    expect(await codigoDaGravacao(devolver(200.01))).toBe('acima-do-saldo');
    const dv = await devolver(200);
    expect(dv.saldo).toBe(0);
    const mv2 = await uma('SELECT natureza, valor FROM movimento_bancario WHERE id = ?', [dv.movimento]);
    expect([String(mv2?.['natureza']), Number(mv2?.['valor'])]).toEqual(['credito', 200]);
    const a2 = await uma(
      'SELECT situacao, saldo_compensar AS s, encerrado_em AS e FROM adiantamento WHERE id = ?',
      [ad.id],
    );
    expect([String(a2?.['situacao']), Number(a2?.['s']), a2?.['e'] != null]).toEqual(['compensado', 0, true]);
    // O adiantamento encerrado segue na consulta (registro nunca apagado), com o compensado e o saldo.
    const lista = await porta.adiantamentos(m.ctx(m.paga));
    expect(lista.find((x) => x.id === ad.id)).toMatchObject({
      tipoCredor: 'fornecedor',
      situacao: 'compensado',
      compensado: 500,
      saldo: 0,
    });
  });

  it('recusa: outro credor, conta fora do escopo e valor zero não gravam', async () => {
    const ad = await conceder(m.tributo, 100);
    const c = m.ctx(m.lanca);
    const t = await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, 7402, 50), {
      ...c,
      chaveIdempotencia: `t0207-ad-${randomUUID()}`,
    });
    expect(
      await codigoDaGravacao(
        porta.gravarSgh(comChave(m.ctx(m.paga)), trilha, (g) =>
          g.compensarAdiantamento({
            adiantamento: ad.id,
            parcela: Number(t.resultado['titulo']),
            valor: 50,
            data: hoje(),
            usuario: 'x',
          }),
        ),
      ),
    ).toBe('credor-diferente');
    expect(await codigoDaGravacao(conceder(m.fornecedor, 10, m.contaOutroEst))).toBe('fora-do-escopo');
    expect(await codigoDaGravacao(conceder(m.fornecedor, 0))).toBe('valor-obrigatorio');
    const n = await uma(
      "SELECT COUNT(*) AS n FROM adiantamento WHERE estabelecimento_id = ? AND referente LIKE 'SINTETICO L0207%'",
      [m.est],
    );
    expect(Number(n?.['n'])).toBe(2);
  });
});
