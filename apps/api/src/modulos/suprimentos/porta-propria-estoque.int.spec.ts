// Integração das leituras e gravações do estoque (F2.4) na porta própria contra o MariaDB real (cliente de teste do
// lote, SGH_CLIENTE_TESTE; massa SINTÉTICA, nenhuma pessoa real). Contrato de efeito pelo Executor: requisição,
// autorização e saída que a atende (lote que vence primeiro, saldo e custo), devolução pelo custo e lote da saída,
// transferência direta e por envio (recebimento parcial: divergente; cancelamento), nota de entrada com lote novo e
// custo médio, desconsolidação, pedido com cotação, proposta, vencedor e aprovação, ponto de pedido, conferência do
// carrinho, balanço do inventário, fechamento e reabertura do mês e saneamento da validade; recusas sem gravar e o
// isolamento por estabelecimento. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
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
let k = 0;

describe.skipIf(SEM_BANCO)('estoque na porta própria (MariaDB, cliente de teste do lote)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSuprimentosPropria;
  let m: MassaSuprimentos;
  let c: ContextoSuprimentos;
  let hoje: string;
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f24-estoque' }, (l) => l.consultar<T>(sql, p));
  const op = (nome: string, entrada: unknown, ctx: ContextoSuprimentos = c) =>
    porta.executar(ctx, `suprimentos.${nome}`, entrada, {
      ...ctx,
      chaveIdempotencia: `f24e-${RODADA}-${++k}`,
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
  const saldo = async (local: number) =>
    Number(
      (
        await ler<{ q: unknown }>(
          'SELECT quantidade AS q FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?',
          [local, m.insumo],
        )
      )[0]?.q ?? 0,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaSuprimentosPropria(nucleo);
    c = { ...contexto(m, m.estA, 'f24-estoque') } as ContextoSuprimentos;
    hoje = (await porta.relogio(c)).hoje;
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await limparMassa(nucleo, m);
      await nucleo.encerrar();
    }
  });

  it('leituras do cadastro e do escopo: busca, ficha, escopo, fornecedores, kits e isolamento', async () => {
    const busca = await porta.buscarItens(c, 'ITEM SINTETICO M');
    expect(busca.find((x) => x.codigo === m.insumo)).toMatchObject({ rastreavel: true, ativo: true });
    expect(await porta.fichaItem(c, m.insumo)).toMatchObject({ item: m.insumo, grupo: { codigo: m.grupo } });
    const login = (await ler<{ login: string }>('SELECT login FROM usuario WHERE id = ?', [m.usuario]))[0]!
      .login;
    const esc = await porta.escopo(c, login);
    expect(esc?.flags).toMatchObject({
      autorizarRequisicao: true,
      autorizarPedido: true,
      desbloquearFechamento: true,
    });
    expect(esc?.locais.map((x) => x.local).sort()).toEqual([m.localA, m.localA2].sort());
    expect((await porta.fornecedores(c, 'FORNECEDOR A')).itens[0]).toMatchObject({
      codigo: m.fornecedor,
      pessoa: 'J',
      documentoValido: true,
    });
    expect((await porta.kits(c, hoje, 30)).map((x) => x.id)).toEqual([m.kit]);
    // Outro estabelecimento não vê o carrinho nem o escopo.
    expect(await porta.kits({ ...c, estabelecimento: m.estB } as ContextoSuprimentos, hoje, 30)).toEqual([]);
    expect(
      (await porta.escopo({ ...c, estabelecimento: m.estB } as ContextoSuprimentos, login))?.locais,
    ).toEqual([]);
  });

  it('requisição, autorização e saída que a atende: lote, saldo, custo, documento e devolução', async () => {
    const req = await op('requisitarMaterial', {
      destino: 2,
      local: m.localA,
      centroCusto: m.centroCusto,
      localConsumo: 1,
      itens: [{ item: m.insumo, quantidade: 3 }],
    });
    const chaveReq = {
      ano: Number(req.resultado['ano']),
      mes: Number(req.resultado['mes']),
      doc: Number(req.resultado['doc']),
    };
    const pend = await porta.requisicoes(c, { local: m.localA, hoje });
    expect(pend.itens.find((x) => x.id === req.resultado['id'])?.itens[0]).toMatchObject({
      item: m.insumo,
      quantidade: 3,
      saldoLocal: 10,
    });
    await porta.gravarSgh(c, trilha('suprimentos.requisicao.autorizada', 'requisicao_material'), (g) =>
      g.autorizarRequisicao({ ...chaveReq, usuario: 'x' }),
    );
    expect(
      await codigoDe(
        porta.gravarSgh(c, trilha('suprimentos.requisicao.autorizada', 'requisicao_material'), (g) =>
          g.autorizarRequisicao({ ...chaveReq, usuario: 'x' }),
        ),
      ),
    ).toBe('requisicao-autorizada');
    // Saldo insuficiente: recusa, nada gravado.
    expect(
      await codigoDe(
        op('registrarSaida', {
          destino: 2,
          local: m.localA,
          centroCusto: m.centroCusto,
          localConsumo: 1,
          itens: [{ item: m.insumo, quantidade: 50 }],
        }),
      ),
    ).toBe('saldo-insuficiente');
    expect(await saldo(m.localA)).toBe(10);
    const s = await op('registrarSaida', {
      destino: 2,
      local: m.localA,
      centroCusto: m.centroCusto,
      localConsumo: 1,
      requisicao: Number(req.resultado['id']),
      itens: [{ item: m.insumo, quantidade: 3 }],
    });
    expect(s.repetida).toBe(false);
    expect(await saldo(m.localA)).toBe(7);
    const chave = {
      ano: Number(s.resultado['ano']),
      mes: Number(s.resultado['mes']),
      doc: Number(s.resultado['doc']),
    };
    const doc = await porta.documento(c, 'saida', chave);
    expect(doc).toMatchObject({ destino: 2, centroCusto: m.centroCusto, consolidado: true, valor: 7.5 });
    expect(doc?.itensDetalhe[0]?.lotes).toEqual([expect.objectContaining({ id: m.lote, quantidade: 3 })]);
    const [rm] = await ler<{ situacao: string }>('SELECT situacao FROM requisicao_material WHERE id = ?', [
      req.resultado['id'],
    ]);
    expect(rm?.situacao).toBe('atendida');
    const [tri] = await ler<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'documento_estoque' AND entidade_id = ?",
      [s.resultado['id']],
    );
    expect(Number(tri?.n)).toBe(1);
    // Devolução de 1 pelo custo e pelo lote da saída.
    const dv = await op('registrarDevolucao', {
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
    expect(await saldo(m.localA)).toBe(8);
    expect((await porta.documento(c, 'saida', chave))?.itensDetalhe[0]?.devolvido).toBe(1);
    expect(
      await codigoDe(
        op('registrarDevolucao', {
          saida: Number(s.resultado['id']),
          local: m.localA,
          itens: [
            {
              lancamentoSaida: doc!.itensDetalhe[0]!.id,
              item: m.insumo,
              quantidade: 5,
              lotes: [{ loteSaida: m.lote, quantidade: 5 }],
            },
          ],
        }),
      ),
    ).toBe('devolucao-acima');
    expect(
      (await porta.documentos(c, { tipo: 'devolucao', inicio: hoje, fim: hoje })).itens.map((x) => x.id),
    ).toContain(dv.resultado['id']);
    const r = await porta.rastreio(c, m.insumo, `${m.marca}L1`);
    expect(r.movimentos.map((x) => x.tipo)).toEqual(['saida', 'devolucao']);
    const cons = await porta.consumo(c, { ano: chave.ano, mes: chave.mes });
    expect(cons.porCentroCusto[0]).toMatchObject({ centroCusto: m.centroCusto, quantidade: 2, valor: 5 });
  });

  it('transferência direta e por envio (parcial: divergente; cancelamento devolve nada)', async () => {
    const antesA = await saldo(m.localA);
    await op('transferir', {
      origem: m.localA,
      destino: m.localA2,
      itens: [{ item: m.insumo, quantidade: 1, lotes: [] }],
    });
    expect(await saldo(m.localA)).toBe(antesA - 1);
    const env = await porta.gravarSgh(
      c,
      trilha('suprimentos.transferencia.enviada', 'documento_estoque'),
      (g) =>
        g.enviarTransferencia({
          origem: m.localA,
          destino: m.localA2,
          observacao: null,
          itens: [{ item: m.insumo, quantidade: 2, lotes: [] }],
          usuario: 'x',
        }),
    );
    expect(await saldo(m.localA)).toBe(antesA - 1);
    expect((await porta.transferencias(c, { etapa: 'enviada' })).map((x) => x.id)).toContain(env);
    await op('transferir', {
      origem: m.localA,
      destino: m.localA2,
      envio: env,
      itens: [{ item: m.insumo, quantidade: 1, lotes: [] }],
    });
    expect((await porta.transferencias(c, {})).find((x) => x.id === env)).toMatchObject({
      etapa: 'divergente',
      itens: [expect.objectContaining({ quantidade: 2, recebida: 1 })],
    });
    expect(await saldo(m.localA)).toBe(antesA - 2);
    const env2 = await porta.gravarSgh(
      c,
      trilha('suprimentos.transferencia.enviada', 'documento_estoque'),
      (g) =>
        g.enviarTransferencia({
          origem: m.localA,
          destino: m.localA2,
          observacao: null,
          itens: [{ item: m.insumo, quantidade: 1, lotes: [] }],
          usuario: 'x',
        }),
    );
    await porta.gravarSgh(c, trilha('suprimentos.transferencia.cancelada', 'documento_estoque'), (g) =>
      g.cancelarTransferencia({ id: env2, motivo: 'Teste de cancelamento', usuario: 'x' }),
    );
    expect((await porta.envio(c, env2))?.etapa).toBe('cancelada');
    expect(await saldo(m.localA)).toBe(antesA - 2);
  });

  it('nota de entrada com lote novo e custo médio; histórico; desconsolidação', async () => {
    const antes = await saldo(m.localA);
    const custo = async () =>
      Number(
        (
          await ler<{ c: unknown }>(
            'SELECT custo_medio AS c FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ? AND excluido_em IS NULL',
            [m.localA, m.insumo],
          )
        )[0]?.c,
      );
    const custoAntes = await custo();
    const nf = await op('registrarEntradaNF', {
      fornecedor: m.fornecedor,
      numero: Number(RODADA.replace(/\D/g, '').slice(-6) || '1'),
      emissao: hoje,
      local: m.localA,
      frete: 2,
      itens: [
        {
          item: m.insumo,
          quantidade: 4,
          valorUnitario: 5,
          lotes: [{ lote: `${m.marca}L2`, validade: '2028-01-31', quantidade: 4 }],
        },
      ],
    });
    expect(await saldo(m.localA)).toBe(antes + 4);
    const h = await porta.historicoCompras(c, m.insumo);
    expect(h.compras[0]).toMatchObject({ fornecedor: m.fornecedor, quantidade: 4, unitario: 5, custo: 5.5 });
    const chave = {
      ano: Number(nf.resultado['ano']),
      mes: Number(nf.resultado['mes']),
      doc: Number(nf.resultado['doc']),
    };
    expect((await porta.documento(c, 'nota', chave))?.itensDetalhe[0]?.lotes[0]).toMatchObject({
      lote: `${m.marca}L2`,
      quantidade: 4,
    });
    await op('desconsolidarDocumento', {
      tipo: 'nota',
      documento: Number(nf.resultado['id']),
      motivo: 'Nota lançada no local errado',
    });
    expect(await saldo(m.localA)).toBe(antes);
    // O estorno tira o valor que a nota pôs (não o custo médio de depois): o custo médio volta ao de antes da nota.
    expect(await custo()).toBeCloseTo(custoAntes, 3);
    expect((await porta.documento(c, 'nota', chave))?.consolidado).toBe(false);
  });

  it('pedido com cotação: proposta, vencedor com justificativa, aprovação por alçada e leitura', async () => {
    const p = await op('criarPedido', {
      centroCusto: m.centroCusto,
      fornecedores: [m.fornecedor, m.fornecedor2],
      itens: [{ item: m.insumo, quantidade: 10 }],
    });
    const ano = Number(p.resultado['ano']);
    const doc = Number(p.resultado['doc']);
    const lido = await porta.pedido(c, ano, doc);
    expect(lido?.propostas).toHaveLength(2);
    const [a, b] = lido!.propostas;
    await op('registrarProposta', { pedido: { ano, doc }, proposta: a!.id, valorUnitario: 3 });
    await op('registrarProposta', { pedido: { ano, doc }, proposta: b!.id, valorUnitario: 2 });
    expect(
      await codigoDe(
        op('definirVencedorCotacao', { pedido: { ano, doc }, item: m.insumo, seq: 1, vencedoras: [a!.id] }),
      ),
    ).toBe('sem-justificativa');
    await op('definirVencedorCotacao', {
      pedido: { ano, doc },
      item: m.insumo,
      seq: 1,
      vencedoras: [a!.id],
      justificativa: 'Prazo de entrega melhor',
    });
    // Quem fez o pedido não o aprova (segregação); o supervisor, com a alçada no local, aprova.
    const supervisor = { ...c, usuario: m.usuario3 } as ContextoSuprimentos;
    expect(
      await codigoDe(
        porta.gravarSgh(c, trilha('suprimentos.pedido.aprovado', 'pedido_compra'), (g) =>
          g.aprovarPedido({
            ano,
            doc,
            decisao: 'aprovado',
            justificativa: '',
            usuario: 'x',
            nivel: 3,
            faixas: [{ ate: Number.POSITIVE_INFINITY, nivel: 1 }],
          }),
        ),
      ),
    ).toBe('aprovador-solicitante');
    const r = await porta.gravarSgh(supervisor, trilha('suprimentos.pedido.aprovado', 'pedido_compra'), (g) =>
      g.aprovarPedido({
        ano,
        doc,
        decisao: 'aprovado',
        justificativa: '',
        usuario: 'x',
        nivel: 3,
        faixas: [{ ate: Number.POSITIVE_INFINITY, nivel: 1 }],
      }),
    );
    expect(r.valor).toBe(30);
    const depois = await porta.pedido(c, ano, doc);
    expect(depois).toMatchObject({ situacao: 5, valor: { total: 30 }, aprovacao: { decisao: 'aprovado' } });
    expect(depois?.propostas.find((x) => x.id === a!.id)?.vencedor).toBe('T');
    expect((await porta.emPedidoPorItem(c, ano)).get(m.insumo)).toBe(10);
  });

  it('ponto de pedido, carrinho, balanço do inventário, fechamento e reabertura, validade suspeita', async () => {
    await porta.gravarSgh(c, trilha('suprimentos.ponto_pedido.definido', 'parametro_reposicao'), (g) =>
      g.definirPontoPedido({
        item: m.insumo,
        local: m.localA,
        prazoDias: 5,
        estoqueSeguranca: 2,
        usuario: 'x',
      }),
    );
    expect((await porta.pontosPedido(c, m.localA)).get(`${m.insumo}:${m.localA}`)).toEqual({
      prazoDias: 5,
      estoqueSeguranca: 2,
    });
    expect(
      await codigoDe(
        porta.gravarSgh(c, trilha('suprimentos.carrinho.conferido', 'kit_rastreavel'), (g) =>
          g.conferirCarrinho({ kit: m.kit, lacre: 'L-1', conferidos: [], pendencias: null, usuario: 'x' }),
        ),
      ),
    ).toBe('sem-pendencia');
    await porta.gravarSgh(c, trilha('suprimentos.carrinho.conferido', 'kit_rastreavel'), (g) =>
      g.conferirCarrinho({
        kit: m.kit,
        lacre: 'L-1',
        conferidos: [m.kitItem],
        pendencias: null,
        usuario: 'x',
      }),
    );
    expect((await porta.kit(c, m.kit, hoje, 30))?.conferencia).toMatchObject({
      lacre: 'L-1',
      completa: true,
    });
    // Inventário aprovado de um local com a contagem informada (o item da massa controla lote).
    const como = (u: number) => ({ ...c, usuario: u }) as ContextoSuprimentos;
    const inventariar = async (local: number, quantidade: number) => {
      const id = await porta.gravarSgh(
        c,
        trilha('suprimentos.inventario.aberto', 'inventario_estoque'),
        (g) =>
          g.abrirInventario({
            local,
            tipo: 'ciclico',
            limitePct: 100,
            itens: [{ item: m.insumo, saldo: 0 }],
            usuario: 'x',
          }),
      );
      await porta.gravarSgh(
        como(m.usuario2),
        trilha('suprimentos.inventario.contado', 'inventario_estoque_item'),
        (g) => g.registrarContagem({ inventario: id, item: m.insumo, quantidade, usuario: 'x' }),
      );
      await porta.gravarSgh(c, trilha('suprimentos.inventario.decidido', 'inventario_estoque'), (g) =>
        g.decidirInventario({
          inventario: id,
          decisao: 'aprovado',
          justificativa: '',
          usuario: 'x',
          podeAprovar: true,
        }),
      );
      return id;
    };
    // Sobra de item com lote: a contagem não guarda o lote, então o acerto recusa e nada muda no saldo.
    const baseA = await saldo(m.localA);
    const invSobra = await inventariar(m.localA, baseA + 2);
    expect(await codigoDe(op('registrarBalanco', { inventario: invSobra }))).toBe('sobra-sem-lote');
    expect(await saldo(m.localA)).toBe(baseA);
    // Falta no local A2 (saldo do item: 4 + as transferências): balanço de saída pelos lotes que vencem primeiro.
    const base = await saldo(m.localA2);
    const inv = await inventariar(m.localA2, base - 1);
    const bal = await op('registrarBalanco', { inventario: inv });
    expect(await saldo(m.localA2)).toBe(base - 1);
    expect(await codigoDe(op('registrarBalanco', { inventario: inv }))).toBe('balanco-gravado');
    expect((await porta.inventario(c, inv, false))?.balanco).toEqual({
      ano: bal.resultado['ano'],
      mes: bal.resultado['mes'],
      doc: bal.resultado['doc'],
    });
    // Fechamento: só o próximo da fila (o seguinte ao fechado da massa); reabertura com motivo.
    const f = await porta.fechamentos(c, { ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) });
    expect(await codigoDe(op('fecharMes', { ano: f.proximo.ano + 1, mes: f.proximo.mes }))).toBe(
      'fora-de-ordem',
    );
    if (f.proximo.ano * 100 + f.proximo.mes < Number(hoje.slice(0, 4)) * 100 + Number(hoje.slice(5, 7))) {
      await op('fecharMes', f.proximo);
      expect((await porta.fechamentos(c, f.proximo)).fechados.map((x) => `${x.ano}-${x.mes}`)).toContain(
        `${f.proximo.ano}-${f.proximo.mes}`,
      );
      await op('reabrirMes', { ...f.proximo, motivo: 'Correção de lançamento do teste' });
      expect((await porta.fechamentos(c, f.proximo)).ocorrencias[0]).toMatchObject({
        tipo: 'reabertura-mes',
      });
    }
    expect(
      await codigoDe(
        op('corrigirValidadeLote', {
          lote: m.lote,
          validade: '2027-04-30',
          motivo: 'Validade digitada errada',
        }),
      ),
    ).toBe('validade-correta');
    await op('corrigirValidadeLote', {
      lote: m.loteSuspeito,
      validade: '2027-03-31',
      motivo: 'Validade digitada errada',
    });
    const [l] = await ler<{ validade: unknown; validade_original: unknown }>(
      'SELECT validade, validade_original FROM lote_insumo WHERE id = ?',
      [m.loteSuspeito],
    );
    expect(String(l?.validade_original)).toContain('1927');
  });
});
