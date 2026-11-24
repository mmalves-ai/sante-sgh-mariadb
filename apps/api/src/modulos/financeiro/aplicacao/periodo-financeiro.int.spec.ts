// F3.8, 07-FIN linha 85: contrato de efeito do fechamento e da reabertura do período financeiro contra o MariaDB real
// (massa SINTÉTICA "L0207"). Fechar o mês passado: a competência fica fechada (quem, quando, quantos movimentos), cada
// conta ganha um saldo por dia com movimento (encadeado: o final de um dia é o anterior do próximo) e o resumo do
// período (inicial, entradas, saídas, final); o lançamento com data no mês fechado é recusado e não grava. Reabrir:
// exige justificativa, guarda quem e por quê, solta os dias; o novo fechamento regrava os saldos com o lançamento novo.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const op = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-pf-${randomUUID()}` });
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const hoje = new Date();
// A competência do mês passado (fechável) e dois dias dela.
const COMP = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
const D1 = `${COMP.slice(0, 8)}03`;
const D2 = `${COMP.slice(0, 8)}10`;
const MES_ATUAL = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)).toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('período financeiro: fechar, travar e reabrir (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  const consultar = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'pf-02-07' }, (l) => l.consultar(sql, p));
  const executar = (nome: string, entrada: unknown, usuario = m.lanca) => {
    const c = m.ctx(usuario);
    return porta.executar(c, nome, entrada, op(c));
  };
  const transferir = (data: string, de: number, para: number, valor: number) =>
    executar('financeiro.lancarMovimento', {
      tipo: 'T',
      data,
      contaCredito: para,
      contaDebito: de,
      valor,
      historico: 'TRANSFERENCIA SINTETICA L0207 PERIODO',
      classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
    });
  const periodo = async () =>
    (
      await consultar(
        `SELECT situacao, fechamento_usuario_id, quantidade_registros, reabertura_usuario_id, autorizador_usuario_id,
                justificativa_reabertura FROM periodo_financeiro WHERE estabelecimento_id = ? AND competencia = ?`,
        [m.est, COMP],
      )
    )[0];
  const dias = async (conta: number) =>
    (
      await consultar(
        `SELECT data_saldo, saldo_anterior, total_entradas, total_saidas, saldo_final, fechado, operacao
           FROM saldo_diario_conta WHERE conta_bancaria_id = ? AND data_saldo BETWEEN ? AND LAST_DAY(?) ORDER BY data_saldo`,
        [conta, COMP, COMP],
      )
    ).map((r) => ({
      data: iso(r['data_saldo']),
      anterior: Number(r['saldo_anterior']),
      entradas: Number(r['total_entradas']),
      saidas: Number(r['total_saidas']),
      final: Number(r['saldo_final']),
      fechado: Number(r['fechado']) === 1,
      operacao: String(r['operacao']),
    }));
  const movimentosDoMes = async () =>
    Number(
      (
        await consultar(
          `SELECT COUNT(*) AS n FROM movimento_bancario WHERE estabelecimento_id = ? AND situacao = 'ativo'
              AND excluido_em IS NULL AND data_movimento BETWEEN ? AND LAST_DAY(?)`,
          [m.est, COMP, COMP],
        )
      )[0]?.['n'] ?? 0,
    );

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
  });

  afterAll(async () => {
    if (m) {
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('fecha o mês passado: competência fechada, saldo por dia encadeado e resumo por conta', async () => {
    await transferir(D1, m.contaA, m.contaB, 77.7);
    await transferir(D2, m.contaB, m.contaA, 20);
    const r = await executar('financeiro.fecharPeriodo', { competencia: COMP });
    expect(Number(r.resultado['movimentos'])).toBe(await movimentosDoMes());

    const p = await periodo();
    expect(p?.['situacao']).toBe('fechado');
    expect(Number(p?.['fechamento_usuario_id'])).toBe(m.lanca);
    expect(Number(p?.['quantidade_registros'])).toBe(await movimentosDoMes());

    const a = await dias(m.contaA);
    const dA1 = a.find((d) => d.data === D1);
    const dA2 = a.find((d) => d.data === D2);
    expect(dA1?.saidas).toBeGreaterThanOrEqual(77.7);
    expect(dA2?.entradas).toBeGreaterThanOrEqual(20);
    expect(a.every((d) => d.fechado && d.operacao === 'inclusao')).toBe(true);
    // Encadeado: o final de cada dia é o anterior do próximo, e o final é anterior + entradas - saídas.
    for (let i = 0; i < a.length; i++) {
      const d = a[i]!;
      expect(Math.round((d.anterior + d.entradas - d.saidas) * 100)).toBe(Math.round(d.final * 100));
      if (i > 0) expect(d.anterior).toBe(a[i - 1]!.final);
    }
    const [resumo] = await consultar(
      `SELECT s.saldo_inicial, s.total_credito, s.total_debito, s.saldo_final FROM saldo_financeiro_periodo s
         JOIN periodo_financeiro p ON p.id = s.periodo_financeiro_id
        WHERE p.estabelecimento_id = ? AND p.competencia = ? AND s.tipo_referencia = 'conta_bancaria'
          AND s.conta_bancaria_id = ?`,
      [m.est, COMP, m.contaA],
    );
    expect(Number(resumo?.['saldo_final'])).toBe(a[a.length - 1]!.final);
    expect(Number(resumo?.['saldo_inicial'])).toBe(a[0]!.anterior);
  });

  it('trava o retroativo: movimento e repetição do fechamento recusados, nada gravado', async () => {
    const antes = await movimentosDoMes();
    expect(await codigoDaGravacao(transferir(D1, m.contaA, m.contaB, 5))).toBe('periodo-fechado');
    expect(await movimentosDoMes()).toBe(antes);
    expect(await codigoDaGravacao(executar('financeiro.fecharPeriodo', { competencia: COMP }))).toBe(
      'periodo-ja-fechado',
    );
    expect(await codigoDaGravacao(executar('financeiro.fecharPeriodo', { competencia: MES_ATUAL }))).toBe(
      'periodo-em-curso',
    );
    const atual = await consultar(
      'SELECT COUNT(*) AS n FROM periodo_financeiro WHERE estabelecimento_id = ? AND competencia = ?',
      [m.est, MES_ATUAL],
    );
    expect(Number(atual[0]?.['n'])).toBe(0);
  });

  it('reabre com justificativa, guarda quem e por quê, e o novo fechamento regrava o dia', async () => {
    expect(
      await codigoDaGravacao(
        executar('financeiro.reabrirPeriodo', { competencia: COMP, justificativa: 'erro' }),
      ),
    ).toBe('justificativa-obrigatoria');
    expect((await periodo())?.['situacao']).toBe('fechado');

    const just = 'Tarifa do banco lançada fora do mês';
    await executar('financeiro.reabrirPeriodo', { competencia: COMP, justificativa: just }, m.aprova);
    const p = await periodo();
    expect(p?.['situacao']).toBe('reaberto');
    expect(Number(p?.['reabertura_usuario_id'])).toBe(m.aprova);
    expect(Number(p?.['autorizador_usuario_id'])).toBe(m.aprova);
    expect(p?.['justificativa_reabertura']).toBe(just);
    expect((await dias(m.contaA)).every((d) => !d.fechado)).toBe(true);

    const antes = (await dias(m.contaA)).find((d) => d.data === D1)!;
    await transferir(D1, m.contaA, m.contaB, 5);
    await executar('financeiro.fecharPeriodo', { competencia: COMP });
    const depois = (await dias(m.contaA)).find((d) => d.data === D1)!;
    expect(Math.round((depois.saidas - antes.saidas) * 100)).toBe(500);
    expect([depois.fechado, depois.operacao]).toEqual([true, 'alteracao']);
    expect((await periodo())?.['situacao']).toBe('fechado');
  });
});
