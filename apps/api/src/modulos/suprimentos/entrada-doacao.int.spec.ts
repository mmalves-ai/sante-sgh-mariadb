// Contrato de efeito da entrada de produtos recebidos em doação (C1-126, 09-AREA linha 79) contra o MariaDB real
// (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: a doação de empresa com o valor justo
// do termo grava o recebimento (doacao, sem pedido, modelo recibo, termo no número, total = soma das parcelas), o item
// com o critério, o lote, o movimento "entrada_doacao" com propriedade doação e o saldo com a parte doada; a repetição
// pela mesma chave não grava de novo; o termo repetido e o item nunca comprado sem valor justo são recusados sem gravar
// nada; a doação de pessoa pelo último preço de compra usa o custo da última nota de compra e deixa o emitente vazio; a
// saída consome primeiro o que não é doado e a parte doada nunca passa do saldo. Outro estabelecimento não vê a doação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { definirOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { type EntradaDoacao, PortaEntradaDoacaoPropria } from './entrada-doacao.js';
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
import { TABELAS_PUBLICACAO_FATO } from '../contabil/publicacao-fato.js';
import type { ContextoSuprimentos } from './porta.js';
import { movimentar, PortaSuprimentosPropria, tipoMovimentoId } from './porta-propria.js';

const k = () => `t-doa-${randomUUID()}`;
const TERMO = `TD${Date.now().toString(36).toUpperCase()}`.slice(0, 14);
type L = Record<string, unknown>;

describe.skipIf(SEM_BANCO)('entrada por doação (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEntradaDoacaoPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  let pessoa = 0;
  let naoDoador = 0;
  let notaCompra = 0;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c1126' }, (l) => l.uma<L>(sql, p));
  const saldo = async () => {
    const s = await um(
      'SELECT quantidade, quantidade_doada, custo_medio FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
      [m.localA, m.insumo],
    );
    return { q: Number(s?.['quantidade'] ?? 0), doada: Number(s?.['quantidade_doada'] ?? 0) };
  };
  const notasDoacao = async () =>
    Number(
      (
        await um('SELECT COUNT(*) AS n FROM nota_entrada WHERE estabelecimento_id = ? AND doacao = TRUE', [
          m.estA,
        ])
      )?.['n'],
    );
  const base = (x: Partial<EntradaDoacao> = {}): EntradaDoacao => ({
    doador: { tipo: 'empresa', id: m.fornecedor },
    termo: TERMO,
    recebidaEm: '2026-01-10',
    local: m.localA,
    observacao: null,
    itens: [
      {
        item: m.insumo,
        quantidade: 10,
        criterio: 'valor_justo',
        valorJusto: 2.5,
        lotes: [{ lote: `${TERMO}L`, validade: '2030-12-31', quantidade: 10 }],
      },
    ],
    ...x,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaEntradaDoacaoPropria(nucleo);
    c = contexto(m, m.estA, 't-c1126') as ContextoPortaM18;
    pessoa = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1126-pessoa' }, (e) =>
      inserirMinimo(e, 'pessoa_fisica', { nome: `Doador Sintetico ${TERMO}` }, 'c1126'),
    );
    naoDoador = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1126-pessoa' }, (e) =>
      inserirMinimo(e, 'pessoa_fisica', { nome: `Doador Sintetico ${TERMO} Novo` }, 'c1126'),
    );
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1126-limpa' }, async (e) => {
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    if (pessoa)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1126-limpa' }, (e) =>
        e.executar('DELETE FROM pessoa_fisica WHERE id IN (?, ?)', [pessoa, naoDoador]),
      );
    await nucleo.encerrar?.();
  }, 120_000);

  it('a doação de empresa pelo valor justo grava o recebimento, o item, o lote, o movimento e a parte doada', async () => {
    const antes = await saldo();
    const chave = k();
    const r = await porta.registrar(c, base(), chave);
    expect(r.valorTotal).toBe(25);
    expect(r.itens).toBe(1);
    const nota = await um(
      `SELECT doacao, pedido_compra_id, empresa_fornecedora_id, doador_pessoa_fisica_id, modelo_documento,
              numero_documento, data_emissao, valor_produtos, valor_total, situacao, tipo_entrada_estoque_id
         FROM nota_entrada WHERE id = ?`,
      [r.id],
    );
    expect(Number(nota?.['doacao'])).toBe(1);
    expect(nota?.['pedido_compra_id']).toBeNull();
    expect(Number(nota?.['empresa_fornecedora_id'])).toBe(m.fornecedor);
    expect(nota?.['doador_pessoa_fisica_id']).toBeNull();
    expect(nota?.['modelo_documento']).toBe('recibo');
    expect(nota?.['numero_documento']).toBe(TERMO);
    expect(Number(nota?.['valor_total'])).toBe(25);
    expect(nota?.['situacao']).toBe('confirmada');
    const tipo = await um('SELECT codigo, natureza FROM tipo_entrada_estoque WHERE id = ?', [
      nota?.['tipo_entrada_estoque_id'],
    ]);
    expect(tipo).toMatchObject({ codigo: 'doacao', natureza: 'doacao' });
    const item = await um(
      `SELECT id, quantidade, custo_unitario, valor_total, criterio_custo_doacao, lote_insumo_id
         FROM nota_entrada_item WHERE nota_entrada_id = ?`,
      [r.id],
    );
    expect(item?.['criterio_custo_doacao']).toBe('valor_justo');
    expect(Number(item?.['custo_unitario'])).toBe(2.5);
    expect(Number(item?.['valor_total'])).toBe(25);
    expect(item?.['lote_insumo_id']).not.toBeNull();
    const mov = await um(
      `SELECT me.propriedade, me.natureza, me.quantidade, me.valor_total, t.codigo
         FROM movimento_estoque me JOIN tipo_movimento_estoque t ON t.id = me.tipo_movimento_estoque_id
        WHERE me.nota_entrada_item_id = ?`,
      [item?.['id']],
    );
    expect(mov).toMatchObject({ propriedade: 'doacao', natureza: 'entrada', codigo: 'entrada_doacao' });
    expect(Number(mov?.['valor_total'])).toBe(25);
    const lote = await um(
      'SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?',
      [m.localA, item?.['lote_insumo_id']],
    );
    expect(Number(lote?.['quantidade'])).toBe(10);
    const depois = await saldo();
    expect(depois.q).toBe(antes.q + 10);
    expect(depois.doada).toBe(antes.doada + 10);
    const trilha = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'nota_entrada' AND entidade_id = ?",
      [r.id],
    );
    expect(Number(trilha?.['n'])).toBeGreaterThan(0);
    // A mesma chave devolve o resultado da primeira e não grava de novo.
    const n0 = await notasDoacao();
    expect((await porta.registrar(c, base(), chave)).id).toBe(r.id);
    expect(await notasDoacao()).toBe(n0);
    expect((await saldo()).q).toBe(depois.q);
    // A lista do estabelecimento mostra a doação; o outro estabelecimento não.
    expect((await porta.recebidas(c)).find((d) => d.id === r.id)).toMatchObject({
      termo: TERMO,
      tipoDoador: 'empresa',
      itens: 1,
      valorTotal: 25,
    });
    const cB = contexto(m, m.estB, 't-c1126-b') as ContextoPortaM18;
    expect((await porta.recebidas(cB)).some((d) => d.id === r.id)).toBe(false);
  });

  it('recusa o termo repetido do doador e o item nunca comprado sem valor justo, sem gravar nada', async () => {
    const n0 = await notasDoacao();
    const s0 = await saldo();
    expect(await codigoDe(porta.registrar(c, base(), k()))).toBe('termo-repetido');
    expect(
      await codigoDe(
        porta.registrar(
          c,
          base({
            termo: `${TERMO}B`,
            itens: [{ item: m.insumo, quantidade: 1, criterio: 'ultimo_preco', valorJusto: null, lotes: [] }],
          }),
          k(),
        ),
      ),
    ).toBe('sem-ultimo-preco');
    expect(
      await codigoDe(porta.registrar(c, base({ termo: `${TERMO}C`, recebidaEm: '2099-01-01' }), k())),
    ).toBe('data-futura');
    expect(
      await codigoDe(
        porta.registrar(c, base({ termo: `${TERMO}D`, doador: { tipo: 'pessoa', id: 999_999_999 } }), k()),
      ),
    ).toBe('doador-inexistente');
    expect(await notasDoacao()).toBe(n0);
    expect(await saldo()).toEqual(s0);
  });

  it('a doação de pessoa pelo último preço usa o custo da última compra e deixa o emitente vazio', async () => {
    notaCompra = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1126-compra' }, async (e) => {
      const tipo = await e.uma<L>("SELECT id FROM tipo_entrada_estoque WHERE codigo = 'compra'");
      const nf = await inserirMinimo(
        e,
        'nota_entrada',
        {
          estabelecimento_id: m.estA,
          numero: 980_000 + Math.floor(Math.random() * 9_999),
          empresa_fornecedora_id: m.fornecedor,
          local_estoque_id: m.localA,
          tipo_entrada_estoque_id: tipo?.['id'],
          numero_documento: `${TERMO}NF`.slice(0, 20),
          data_emissao: '2026-01-05',
          data_entrada: '2026-01-05',
          situacao: 'confirmada',
        },
        'c1126',
      );
      const u = await e.uma<L>('SELECT estoque_unidade_medida_id AS u FROM insumo WHERE id = ?', [m.insumo]);
      await inserirMinimo(
        e,
        'nota_entrada_item',
        {
          nota_entrada_id: nf,
          sequencia: 1,
          insumo_id: m.insumo,
          unidade_medida_id: u?.['u'],
          quantidade: 1,
          quantidade_estoque: 1,
          valor_unitario: 4,
          valor_total: 4,
          custo_unitario: 4,
        },
        'c1126',
      );
      return nf;
    });
    expect((await porta.referencia(c, m.insumo)).ultimoPreco).toBe(4);
    const s0 = await saldo();
    const r = await porta.registrar(
      c,
      base({
        doador: { tipo: 'pessoa', id: pessoa },
        termo: `${TERMO}P`,
        itens: [
          {
            item: m.insumo,
            quantidade: 3,
            criterio: 'ultimo_preco',
            valorJusto: null,
            lotes: [{ lote: `${TERMO}L`, validade: '2030-12-31', quantidade: 3 }],
          },
        ],
      }),
      k(),
    );
    expect(r.valorTotal).toBe(12);
    const nota = await um(
      'SELECT empresa_fornecedora_id, doador_pessoa_fisica_id FROM nota_entrada WHERE id = ?',
      [r.id],
    );
    expect(nota?.['empresa_fornecedora_id']).toBeNull();
    expect(Number(nota?.['doador_pessoa_fisica_id'])).toBe(pessoa);
    const item = await um(
      'SELECT custo_unitario, criterio_custo_doacao FROM nota_entrada_item WHERE nota_entrada_id = ?',
      [r.id],
    );
    expect(item).toMatchObject({ criterio_custo_doacao: 'ultimo_preco' });
    expect(Number(item?.['custo_unitario'])).toBe(4);
    const s1 = await saldo();
    expect(s1.q).toBe(s0.q + 3);
    expect(s1.doada).toBe(s0.doada + 3);
    // O último preço de compra não muda com a doação (a referência continua a da nota de compra).
    expect((await porta.referencia(c, m.insumo)).ultimoPreco).toBe(4);
    expect(notaCompra).toBeGreaterThan(0);
  });

  it('a saída consome primeiro o que não é doado e a parte doada nunca passa do saldo', async () => {
    const s0 = await saldo();
    expect(s0.doada).toBeGreaterThan(0);
    const lote = await um(
      `SELECT sl.lote_insumo_id AS id, sl.quantidade FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id
        WHERE sl.local_estoque_id = ? AND li.numero_lote = ?`,
      [m.localA, `${TERMO}L`],
    );
    const sair = (q: number) =>
      nucleo.criarExecutor().executar(
        definirOperacao({
          nome: 'teste.c1126.saida',
          // C2-093: a saída publica o fato contábil do movimento.
          tabelas: [
            'saldo_estoque',
            'saldo_lote',
            'movimento_estoque',
            'movimento_lote',
            ...TABELAS_PUBLICACAO_FATO,
          ],
          entrada: z.unknown(),
          gravar: async (tx) => {
            const r = await movimentar(tx, m.estA, {
              local: m.localA,
              insumo: m.insumo,
              quantidade: q,
              natureza: 'saida',
              tipoMovimento: await tipoMovimentoId(tx, 'saida_setor'),
              lotes: [{ id: Number(lote?.['id']), quantidade: q }],
              hoje: '2026-01-10',
              centroCusto: m.centroCusto,
            });
            return { id: r.id };
          },
          alvo: () => ({ tabela: 'saldo_estoque', id: m.localA }),
        }),
        CLIENTE,
        { q },
        {
          cliente: CLIENTE,
          estabelecimento: m.estA,
          usuario: m.usuario,
          correlacao: 't-c1126-saida',
          chaveIdempotencia: k(),
        },
      );
    // Sai tudo o que não é doado: a parte doada fica inteira.
    const livre = s0.q - s0.doada;
    const parcial = Math.min(Number(lote?.['quantidade']) - 1, Math.max(1, livre));
    await sair(parcial);
    const s1 = await saldo();
    expect(s1.q).toBe(s0.q - parcial);
    expect(s1.doada).toBe(Math.min(s0.doada, s1.q));
    // A saída que entra na parte doada a baixa até o saldo que fica (o CHECK do saldo nunca é violado).
    await sair(1);
    const s2 = await saldo();
    expect(s2.doada).toBe(Math.min(s1.doada, s2.q));
    expect(s2.doada).toBeLessThanOrEqual(s2.q);
  });

  it('pelo nome, a pessoa só aparece se já doou; a pessoa nova pede o CPF completo', async () => {
    const achados = await porta.doadores(c, `Doador Sintetico ${TERMO}`);
    const pessoas = achados.filter((d) => d.tipo === 'pessoa').map((d) => d.id);
    expect(pessoas).toContain(pessoa);
    expect(pessoas).not.toContain(naoDoador);
    // Parte do CPF não lista ninguém (sem listagem por documento parcial).
    expect((await porta.doadores(c, '123456')).filter((d) => d.tipo === 'pessoa')).toEqual([]);
  });

  it('a doação desfeita tira a parte doada do saldo e não entra no histórico de compras', async () => {
    const cs = contexto(m, m.estA, 't-c1126-desfaz') as ContextoSuprimentos;
    const sup = new PortaSuprimentosPropria(nucleo);
    const compras0 = (await sup.historicoCompras(cs, m.insumo)).compras.length;
    const s0 = await saldo();
    const r = await porta.registrar(
      c,
      base({
        termo: `${TERMO}X`,
        itens: [
          {
            item: m.insumo,
            quantidade: 5,
            criterio: 'valor_justo',
            valorJusto: 7,
            lotes: [{ lote: `${TERMO}D`, validade: '2030-12-31', quantidade: 5 }],
          },
        ],
      }),
      k(),
    );
    const s1 = await saldo();
    expect(s1.q).toBe(s0.q + 5);
    expect(s1.doada).toBe(s0.doada + 5);
    // A doação de empresa não é compra: o último custo e o menor unitário do comprador não mudam.
    expect((await sup.historicoCompras(cs, m.insumo)).compras.length).toBe(compras0);
    await sup.executar(
      cs,
      'suprimentos.desconsolidarDocumento',
      { tipo: 'nota', documento: r.id, motivo: 'Doação lançada no local errado' },
      { ...cs, chaveIdempotencia: k() },
    );
    const s2 = await saldo();
    expect(s2.q).toBe(s0.q);
    expect(s2.doada).toBe(s0.doada);
    const estorno = await um(
      `SELECT m.natureza, m.propriedade, m.quantidade FROM movimento_estoque m
         JOIN movimento_estoque o ON o.id = m.estorno_movimento_estoque_id
         JOIN nota_entrada_item ni ON ni.id = o.nota_entrada_item_id
        WHERE ni.nota_entrada_id = ?`,
      [r.id],
    );
    expect(estorno).toMatchObject({ natureza: 'saida', propriedade: 'doacao' });
    expect(Number(estorno?.['quantidade'])).toBe(5);
    expect((await um('SELECT situacao FROM nota_entrada WHERE id = ?', [r.id]))?.['situacao']).toBe(
      'conferencia',
    );
  });
});
