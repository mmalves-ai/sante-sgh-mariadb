// Lote migrado sem validade nos movimentos que não levam o insumo ao uso (recusas da carga, fase 2, D1) contra o
// MariaDB real (cliente de teste do lote, SGH_CLIENTE_TESTE; massa SINTÉTICA, nenhuma pessoa real). Contrato de efeito:
//   - a devolução ao fornecedor leva os lotes que entraram pela nota, o datado primeiro e o migrado sem validade por
//     último (FEFO), e o lote sem validade sai do saldo pelo id, com a validade que continua nula (nunca inventada);
//   - o balanço do inventário (ajuste do saldo físico) baixa a falta pelo lote datado e completa com o lote sem
//     validade, que continua nulo.
// O envio entre unidades do romaneio fica em romaneio-entrega.int.spec.ts. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { definirOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaDevolucaoFornecedorPropria } from './devolucao-fornecedor.js';
import {
  CLIENTE,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import type { ContextoSuprimentos } from './porta.js';
import { movimentar, PortaSuprimentosPropria, tipoMovimentoId } from './porta-propria.js';

const RODADA = Date.now().toString(36);
let k = 0;
type L = Record<string, unknown>;

describe.skipIf(SEM_BANCO)('lote migrado sem validade na devolução e no balanço (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSuprimentosPropria;
  let devolucao: PortaDevolucaoFornecedorPropria;
  let m: MassaSuprimentos;
  let c: ContextoSuprimentos;
  let nota = 0;
  let notaItem = 0;
  let motivo = 0;
  // Lotes da nota (local A) e do inventário (local A2): o datado e o migrado sem validade de cada um.
  let notaCom = 0;
  let notaSem = 0;
  let invCom = 0;
  let invSem = 0;
  const ctxE = { cliente: CLIENTE, correlacao: 't-recusas-lote-mov' };
  const ler = <T extends L>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-recusas-lote-mov' }, (l) => l.consultar<T>(sql, p));
  const op = (nome: string, entrada: unknown, ctx: ContextoSuprimentos = c) =>
    porta.executar(ctx, `suprimentos.${nome}`, entrada, {
      ...ctx,
      chaveIdempotencia: `rlsm-${RODADA}-${++k}`,
    });
  const trilha = (evento: string, entidade: string) =>
    ({
      estabelecimento: m.estA,
      usuario: m.usuario,
      acao: 'operacao',
      entidade,
      entidadeId: null,
      dadosDepois: { evento },
      correlacao: null,
    }) as TrilhaDaGravacao;
  const saldoDoLote = async (lote: number, local: number): Promise<number> => {
    const [s] = await ler<{ q: unknown }>(
      'SELECT quantidade AS q FROM saldo_lote WHERE lote_insumo_id = ? AND local_estoque_id = ? AND excluido_em IS NULL',
      [lote, local],
    );
    return Number(s?.q ?? 0);
  };
  const validadeDe = async (lote: number): Promise<unknown> =>
    (await ler<{ v: unknown }>('SELECT validade AS v FROM lote_insumo WHERE id = ?', [lote]))[0]?.v;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaSuprimentosPropria(nucleo);
    devolucao = new PortaDevolucaoFornecedorPropria(nucleo);
    c = { ...contexto(m, m.estA, 'recusas-lote-mov') } as ContextoSuprimentos;
    await nucleo.escrever(ctxE, async (e) => {
      const lote = (numero: string, validade: string | null, origem: string) =>
        inserirMinimo(
          e,
          'lote_insumo',
          {
            estabelecimento_id: m.estA,
            insumo_id: m.insumo,
            numero_lote: numero,
            validade,
            situacao: 'liberado',
            origem,
          },
          m.marca,
        );
      notaCom = await lote(`${m.marca}NC`, '2027-08-31', 'sistema');
      notaSem = await lote(`${m.marca}NS`, null, 'migracao');
      invCom = await lote(`${m.marca}IC`, '2027-06-30', 'sistema');
      invSem = await lote(`${m.marca}IS`, null, 'migracao');
      // O local A2 da massa tem 4 no saldo do item, sem lote: 1 no lote datado e 3 no migrado sem validade.
      for (const [id, q] of [
        [invCom, 1],
        [invSem, 3],
      ] as const)
        await inserirMinimo(
          e,
          'saldo_lote',
          {
            estabelecimento_id: m.estA,
            local_estoque_id: m.localA2,
            lote_insumo_id: id,
            quantidade: q,
            competencia: '2026-11-01',
          },
          m.marca,
        );
      const tipo = await e.uma<L>("SELECT id FROM tipo_entrada_estoque WHERE codigo = 'compra'");
      nota = await inserirMinimo(
        e,
        'nota_entrada',
        {
          estabelecimento_id: m.estA,
          numero: 960_000 + Math.floor(Math.random() * 9_999),
          empresa_fornecedora_id: m.fornecedor,
          local_estoque_id: m.localA,
          tipo_entrada_estoque_id: tipo?.['id'],
          numero_documento: `${m.marca}NF`,
          data_emissao: '2026-01-05',
          data_entrada: '2026-01-05',
          situacao: 'confirmada',
        },
        m.marca,
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
          quantidade: 5,
          quantidade_estoque: 5,
          valor_unitario: 5,
          valor_total: 25,
          custo_unitario: 5,
        },
        m.marca,
      );
      motivo = Number(
        (await e.uma<L>("SELECT id FROM motivo_devolucao_fornecedor WHERE codigo = 'avaria'"))?.['id'],
      );
    });
    // A entrada da compra pelo motor: 2 no lote datado e 3 no lote migrado sem validade, ligadas ao item da nota.
    const entrada = definirOperacao({
      nome: 'teste.recusas.entrada_lote_sem_validade',
      tabelas: ['saldo_estoque', 'saldo_lote', 'movimento_estoque', 'movimento_lote'],
      entrada: z.object({}),
      gravar: async (tx) => {
        await movimentar(tx, m.estA, {
          local: m.localA,
          insumo: m.insumo,
          quantidade: 5,
          natureza: 'entrada',
          tipoMovimento: await tipoMovimentoId(tx, 'entrada_nota'),
          valorEntrada: 25,
          lotes: [
            { id: notaCom, quantidade: 2 },
            { id: notaSem, quantidade: 3 },
          ],
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
      .executar(
        entrada,
        CLIENTE,
        {},
        { ...contexto(m, m.estA, 't-rlsm-e'), chaveIdempotencia: randomUUID() },
      );
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-rlsm-limpa' }, async (e) => {
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
          "DELETE FROM sequencia_negocio WHERE tipo = 'devolucao_fornecedor' AND estabelecimento_id IN (?, ?)",
          [m.estA, m.estB],
        );
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  }, 120_000);

  it('devolução ao fornecedor: sai o lote datado da nota e completa com o migrado sem validade, que segue sem validade', async () => {
    expect(await saldoDoLote(notaCom, m.localA)).toBe(2);
    expect(await saldoDoLote(notaSem, m.localA)).toBe(3);
    const r = await devolucao.registrar(
      c as ContextoPortaM18,
      {
        nota,
        motivo,
        local: null,
        abaterContasPagar: false,
        numeroNotaFiscal: null,
        serieNotaFiscal: null,
        chaveAcesso: null,
        dataEmissao: null,
        observacao: null,
        itens: [{ notaItem, quantidade: 4 }],
      },
      `rlsm-dev-${RODADA}`,
    );
    expect(await saldoDoLote(notaCom, m.localA)).toBe(0);
    expect(await saldoDoLote(notaSem, m.localA)).toBe(1);
    const lotes = await ler<{ lote: unknown; q: unknown }>(
      `SELECT ml.lote_insumo_id AS lote, ml.quantidade AS q
         FROM devolucao_fornecedor_item dfi
         JOIN movimento_estoque me ON me.devolucao_fornecedor_item_id = dfi.id AND me.natureza = 'saida'
         JOIN movimento_lote ml ON ml.movimento_estoque_id = me.id
        WHERE dfi.devolucao_fornecedor_id = ? ORDER BY ml.id`,
      [r.id],
    );
    expect(lotes.map((x) => [Number(x.lote), Number(x.q)])).toEqual([
      [notaCom, 2],
      [notaSem, 2],
    ]);
    expect(await validadeDe(notaSem)).toBeNull();
  });

  it('balanço do inventário (ajuste do saldo físico): baixa o lote datado e completa com o sem validade', async () => {
    const como = (u: number) => ({ ...c, usuario: u }) as ContextoSuprimentos;
    const [s] = await ler<{ q: unknown }>(
      'SELECT quantidade AS q FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
      [m.localA2, m.insumo],
    );
    const base = Number(s?.q ?? 0);
    expect(base).toBe(4);
    const inv = await porta.gravarSgh(c, trilha('suprimentos.inventario.aberto', 'inventario_estoque'), (g) =>
      g.abrirInventario({
        local: m.localA2,
        tipo: 'ciclico',
        limitePct: 100,
        itens: [{ item: m.insumo, saldo: 0 }],
        usuario: 'x',
      }),
    );
    await porta.gravarSgh(
      como(m.usuario2),
      trilha('suprimentos.inventario.contado', 'inventario_estoque_item'),
      (g) => g.registrarContagem({ inventario: inv, item: m.insumo, quantidade: base - 2, usuario: 'x' }),
    );
    await porta.gravarSgh(c, trilha('suprimentos.inventario.decidido', 'inventario_estoque'), (g) =>
      g.decidirInventario({
        inventario: inv,
        decisao: 'aprovado',
        justificativa: '',
        usuario: 'x',
        podeAprovar: true,
      }),
    );
    await op('registrarBalanco', { inventario: inv });
    expect(await saldoDoLote(invCom, m.localA2)).toBe(0);
    expect(await saldoDoLote(invSem, m.localA2)).toBe(2);
    const lotes = await ler<{ lote: unknown; q: unknown }>(
      `SELECT ml.lote_insumo_id AS lote, ml.quantidade AS q
         FROM inventario_estoque ie
         JOIN movimento_estoque me ON me.documento_estoque_id = ie.documento_estoque_id
         JOIN movimento_lote ml ON ml.movimento_estoque_id = me.id
        WHERE ie.id = ? ORDER BY ml.id`,
      [inv],
    );
    expect(lotes.map((x) => [Number(x.lote), Number(x.q)])).toEqual([
      [invCom, 1],
      [invSem, 1],
    ]);
    expect(await validadeDe(invSem)).toBeNull();
  });
});
