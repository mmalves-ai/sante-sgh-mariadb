// Contrato de efeito da gestão do pedido de compra emitido (F3.6, 05-SUP linha 20) contra o MariaDB real (cliente de
// teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: programa as entregas de um item (e reprograma:
// a agenda antiga sai com marca de exclusão, nada apagado), recusa passar do pedido; registra o contato com o
// fornecedor e o seguimento; cadastra o motivo; cancela parte do item (a agenda abate da entrega mais distante), recusa
// o motivo que exige justificativa sem ela; cada cancelamento parcial vira um evento próprio com motivo, justificativa,
// quem e quando, e as entregas abatidas apontam para ele; cancela o pedido inteiro (situação, data, motivo e
// justificativa) e recusa cancelar de novo; a mesma chave repetida não grava duas vezes. O recebimento pela nota do
// pedido abate a agenda da entrega mais antiga, e a entrega com recebimento sobrevive à reprogramação.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
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
const MOTIVO = `f36pg_${RODADA}`.slice(0, 30);
let k = 0;

describe.skipIf(SEM_BANCO)(
  'gestão do pedido de compra na porta própria (MariaDB, cliente de teste do lote)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaSuprimentosPropria;
    let m: MassaSuprimentos;
    let c: ContextoSuprimentos;
    let ano = 0;
    let doc = 0;
    let pedidoId = 0;
    let itemId = 0;
    let motivo = 0;
    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f36-pg' }, (l) => l.consultar<T>(sql, p));
    const op = (nome: string, entrada: unknown, chave = `f36pg-${RODADA}-${++k}`) =>
      porta.executar(c, `suprimentos.${nome}`, entrada, { ...c, chaveIdempotencia: chave });

    const limparGestao = async (e: Escritor) => {
      const itens =
        'SELECT x.id FROM pedido_compra_item x JOIN pedido_compra p ON p.id = x.pedido_compra_id WHERE p.estabelecimento_id IN (?, ?)';
      await e.executar(
        `DELETE FROM cancelamento_pedido_compra_entrega WHERE cancelamento_pedido_compra_item_id IN (SELECT id FROM cancelamento_pedido_compra_item WHERE pedido_compra_item_id IN (${itens}))`,
        [m.estA, m.estB],
      );
      await e.executar(
        `DELETE FROM cancelamento_pedido_compra_item WHERE pedido_compra_item_id IN (${itens})`,
        [m.estA, m.estB],
      );
      await e.executar(`DELETE FROM pedido_compra_entrega WHERE pedido_compra_item_id IN (${itens})`, [
        m.estA,
        m.estB,
      ]);
      await e.executar(
        'DELETE FROM pedido_compra_acompanhamento WHERE pedido_compra_id IN (SELECT id FROM pedido_compra WHERE estabelecimento_id IN (?, ?))',
        [m.estA, m.estB],
      );
    };

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassa(nucleo);
      porta = new PortaSuprimentosPropria(nucleo);
      c = { ...contexto(m, m.estA, 'f36-pg') } as ContextoSuprimentos;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f36-pg' }, (e) => limparGestao(e));
      const p = await op('criarPedido', {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor],
        itens: [{ item: m.insumo, quantidade: 10 }],
      });
      ano = Number(p.resultado['ano']);
      doc = Number(p.resultado['doc']);
      const [r] = await ler<{ id: number; item: number }>(
        `SELECT p.id, x.id AS item FROM pedido_compra p JOIN pedido_compra_item x ON x.pedido_compra_id = p.id
        WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.numero = ?`,
        [m.estA, ano, doc],
      );
      pedidoId = Number(r!.id);
      itemId = Number(r!.item);
    }, 120_000);

    afterAll(async () => {
      if (nucleo) {
        if (m)
          await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpa-f36-pg' }, async (e) => {
            await limparGestao(e);
            // A nota do pedido sai antes dos pedidos (limparMassa apaga os pedidos do estabelecimento).
            await e.executar(
              'DELETE FROM nota_entrada_item WHERE pedido_compra_item_id IN (SELECT x.id FROM pedido_compra_item x JOIN pedido_compra p ON p.id = x.pedido_compra_id WHERE p.estabelecimento_id IN (?, ?))',
              [m.estA, m.estB],
            );
          });
        await limparMassa(nucleo, m);
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpa-f36-pg-motivo' }, (e) =>
          e.executar(
            'DELETE FROM motivo_cancelamento_compra WHERE codigo LIKE ? AND id NOT IN (SELECT motivo_cancelamento_compra_id FROM pedido_compra WHERE motivo_cancelamento_compra_id IS NOT NULL)',
            [`${MOTIVO}%`],
          ),
        );
        await nucleo.encerrar();
      }
    });

    const depois = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
    const entregas = () =>
      ler<{
        id: number;
        quantidade: string;
        quantidade_cancelada: string;
        excluido_em: unknown;
        motivo: number | null;
      }>(
        `SELECT id, quantidade, quantidade_cancelada, excluido_em, motivo_cancelamento_compra_id AS motivo
         FROM pedido_compra_entrega WHERE pedido_compra_item_id = ? ORDER BY sequencia`,
        [itemId],
      );

    it('programa as entregas do item, reprograma sem apagar e recusa passar do pedido', async () => {
      const pedido = { ano, doc };
      await op('programarEntregasPedido', {
        pedido,
        item: itemId,
        entregas: [{ dataPrevista: depois(5), dataLimite: null, quantidade: 10 }],
      });
      await op('programarEntregasPedido', {
        pedido,
        item: itemId,
        entregas: [
          { dataPrevista: depois(3), dataLimite: depois(4), quantidade: 6 },
          { dataPrevista: depois(20), dataLimite: null, quantidade: 4 },
        ],
      });
      const e = await entregas();
      expect(e).toHaveLength(3);
      expect(e[0]!.excluido_em).not.toBeNull();
      expect(e.filter((x) => x.excluido_em === null).map((x) => Number(x.quantidade))).toEqual([6, 4]);
      const [item] = await ler<{ data_prevista_entrega: unknown }>(
        'SELECT data_prevista_entrega FROM pedido_compra_item WHERE id = ?',
        [itemId],
      );
      expect(item!.data_prevista_entrega).not.toBeNull();
      expect(
        await codigoDe(
          op('programarEntregasPedido', {
            pedido,
            item: itemId,
            entregas: [{ dataPrevista: depois(2), dataLimite: null, quantidade: 11 }],
          }),
        ),
      ).toBe('entrega-acima-do-pedido');
      const trilha = await ler<{ n: number }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'pedido_compra_entrega' AND entidade_id = ?",
        [e[1]!.id],
      );
      expect(Number(trilha[0]!.n)).toBeGreaterThan(0);
    });

    it('registra o contato com o fornecedor e o seguimento, sempre linha nova', async () => {
      const pedido = { ano, doc };
      const base = {
        pedido,
        contatoNome: 'CONTATO SINTETICO',
        contatoTelefone: '1130000000',
        contatoEmail: 'contato@exemplo.invalid',
        previsaoEntrega: depois(4),
        situacao: 'pendente_fornecedor',
        andamento: 'Fornecedor confirmou a primeira entrega',
        anterior: null,
      };
      const a = await op('acompanharPedido', base);
      const primeiro = Number(a.resultado['acompanhamento']);
      await op('acompanharPedido', {
        ...base,
        situacao: 'em_dia',
        andamento: 'Confirmado de novo',
        anterior: primeiro,
      });
      const linhas = await ler<{
        operacao: string;
        usuario_id: number;
        acompanhamento_anterior_id: number | null;
      }>(
        'SELECT operacao, usuario_id, acompanhamento_anterior_id FROM pedido_compra_acompanhamento WHERE pedido_compra_id = ? ORDER BY id',
        [pedidoId],
      );
      expect(linhas).toHaveLength(2);
      expect(linhas.every((l) => l.operacao === 'inclusao' && Number(l.usuario_id) === m.usuario)).toBe(true);
      expect(Number(linhas[1]!.acompanhamento_anterior_id)).toBe(primeiro);
      expect(await codigoDe(op('acompanharPedido', { ...base, previsaoEntrega: '2000-01-01' }))).toBe(
        'previsao-antes-do-pedido',
      );
    });

    it('cadastra o motivo, cancela parte do item (agenda da mais distante) e depois o pedido inteiro', async () => {
      const pedido = { ano, doc };
      const g = await op('gravarMotivoCancelamentoCompra', {
        codigo: MOTIVO,
        descricao: 'Fornecedor sem estoque',
        aplicaPedido: true,
        aplicaItem: true,
        exigeJustificativa: true,
        ativo: true,
      });
      motivo = Number(g.resultado['id']);
      expect(
        await codigoDe(
          op('gravarMotivoCancelamentoCompra', {
            codigo: MOTIVO,
            descricao: 'Outro',
            aplicaPedido: true,
            aplicaItem: false,
            exigeJustificativa: false,
            ativo: true,
          }),
        ),
      ).toBe('motivo-codigo-duplicado');
      expect(
        await codigoDe(
          op('cancelarCompra', { pedido, item: itemId, quantidade: 3, motivo, justificativa: null }),
        ),
      ).toBe('justificativa-obrigatoria');
      const chave = `f36pg-${RODADA}-parcial`;
      const parcial = {
        pedido,
        item: itemId,
        quantidade: 5,
        motivo,
        justificativa: 'Fornecedor só entrega metade',
      };
      await op('cancelarCompra', parcial, chave);
      const repetida = await op('cancelarCompra', parcial, chave);
      expect(repetida.repetida).toBe(true);
      const [it1] = await ler<{ quantidade_cancelada: string; cancelado_em: unknown }>(
        'SELECT quantidade_cancelada, cancelado_em FROM pedido_compra_item WHERE id = ?',
        [itemId],
      );
      expect(Number(it1!.quantidade_cancelada)).toBe(5);
      expect(it1!.cancelado_em).toBeNull();
      const vivas = (await entregas()).filter((x) => x.excluido_em === null);
      // A entrega mais distante (4) sai inteira; a mais próxima (6) perde 1.
      expect(vivas.map((x) => Number(x.quantidade_cancelada))).toEqual([1, 4]);
      expect(vivas[1]!.motivo).toBe(motivo);
      // Um segundo cancelamento parcial: o rastro do primeiro fica; cada um é um evento com motivo e justificativa.
      await op('cancelarCompra', {
        pedido,
        item: itemId,
        quantidade: 1,
        motivo,
        justificativa: 'Mais uma unidade em falta',
      });
      const eventos = await ler<{
        id: number;
        abrangencia: string;
        quantidade: string;
        motivo: number;
        justificativa: string;
        usuario_id: number;
        ocorrido_em: unknown;
      }>(
        `SELECT id, abrangencia, quantidade, motivo_cancelamento_compra_id AS motivo, justificativa, usuario_id,
                ocorrido_em FROM cancelamento_pedido_compra_item WHERE pedido_compra_item_id = ? ORDER BY id`,
        [itemId],
      );
      expect(eventos.map((x) => [x.abrangencia, Number(x.quantidade), x.justificativa])).toEqual([
        ['item', 5, 'Fornecedor só entrega metade'],
        ['item', 1, 'Mais uma unidade em falta'],
      ]);
      expect(eventos.every((x) => Number(x.motivo) === motivo && Number(x.usuario_id) === m.usuario)).toBe(
        true,
      );
      expect(eventos.every((x) => x.ocorrido_em !== null)).toBe(true);
      const abatidas = await ler<{ cancelamento: number; entrega: number; quantidade: string }>(
        `SELECT cancelamento_pedido_compra_item_id AS cancelamento, pedido_compra_entrega_id AS entrega, quantidade
           FROM cancelamento_pedido_compra_entrega WHERE cancelamento_pedido_compra_item_id IN (?, ?) ORDER BY id`,
        [eventos[0]!.id, eventos[1]!.id],
      );
      // O primeiro abateu 4 da entrega distante e 1 da próxima; o segundo, mais 1 da próxima.
      expect(abatidas.map((x) => [Number(x.cancelamento), Number(x.entrega), Number(x.quantidade)])).toEqual([
        [Number(eventos[0]!.id), Number(vivas[1]!.id), 4],
        [Number(eventos[0]!.id), Number(vivas[0]!.id), 1],
        [Number(eventos[1]!.id), Number(vivas[0]!.id), 1],
      ]);
      expect(
        (await entregas()).filter((x) => x.excluido_em === null).map((x) => Number(x.quantidade_cancelada)),
      ).toEqual([2, 4]);

      await op('cancelarCompra', {
        pedido,
        item: null,
        quantidade: null,
        motivo,
        justificativa: 'Compra desistida pela área',
      });
      const [p] = await ler<{
        situacao: string;
        cancelado_em: unknown;
        motivo: number;
        justificativa_cancelamento: string;
      }>(
        'SELECT situacao, cancelado_em, motivo_cancelamento_compra_id AS motivo, justificativa_cancelamento FROM pedido_compra WHERE id = ?',
        [pedidoId],
      );
      expect(p!.situacao).toBe('cancelado');
      expect(p!.cancelado_em).not.toBeNull();
      expect(Number(p!.motivo)).toBe(motivo);
      expect(p!.justificativa_cancelamento).toBe('Compra desistida pela área');
      const [it2] = await ler<{ quantidade_cancelada: string; cancelado_em: unknown }>(
        'SELECT quantidade_cancelada, cancelado_em FROM pedido_compra_item WHERE id = ?',
        [itemId],
      );
      expect(Number(it2!.quantidade_cancelada)).toBe(10);
      expect(it2!.cancelado_em).not.toBeNull();
      const [ultimo] = await ler<{ abrangencia: string; quantidade: string; justificativa: string }>(
        'SELECT abrangencia, quantidade, justificativa FROM cancelamento_pedido_compra_item WHERE pedido_compra_item_id = ? ORDER BY id DESC LIMIT 1',
        [itemId],
      );
      expect([ultimo!.abrangencia, Number(ultimo!.quantidade), ultimo!.justificativa]).toEqual([
        'pedido',
        4,
        'Compra desistida pela área',
      ]);
      expect(
        await codigoDe(
          op('cancelarCompra', {
            pedido,
            item: null,
            quantidade: null,
            motivo,
            justificativa: 'De novo, sem efeito',
          }),
        ),
      ).toBe('pedido-encerrado');
    });

    it('a leitura da tela traz itens com a agenda, contatos e motivos', async () => {
      const g = await porta.gestaoPedido(c, ano, doc);
      expect(g?.pedido.situacao).toBe('cancelado');
      expect(g?.pedido.motivoCancelamento).toBe('Fornecedor sem estoque');
      expect(g?.itens[0]?.pendente).toBe(0);
      expect(g?.itens[0]?.entregas).toHaveLength(2);
      expect(g?.itens[0]?.cancelamentos.map((x) => [x.abrangencia, x.quantidade, x.justificativa])).toEqual([
        ['item', 5, 'Fornecedor só entrega metade'],
        ['item', 1, 'Mais uma unidade em falta'],
        ['pedido', 4, 'Compra desistida pela área'],
      ]);
      expect(g?.itens[0]?.cancelamentos[0]?.motivo).toBe('Fornecedor sem estoque');
      expect(g?.acompanhamentos).toHaveLength(2);
      expect(g?.motivos.some((x) => x.id === motivo)).toBe(true);
      expect(g?.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        await porta.gestaoPedido({ ...c, estabelecimento: m.estB } as ContextoSuprimentos, ano, doc),
      ).toBeNull();
    });

    it('a nota do pedido abate a agenda da entrega mais antiga; a entrega com recebimento sobrevive à reprogramação', async () => {
      const p = await op('criarPedido', {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor],
        itens: [{ item: m.insumo, quantidade: 10 }],
      });
      const pedido = { ano: Number(p.resultado['ano']), doc: Number(p.resultado['doc']) };
      const [r] = await ler<{ item: number }>(
        `SELECT x.id AS item FROM pedido_compra p JOIN pedido_compra_item x ON x.pedido_compra_id = p.id
          WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.numero = ?`,
        [m.estA, pedido.ano, pedido.doc],
      );
      const item = Number(r!.item);
      await op('programarEntregasPedido', {
        pedido,
        item,
        entregas: [
          { dataPrevista: depois(3), dataLimite: null, quantidade: 6 },
          { dataPrevista: depois(20), dataLimite: null, quantidade: 4 },
        ],
      });
      const hoje = new Date().toISOString().slice(0, 10);
      await op('registrarEntradaNF', {
        fornecedor: m.fornecedor,
        numero: Number(`9${RODADA.replace(/\D/g, '').slice(-6) || '1'}`),
        emissao: hoje,
        local: m.localA,
        pedido,
        itens: [
          {
            item: m.insumo,
            quantidade: 4,
            valorUnitario: 5,
            lotes: [{ lote: `${m.marca}PG`, validade: '2028-01-31', quantidade: 4 }],
          },
        ],
      });
      const agenda = () =>
        ler<{ id: number; quantidade: string; quantidade_recebida: string; excluido_em: unknown }>(
          'SELECT id, quantidade, quantidade_recebida, excluido_em FROM pedido_compra_entrega WHERE pedido_compra_item_id = ? ORDER BY sequencia',
          [item],
        );
      const a1 = await agenda();
      // A mais antiga (6) recebe os 4; a mais nova fica intacta.
      expect(a1.map((x) => Number(x.quantidade_recebida))).toEqual([4, 0]);
      const [pi] = await ler<{ quantidade_recebida: string }>(
        'SELECT quantidade_recebida FROM pedido_compra_item WHERE id = ?',
        [item],
      );
      expect(Number(pi!.quantidade_recebida)).toBe(4);
      await op('programarEntregasPedido', {
        pedido,
        item,
        entregas: [{ dataPrevista: depois(30), dataLimite: null, quantidade: 4 }],
      });
      const a2 = await agenda();
      expect(a2).toHaveLength(3);
      // A entrega com recebimento fica viva e igual; a que nada recebeu sai com marca de exclusão.
      expect(a2[0]).toMatchObject({ id: a1[0]!.id, excluido_em: null });
      expect([Number(a2[0]!.quantidade), Number(a2[0]!.quantidade_recebida)]).toEqual([6, 4]);
      expect(a2[1]!.excluido_em).not.toBeNull();
      expect(a2[2]!.excluido_em).toBeNull();
    });
  },
);
