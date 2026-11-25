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
let k = 0;

/** Os contratos da massa (pelo número) e o que aponta para eles saem; o pedido fica sem contrato. */
async function limparContratos(e: Escritor): Promise<void> {
  const sub = `SELECT id FROM contrato_fornecedor WHERE numero LIKE '${PREFIXO_NUMERO}%'`;
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
    }, 120_000);

    afterAll(async () => {
      if (nucleo) {
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpa-ctpc' }, limparContratos);
        if (m) await limparMassa(nucleo, m);
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
  },
);
