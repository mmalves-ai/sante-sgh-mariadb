// Contrato de efeito da produção interna (C1-124, 05-SUP linha 12) na porta própria contra o MariaDB real (cliente de
// teste do lote; massa SINTÉTICA, nenhuma pessoa real): o fechamento da ordem de manipulação baixada grava o lote
// produzido com o custo indireto, o lote do produto no estoque, a entrada no local (custo médio pelo custo do lote) e
// liga a ordem; o kit montado consome a composição pelos lotes que vencem primeiro e entra como lote próprio. Recusas
// (ordem não baixada, já fechada, custo sem valor, validade acima do componente, saldo) e isolamento por
// estabelecimento. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { PortaProducaoInternaPropria } from './producao-interna.js';

const RODADA = Date.now().toString(36);
let k = 0;
const chave = () => `c1124-${RODADA}-${++k}`;
const ESTS = "SELECT id FROM estabelecimento WHERE codigo LIKE 'F22L0314%'";
const CUSTO = 'C1124SINT';

async function limparProducao(e: Escritor): Promise<void> {
  for (const sql of [
    `UPDATE ordem_manipulacao SET lote_produzido_id = NULL WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM lote_produzido_custo WHERE lote_produzido_id IN (SELECT id FROM lote_produzido WHERE estabelecimento_id IN (${ESTS}))`,
    `DELETE FROM lote_produzido WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM ordem_manipulacao_insumo WHERE ordem_manipulacao_id IN (SELECT id FROM ordem_manipulacao WHERE estabelecimento_id IN (${ESTS}))`,
    `DELETE FROM ordem_manipulacao WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM kit_material_item WHERE kit_material_id IN (SELECT id FROM kit_material WHERE estabelecimento_id IN (${ESTS}))`,
    `DELETE FROM kit_material WHERE estabelecimento_id IN (${ESTS})`,
    `DELETE FROM custo_indireto_producao_valor WHERE custo_indireto_producao_id IN (SELECT id FROM custo_indireto_producao WHERE codigo LIKE '${CUSTO}%')`,
    `DELETE FROM custo_indireto_producao WHERE codigo LIKE '${CUSTO}%'`,
  ])
    await e.executar(sql, []);
}

describe.skipIf(SEM_BANCO)('produção interna na porta própria (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let m: MassaSuprimentos;
  let porta: PortaProducaoInternaPropria;
  const ids: Record<string, number> = {};
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c1124' }, (l) => l.consultar<T>(sql, p));
  const um = async (sql: string, p: unknown[]) => (await ler<Record<string, unknown>>(sql, p))[0]!;
  const fechamento = (extra: Record<string, unknown> = {}) => ({
    versaoVista: 1,
    quantidadeProduzida: 9,
    perda: 1,
    validadeEm: '2027-01-01T10:00',
    numeroLote: null,
    custos: [{ custo: ids.custo!, quantidade: 2 }],
    valorAdicional: 5,
    ...extra,
  });
  const montagem = (extra: Record<string, unknown> = {}) => ({
    kit: ids.kit!,
    produto: ids.produtoKit!,
    local: m.localA,
    quantidadeKits: 3,
    validadeEm: '2027-03-01T00:00',
    numeroLote: null,
    custos: [],
    valorAdicional: 0,
    ...extra,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1124-limpa' }, limparProducao);
    await limparMassa(nucleo, null);
    m = await montarMassa(nucleo);
    porta = new PortaProducaoInternaPropria(nucleo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1124-massa' }, async (e) => {
      const x = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, m.marca);
      const produto = (cod: string) =>
        x('insumo', {
          codigo: `${m.marca}${cod}`,
          nome: `PRODUTO SINTETICO ${cod}`,
          tipo: 'material',
          grupo_insumo_id: m.grupo,
          estoque_unidade_medida_id: m.unidade,
          situacao: 'ativo',
        });
      ids.produto = await produto('P');
      ids.produtoKit = await produto('K');
      const ordem = (numero: number, situacao: string) =>
        x('ordem_manipulacao', {
          estabelecimento_id: m.estA,
          numero,
          finalidade: 'estoque',
          insumo_id: ids.produto,
          unidade_medida_id: m.unidade,
          quantidade_prevista: 10,
          local_estoque_id: m.localA2,
          situacao,
          valor_custo_total: 50,
        });
      ids.ordem = await ordem(912_401, 'baixada');
      ids.conferida = await ordem(912_402, 'conferida');
      ids.custo = await x('custo_indireto_producao', {
        codigo: `${CUSTO}1`,
        descricao: 'MAO DE OBRA SINTETICA',
        tipo: 'mao_de_obra',
      });
      ids.semValor = await x('custo_indireto_producao', {
        codigo: `${CUSTO}2`,
        descricao: 'ENERGIA SINTETICA',
      });
      await x('custo_indireto_producao_valor', {
        estabelecimento_id: m.estA,
        custo_indireto_producao_id: ids.custo,
        valor: 12.5,
        vigencia_inicio: '2026-01-01',
        ocorrido_em: new Date(),
      });
      ids.kit = await x('kit_material', {
        estabelecimento_id: m.estA,
        codigo: `${m.marca}KT`.slice(0, 30),
        nome: 'KIT SINTETICO C1124',
        tipo: 'rotina',
      });
      await x('kit_material_item', {
        kit_material_id: ids.kit,
        sequencia: 1,
        insumo_id: m.insumo,
        unidade_medida_id: m.unidade,
        quantidade: 2,
      });
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1124-limpa' }, limparProducao);
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  });

  it('fecha a ordem baixada: lote produzido com custo, lote e entrada do produto no estoque, ordem ligada', async () => {
    const c = contexto(m, m.estA, 't-c1124');
    const k1 = chave();
    const r = await porta.fecharOrdem(c, ids.ordem!, fechamento(), k1);
    // 50 dos insumos baixados + 2 × 12,50 de mão de obra + 5 de adicional = 80; por unidade 80 / 9.
    expect(r).toMatchObject({ valorInsumos: 50, valorIndireto: 25, valorAdicional: 5, valorTotal: 80 });
    expect(r.custoUnitario).toBe(8.8889);
    expect(r.numeroLote).toMatch(/^MP-\d{8}-0001$/);
    const lp = await um('SELECT * FROM lote_produzido WHERE id = ?', [r.id]);
    expect(lp).toMatchObject({
      tipo: 'manipulacao',
      situacao: 'liberado',
      estabelecimento_id: m.estA,
      ordem_manipulacao_id: ids.ordem,
      insumo_id: ids.produto,
      local_estoque_id: m.localA2,
      lote_insumo_id: r.loteEstoque,
    });
    expect(Number(lp['quantidade_produzida'])).toBe(9);
    expect(Number(lp['quantidade_perda'])).toBe(1);
    expect(Number(lp['valor_total'])).toBe(80);
    const custos = await ler('SELECT * FROM lote_produzido_custo WHERE lote_produzido_id = ?', [r.id]);
    expect(custos).toHaveLength(1);
    expect(custos[0]).toMatchObject({ sequencia: 1, custo_indireto_producao_id: ids.custo });
    expect(Number(custos[0]!['valor_total'])).toBe(25);
    const o = await um(
      'SELECT lote_produzido_id, quantidade_produzida, quantidade_perda, validade_em, versao, situacao FROM ordem_manipulacao WHERE id = ?',
      [ids.ordem],
    );
    expect(o).toMatchObject({ lote_produzido_id: r.id, situacao: 'baixada', versao: 2 });
    expect(Number(o['quantidade_produzida'])).toBe(9);
    const li = await um('SELECT insumo_id, numero_lote, situacao FROM lote_insumo WHERE id = ?', [
      r.loteEstoque,
    ]);
    expect(li).toMatchObject({ insumo_id: ids.produto, numero_lote: r.numeroLote, situacao: 'liberado' });
    const mov = await um(
      `SELECT me.natureza, me.quantidade, me.valor_total, me.saldo_apos, t.codigo
         FROM movimento_estoque me JOIN tipo_movimento_estoque t ON t.id = me.tipo_movimento_estoque_id
        WHERE me.id = ?`,
      [r.movimento],
    );
    expect(mov).toMatchObject({ natureza: 'entrada', codigo: 'producao_entrada' });
    expect(Number(mov['quantidade'])).toBe(9);
    expect(Number(mov['valor_total'])).toBe(80);
    const ml = await um(
      'SELECT lote_insumo_id, quantidade FROM movimento_lote WHERE movimento_estoque_id = ?',
      [r.movimento],
    );
    expect(ml['lote_insumo_id']).toBe(r.loteEstoque);
    const s = await um(
      'SELECT quantidade, custo_medio FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
      [m.localA2, ids.produto],
    );
    expect(Number(s['quantidade'])).toBe(9);
    expect(Number(s['custo_medio'])).toBeCloseTo(8.8889, 3);
    const sl = await um(
      'SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?',
      [m.localA2, r.loteEstoque],
    );
    expect(Number(sl['quantidade'])).toBe(9);

    // A mesma chave devolve o mesmo lote, sem gravar de novo; outra chave recusa a ordem já fechada.
    const repetida = await porta.fecharOrdem(c, ids.ordem!, fechamento(), k1);
    expect(repetida.id).toBe(r.id);
    expect(
      (await ler('SELECT id FROM lote_produzido WHERE ordem_manipulacao_id = ?', [ids.ordem])).length,
    ).toBe(1);
    expect(await codigoDe(porta.fecharOrdem(c, ids.ordem!, fechamento({ versaoVista: 2 }), chave()))).toBe(
      'producao-ja-fechada',
    );
    expect(await codigoDe(porta.fecharOrdem(c, ids.ordem!, fechamento(), chave()))).toBe('ordem-mudou');
  });

  it('recusa a ordem não baixada, o custo sem valor vigente, o rendimento acima e a ordem de outro estabelecimento', async () => {
    const c = contexto(m, m.estA, 't-c1124');
    expect(await codigoDe(porta.fecharOrdem(c, ids.conferida!, fechamento(), chave()))).toBe(
      'ordem-nao-baixada',
    );
    const antes = await ler('SELECT id FROM lote_produzido WHERE estabelecimento_id = ?', [m.estA]);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c1124-massa' }, (e) =>
      e.executar("UPDATE ordem_manipulacao SET situacao = 'baixada' WHERE id = ?", [ids.conferida]),
    );
    expect(
      await codigoDe(
        porta.fecharOrdem(
          c,
          ids.conferida!,
          fechamento({ custos: [{ custo: ids.semValor, quantidade: 1 }] }),
          chave(),
        ),
      ),
    ).toBe('custo-sem-valor');
    expect(
      await codigoDe(
        porta.fecharOrdem(c, ids.conferida!, fechamento({ quantidadeProduzida: 11, perda: 1 }), chave()),
      ),
    ).toBe('rendimento-acima');
    expect(
      await codigoDe(
        porta.fecharOrdem(contexto(m, m.estB, 't-c1124'), ids.conferida!, fechamento(), chave()),
      ),
    ).toBe('ordem-inexistente');
    // Nada gravado pelas recusas (a transação desfaz tudo).
    expect(await ler('SELECT id FROM lote_produzido WHERE estabelecimento_id = ?', [m.estA])).toHaveLength(
      antes.length,
    );
  });

  it('monta o kit: a composição sai pelos lotes que vencem primeiro e o kit entra como lote próprio', async () => {
    const c = contexto(m, m.estA, 't-c1124');
    expect(await codigoDe(porta.montarKit(c, montagem({ validadeEm: '2027-04-01T00:00' }), chave()))).toBe(
      'validade-acima-componente',
    );
    expect(await codigoDe(porta.montarKit(c, montagem({ quantidadeKits: 6 }), chave()))).toBe(
      'saldo-insuficiente',
    );
    expect(await codigoDe(porta.montarKit(c, montagem({ produto: m.insumo }), chave()))).toBe(
      'produto-no-kit',
    );
    expect(await codigoDe(porta.montarKit(contexto(m, m.estB, 't-c1124'), montagem(), chave()))).toBe(
      'kit-inexistente',
    );
    const r = await porta.montarKit(c, montagem(), chave());
    // 3 kits × 2 unidades = 6 do componente pelo custo médio 2,50 = 15; por kit 5.
    expect(r).toMatchObject({ valorInsumos: 15, valorIndireto: 0, valorTotal: 15, custoUnitario: 5 });
    expect(r.numeroLote).toMatch(/^KT-\d{8}-0001$/);
    const lp = await um('SELECT * FROM lote_produzido WHERE id = ?', [r.id]);
    expect(lp).toMatchObject({
      tipo: 'kit_montado',
      kit_material_id: ids.kit,
      insumo_id: ids.produtoKit,
      local_estoque_id: m.localA,
      ordem_manipulacao_id: null,
    });
    expect(Number(lp['quantidade_produzida'])).toBe(3);
    const saidas = await ler<Record<string, unknown>>(
      `SELECT me.insumo_id, me.quantidade, me.valor_total, ml.lote_insumo_id, t.codigo
         FROM movimento_estoque me JOIN tipo_movimento_estoque t ON t.id = me.tipo_movimento_estoque_id
         JOIN movimento_lote ml ON ml.movimento_estoque_id = me.id
        WHERE me.estabelecimento_id = ? AND t.codigo = 'producao_consumo'`,
      [m.estA],
    );
    expect(saidas).toHaveLength(1);
    expect(saidas[0]).toMatchObject({ insumo_id: m.insumo, lote_insumo_id: m.lote });
    expect(Number(saidas[0]!['quantidade'])).toBe(6);
    expect(Number(saidas[0]!['valor_total'])).toBe(15);
    const comp = await um(
      'SELECT quantidade FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
      [m.localA, m.insumo],
    );
    expect(Number(comp['quantidade'])).toBe(4);
    const kit = await um(
      'SELECT quantidade FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
      [m.localA, ids.produtoKit],
    );
    expect(Number(kit['quantidade'])).toBe(3);
  });
});
