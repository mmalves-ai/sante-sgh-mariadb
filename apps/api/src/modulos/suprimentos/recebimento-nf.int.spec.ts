// Contrato de efeito do recebimento por nota fiscal (C2-038, 05-SUP linha 21) contra o MariaDB real (cliente de teste
// do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: a conferência física com falta grava a conferência
// "divergente" (conferente, chegada) e o item com esperado, conferido, lote, validade e a divergência "falta"; quem
// conferiu não valida; a divergente só é validada por outra pessoa com a justificativa; o cancelamento pede o motivo.
// A nota com impostos por item grava nota_entrada_imposto (tributo, base, alíquota, valor, CST, compõe o custo), os
// totais da nota (ICMS, ICMS-ST, IPI, seguro) e o custo de entrada com IPI e ICMS-ST (o ICMS próprio fica no preço),
// liga a conferência validada à nota e a cada item; a conferência não validada ou já usada é recusada sem gravar.
// A leitura do XML da NF-e traz os impostos do item e as despesas do total. SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import {
  type ConferenciaRecebimentoEntrada,
  PortaConferenciaRecebimentoPropria,
} from './conferencia-recebimento.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import { lerXmlNota } from './nfe-xml.js';
import type { ContextoSuprimentos } from './porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

const k = () => `t-c2038-${randomUUID()}`;
const NUMERO = 700_000 + (Date.now() % 99_999);
type L = Record<string, unknown>;

const XML = `<?xml version="1.0"?><nfeProc><NFe><infNFe>
<ide><nNF>123</nNF><serie>1</serie><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>00000000000191</CNPJ><xNome>Fornecedor Sintetico</xNome></emit>
<det nItem="1"><prod><cProd>A1</cProd><xProd>Luva sintetica</xProd><uCom>CX</uCom><qCom>10.0000</qCom><vUnCom>10.00</vUnCom></prod>
<imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS>
<vBCST>120.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>3.60</vICMSST></ICMS10></ICMS>
<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>100.00</vBC><pIPI>5.00</pIPI><vIPI>5.00</vIPI></IPITrib></IPI>
<PIS><PISAliq><CST>01</CST><vBC>100.00</vBC><pPIS>1.65</pPIS><vPIS>1.65</vPIS></PISAliq></PIS>
<COFINS><COFINSNT><CST>06</CST></COFINSNT></COFINS></imposto></det>
<det nItem="2"><prod><cProd>B2</cProd><xProd>Gaze</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>2.00</vUnCom></prod>
<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>
<total><ICMSTot><vBC>100.00</vBC><vFrete>4.00</vFrete><vSeg>1.00</vSeg><vDesc>2.00</vDesc><vOutro>0.50</vOutro></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

describe('XML da NF-e: impostos por item e despesas do total', () => {
  it('lê ICMS, ICMS-ST, IPI e PIS do item; o tributo sem valor fica de fora', () => {
    const n = lerXmlNota(XML);
    expect(n.itens[0]!.impostos).toEqual([
      { tributo: 'ICMS', base: 100, aliquota: 18, valor: 18, cst: '10' },
      { tributo: 'ICMS_ST', base: 120, aliquota: 18, valor: 3.6, cst: '10' },
      { tributo: 'IPI', base: 100, aliquota: 5, valor: 5, cst: '50' },
      { tributo: 'PIS', base: 100, aliquota: 1.65, valor: 1.65, cst: '01' },
    ]);
    expect(n.itens[1]!.impostos).toEqual([]);
    expect([n.frete, n.seguro, n.outros, n.desconto]).toEqual([4, 1, 0.5, 2]);
  });
});

describe.skipIf(SEM_BANCO)('recebimento por nota fiscal: conferência física e impostos (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let conf: PortaConferenciaRecebimentoPropria;
  let estoque: PortaSuprimentosPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  let c2: ContextoPortaM18;
  let hoje = '';
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2038' }, (l) => l.uma<L>(sql, p));
  const varios = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2038' }, (l) => l.consultar<L>(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);
  const nota = (x: Record<string, unknown> = {}) =>
    estoque.executar(
      c as unknown as ContextoSuprimentos,
      'suprimentos.registrarEntradaNF',
      {
        fornecedor: m.fornecedor,
        numero: NUMERO,
        emissao: hoje,
        local: m.localA,
        desconto: 2,
        frete: 4,
        seguro: 1,
        itens: [
          {
            item: m.insumo,
            quantidade: 8,
            valorUnitario: 10,
            lotes: [{ lote: `${m.marca}C38`, validade: '2030-06-30', quantidade: 8 }],
            impostos: [
              { tributo: 'ICMS', base: 80, aliquota: 18, valor: 14.4, cst: '10' },
              { tributo: 'ICMS_ST', base: 96, aliquota: 18, valor: 2.88, cst: '10' },
              { tributo: 'IPI', base: 80, aliquota: 5, valor: 4, cst: '50' },
            ],
          },
        ],
        ...x,
      },
      { ...(c as unknown as ContextoSuprimentos), chaveIdempotencia: k() },
    );
  const entrada = (x: Partial<ConferenciaRecebimentoEntrada> = {}): ConferenciaRecebimentoEntrada => ({
    tipo: 'compra',
    fornecedor: m.fornecedor,
    local: m.localA,
    numeroNota: String(NUMERO),
    observacao: null,
    itens: [
      {
        item: m.insumo,
        esperada: 10,
        conferida: 8,
        lote: `${m.marca}C38`,
        validade: '2030-06-30',
      },
    ],
    ...x,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    conf = new PortaConferenciaRecebimentoPropria(nucleo);
    estoque = new PortaSuprimentosPropria(nucleo);
    c = contexto(m, m.estA, 't-c2038') as ContextoPortaM18;
    c2 = { ...c, usuario: m.usuario2 } as ContextoPortaM18;
    hoje = (await estoque.relogio(c as unknown as ContextoSuprimentos)).hoje;
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2038-limpa' }, async (e) => {
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  let validada = 0;

  it('conferência com falta fica divergente; quem conferiu não valida; outra pessoa valida com justificativa', async () => {
    const r = await conf.registrar(c, entrada(), k());
    expect(r).toMatchObject({ situacao: 'divergente', divergentes: 1 });
    const cab = await um(
      'SELECT situacao, conferente_usuario_id, conferido_em, chegada_em, empresa_fornecedora_id, numero_nota_fiscal FROM conferencia_recebimento WHERE id = ?',
      [r.id],
    );
    expect(cab).toMatchObject({ situacao: 'divergente', numero_nota_fiscal: String(NUMERO) });
    expect(Number(cab?.['conferente_usuario_id'])).toBe(m.usuario);
    expect(cab?.['conferido_em']).not.toBeNull();
    const itens = await varios(
      'SELECT insumo_id, quantidade_esperada, quantidade_conferida, numero_lote, divergencia, unidade_medida_id FROM conferencia_recebimento_item WHERE conferencia_recebimento_id = ?',
      [r.id],
    );
    expect(itens).toHaveLength(1);
    expect(Number(itens[0]!['quantidade_esperada'])).toBe(10);
    expect(Number(itens[0]!['quantidade_conferida'])).toBe(8);
    expect(itens[0]).toMatchObject({ numero_lote: `${m.marca}C38`, divergencia: 'falta' });
    expect(Number(itens[0]!['unidade_medida_id'])).toBeGreaterThan(0);

    expect(
      await codigoDe(conf.validar(c, { id: r.id, justificativa: 'Falta aceita pelo comprador' }, k())),
    ).toBe('mesmo-conferente');
    expect(await codigoDe(conf.validar(c2, { id: r.id, justificativa: null }, k()))).toBe(
      'divergencia-sem-justificativa',
    );
    expect(await um('SELECT situacao FROM conferencia_recebimento WHERE id = ?', [r.id])).toMatchObject({
      situacao: 'divergente',
    });
    const v = await conf.validar(
      c2,
      { id: r.id, justificativa: 'Falta de 2 caixas reposta na próxima entrega' },
      k(),
    );
    expect(v.situacao).toBe('validada');
    const depois = await um(
      'SELECT situacao, validador_usuario_id, validado_em, observacao FROM conferencia_recebimento WHERE id = ?',
      [r.id],
    );
    expect(Number(depois?.['validador_usuario_id'])).toBe(m.usuario2);
    expect(String(depois?.['observacao'])).toContain('Aceite:');
    const d = await conf.detalhe(c, r.id);
    expect(d.itensDetalhe[0]).toMatchObject({ divergencia: 'falta', esperada: 10, conferida: 8 });
    expect((await conf.listar(c, 'validada')).some((x) => x.id === r.id)).toBe(true);
    validada = r.id;
  });

  it('cancelamento com motivo; a recusa não grava', async () => {
    const r = await conf.registrar(
      c,
      entrada({ itens: [{ item: m.insumo, esperada: 8, conferida: 8, lote: 'X1', validade: '2030-06-30' }] }),
      k(),
    );
    expect(r.situacao).toBe('conferida');
    expect(await codigoDe(conf.cancelar(c, { id: r.id, motivo: 'curto' }, k()))).toBe('motivo-obrigatorio');
    await conf.cancelar(c, { id: r.id, motivo: 'Entrega devolvida inteira ao transportador' }, k());
    expect(
      await um(
        'SELECT situacao, motivo_cancelamento, cancelado_por_usuario_id FROM conferencia_recebimento WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({
      situacao: 'cancelada',
      motivo_cancelamento: 'Entrega devolvida inteira ao transportador',
    });
    // Item com lote sem o lote informado: recusado sem gravar.
    const antes = await contar(
      'SELECT COUNT(*) AS n FROM conferencia_recebimento WHERE estabelecimento_id = ?',
      [m.estA],
    );
    expect(
      await codigoDe(
        conf.registrar(c, entrada({ itens: [{ item: m.insumo, esperada: 1, conferida: 1 }] }), k()),
      ),
    ).toBe('lote-obrigatorio');
    expect(
      await contar('SELECT COUNT(*) AS n FROM conferencia_recebimento WHERE estabelecimento_id = ?', [
        m.estA,
      ]),
    ).toBe(antes);
    // A conferência não validada não dá entrada na nota.
    expect(await codigoDe(nota({ conferencia: r.id }))).toBe('conferencia-nao-validada');
  });

  it('nota com impostos por item: nota_entrada_imposto, totais, custo de entrada e a conferência ligada', async () => {
    const notasAntes = await contar('SELECT COUNT(*) AS n FROM nota_entrada WHERE estabelecimento_id = ?', [
      m.estA,
    ]);
    // Imposto que não confere com base × alíquota: recusado sem gravar.
    expect(
      await codigoDe(
        nota({
          conferencia: validada,
          itens: [
            {
              item: m.insumo,
              quantidade: 8,
              valorUnitario: 10,
              lotes: [{ lote: `${m.marca}C38`, validade: '2030-06-30', quantidade: 8 }],
              impostos: [{ tributo: 'IPI', base: 80, aliquota: 5, valor: 9 }],
            },
          ],
        }),
      ),
    ).toBe('imposto-nao-confere');
    expect(
      await contar('SELECT COUNT(*) AS n FROM nota_entrada WHERE estabelecimento_id = ?', [m.estA]),
    ).toBe(notasAntes);

    // A conferência contou 8: a nota de 10 não dá entrada; nem a de lote diferente do conferido. Nada gravado.
    const lote = (q: number, l = `${m.marca}C38`, validade = '2030-06-30') => ({
      conferencia: validada,
      itens: [
        { item: m.insumo, quantidade: q, valorUnitario: 10, lotes: [{ lote: l, validade, quantidade: q }] },
      ],
    });
    expect(await codigoDe(nota(lote(10)))).toBe('quantidade-acima-da-conferida');
    expect(await codigoDe(nota(lote(8, `${m.marca}OUTRO`)))).toBe('lote-divergente-da-conferencia');
    expect(await codigoDe(nota(lote(8, `${m.marca}C38`, '2031-01-31')))).toBe(
      'lote-divergente-da-conferencia',
    );
    expect(
      await contar('SELECT COUNT(*) AS n FROM nota_entrada WHERE estabelecimento_id = ?', [m.estA]),
    ).toBe(notasAntes);
    expect(
      (await um('SELECT nota_entrada_id FROM conferencia_recebimento WHERE id = ?', [validada]))?.[
        'nota_entrada_id'
      ],
    ).toBeNull();

    const r = await nota({ conferencia: validada });
    const id = Number(r.resultado['id']);
    const cab = await um(
      `SELECT valor_produtos, valor_desconto, valor_frete, valor_seguro, base_calculo_icms, valor_icms,
              base_calculo_icms_st, valor_icms_st, valor_ipi, valor_total FROM nota_entrada WHERE id = ?`,
      [id],
    );
    expect(Object.fromEntries(Object.entries(cab ?? {}).map(([a, b]) => [a, Number(b)]))).toEqual({
      valor_produtos: 80,
      valor_desconto: 2,
      valor_frete: 4,
      valor_seguro: 1,
      base_calculo_icms: 80,
      valor_icms: 14.4,
      base_calculo_icms_st: 96,
      valor_icms_st: 2.88,
      valor_ipi: 4,
      // 80 − 2 + 4 + 1 + 2,88 + 4
      valor_total: 89.88,
    });
    const item = await um(
      'SELECT id, custo_unitario, valor_frete, valor_desconto, valor_outras_despesas FROM nota_entrada_item WHERE nota_entrada_id = ?',
      [id],
    );
    // Custo: 80 − 2 + 4 + 1 + IPI 4 + ICMS-ST 2,88 = 89,88 / 8 = 11,235 (o ICMS próprio fica no preço).
    expect(Number(item?.['custo_unitario'])).toBeCloseTo(11.235, 6);
    expect(Number(item?.['valor_outras_despesas'])).toBe(1);
    const imps = await varios(
      `SELECT t.codigo, ni.sequencia, ni.base_calculo, ni.aliquota_percentual, ni.valor, ni.situacao_tributaria,
              ni.compoe_custo, ni.recuperavel
         FROM nota_entrada_imposto ni JOIN tributo t ON t.id = ni.tributo_id
        WHERE ni.nota_entrada_item_id = ? ORDER BY ni.sequencia`,
      [Number(item?.['id'])],
    );
    expect(
      imps.map((i) => [
        i['codigo'],
        Number(i['valor']),
        i['situacao_tributaria'],
        Number(i['compoe_custo']),
        Number(i['recuperavel']),
      ]),
    ).toEqual([
      ['ICMS', 14.4, '10', 1, 0],
      ['ICMS_ST', 2.88, '10', 1, 0],
      ['IPI', 4, '50', 1, 0],
    ]);
    // O movimento de entrada leva o custo de entrada.
    const mov = await um('SELECT valor_total FROM movimento_estoque WHERE nota_entrada_item_id = ?', [
      Number(item?.['id']),
    ]);
    expect(Number(mov?.['valor_total'])).toBeCloseTo(89.88, 2);
    // A conferência validada fica ligada à nota e ao item; não é usada de novo nem cancelada.
    expect(
      Number(
        (await um('SELECT nota_entrada_id FROM conferencia_recebimento WHERE id = ?', [validada]))?.[
          'nota_entrada_id'
        ],
      ),
    ).toBe(id);
    expect(
      Number(
        (
          await um(
            'SELECT nota_entrada_item_id FROM conferencia_recebimento_item WHERE conferencia_recebimento_id = ?',
            [validada],
          )
        )?.['nota_entrada_item_id'],
      ),
    ).toBe(Number(item?.['id']));
    expect(await codigoDe(nota({ numero: NUMERO + 1, conferencia: validada }))).toBe('conferencia-usada');
    expect(
      await codigoDe(conf.cancelar(c, { id: validada, motivo: 'Tentativa de cancelar a já usada' }, k())),
    ).toBe('conferencia-usada');
    // Outro estabelecimento não vê a conferência.
    await expect(
      conf.detalhe({ ...c, estabelecimento: m.estB } as ContextoPortaM18, validada),
    ).rejects.toMatchObject({
      tipo: 'nao-encontrado',
    });
  });

  it('com pedido: o esperado é o saldo do servidor, o item fora do pedido é produto errado e o que não veio é falta', async () => {
    const p = await estoque.executar(
      c as unknown as ContextoSuprimentos,
      'suprimentos.criarPedido',
      {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor],
        itens: [{ item: m.insumoOpme, quantidade: 2 }],
      },
      { ...(c as unknown as ContextoSuprimentos), chaveIdempotencia: k() },
    );
    const pedido = { ano: Number(p.resultado['ano']), doc: Number(p.resultado['doc']) };
    // A tela manda o item fora do pedido com esperada igual à conferida, e não manda o item do pedido.
    const r = await conf.registrar(
      c,
      entrada({
        pedido,
        itens: [
          { item: m.insumo, esperada: 5, conferida: 5, lote: `${m.marca}C38P`, validade: '2030-06-30' },
        ],
      }),
      k(),
    );
    expect(r).toMatchObject({ situacao: 'divergente', divergentes: 2 });
    const itens = await varios(
      `SELECT insumo_id, quantidade_esperada, quantidade_conferida, divergencia, unidade_medida_id
         FROM conferencia_recebimento_item WHERE conferencia_recebimento_id = ? ORDER BY sequencia`,
      [r.id],
    );
    expect(
      itens.map((i) => [
        Number(i['insumo_id']),
        Number(i['quantidade_esperada']),
        Number(i['quantidade_conferida']),
        i['divergencia'],
      ]),
    ).toEqual([
      [m.insumo, 0, 5, 'produto_errado'],
      [m.insumoOpme, 2, 0, 'falta'],
    ]);
    expect(Number(itens[1]!['unidade_medida_id'])).toBeGreaterThan(0);
    expect(
      Number(
        (await um('SELECT pedido_compra_id FROM conferencia_recebimento WHERE id = ?', [r.id]))?.[
          'pedido_compra_id'
        ],
      ),
    ).toBeGreaterThan(0);
    // Divergente: a validação sem justificativa é recusada.
    expect(await codigoDe(conf.validar(c2, { id: r.id, justificativa: null }, k()))).toBe(
      'divergencia-sem-justificativa',
    );
  });
});
