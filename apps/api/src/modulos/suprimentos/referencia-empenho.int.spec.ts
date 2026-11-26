// Contrato de efeito da referência do empenho no pedido de compra e no título a pagar (C3-025, 07-FIN linha 132) contra
// o MariaDB real (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: o pedido do mesmo credor
// recebe pedido_compra.empenho_id; credor diferente, pedido reprovado e empenho anulado recusam sem gravar; versão velha
// dá conflito; o título recebe titulo_pagar.empenho_id até a soma chegar ao valor empenhado, e o que passaria recusa; a
// repetição pela mesma chave não grava de novo; outro estabelecimento não vê o empenho; a exportação para o ente traz uma
// linha por título com o pedido. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaAtaEmpenhoPropria } from './ata-empenho.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';

const k = () => `t-c3025-${randomUUID()}`;
const MARCA = Date.now().toString(36).toUpperCase();
type L = Record<string, unknown>;

describe.skipIf(SEM_BANCO)('referência do empenho no pedido e no título (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtaEmpenhoPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  let emp = 0;
  let anulado = 0;
  let pedido = 0;
  let pedidoOutro = 0;
  let pedidoCancelado = 0;
  const titulos: number[] = [];
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c3025' }, (l) => l.uma<L>(sql, p));
  const versao = async (tabela: string, id: number) =>
    Number((await um(`SELECT versao FROM ${tabela} WHERE id = ?`, [id]))?.['versao']);
  const ref = async (tabela: string, id: number) =>
    (await um(`SELECT empenho_id FROM ${tabela} WHERE id = ?`, [id]))?.['empenho_id'] ?? null;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaAtaEmpenhoPropria(nucleo);
    c = contexto(m, m.estA, 't-c3025') as ContextoPortaM18;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c3025-massa' }, async (e) => {
      const empenho = (numero: string, situacao: string, extra: Record<string, unknown> = {}) =>
        inserirMinimo(
          e,
          'empenho',
          {
            estabelecimento_id: m.estA,
            numero_empenho: numero,
            empresa_fornecedora_id: m.fornecedor,
            emitido_em: '2026-11-02',
            fonte_recurso: '1.500.1002',
            natureza_despesa: '3.3.90.30',
            valor_total: 150,
            situacao,
            ...extra,
          },
          'c3025',
        );
      emp = await empenho(`R1${MARCA}`, 'emitido');
      anulado = await empenho(`R2${MARCA}`, 'anulado', { cancelado_em: new Date() });
      const ped = (numero: number, fornecedor: number, situacao: string) =>
        inserirMinimo(
          e,
          'pedido_compra',
          {
            estabelecimento_id: m.estA,
            ano: 2026,
            numero,
            empresa_fornecedora_id: fornecedor,
            centro_custo_id: m.centroCusto,
            data_pedido: '2026-11-03',
            situacao,
            ...(situacao === 'aprovado' ? { aprovado_em: new Date() } : {}),
          },
          'c3025',
        );
      const base = 900_000_000 + (Date.now() % 90_000_000);
      pedido = await ped(base, m.fornecedor, 'aprovado');
      pedidoOutro = await ped(base + 1, m.fornecedor2, 'aprovado');
      pedidoCancelado = await ped(base + 2, m.fornecedor, 'reprovado');
      const um1 = async (sql: string) => Number((await e.consultar<L>(sql))[0]?.['id']);
      const tipoCredor = await um1('SELECT id FROM tipo_credor ORDER BY id LIMIT 1');
      const tipoDoc = await um1('SELECT id FROM tipo_documento_financeiro ORDER BY id LIMIT 1');
      const natureza = await um1('SELECT id FROM natureza_financeira ORDER BY id LIMIT 1');
      for (const [i, valor] of [100, 50, 0.01].entries())
        titulos.push(
          await inserirMinimo(
            e,
            'titulo_pagar',
            {
              estabelecimento_id: m.estA,
              numero: `TP${MARCA}${i}`.slice(0, 30),
              tipo_credor_id: tipoCredor,
              empresa_fornecedora_id: m.fornecedor,
              tipo_documento_financeiro_id: tipoDoc,
              natureza_financeira_id: natureza,
              numero_documento: `NF${i}`,
              data_emissao: '2026-11-10',
              data_lancamento: '2026-11-10',
              valor_bruto: valor,
              valor_liquido: valor,
              situacao: 'aberto',
            },
            'c3025',
          ),
        );
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c3025-limpa' }, async (e) => {
        if (titulos.length)
          await e.executar(`DELETE FROM titulo_pagar WHERE id IN (${titulos.join(',')})`, []);
        await e.executar('DELETE FROM pedido_compra WHERE id IN (?, ?, ?)', [
          pedido,
          pedidoOutro,
          pedidoCancelado,
        ]);
        await e.executar('DELETE FROM empenho WHERE id IN (?, ?)', [emp, anulado]);
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  it('o pedido recebe o empenho do mesmo credor; os demais recusam sem gravar', async () => {
    expect(
      await codigoDe(
        porta.referirPedido(
          c,
          emp,
          { id: pedidoOutro, versao: await versao('pedido_compra', pedidoOutro) },
          k(),
        ),
      ),
    ).toBe('empenho-credor-diferente');
    expect(
      await codigoDe(
        porta.referirPedido(
          c,
          emp,
          { id: pedidoCancelado, versao: await versao('pedido_compra', pedidoCancelado) },
          k(),
        ),
      ),
    ).toBe('pedido-sem-empenho');
    expect(
      await codigoDe(
        porta.referirPedido(c, anulado, { id: pedido, versao: await versao('pedido_compra', pedido) }, k()),
      ),
    ).toBe('empenho-fora-de-vigor');
    expect(await ref('pedido_compra', pedidoOutro)).toBeNull();
    expect(await ref('pedido_compra', pedidoCancelado)).toBeNull();
    expect(await ref('pedido_compra', pedido)).toBeNull();

    const v = await versao('pedido_compra', pedido);
    expect(await codigoDe(porta.referirPedido(c, emp, { id: pedido, versao: v + 5 }, k()))).toBe(
      'conflito-versao',
    );
    const chave = k();
    const r = await porta.referirPedido(c, emp, { id: pedido, versao: v }, chave);
    expect(r).toMatchObject({ id: pedido, numero: `R1${MARCA}`, itens: 1 });
    expect((await porta.referirPedido(c, emp, { id: pedido, versao: v }, chave)).id).toBe(pedido);
    expect(Number(await ref('pedido_compra', pedido))).toBe(emp);
    expect(await versao('pedido_compra', pedido)).toBe(v + 1);
    const trilha = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'pedido_compra' AND entidade_id = ?",
      [pedido],
    );
    expect(Number(trilha?.['n'])).toBe(1);

    // Outro estabelecimento não vê o empenho.
    const cB = contexto(m, m.estB, 't-c3025-b') as ContextoPortaM18;
    expect(await codigoDe(porta.referencias(cB, emp))).toContain('Empenho não encontrado');
  }, 120_000);

  it('o título recebe o empenho até o valor empenhado; a exportação traz o pedido e o título', async () => {
    const [t1, t2, t3] = titulos as [number, number, number];
    const cand = await porta.candidatosReferencia(c, emp, '');
    expect(cand.titulos.map((x) => x.id)).toEqual(expect.arrayContaining([t1, t2, t3]));
    expect(cand.pedidos.map((x) => x.id)).not.toContain(pedidoOutro);
    expect(cand.pedidos.map((x) => x.id)).not.toContain(pedidoCancelado);

    const r1 = await porta.referirTitulo(c, emp, { id: t1, versao: await versao('titulo_pagar', t1) }, k());
    expect(r1.valorTotal).toBe(100);
    const r2 = await porta.referirTitulo(c, emp, { id: t2, versao: await versao('titulo_pagar', t2) }, k());
    expect(r2.valorTotal).toBe(150);
    expect(
      await codigoDe(porta.referirTitulo(c, emp, { id: t3, versao: await versao('titulo_pagar', t3) }, k())),
    ).toBe('empenho-sem-saldo');
    expect(await ref('titulo_pagar', t3)).toBeNull();
    expect(Number(await ref('titulo_pagar', t1))).toBe(emp);
    expect(Number(await ref('titulo_pagar', t2))).toBe(emp);

    const visao = await porta.referencias(c, emp);
    expect(visao).toMatchObject({ valorTotal: 150, referido: 150, saldo: 0 });
    expect(visao.pedidos.map((p) => p.id)).toEqual([pedido]);
    expect(visao.titulos.map((x) => x.id)).toEqual([t1, t2]);

    const csv = await porta.exportacao(c, '2026-11-01', '2026-11-30');
    const linhas = csv
      .trim()
      .split('\r\n')
      .filter((l) => l.startsWith(`R1${MARCA};`));
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toContain(';100.00;aberto');
    expect(linhas[0]?.split(';')[7]).toMatch(/^2026\/\d+$/);
    expect(
      csv
        .trim()
        .split('\r\n')
        .filter((l) => l.startsWith(`R2${MARCA};`)),
    ).toHaveLength(1);
    expect((await porta.exportacao(c, '2026-12-01', '2026-12-31')).includes(`R1${MARCA}`)).toBe(false);
  }, 120_000);
});
