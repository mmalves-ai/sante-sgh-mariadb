// Contrato de efeito do pedido de compra que nasce ligado ao contrato do fornecedor (05-SUP linha 27) contra o MariaDB
// real (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor do estoque, na MESMA transação
// da compra: o pedido aponta o contrato (pedido_compra.contrato_fornecedor_id), o histórico do contrato ganha o
// vínculo (ocorrencia_contrato, apontamento) e o saldo do contrato passa a contar o pedido; o contrato de outro
// fornecedor e o contrato vencido são recusados sem gravar nada (nem o pedido, nem a cotação); a vencedora da cotação
// do pedido ligado é só a proposta do fornecedor do contrato.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { CriarContratoEntrada } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaContratoPropria } from './contrato-porta-propria.js';
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
const PREFIXO_NUMERO = 'CTPC-';
const MOTIVO = `ctpc_${RODADA}`.slice(0, 30);
let k = 0;

/** Os contratos da massa (pelo número) e o que aponta para eles saem; o pedido fica sem contrato. */
async function limparContratos(e: Escritor): Promise<void> {
  const sub = `SELECT id FROM contrato_fornecedor WHERE numero LIKE '${PREFIXO_NUMERO}%'`;
  // 05-SUP linha 20: os cancelamentos da gestão dos pedidos ligados saem antes (os pedidos saem pelo limparMassa).
  const itens = `SELECT x.id FROM pedido_compra_item x JOIN pedido_compra p ON p.id = x.pedido_compra_id
                  WHERE p.contrato_fornecedor_id IN (${sub})`;
  await e.executar(
    `DELETE FROM cancelamento_pedido_compra_entrega WHERE cancelamento_pedido_compra_item_id IN
       (SELECT id FROM cancelamento_pedido_compra_item WHERE pedido_compra_item_id IN (${itens}))`,
    [],
  );
  await e.executar(
    `DELETE FROM cancelamento_pedido_compra_item WHERE pedido_compra_item_id IN (${itens})`,
    [],
  );
  await e.executar(
    `UPDATE pedido_compra SET contrato_fornecedor_id = NULL WHERE contrato_fornecedor_id IN (${sub})`,
    [],
  );
  for (const t of [
    'ocorrencia_contrato',
    'aditivo_contrato',
    'reajuste_contrato',
    'anexo_contrato',
    'garantia_contrato',
    'gestor_contrato',
  ])
    await e.executar(`DELETE FROM ${t} WHERE contrato_fornecedor_id IN (${sub})`, []);
  await e.executar(`DELETE FROM contrato_fornecedor WHERE numero LIKE '${PREFIXO_NUMERO}%'`, []);
}

describe.skipIf(SEM_BANCO)(
  'pedido de compra ligado ao contrato do fornecedor (MariaDB, cliente de teste do lote)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaSuprimentosPropria;
    let contratos: PortaContratoPropria;
    let m: MassaSuprimentos;
    let c: ContextoSuprimentos;
    let ctxContrato: ContextoPortaM18;
    let vigente = 0;
    let vencido = 0;
    let outroFornecedor = 0;
    let contrato50 = 0;
    let contrato70 = 0;
    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-ctpc' }, (l) => l.consultar<T>(sql, p));
    const op = (nome: string, entrada: unknown) =>
      porta.executar(c, `suprimentos.${nome}`, entrada, {
        ...c,
        chaveIdempotencia: `ctpc-${RODADA}-${++k}`,
      });
    const trilha = (r: unknown): TrilhaDaGravacao => ({
      estabelecimento: m.estA,
      usuario: m.usuario,
      acao: 'operacao',
      entidade: 'contrato_fornecedor',
      entidadeId: Number((r as { id?: number }).id ?? 0),
      dadosDepois: { evento: 'teste' },
      correlacao: 'ctpc',
    });
    const pedidos = async () =>
      Number(
        (
          await ler<{ n: number }>('SELECT COUNT(*) AS n FROM pedido_compra WHERE estabelecimento_id = ?', [
            m.estA,
          ])
        )[0]?.n,
      );

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-ctpc' }, limparContratos);
      m = await montarMassa(nucleo);
      porta = new PortaSuprimentosPropria(nucleo);
      contratos = new PortaContratoPropria(nucleo);
      c = { ...contexto(m, m.estA, 'ctpc') } as ContextoSuprimentos;
      ctxContrato = { cliente: CLIENTE, estabelecimento: m.estA, usuario: m.usuario, correlacao: 'ctpc' };
      const logins = await ler<{ id: number; login: string }>(
        'SELECT id, login FROM usuario WHERE id IN (?, ?)',
        [m.usuario2, m.usuario3],
      );
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-ctpc-indice' }, async (e) => {
        if (!(await e.uma("SELECT id FROM indice_reajuste WHERE codigo = 'IPCA'", [])))
          await e.inserir(
            "INSERT INTO indice_reajuste (codigo, descricao, criado_em) VALUES ('IPCA', 'IPCA (teste)', ?)",
            [new Date()],
          );
      });
      const ano = new Date().getFullYear();
      const base = (x: Partial<CriarContratoEntrada>): CriarContratoEntrada => ({
        chave: `ctpc-${RODADA}-${++k}`,
        numero: `${PREFIXO_NUMERO}${RODADA}-${k}`,
        fornecedor: m.fornecedor,
        tipo: 'fornecimento',
        objeto: 'Fornecimento fictício de material de teste',
        critico: false,
        inicio: `${ano - 1}-01-01`,
        fim: `${ano + 1}-12-31`,
        valor: 50_000,
        indiceReajuste: 'ipca',
        dataBase: `${ano - 1}-01-01`,
        garantia: 'nenhuma',
        garantiaValor: null,
        garantiaValidade: null,
        gestor: String(logins[0]!.login),
        fiscal: String(logins[1]!.login),
        centroCusto: null,
        observacao: 'Contrato fictício de teste',
        ...x,
      });
      const criar = async (x: Partial<CriarContratoEntrada>) =>
        (
          await contratos.gravarSgh(ctxContrato, trilha, (g) =>
            g.criar({ entrada: base(x), usuario: 'teste' }),
          )
        ).id;
      vigente = await criar({});
      vencido = await criar({ inicio: `${ano - 2}-01-01`, fim: `${ano - 1}-06-30` });
      outroFornecedor = await criar({ fornecedor: m.fornecedor2 });
      contrato50 = await criar({ valor: 50 });
      contrato70 = await criar({ valor: 70 });
    }, 120_000);

    afterAll(async () => {
      if (nucleo) {
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpa-ctpc' }, limparContratos);
        if (m) await limparMassa(nucleo, m);
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpa-ctpc-motivo' }, (e) =>
          e.executar(
            `DELETE FROM motivo_cancelamento_compra WHERE codigo = ? AND id NOT IN
               (SELECT motivo_cancelamento_compra_id FROM pedido_compra WHERE motivo_cancelamento_compra_id IS NOT NULL)
               AND id NOT IN (SELECT motivo_cancelamento_compra_id FROM pedido_compra_item
                               WHERE motivo_cancelamento_compra_id IS NOT NULL)`,
            [MOTIVO],
          ),
        );
        await nucleo.encerrar();
      }
    });

    it('o pedido nasce ligado ao contrato: aponta o contrato, o histórico registra o vínculo e o saldo conta o pedido', async () => {
      const r = await op('criarPedido', {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor],
        itens: [{ item: m.insumo, quantidade: 4 }],
        contrato: { contrato: vigente, excecao: null, pedidoDeOrigem: null },
      });
      expect(Number(r.resultado['contrato'])).toBe(vigente);
      const [p] = await ler<{ id: number; contrato: number | null }>(
        `SELECT id, contrato_fornecedor_id AS contrato FROM pedido_compra
          WHERE estabelecimento_id = ? AND ano = ? AND numero = ?`,
        [m.estA, Number(r.resultado['ano']), Number(r.resultado['doc'])],
      );
      expect(Number(p!.contrato)).toBe(vigente);
      const oc = await ler<{ tipo: string; dados: unknown; usuario: number }>(
        `SELECT tipo_ocorrencia AS tipo, dados, usuario_id AS usuario FROM ocorrencia_contrato
          WHERE contrato_fornecedor_id = ? AND JSON_VALUE(dados, '$.evento') = 'vinculo'`,
        [vigente],
      );
      expect(oc).toHaveLength(1);
      expect(oc[0]!.tipo).toBe('apontamento');
      expect(Number(oc[0]!.usuario)).toBe(m.usuario);
      const dados = typeof oc[0]!.dados === 'string' ? JSON.parse(oc[0]!.dados) : oc[0]!.dados;
      expect(dados).toMatchObject({ tipo: 'pedido', ids: [Number(p!.id)] });
      const det = await contratos.detalhar(ctxContrato, vigente);
      expect(det?.vinculos.some((v) => v.tipo === 'pedido' && [v.id, v.legado].includes(Number(p!.id)))).toBe(
        true,
      );
    });

    it('o contrato de outro fornecedor e o contrato vencido recusam sem gravar o pedido nem a cotação', async () => {
      const antes = await pedidos();
      expect(
        await codigoDe(
          op('criarPedido', {
            centroCusto: m.centroCusto,
            fornecedores: [m.fornecedor],
            itens: [{ item: m.insumo, quantidade: 2 }],
            contrato: { contrato: outroFornecedor, excecao: null, pedidoDeOrigem: null },
          }),
        ),
      ).toBe('fornecedor-diferente');
      expect(
        await codigoDe(
          op('criarPedido', {
            centroCusto: m.centroCusto,
            fornecedores: [m.fornecedor],
            itens: [{ item: m.insumo, quantidade: 2 }],
            contrato: { contrato: vencido, excecao: null, pedidoDeOrigem: null },
          }),
        ),
      ).toBe('contrato-vencido');
      expect(await pedidos()).toBe(antes);
      const oc = await ler<{ n: number }>(
        "SELECT COUNT(*) AS n FROM ocorrencia_contrato WHERE contrato_fornecedor_id IN (?, ?) AND JSON_VALUE(dados, '$.evento') = 'vinculo'",
        [outroFornecedor, vencido],
      );
      expect(Number(oc[0]!.n)).toBe(0);
    });

    it('a vencedora da cotação do pedido ligado é só a proposta do fornecedor do contrato', async () => {
      const r = await op('criarPedido', {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor, m.fornecedor2],
        itens: [{ item: m.insumo, quantidade: 3 }],
        contrato: { contrato: vigente, excecao: null, pedidoDeOrigem: null },
      });
      const pedido = { ano: Number(r.resultado['ano']), doc: Number(r.resultado['doc']) };
      const props = await ler<{ id: number; fornecedor: number }>(
        `SELECT cri.id, cf.empresa_fornecedora_id AS fornecedor
           FROM pedido_compra p
           JOIN cotacao_fornecedor cf ON cf.cotacao_id = p.cotacao_id
           JOIN cotacao_resposta_item cri ON cri.cotacao_fornecedor_id = cf.id
          WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.numero = ?`,
        [m.estA, pedido.ano, pedido.doc],
      );
      const doOutro = props.find((x) => Number(x.fornecedor) === m.fornecedor2)!;
      const doContrato = props.find((x) => Number(x.fornecedor) === m.fornecedor)!;
      await op('registrarProposta', { pedido, proposta: Number(doOutro.id), valorUnitario: 9 });
      await op('registrarProposta', { pedido, proposta: Number(doContrato.id), valorUnitario: 10 });
      expect(
        await codigoDe(
          op('definirVencedorCotacao', {
            pedido,
            item: m.insumo,
            seq: 1,
            vencedoras: [Number(doOutro.id)],
          }),
        ),
      ).toBe('fornecedor-diferente');
      const [v] = await ler<{ n: number }>(
        'SELECT COUNT(*) AS n FROM cotacao_resposta_item WHERE id IN (?, ?) AND vencedor',
        [Number(doOutro.id), Number(doContrato.id)],
      );
      expect(Number(v!.n)).toBe(0);
      await op('definirVencedorCotacao', {
        pedido,
        item: m.insumo,
        seq: 1,
        vencedoras: [Number(doContrato.id)],
        justificativa: 'Fornecedor do contrato vigente (teste fictício)',
      });
      const [w] = await ler<{ vencedor: number }>('SELECT vencedor FROM cotacao_resposta_item WHERE id = ?', [
        Number(doContrato.id),
      ]);
      expect(Number(w!.vencedor)).toBe(1);
    });

    it('05-SUP linha 20: o pedido ligado aprovado compromete o contrato; o cancelamento da gestão devolve ao saldo', async () => {
      const consumido = async () => (await contratos.detalhar(ctxContrato, vigente))!.saldoDetalhe.consumido;
      const antes = await consumido();
      const r = await op('criarPedido', {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor],
        itens: [{ item: m.insumo, quantidade: 10 }],
        contrato: { contrato: vigente, excecao: null, pedidoDeOrigem: null },
      });
      const ano = Number(r.resultado['ano']);
      const doc = Number(r.resultado['doc']);
      const pedido = { ano, doc };
      const [prop] = await ler<{ id: number }>(
        `SELECT cri.id FROM pedido_compra p
           JOIN cotacao_fornecedor cf ON cf.cotacao_id = p.cotacao_id
           JOIN cotacao_resposta_item cri ON cri.cotacao_fornecedor_id = cf.id
          WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.numero = ?`,
        [m.estA, ano, doc],
      );
      await op('registrarProposta', { pedido, proposta: Number(prop!.id), valorUnitario: 10 });
      await op('definirVencedorCotacao', {
        pedido,
        item: m.insumo,
        seq: 1,
        vencedoras: [Number(prop!.id)],
        justificativa: 'Fornecedor do contrato vigente (teste fictício)',
      });
      // Em cotação, o pedido ainda não compromete o contrato.
      expect(await consumido()).toBe(antes);
      const supervisor = { ...c, usuario: m.usuario3 } as ContextoSuprimentos;
      const aprovacao: TrilhaDaGravacao = {
        estabelecimento: m.estA,
        usuario: m.usuario3,
        acao: 'operacao',
        entidade: 'pedido_compra',
        entidadeId: null,
        dadosDepois: { evento: 'suprimentos.pedido.aprovado' },
        correlacao: null,
      };
      const ap = await porta.gravarSgh(supervisor, aprovacao, (g) =>
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
      expect(ap.valor).toBe(100);
      expect(await consumido()).toBe(antes + 100);

      const mot = await op('gravarMotivoCancelamentoCompra', {
        codigo: MOTIVO,
        descricao: 'Fornecedor sem estoque (teste)',
        aplicaPedido: true,
        aplicaItem: true,
        exigeJustificativa: true,
        ativo: true,
      });
      const motivo = Number(mot.resultado['id']);
      const [item] = await ler<{ id: number }>(
        `SELECT x.id FROM pedido_compra_item x JOIN pedido_compra p ON p.id = x.pedido_compra_id
          WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.numero = ?`,
        [m.estA, ano, doc],
      );
      await op('cancelarCompra', {
        pedido,
        item: Number(item!.id),
        quantidade: 4,
        motivo,
        justificativa: 'Fornecedor entrega só seis unidades',
      });
      // O cancelamento parcial devolve ao saldo 4 × R$ 10,00; o valor aprovado do pedido fica como foi aprovado.
      expect(await consumido()).toBe(antes + 60);
      const [pv] = await ler<{ valor_total: string; contrato: number }>(
        `SELECT valor_total, contrato_fornecedor_id AS contrato FROM pedido_compra
          WHERE estabelecimento_id = ? AND ano = ? AND numero = ?`,
        [m.estA, ano, doc],
      );
      expect(Number(pv!.valor_total)).toBe(100);
      expect(Number(pv!.contrato)).toBe(vigente);
      const gestao = await porta.gestaoPedido(c, ano, doc);
      expect(gestao?.pedido.contrato).toMatchObject({ id: vigente, valorComprometido: 60 });
      expect(gestao?.pedido.contrato?.numero.startsWith(PREFIXO_NUMERO)).toBe(true);
      const det = await contratos.detalhar(ctxContrato, vigente);
      expect(
        det?.vinculos.find((v) => v.tipo === 'pedido' && v.chaveNatural === `${ano}/${doc}`)?.valor,
      ).toBe(60);

      // O cancelamento do resto do pedido libera tudo; o vínculo fica no histórico, inativo.
      await op('cancelarCompra', {
        pedido,
        item: null,
        quantidade: null,
        motivo,
        justificativa: 'Compra desistida pela área (teste)',
      });
      expect(await consumido()).toBe(antes);
      const det2 = await contratos.detalhar(ctxContrato, vigente);
      const v2 = det2?.vinculos.find((v) => v.tipo === 'pedido' && v.chaveNatural === `${ano}/${doc}`);
      expect(v2).toMatchObject({ ativo: false, valor: 0 });
      const gestao2 = await porta.gestaoPedido(c, ano, doc);
      expect(gestao2?.pedido.contrato?.valorComprometido).toBe(0);
    });

    it('05-SUP linha 20: o pedido aprovado com cancelamentos, ligado depois, compromete o mesmo valor na lista, na conferência e no saldo', async () => {
      // Pedido sem vencedor na cotação (valorado pelos próprios itens): A 10 x R$ 10,00 e B 5 x R$ 8,00 (preços
      // sintéticos gravados no item). B é cancelado inteiro ANTES da aprovação: a aprovação vale só A (100). Depois, 4 de
      // A são cancelados: compromete 100 - 40 = 60 (B não é descontado de novo; a regra antiga dava 20).
      const r = await op('criarPedido', {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor],
        itens: [
          { item: m.insumo, quantidade: 10 },
          { item: m.insumoOpme, quantidade: 5 },
        ],
      });
      const ano = Number(r.resultado['ano']);
      const doc = Number(r.resultado['doc']);
      const pedido = { ano, doc };
      const itens = await ler<{ id: number; sequencia: number; pedido: number }>(
        `SELECT x.id, x.sequencia, p.id AS pedido FROM pedido_compra_item x JOIN pedido_compra p ON p.id = x.pedido_compra_id
          WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.numero = ? ORDER BY x.sequencia`,
        [m.estA, ano, doc],
      );
      const [a, b] = itens.map((x) => Number(x.id));
      const pedidoId = Number(itens[0]!.pedido);
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-ctpc-precos' }, async (e) => {
        await e.executar(
          'UPDATE pedido_compra_item SET valor_unitario = 10, valor_total = 100 WHERE id = ?',
          [a],
        );
        await e.executar('UPDATE pedido_compra_item SET valor_unitario = 8, valor_total = 40 WHERE id = ?', [
          b,
        ]);
      });
      const [jaTem] = await ler<{ id: number }>(
        'SELECT id FROM motivo_cancelamento_compra WHERE codigo = ?',
        [MOTIVO],
      );
      const motivo = jaTem
        ? Number(jaTem.id)
        : Number(
            (
              await op('gravarMotivoCancelamentoCompra', {
                codigo: MOTIVO,
                descricao: 'Fornecedor sem estoque (teste)',
                aplicaPedido: true,
                aplicaItem: true,
                exigeJustificativa: true,
                ativo: true,
              })
            ).resultado['id'],
          );
      await op('cancelarCompra', {
        pedido,
        item: b,
        quantidade: null,
        motivo,
        justificativa: 'Item retirado antes da aprovação (teste)',
      });
      const supervisor = { ...c, usuario: m.usuario3 } as ContextoSuprimentos;
      const ap = await porta.gravarSgh(
        supervisor,
        {
          estabelecimento: m.estA,
          usuario: m.usuario3,
          acao: 'operacao',
          entidade: 'pedido_compra',
          entidadeId: null,
          dadosDepois: { evento: 'suprimentos.pedido.aprovado' },
          correlacao: null,
        },
        (g) =>
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
      expect(ap.valor).toBe(100);
      await op('cancelarCompra', {
        pedido,
        item: a,
        quantidade: 4,
        motivo,
        justificativa: 'Fornecedor entrega só seis unidades',
      });

      // A lista de candidatos mostra o que o pedido vai comprometer (60), não o valor aprovado cru (100).
      const cand = await contratos.candidatos(ctxContrato, contrato70);
      expect(cand?.find((x) => x.tipo === 'pedido' && x.ids[0] === pedidoId)?.valor).toBe(60);
      // A conferência compara os mesmos 60 com o saldo: o contrato de 50 recusa sem gravar; o de 70 aceita.
      const vincular = (contrato: number, chave: string) =>
        contratos.gravarSgh(ctxContrato, trilha, (g) =>
          g.vincular({
            contrato: { contrato, excecao: null, pedidoDeOrigem: null },
            tipo: 'pedido',
            ids: [pedidoId],
            usuario: 'teste',
            chave: `ctpc-${RODADA}-${chave}`,
          }),
        );
      await expect(vincular(contrato50, 'v50')).rejects.toThrow(/maior que o saldo/);
      const [semContrato] = await ler<{ contrato: number | null }>(
        'SELECT contrato_fornecedor_id AS contrato FROM pedido_compra WHERE id = ?',
        [pedidoId],
      );
      expect(semContrato!.contrato).toBeNull();
      const v = await vincular(contrato70, 'v70');
      expect(v).toMatchObject({ saldoAntes: 70, saldoDepois: 10 });
      const det = await contratos.detalhar(ctxContrato, contrato70);
      expect(det?.vinculos.find((x) => x.tipo === 'pedido' && x.id === pedidoId)?.valor).toBe(60);
      expect(det?.saldoDetalhe.consumido).toBe(60);
      const gestao = await porta.gestaoPedido(c, ano, doc);
      expect(gestao?.pedido.contrato).toMatchObject({ id: contrato70, valorComprometido: 60 });
    });
  },
);
