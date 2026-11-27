// Contrato de efeito do fato contábil do estoque (C2-093; ADR 0003) contra o MariaDB real (cliente de teste do lote;
// massa SINTÉTICA, nenhuma pessoa real): a saída de consumo publica `saidaEstoque` na transação do movimento; a
// devolução parcial estorna o fato e republica o saldo não devolvido; a transferência não publica; a nota confirmada
// publica `notaEntrada` pelo total (a entrada da nota não publica fato próprio) e a desconsolidação o estorna.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import type { ContextoSuprimentos } from './porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

const RODADA = Date.now().toString(36);
let k = 0;

interface FatoLido extends Record<string, unknown> {
  id: unknown;
  codigo: string;
  valor: unknown;
  estorno: unknown;
  estornado: unknown;
  centro: unknown;
  situacao: string;
  entidade_origem_id: unknown;
}

describe.skipIf(SEM_BANCO)('fato contábil do estoque (C2-093, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSuprimentosPropria;
  let m: MassaSuprimentos;
  let c: ContextoSuprimentos;
  let hoje: string;
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2093-estoque' }, (l) => l.consultar<T>(sql, p));
  const op = (nome: string, entrada: unknown) =>
    porta.executar(c, `suprimentos.${nome}`, entrada, { ...c, chaveIdempotencia: `c2093-${RODADA}-${++k}` });
  const fatos = (entidade: string, ids: readonly number[]) =>
    ler<FatoLido>(
      `SELECT f.id, ev.codigo, f.valor, f.estorno, f.estornado_fato_contabil_id AS estornado,
              f.centro_custo_id AS centro, f.situacao, f.entidade_origem_id
         FROM fato_contabil f JOIN evento_contabil ev ON ev.id = f.evento_contabil_id
        WHERE f.entidade_origem = ? AND f.entidade_origem_id IN (${ids.map(() => '?').join(',')})
          AND f.excluido_em IS NULL ORDER BY f.id`,
      [entidade, ...ids],
    );
  const movimentosDoDocumento = async (doc: unknown) =>
    (
      await ler<{ id: unknown; valor_total: unknown }>(
        'SELECT id, valor_total FROM movimento_estoque WHERE documento_estoque_id = ? ORDER BY id',
        [doc],
      )
    ).map((r) => ({ id: Number(r.id), valor: Number(r.valor_total) }));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaSuprimentosPropria(nucleo);
    c = { ...contexto(m, m.estA, 'c2093-estoque') } as ContextoSuprimentos;
    hoje = (await porta.relogio(c)).hoje;
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await limparMassa(nucleo, m);
      await nucleo.encerrar();
    }
  });

  it('saída de consumo publica saidaEstoque; devolução parcial estorna e republica o saldo', async () => {
    const s = await op('registrarSaida', {
      destino: 2,
      local: m.localA,
      centroCusto: m.centroCusto,
      localConsumo: 1,
      itens: [{ item: m.insumo, quantidade: 3 }],
    });
    const [mov] = await movimentosDoDocumento(s.resultado['id']);
    expect(mov && mov.valor > 0).toBe(true);
    const f1 = await fatos('movimento_estoque', [mov!.id]);
    expect(f1).toHaveLength(1);
    expect(f1[0]).toMatchObject({ codigo: 'saidaEstoque', situacao: 'pendente' });
    expect(Number(f1[0]!.valor)).toBeCloseTo(mov!.valor, 2);
    expect(Number(f1[0]!.centro)).toBe(m.centroCusto);
    expect(Number(f1[0]!.estorno)).toBe(0);

    const doc = await porta.documento(c, 'saida', {
      ano: Number(s.resultado['ano']),
      mes: Number(s.resultado['mes']),
      doc: Number(s.resultado['doc']),
    });
    await op('registrarDevolucao', {
      saida: Number(s.resultado['id']),
      local: m.localA,
      itens: [
        {
          lancamentoSaida: doc!.itensDetalhe[0]!.id,
          item: m.insumo,
          quantidade: 1,
          lotes: [{ loteSaida: m.lote, quantidade: 1 }],
        },
      ],
    });
    const f2 = await fatos('movimento_estoque', [mov!.id]);
    // Original (fica), estorno dele e o saldo de 2 das 3 unidades, todos na origem do movimento de saída.
    expect(f2).toHaveLength(3);
    expect(Number(f2[1]!.estorno)).toBe(1);
    expect(Number(f2[1]!.estornado)).toBe(Number(f2[0]!.id));
    expect(Number(f2[1]!.valor)).toBeCloseTo(mov!.valor, 2);
    expect(Number(f2[2]!.estorno)).toBe(0);
    expect(Number(f2[2]!.valor)).toBeCloseTo((mov!.valor * 2) / 3, 2);
  });

  it('transferência entre locais não publica fato', async () => {
    const t = await op('transferir', {
      origem: m.localA,
      destino: m.localA2,
      itens: [{ item: m.insumo, quantidade: 1, lotes: [] }],
    });
    const movs = await movimentosDoDocumento(t.resultado['id']);
    expect(movs.length).toBeGreaterThan(0);
    expect(
      await fatos(
        'movimento_estoque',
        movs.map((x) => x.id),
      ),
    ).toEqual([]);
  });

  it('nota confirmada publica notaEntrada pelo total; a desconsolidação estorna', async () => {
    const nf = await op('registrarEntradaNF', {
      fornecedor: m.fornecedor,
      numero: Number(RODADA.replace(/\D/g, '').slice(-6) || '1') + 7,
      emissao: hoje,
      local: m.localA,
      frete: 2,
      itens: [
        {
          item: m.insumo,
          quantidade: 4,
          valorUnitario: 5,
          lotes: [{ lote: `${m.marca}C93`, validade: '2028-01-31', quantidade: 4 }],
        },
      ],
    });
    const nota = Number(nf.resultado['id']);
    const f1 = await fatos('nota_entrada', [nota]);
    expect(f1).toHaveLength(1);
    expect(f1[0]).toMatchObject({ codigo: 'notaEntrada', situacao: 'pendente' });
    expect(Number(f1[0]!.valor)).toBeCloseTo(22, 2);
    // A entrada da nota não publica fato próprio.
    const [ent] = await ler<{ id: unknown }>(
      `SELECT m.id FROM movimento_estoque m JOIN nota_entrada_item ni ON ni.id = m.nota_entrada_item_id
        WHERE ni.nota_entrada_id = ?`,
      [nota],
    );
    expect(await fatos('movimento_estoque', [Number(ent!.id)])).toEqual([]);
    await op('desconsolidarDocumento', {
      tipo: 'nota',
      documento: nota,
      motivo: 'Nota lançada no local errado',
    });
    const f2 = await fatos('nota_entrada', [nota]);
    expect(f2).toHaveLength(2);
    expect(Number(f2[1]!.estorno)).toBe(1);
    expect(Number(f2[1]!.estornado)).toBe(Number(f2[0]!.id));
  });
});
