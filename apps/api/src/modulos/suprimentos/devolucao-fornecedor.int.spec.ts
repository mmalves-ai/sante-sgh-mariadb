// Contrato de efeito da devolução de compra ao fornecedor (C2-015, 05-SUP linha 22) contra o MariaDB real (cliente de
// teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: a devolução parcial de uma nota de compra grava
// a devolução (número, tipo parcial, motivo, NF-e de devolução, valor pelo custo da compra) e o item ligado ao item da
// nota; tira o produto do estoque pelo motor (movimento "devolucao_fornecedor" de saída, ligado ao item da devolução,
// saldo menor); emite e aplica a nota de crédito recebida do fornecedor (motivo devolução, ligada à devolução e à nota
// de entrada), que abate a parcela a pagar de vencimento mais próximo (desconto, saldo) e o título (desconto, líquido
// menor). A repetição pela mesma chave não grava de novo. A quantidade acima do disponível e a chave de acesso inválida
// são recusadas sem gravar nada. A segunda devolução (o resto, total) abate o que cabe nas parcelas e deixa a sobra como
// crédito pendente. Sem abater, nada muda no contas a pagar. Outro estabelecimento não vê a devolução.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { definirOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { type DevolucaoFornecedorEntrada, PortaDevolucaoFornecedorPropria } from './devolucao-fornecedor.js';
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
import { insumoAtivo, lotesDaEntrada, movimentar, tipoMovimentoId } from './porta-propria.js';

const k = () => `t-devf-${randomUUID()}`;
const MARCA = `DF${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
type L = Record<string, unknown>;

/** Chave de acesso sintética com o dígito em módulo 11 (modelo 55). */
function chaveSintetica(numero: string): string {
  const b = `352611${'0'.repeat(13)}1` + `55001${numero.padStart(9, '0')}1${'1'.repeat(8)}`;
  let peso = 2;
  let soma = 0;
  for (let i = b.length - 1; i >= 0; i--) {
    soma += Number(b[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return `${b}${r < 2 ? 0 : 11 - r}`;
}

describe.skipIf(SEM_BANCO)('devolução de compra ao fornecedor (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaDevolucaoFornecedorPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  let nota = 0;
  let notaItem = 0;
  let titulo = 0;
  let parcela1 = 0;
  let parcela2 = 0;
  let motivo = 0;
  let natureza = 0;
  let subgrupoNat = 0;
  let grupoNat = 0;
  let credor = 0;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2015' }, (l) => l.uma<L>(sql, p));
  const saldo = async () =>
    Number(
      (
        await um('SELECT quantidade FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?', [
          m.localA,
          m.insumo,
        ])
      )?.['quantidade'] ?? 0,
    );
  const contagem = async () =>
    Number(
      (await um('SELECT COUNT(*) AS n FROM devolucao_fornecedor WHERE nota_entrada_id = ?', [nota]))?.['n'],
    );
  const base = (x: Partial<DevolucaoFornecedorEntrada> = {}): DevolucaoFornecedorEntrada => ({
    nota,
    motivo,
    local: null,
    abaterContasPagar: true,
    numeroNotaFiscal: '4321',
    serieNotaFiscal: '1',
    chaveAcesso: chaveSintetica('4321'),
    dataEmissao: null,
    observacao: null,
    itens: [{ notaItem, quantidade: 4 }],
    ...x,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaDevolucaoFornecedorPropria(nucleo);
    c = contexto(m, m.estA, 't-c2015') as ContextoPortaM18;
    // A compra: nota confirmada de 10 unidades a 5,00 (50,00), com o título a pagar em duas parcelas de 25,00.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2015-compra' }, async (e) => {
      const tipo = await e.uma<L>("SELECT id FROM tipo_entrada_estoque WHERE codigo = 'compra'");
      nota = await inserirMinimo(
        e,
        'nota_entrada',
        {
          estabelecimento_id: m.estA,
          numero: 970_000 + Math.floor(Math.random() * 9_999),
          empresa_fornecedora_id: m.fornecedor,
          local_estoque_id: m.localA,
          tipo_entrada_estoque_id: tipo?.['id'],
          numero_documento: `${MARCA}NF`,
          data_emissao: '2026-01-05',
          data_entrada: '2026-01-05',
          situacao: 'confirmada',
        },
        'c2015',
      );
      const u = await e.uma<L>('SELECT estoque_unidade_medida_id AS u FROM insumo WHERE id = ?', [m.insumo]);
      notaItem = await inserirMinimo(
        e,
        'nota_entrada_item',
        {
          nota_entrada_id: nota,
          sequencia: 1,
          insumo_id: m.insumo,
          unidade_medida_id: u?.['u'],
          quantidade: 10,
          quantidade_estoque: 10,
          valor_unitario: 5,
          valor_total: 50,
          custo_unitario: 5,
        },
        'c2015',
      );
      motivo = Number(
        (await e.uma<L>("SELECT id FROM motivo_devolucao_fornecedor WHERE codigo = 'avaria'"))?.['id'],
      );
      grupoNat = await inserirMinimo(
        e,
        'grupo_natureza_financeira',
        {
          codigo: `${MARCA}G`,
          nome: `Grupo sintético ${MARCA}`,
          tipo: 'despesa',
          classificacao: 'operacional',
        },
        'c2015',
      );
      subgrupoNat = await inserirMinimo(
        e,
        'subgrupo_natureza_financeira',
        {
          grupo_natureza_financeira_id: grupoNat,
          codigo: `${MARCA}S`,
          descricao: `Subgrupo sintético ${MARCA}`,
          classificacao: 'despesa',
        },
        'c2015',
      );
      natureza = await inserirMinimo(
        e,
        'natureza_financeira',
        {
          codigo: `${MARCA}N`,
          descricao: `Natureza sintética ${MARCA}`,
          subgrupo_natureza_financeira_id: subgrupoNat,
          tipo: 'despesa',
        },
        'c2015',
      );
      credor = await inserirMinimo(
        e,
        'tipo_credor',
        {
          codigo: `${MARCA}C`,
          descricao: `Credor sintético ${MARCA}`,
          natureza: 'fornecedor',
          sentido: 'pagar',
        },
        'c2015',
      );
      const tipoDoc = await e.uma<L>("SELECT id FROM tipo_documento_financeiro WHERE codigo = 'nota_fiscal'");
      titulo = await inserirMinimo(
        e,
        'titulo_pagar',
        {
          estabelecimento_id: m.estA,
          numero: `${MARCA}T`,
          tipo_credor_id: credor,
          empresa_fornecedora_id: m.fornecedor,
          tipo_documento_financeiro_id: tipoDoc?.['id'],
          numero_documento: `${MARCA}NF`,
          data_emissao: '2026-01-05',
          data_lancamento: '2026-01-05',
          valor_bruto: 50,
          valor_liquido: 50,
          quantidade_parcelas: 2,
          natureza_financeira_id: natureza,
          nota_entrada_id: nota,
          situacao: 'aberto',
        },
        'c2015',
      );
      const parcela = (seq: number, venc: string) =>
        inserirMinimo(
          e,
          'parcela_pagar',
          {
            titulo_pagar_id: titulo,
            sequencia: seq,
            vencimento: venc,
            vencimento_original: venc,
            valor: 25,
            saldo: 25,
            situacao: 'aberta',
          },
          'c2015',
        );
      parcela2 = await parcela(2, '2027-02-10');
      parcela1 = await parcela(1, '2027-01-10');
    });
    // A entrada da compra no estoque, pelo motor (o movimento ligado ao item da nota).
    const entrada = definirOperacao({
      nome: 'teste.c2015.entrada_compra',
      tabelas: ['saldo_estoque', 'saldo_lote', 'movimento_estoque', 'movimento_lote'],
      entrada: z.object({}),
      gravar: async (tx) => {
        await movimentar(tx, m.estA, {
          local: m.localA,
          insumo: m.insumo,
          quantidade: 10,
          natureza: 'entrada',
          tipoMovimento: await tipoMovimentoId(tx, 'entrada_nota'),
          valorEntrada: 50,
          lotes: [],
          hoje: '2026-01-05',
          notaItem,
          fornecedor: m.fornecedor,
        });
        return { ok: 1 };
      },
      alvo: () => ({ tabela: 'nota_entrada', id: nota }),
    });
    await nucleo
      .criarExecutor()
      .executar(entrada, CLIENTE, {}, { ...contexto(m, m.estA, 't-c2015-e'), chaveIdempotencia: k() });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2015-limpa' }, async (e) => {
        await e.executar('DELETE FROM nota_credito_debito WHERE nota_entrada_id = ?', [nota]);
        await e.executar(
          'UPDATE movimento_estoque SET devolucao_fornecedor_item_id = NULL WHERE estabelecimento_id IN (?, ?)',
          [m.estA, m.estB],
        );
        await e.executar(
          'DELETE i FROM devolucao_fornecedor_item i JOIN devolucao_fornecedor d ON d.id = i.devolucao_fornecedor_id WHERE d.estabelecimento_id IN (?, ?)',
          [m.estA, m.estB],
        );
        await e.executar('DELETE FROM devolucao_fornecedor WHERE estabelecimento_id IN (?, ?)', [
          m.estA,
          m.estB,
        ]);
        await e.executar(
          "DELETE FROM sequencia_negocio WHERE tipo IN ('devolucao_fornecedor','nota_credito_debito') AND estabelecimento_id IN (?, ?)",
          [m.estA, m.estB],
        );
        await e.executar('DELETE FROM parcela_pagar WHERE titulo_pagar_id = ?', [titulo]);
        await e.executar('DELETE FROM titulo_pagar WHERE id = ?', [titulo]);
        await e.executar('DELETE FROM natureza_financeira WHERE id = ?', [natureza]);
        await e.executar('DELETE FROM subgrupo_natureza_financeira WHERE id = ?', [subgrupoNat]);
        await e.executar('DELETE FROM grupo_natureza_financeira WHERE id = ?', [grupoNat]);
        await e.executar('DELETE FROM tipo_credor WHERE id = ?', [credor]);
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  it('a devolução parcial sai do estoque pelo custo da compra e abate a parcela mais próxima pela nota de crédito', async () => {
    expect(await saldo()).toBeGreaterThanOrEqual(10);
    const s0 = await saldo();
    const disponivel = await porta.nota(c, nota);
    expect(disponivel.saldoAPagar).toBe(50);
    expect(disponivel.itens[0]).toMatchObject({ notaItem, recebida: 10, jaDevolvida: 0, disponivel: 10 });
    expect((await porta.notas(c, MARCA)).some((x) => x.id === nota)).toBe(true);
    const chave = k();
    const r = await porta.registrar(c, base(), chave);
    expect(r).toMatchObject({ tipo: 'parcial', valorTotal: 20, valorAbatido: 20, creditoPendente: 0 });
    const d = await um(
      `SELECT tipo, situacao, empresa_fornecedora_id, nota_entrada_id, motivo_devolucao_fornecedor_id, local_estoque_id,
              numero_nota_fiscal, chave_acesso, valor_total, abate_contas_pagar, titulo_pagar_id, valor_abatido,
              valor_credito_pendente FROM devolucao_fornecedor WHERE id = ?`,
      [r.id],
    );
    expect(d).toMatchObject({ tipo: 'parcial', situacao: 'concluida', numero_nota_fiscal: '4321' });
    expect(Number(d?.['empresa_fornecedora_id'])).toBe(m.fornecedor);
    expect(Number(d?.['nota_entrada_id'])).toBe(nota);
    expect(Number(d?.['local_estoque_id'])).toBe(m.localA);
    expect(Number(d?.['valor_total'])).toBe(20);
    expect(Number(d?.['titulo_pagar_id'])).toBe(titulo);
    expect(Number(d?.['valor_abatido'])).toBe(20);
    const item = await um(
      'SELECT id, nota_entrada_item_id, quantidade, valor_unitario, valor_total FROM devolucao_fornecedor_item WHERE devolucao_fornecedor_id = ?',
      [r.id],
    );
    expect(Number(item?.['nota_entrada_item_id'])).toBe(notaItem);
    expect(Number(item?.['quantidade'])).toBe(4);
    expect(Number(item?.['valor_total'])).toBe(20);
    const mov = await um(
      `SELECT me.natureza, me.quantidade, me.valor_total, me.empresa_fornecedora_id, t.codigo
         FROM movimento_estoque me JOIN tipo_movimento_estoque t ON t.id = me.tipo_movimento_estoque_id
        WHERE me.devolucao_fornecedor_item_id = ?`,
      [item?.['id']],
    );
    expect(mov).toMatchObject({ natureza: 'saida', codigo: 'devolucao_fornecedor' });
    expect(Number(mov?.['quantidade'])).toBe(4);
    expect(Number(mov?.['valor_total'])).toBe(20);
    expect(await saldo()).toBe(s0 - 4);
    // A nota de crédito recebida (motivo devolução) aplicada na parcela de vencimento mais próximo.
    const nc = await um(
      `SELECT n.direcao, n.natureza, n.efeito, n.situacao, n.valor_ajuste, n.parcela_pagar_id, n.nota_entrada_id,
              n.tipo_conteudo, n.numero_documento, mo.codigo AS motivo
         FROM nota_credito_debito n JOIN motivo_nota_credito_debito mo ON mo.id = n.motivo_nota_credito_debito_id
        WHERE n.devolucao_fornecedor_id = ?`,
      [r.id],
    );
    expect(nc).toMatchObject({
      direcao: 'recebida',
      natureza: 'credito',
      efeito: 'abate',
      situacao: 'aplicada',
      tipo_conteudo: 'produto',
      numero_documento: '4321',
      motivo: 'devolucao',
    });
    expect(Number(nc?.['parcela_pagar_id'])).toBe(parcela1);
    expect(Number(nc?.['nota_entrada_id'])).toBe(nota);
    const p1 = await um('SELECT saldo, valor_desconto, situacao FROM parcela_pagar WHERE id = ?', [parcela1]);
    expect(Number(p1?.['saldo'])).toBe(5);
    expect(Number(p1?.['valor_desconto'])).toBe(20);
    const p2 = await um('SELECT saldo FROM parcela_pagar WHERE id = ?', [parcela2]);
    expect(Number(p2?.['saldo'])).toBe(25);
    const tt = await um('SELECT valor_desconto, valor_liquido FROM titulo_pagar WHERE id = ?', [titulo]);
    expect(Number(tt?.['valor_desconto'])).toBe(20);
    expect(Number(tt?.['valor_liquido'])).toBe(30);
    const trilha = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'devolucao_fornecedor' AND entidade_id = ?",
      [r.id],
    );
    expect(Number(trilha?.['n'])).toBeGreaterThan(0);
    // A mesma chave devolve o resultado da primeira e não grava de novo.
    const n0 = await contagem();
    expect((await porta.registrar(c, base(), chave)).id).toBe(r.id);
    expect(await contagem()).toBe(n0);
    expect(await saldo()).toBe(s0 - 4);
    // A lista do estabelecimento mostra a devolução; o outro estabelecimento não.
    expect((await porta.devolucoes(c)).find((x) => x.id === r.id)).toMatchObject({
      tipo: 'parcial',
      itens: 1,
      valorTotal: 20,
      valorAbatido: 20,
    });
    const cB = contexto(m, m.estB, 't-c2015-b') as ContextoPortaM18;
    expect((await porta.devolucoes(cB)).some((x) => x.id === r.id)).toBe(false);
  });

  it('recusa a quantidade acima do disponível e a chave de acesso inválida, sem gravar nada', async () => {
    const n0 = await contagem();
    const s0 = await saldo();
    expect(await codigoDe(porta.registrar(c, base({ itens: [{ notaItem, quantidade: 7 }] }), k()))).toBe(
      'quantidade-acima-do-recebido',
    );
    const ok = chaveSintetica('4321');
    expect(
      await codigoDe(
        porta.registrar(c, base({ chaveAcesso: `${ok.slice(0, 43)}${(Number(ok[43]) + 1) % 10}` }), k()),
      ),
    ).toBe('chave-acesso-invalida');
    expect(await contagem()).toBe(n0);
    expect(await saldo()).toBe(s0);
    const p1 = await um('SELECT saldo FROM parcela_pagar WHERE id = ?', [parcela1]);
    expect(Number(p1?.['saldo'])).toBe(5);
  });

  it('sem abater, o contas a pagar não muda; o resto devolvido (total) abate o que cabe e deixa a sobra pendente', async () => {
    const semAbater = await porta.registrar(
      c,
      base({
        abaterContasPagar: false,
        chaveAcesso: null,
        numeroNotaFiscal: null,
        itens: [{ notaItem, quantidade: 1 }],
      }),
      k(),
    );
    expect(semAbater).toMatchObject({ tipo: 'parcial', valorTotal: 5, valorAbatido: 0, creditoPendente: 0 });
    expect(Number((await um('SELECT saldo FROM parcela_pagar WHERE id = ?', [parcela1]))?.['saldo'])).toBe(5);
    expect(
      Number(
        (
          await um('SELECT COUNT(*) AS n FROM nota_credito_debito WHERE devolucao_fornecedor_id = ?', [
            semAbater.id,
          ])
        )?.['n'],
      ),
    ).toBe(0);
    // A segunda parcela foi paga em parte (saldo 10). O resto (5 unidades, 25,00) abate 5,00 da primeira e 10,00 da
    // segunda; sobram 10,00 de crédito pendente do fornecedor.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2015-paga' }, (e) =>
      e.executar(
        "UPDATE parcela_pagar SET saldo = 10, valor_pago = 15, situacao = 'parcial', versao = versao + 1 WHERE id = ?",
        [parcela2],
      ),
    );
    const resto = await porta.registrar(
      c,
      base({ chaveAcesso: null, numeroNotaFiscal: null, itens: [{ notaItem, quantidade: 5 }] }),
      k(),
    );
    expect(resto).toMatchObject({ tipo: 'total', valorTotal: 25, valorAbatido: 15, creditoPendente: 10 });
    expect(resto.notasCredito.split(',')).toHaveLength(2);
    const p1 = await um('SELECT saldo, situacao FROM parcela_pagar WHERE id = ?', [parcela1]);
    expect(Number(p1?.['saldo'])).toBe(0);
    expect(p1?.['situacao']).toBe('paga');
    const p2 = await um('SELECT saldo FROM parcela_pagar WHERE id = ?', [parcela2]);
    expect(Number(p2?.['saldo'])).toBe(0);
    expect((await porta.nota(c, nota)).itens[0]).toMatchObject({ jaDevolvida: 10, disponivel: 0 });
    expect((await porta.notas(c, MARCA)).some((x) => x.id === nota)).toBe(false);
  });

  it('item com lote: a segunda devolução parcial sai do lote seguinte da nota, nunca do lote já devolvido', async () => {
    // Outra compra do mesmo insumo rastreável: 10 unidades em dois lotes de 5 (L1 vence antes de L2).
    let nota2 = 0;
    let item2 = 0;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2015-lote' }, async (e) => {
      const tipo = await e.uma<L>("SELECT id FROM tipo_entrada_estoque WHERE codigo = 'compra'");
      nota2 = await inserirMinimo(
        e,
        'nota_entrada',
        {
          estabelecimento_id: m.estA,
          numero: 980_000 + Math.floor(Math.random() * 9_999),
          empresa_fornecedora_id: m.fornecedor,
          local_estoque_id: m.localA,
          tipo_entrada_estoque_id: tipo?.['id'],
          numero_documento: `${MARCA}NL`,
          data_emissao: '2026-01-06',
          data_entrada: '2026-01-06',
          situacao: 'confirmada',
        },
        'c2015',
      );
      const u = await e.uma<L>('SELECT estoque_unidade_medida_id AS u FROM insumo WHERE id = ?', [m.insumo]);
      item2 = await inserirMinimo(
        e,
        'nota_entrada_item',
        {
          nota_entrada_id: nota2,
          sequencia: 1,
          insumo_id: m.insumo,
          unidade_medida_id: u?.['u'],
          quantidade: 10,
          quantidade_estoque: 10,
          valor_unitario: 5,
          valor_total: 50,
          custo_unitario: 5,
        },
        'c2015',
      );
    });
    const sufixo = randomUUID().slice(0, 6).toUpperCase();
    const l1 = `C2015A${sufixo}`;
    const l2 = `C2015B${sufixo}`;
    const entrada = definirOperacao({
      nome: 'teste.c2015.entrada_lotes',
      tabelas: ['saldo_estoque', 'saldo_lote', 'lote_insumo', 'movimento_estoque', 'movimento_lote'],
      entrada: z.object({}),
      gravar: async (tx) => {
        const ins = await insumoAtivo(tx, m.insumo);
        const lotes = await lotesDaEntrada(
          tx,
          m.estA,
          ins,
          10,
          [
            { lote: l1, validade: '2027-03-31', quantidade: 5 },
            { lote: l2, validade: '2027-09-30', quantidade: 5 },
          ],
          '2026-01-06',
        );
        await movimentar(tx, m.estA, {
          local: m.localA,
          insumo: m.insumo,
          quantidade: 10,
          natureza: 'entrada',
          tipoMovimento: await tipoMovimentoId(tx, 'entrada_nota'),
          valorEntrada: 50,
          lotes,
          hoje: '2026-01-06',
          notaItem: item2,
          fornecedor: m.fornecedor,
        });
        return { ok: 1 };
      },
      alvo: () => ({ tabela: 'nota_entrada', id: nota2 }),
    });
    await nucleo
      .criarExecutor()
      .executar(entrada, CLIENTE, {}, { ...contexto(m, m.estA, 't-c2015-el'), chaveIdempotencia: k() });
    const lotesDa = async (devolucao: number) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2015-ll' }, (l) =>
        l.consultar<L>(
          `SELECT li.numero_lote, SUM(ml.quantidade) AS q
             FROM devolucao_fornecedor_item dfi
             JOIN movimento_estoque me ON me.devolucao_fornecedor_item_id = dfi.id
             JOIN movimento_lote ml ON ml.movimento_estoque_id = me.id
             JOIN lote_insumo li ON li.id = ml.lote_insumo_id
            WHERE dfi.devolucao_fornecedor_id = ? GROUP BY li.numero_lote ORDER BY li.numero_lote`,
          [devolucao],
        ),
      );
    const daNota = (quantidade: number, nf: string): DevolucaoFornecedorEntrada =>
      base({
        nota: nota2,
        abaterContasPagar: false,
        numeroNotaFiscal: nf,
        chaveAcesso: chaveSintetica(nf),
        itens: [{ notaItem: item2, quantidade }],
      });
    // 1ª devolução: 5, todo o L1 (vence antes).
    const d1 = await porta.registrar(c, daNota(5, '5501'), k());
    expect((await lotesDa(d1.id)).map((r) => [r['numero_lote'], Number(r['q'])])).toEqual([[l1, 5]]);
    // 2ª devolução: 3, do L2 (o L1 já voltou inteiro ao fornecedor).
    const d2 = await porta.registrar(c, daNota(3, '5502'), k());
    expect((await lotesDa(d2.id)).map((r) => [r['numero_lote'], Number(r['q'])])).toEqual([[l2, 3]]);
    const sl = await um(
      `SELECT SUM(CASE WHEN li.numero_lote = ? THEN sl.quantidade ELSE 0 END) AS a,
              SUM(CASE WHEN li.numero_lote = ? THEN sl.quantidade ELSE 0 END) AS b
         FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id WHERE sl.local_estoque_id = ?`,
      [l1, l2, m.localA],
    );
    expect([Number(sl?.['a']), Number(sl?.['b'])]).toEqual([0, 2]);
  });
});
