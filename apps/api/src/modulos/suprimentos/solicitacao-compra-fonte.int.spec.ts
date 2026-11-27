// Contrato de efeito da solicitação de compra pública com a fonte de recurso por item (C2-017, 09-AREA linha 81; Lei
// 14.133, art. 150) contra o MariaDB real (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo
// Executor: o item sem fonte e as fontes que não fecham 100% são recusados sem gravar; com duas fontes (70% e 30%) num
// item e uma fonte por quantidade no outro, grava a solicitação numerada, os itens com a unidade de estoque e as
// parcelas; a fonte principal é a de maior valor estimado; a repetição pela mesma chave não grava de novo; a fonte
// inativa é recusada. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaAtaEmpenhoPropria } from './ata-empenho.js';
import {
  CLIENTE,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import type { EntradaSolicitacaoCompraPublica } from './solicitacao-compra-fonte.js';

const k = () => `t-scf-${randomUUID()}`;
const MARCA = Date.now().toString(36).toUpperCase();
type L = Record<string, unknown>;

describe.skipIf(SEM_BANCO)('solicitação de compra pública com fonte de recurso (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtaEmpenhoPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  const origens: number[] = [];
  const cn = { cliente: CLIENTE, correlacao: 't-c2017-scf' };
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(cn, (l) => l.uma<L>(sql, p));
  const varios = (sql: string, p: unknown[]) => nucleo.lerSomente(cn, (l) => l.consultar<L>(sql, p));
  const contar = async () =>
    Number(
      (await um('SELECT COUNT(*) AS n FROM solicitacao_compra WHERE estabelecimento_id = ?', [m.estA]))?.[
        'n'
      ],
    );
  const entrada = (x: Partial<EntradaSolicitacaoCompraPublica> = {}): EntradaSolicitacaoCompraPublica => ({
    tipo: 'insumo',
    localEstoque: m.localA,
    processo: null,
    necessarioAte: null,
    justificativa: 'Reposição sintética de material médico.',
    itens: [
      {
        insumo: m.insumo,
        quantidade: 10,
        valorUnitarioEstimado: 5,
        fontes: [
          { origem: origens[0]!, quantidade: null, percentual: 70 },
          { origem: origens[1]!, quantidade: null, percentual: 30 },
        ],
      },
      {
        insumo: m.insumoOpme,
        quantidade: 4,
        valorUnitarioEstimado: 2,
        fontes: [{ origem: origens[1]!, quantidade: 4, percentual: null }],
      },
    ],
    ...x,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaAtaEmpenhoPropria(nucleo);
    c = contexto(m, m.estA, 't-c2017-scf') as ContextoPortaM18;
    await nucleo.escrever({ ...cn, correlacao: 't-c2017-scf-massa' }, async (e) => {
      for (const [i, ativo] of [true, true, false].entries()) {
        await e.executar(
          'INSERT INTO origem_recurso_compra (codigo, descricao, ativo, esfera, criado_em) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))',
          [`T${MARCA}${i}`, `Fonte sintética ${MARCA} ${i}`, ativo, i === 0 ? 'federal' : 'municipal'],
        );
        const r = await e.consultar<L>('SELECT id FROM origem_recurso_compra WHERE codigo = ?', [
          `T${MARCA}${i}`,
        ]);
        origens.push(Number(r[0]?.['id']));
      }
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ ...cn, correlacao: 't-c2017-scf-limpa' }, async (e) => {
        await e.executar(
          `DELETE f FROM solicitacao_compra_fonte_recurso f JOIN solicitacao_compra_item i ON i.id = f.solicitacao_compra_item_id
            JOIN solicitacao_compra s ON s.id = i.solicitacao_compra_id WHERE s.estabelecimento_id = ?`,
          [m.estA],
        );
        await e.executar(
          'DELETE i FROM solicitacao_compra_item i JOIN solicitacao_compra s ON s.id = i.solicitacao_compra_id WHERE s.estabelecimento_id = ?',
          [m.estA],
        );
        await e.executar('DELETE FROM solicitacao_compra WHERE estabelecimento_id = ?', [m.estA]);
        await e.executar(
          "DELETE FROM sequencia_negocio WHERE tipo = 'solicitacao_compra' AND estabelecimento_id = ?",
          [m.estA],
        );
        await e.executar('DELETE FROM origem_recurso_compra WHERE codigo LIKE ?', [`T${MARCA}%`]);
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    if (m) await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  it('recusa sem fonte e soma errada; grava itens, parcelas e a fonte principal; repetição não duplica', async () => {
    const antes = await contar();
    await expect(
      porta.solicitarCompra(c, entrada({ itens: [{ ...entrada().itens[0]!, fontes: [] }] }), k()),
    ).rejects.toMatchObject({ problema: { codigo: 'item-sem-fonte' } });
    await expect(
      porta.solicitarCompra(
        c,
        entrada({
          itens: [
            { ...entrada().itens[0]!, fontes: [{ origem: origens[0]!, quantidade: null, percentual: 60 }] },
          ],
        }),
        k(),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'fonte-soma-percentual' } });
    expect(await contar()).toBe(antes);

    const chave = k();
    const r = await porta.solicitarCompra(c, entrada(), chave);
    expect(r.itens).toBe(2);
    expect(r.valorTotal).toBe(58);
    const again = await porta.solicitarCompra(c, entrada(), chave);
    expect(again.id).toBe(r.id);
    expect(await contar()).toBe(antes + 1);

    const s = await um(
      'SELECT numero, situacao, origem_recurso_compra_id, valor_estimado, solicitante_usuario_id FROM solicitacao_compra WHERE id = ?',
      [r.id],
    );
    expect(Number(s?.['numero'])).toBeGreaterThan(0);
    expect(s?.['situacao']).toBe('enviada');
    // 10 x 5 = 50: 35 da fonte 0 e 15 da fonte 1; mais 4 x 2 = 8 da fonte 1 (23): a principal é a fonte 0.
    expect(Number(s?.['origem_recurso_compra_id'])).toBe(origens[0]);
    expect(Number(s?.['valor_estimado'])).toBe(58);
    const parcelas = await varios(
      `SELECT i.sequencia, i.unidade_medida_id, f.origem_recurso_compra_id AS o, f.quantidade, f.percentual
         FROM solicitacao_compra_item i JOIN solicitacao_compra_fonte_recurso f ON f.solicitacao_compra_item_id = i.id
        WHERE i.solicitacao_compra_id = ? ORDER BY i.sequencia, f.id`,
      [r.id],
    );
    expect(
      parcelas.map((p) => [
        Number(p['sequencia']),
        Number(p['o']),
        p['quantidade'] === null ? null : Number(p['quantidade']),
        p['percentual'] === null ? null : Number(p['percentual']),
      ]),
    ).toEqual([
      [1, origens[0], null, 70],
      [1, origens[1], null, 30],
      [2, origens[1], 4, null],
    ]);
    expect(parcelas.every((p) => p['unidade_medida_id'] !== null)).toBe(true);

    const lista = await porta.solicitacoesCompra(c);
    const v = lista.find((x) => x.id === r.id);
    expect(v?.fontePrincipal).toBe(`Fonte sintética ${MARCA} 0`);
    expect(v?.itens[0]?.fontes.map((f) => f.percentual)).toEqual([70, 30]);
    const apoio = await porta.apoioSolicitacaoCompra(c, '');
    expect(apoio.origens.some((o) => o.id === origens[2])).toBe(false);
    expect(apoio.origens.some((o) => o.id === origens[0])).toBe(true);
    expect(apoio.locais.some((x) => x.id === m.localA)).toBe(true);
  }, 120_000);

  it('recusa a fonte inativa no cadastro', async () => {
    await expect(
      porta.solicitarCompra(
        c,
        entrada({
          itens: [
            { ...entrada().itens[1]!, fontes: [{ origem: origens[2]!, quantidade: 4, percentual: null }] },
          ],
        }),
        k(),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'fonte-inativa' } });
  }, 60_000);
});
