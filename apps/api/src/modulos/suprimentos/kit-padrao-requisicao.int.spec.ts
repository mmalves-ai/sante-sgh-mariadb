// Contrato de efeito do kit padrão no pedido de material (F3.6, 05-SUP linha 13) contra o MariaDB real (cliente de
// teste do lote, massa SINTÉTICA, nenhuma pessoa real). O kit padrão da cirurgia é achado pelo nome da cirurgia com a
// composição vigente; a regra `somarKitAoPedido` monta as linhas (quantidade do kit × número de kits) e a requisição
// grava cada linha com o kit de onde ela veio. Recusas antes de gravar: kit que não existe, kit inativo e item que não
// faz parte do kit citado. A linha digitada à mão segue sem kit. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { somarKitAoPedido } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import type { ContextoSuprimentos } from './porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

const RODADA = Date.now().toString(36);
const PROC = 'F36KITREQ';
const CIRURGIA = 'CIRURGIA SINTETICA F36 PEDIDO';
let k = 0;

describe.skipIf(SEM_BANCO)('kit padrão no pedido de material (MariaDB, cliente de teste do lote)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSuprimentosPropria;
  let m: MassaSuprimentos;
  let c: ContextoSuprimentos;
  let proc = 0;
  let proc2 = 0;
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f36-kitreq' }, (l) => l.consultar<T>(sql, p));
  const op = (nome: string, entrada: unknown) =>
    porta.executar(c, `suprimentos.${nome}`, entrada, {
      ...c,
      chaveIdempotencia: `f36kr-${RODADA}-${++k}`,
    });

  const limparKits = async (e: Escritor) => {
    const kits = 'SELECT id FROM kit_material WHERE estabelecimento_id IN (?, ?)';
    await e.executar(
      `UPDATE requisicao_material_item SET kit_material_id = NULL WHERE kit_material_id IN (${kits})`,
      [m.estA, m.estB],
    );
    for (const t of ['kit_material_procedimento', 'kit_material_item'])
      await e.executar(`DELETE FROM ${t} WHERE kit_material_id IN (${kits})`, [m.estA, m.estB]);
    await e.executar(
      'DELETE FROM kit_material WHERE estabelecimento_id IN (?, ?) AND id NOT IN (SELECT kit_material_id FROM kit_rastreavel WHERE kit_material_id IS NOT NULL)',
      [m.estA, m.estB],
    );
    await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo LIKE ?', [`${PROC}%`]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaSuprimentosPropria(nucleo);
    c = { ...contexto(m, m.estA, 'f36-kitreq') } as ContextoSuprimentos;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f36-kitreq' }, async (e) => {
      await limparKits(e);
      const agora = new Date();
      proc = await e.inserir(
        'INSERT INTO procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${PROC}1`, `${CIRURGIA} UM`, agora],
      );
      proc2 = await e.inserir(
        'INSERT INTO procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${PROC}2`, `${CIRURGIA} DOIS`, agora],
      );
    });
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      if (m)
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpa-f36-kitreq' }, (e) => limparKits(e));
      await limparMassa(nucleo, m);
      await nucleo.encerrar();
    }
  });

  const kit = (extra: Record<string, unknown> = {}) => ({
    codigo: `KR-${RODADA}`.slice(0, 30),
    nome: 'KIT SINTETICO DO PEDIDO',
    tipo: 'procedimento',
    permiteQuantidadeAcima: false,
    permiteSimilar: true,
    observacao: null,
    ativo: true,
    itens: [
      { insumo: m.insumo, quantidade: 2, obrigatorioRastreavel: false, permiteSubstituto: false },
      { insumo: m.insumoOpme, quantidade: 1, obrigatorioRastreavel: false, permiteSubstituto: true },
    ],
    procedimentos: [{ procedimentoCirurgico: proc, itemFaturavel: null, quantidadeKits: 2, padrao: true }],
    ...extra,
  });
  const pedido = (itens: unknown[]) => ({
    destino: 2,
    local: m.localA,
    centroCusto: m.centroCusto,
    localConsumo: 1,
    itens,
  });
  const requisicoes = async () =>
    Number(
      (
        await ler<{ q: unknown }>(
          'SELECT COUNT(*) AS q FROM requisicao_material WHERE estabelecimento_id = ?',
          [m.estA],
        )
      )[0]?.q ?? 0,
    );
  const linhasDe = (requisicao: number) =>
    ler<{ i: unknown; q: unknown; kit: unknown }>(
      `SELECT insumo_id AS i, quantidade_solicitada AS q, kit_material_id AS kit
         FROM requisicao_material_item WHERE requisicao_material_id = ? ORDER BY sequencia`,
      [requisicao],
    );

  it('o kit padrão da cirurgia é achado pelo nome, somado ao pedido e a requisição grava o kit em cada linha', async () => {
    const id = Number((await op('gravarKitPadrao', kit())).resultado['kit']);
    const sugeridos = await porta.kitsPadraoSugeridos(c, `${CIRURGIA} UM`);
    expect(
      sugeridos.map((s) => [s.procedimentoCirurgico, s.procedimentoCodigo, s.kit, s.quantidadeKits]),
    ).toEqual([[proc, `${PROC}1`, id, 2]]);
    const [s] = sugeridos;
    expect(s?.itens.map((i) => [i.insumo, i.quantidade])).toEqual([
      [m.insumo, 2],
      [m.insumoOpme, 1],
    ]);
    expect((s?.itens[0]?.unidade ?? '').length).toBeGreaterThan(0);
    // Pelo código exato da cirurgia também; outro estabelecimento não enxerga o kit.
    expect((await porta.kitsPadraoSugeridos(c, `${PROC}1`)).map((x) => x.kit)).toEqual([id]);
    const cB = { ...contexto(m, m.estB, 'f36-kitreq-b') } as ContextoSuprimentos;
    expect(await porta.kitsPadraoSugeridos(cB, CIRURGIA)).toEqual([]);

    // A tela soma o kit pela regra (2 kits × a composição) e pede; cada linha guarda o kit de onde veio.
    const linhas = somarKitAoPedido([], { kit: id, itens: s?.itens ?? [] }, s?.quantidadeKits ?? 0) ?? [];
    expect(linhas.map((l) => [l.item, l.quantidade, l.kit])).toEqual([
      [m.insumo, 4, id],
      [m.insumoOpme, 2, id],
    ]);
    const antes = await requisicoes();
    const r = await op(
      'requisitarMaterial',
      pedido(linhas.map((l) => ({ item: l.item, quantidade: l.quantidade, kit: id }))),
    );
    expect(await requisicoes()).toBe(antes + 1);
    expect(
      (await linhasDe(Number(r.resultado['id']))).map((x) => [Number(x.i), Number(x.q), Number(x.kit)]),
    ).toEqual([
      [m.insumo, 4, id],
      [m.insumoOpme, 2, id],
    ]);

    // A linha digitada à mão segue sem kit.
    const r2 = await op('requisitarMaterial', pedido([{ item: m.insumo, quantidade: 1 }]));
    expect((await linhasDe(Number(r2.resultado['id']))).map((x) => [Number(x.i), x.kit])).toEqual([
      [m.insumo, null],
    ]);

    // A composição muda: a sugestão seguinte traz só o que vale (o item que saiu não é sugerido).
    await op(
      'gravarKitPadrao',
      kit({
        kit: id,
        versao: 1,
        itens: [{ insumo: m.insumo, quantidade: 5, obrigatorioRastreavel: false, permiteSubstituto: false }],
      }),
    );
    const [depois] = await porta.kitsPadraoSugeridos(c, `${CIRURGIA} UM`);
    expect(depois?.itens.map((i) => [i.insumo, i.quantidade])).toEqual([[m.insumo, 5]]);
    // O item que saiu da composição não pode mais ser pedido como parte do kit, e nada é gravado.
    const antes2 = await requisicoes();
    expect(
      await codigoDe(op('requisitarMaterial', pedido([{ item: m.insumoOpme, quantidade: 1, kit: id }]))),
    ).toBe('item-fora-do-kit');
    expect(await requisicoes()).toBe(antes2);
  });

  it('recusas antes de gravar: kit que não existe, kit inativo; vínculo que não é padrão e kit inativo não são sugeridos', async () => {
    const outro = Number(
      (
        await op(
          'gravarKitPadrao',
          kit({
            codigo: `KS-${RODADA}`.slice(0, 30),
            itens: [
              { insumo: m.insumoOpme, quantidade: 1, obrigatorioRastreavel: false, permiteSubstituto: false },
            ],
            procedimentos: [
              { procedimentoCirurgico: proc2, itemFaturavel: null, quantidadeKits: 1, padrao: false },
            ],
          }),
        )
      ).resultado['kit'],
    );
    // O vínculo existe, mas não é o padrão da cirurgia: nada é sugerido para ela.
    expect(await porta.kitsPadraoSugeridos(c, `${CIRURGIA} DOIS`)).toEqual([]);
    const antes = await requisicoes();
    expect(
      await codigoDe(
        op('requisitarMaterial', pedido([{ item: m.insumo, quantidade: 1, kit: 4_000_000_000 }])),
      ),
    ).toBe('kit-inexistente');
    expect(
      await codigoDe(op('requisitarMaterial', pedido([{ item: m.insumo, quantidade: 1, kit: outro }]))),
    ).toBe('item-fora-do-kit');
    // O kit passa a padrão da segunda cirurgia e depois é inativado: deixa de ser sugerido e de ser aceito na linha.
    await op(
      'gravarKitPadrao',
      kit({
        kit: outro,
        versao: 1,
        codigo: `KS-${RODADA}`.slice(0, 30),
        itens: [
          { insumo: m.insumoOpme, quantidade: 1, obrigatorioRastreavel: false, permiteSubstituto: false },
        ],
        procedimentos: [
          { procedimentoCirurgico: proc2, itemFaturavel: null, quantidadeKits: 1, padrao: true },
        ],
      }),
    );
    expect((await porta.kitsPadraoSugeridos(c, `${CIRURGIA} DOIS`)).map((x) => x.kit)).toEqual([outro]);
    await op(
      'gravarKitPadrao',
      kit({
        kit: outro,
        versao: 2,
        codigo: `KS-${RODADA}`.slice(0, 30),
        ativo: false,
        itens: [
          { insumo: m.insumoOpme, quantidade: 1, obrigatorioRastreavel: false, permiteSubstituto: false },
        ],
        procedimentos: [],
      }),
    );
    expect(await porta.kitsPadraoSugeridos(c, `${CIRURGIA} DOIS`)).toEqual([]);
    expect(
      await codigoDe(op('requisitarMaterial', pedido([{ item: m.insumoOpme, quantidade: 1, kit: outro }]))),
    ).toBe('kit-inativo');
    expect(await requisicoes()).toBe(antes);
  });
});
