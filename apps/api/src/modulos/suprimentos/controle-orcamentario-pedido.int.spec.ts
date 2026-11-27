// Contrato de efeito do controle orçamentário na compra (C2-112, 07-FIN linha 130) pela operação real do pedido de
// compra, contra o MariaDB (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). O pedido nasce em cotação,
// recebe a proposta e o vencedor e é aprovado pela alçada (aprovarPedido): sob regra 'bloquear' sem exceção e sem saldo
// na linha oficial do centro, a aprovação é recusada (regra-violada) e nada fica gravado (o pedido segue em cotação, sem
// reserva); com saldo, a mesma aprovação passa e deixa a reserva do pedido na linha do centro. A nota de entrada do
// pedido (registrarEntradaNF) consome a reserva na mesma transação: a parcial deixa a reserva 'parcial'; a final acima da
// reserva, sob bloqueio sem exceção e sem saldo, é recusada sem gravar a nota; a final dentro da reserva a consome.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
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
const PLANO = `c2112s${RODADA}`.slice(0, 20);
const MESES = Array.from({ length: 12 }, (_, i) => `valor_mes_${String(i + 1).padStart(2, '0')}`);
let k = 0;

describe.skipIf(SEM_BANCO)(
  'controle orçamentário pela aprovação real do pedido e pela nota de entrada (MariaDB, C2-112)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaSuprimentosPropria;
    let m: MassaSuprimentos;
    let c: ContextoSuprimentos;
    let linha = 0;
    const escrever = <T>(f: (e: Escritor) => Promise<T>) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'c2112-sup' }, f);
    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2112-sup' }, (l) => l.consultar<T>(sql, p));
    const contar = async (sql: string, p: unknown[]) => Number((await ler<{ n: number }>(sql, p))[0]?.n);
    const op = (nome: string, entrada: unknown) =>
      porta.executar(c, `suprimentos.${nome}`, entrada, {
        ...c,
        chaveIdempotencia: `c2112s-${RODADA}-${++k}`,
      });
    const orcadoNoMes = (v: number) =>
      escrever((e) =>
        e.executar(`UPDATE linha_orcamento SET ${MESES.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, [
          ...MESES.map(() => v),
          linha,
        ]),
      );
    const limparOrcamento = (est: number) =>
      escrever(async (e) => {
        const res = 'SELECT id FROM reserva_orcamentaria WHERE estabelecimento_id = ?';
        await e.executar(`DELETE FROM ajuste_orcamento_nota WHERE reserva_orcamentaria_id IN (${res})`, [
          est,
        ]);
        await e.executar('DELETE FROM excecao_orcamentaria WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM reserva_orcamentaria WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM regra_controle_orcamentario WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          `DELETE l FROM linha_orcamento l JOIN versao_orcamento v ON v.id = l.versao_orcamento_id
            WHERE v.estabelecimento_id = ?`,
          [est],
        );
        await e.executar('DELETE FROM versao_orcamento WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM plano_orcamentario WHERE codigo = ?', [PLANO]);
      });

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassa(nucleo);
      porta = new PortaSuprimentosPropria(nucleo);
      c = { ...contexto(m, m.estA, 'c2112s') } as ContextoSuprimentos;
      await limparOrcamento(m.estA);
      const ano = new Date().getFullYear();
      // O orçamento oficial aprovado do ano: a linha do centro da massa, sem saldo, e a regra que bloqueia sem exceção.
      linha = await escrever(async (e) => {
        const agora = new Date();
        const plano = await e.inserir(
          `INSERT INTO plano_orcamentario (codigo, descricao, mascara, vigencia_inicio, criado_em)
           VALUES (?, 'Plano sintético C2-112 compra', '9.99', '2000-01-01', ?)`,
          [PLANO, agora],
        );
        const versao = await e.inserir(
          `INSERT INTO versao_orcamento (estabelecimento_id, plano_orcamentario_id, ano, numero_versao, descricao,
             vigencia_inicio, vigencia_fim, oficial, situacao, aprovado_em, aprovador_usuario_id, criado_em)
           VALUES (?, ?, ?, 1, 'Versão sintética C2-112 compra', ?, ?, TRUE, 'aprovado', ?, ?, ?)`,
          [m.estA, plano, ano, `${ano}-01-01`, `${ano}-12-31`, agora, m.usuario3, agora],
        );
        await e.inserir(
          `INSERT INTO regra_controle_orcamentario (estabelecimento_id, acao, centro_custo_id, prioridade,
             vigencia_inicio, ativo, criado_em) VALUES (?, 'bloquear', ?, 10, '2000-01-01', TRUE, ?)`,
          [m.estA, m.centroCusto, agora],
        );
        return e.inserir(
          `INSERT INTO linha_orcamento (versao_orcamento_id, sequencia, centro_custo_id, natureza, criado_em)
           VALUES (?, 1, ?, 'despesa', ?)`,
          [versao, m.centroCusto, agora],
        );
      });
      await orcadoNoMes(50);
    }, 120_000);

    afterAll(async () => {
      if (nucleo) {
        if (m) {
          await limparOrcamento(m.estA);
          await limparMassa(nucleo, m);
        }
        await nucleo.encerrar();
      }
    });

    it('aprovarPedido sob bloqueio sem saldo é recusado sem gravar; com saldo, aprova e reserva; a nota consome a reserva', async () => {
      const p = await op('criarPedido', {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor],
        itens: [{ item: m.insumo, quantidade: 10 }],
      });
      const ano = Number(p.resultado['ano']);
      const doc = Number(p.resultado['doc']);
      const pedido = { ano, doc };
      const [prop] = await ler<{ id: number; pedido: number }>(
        `SELECT cri.id, p.id AS pedido FROM pedido_compra p
           JOIN cotacao_fornecedor cf ON cf.cotacao_id = p.cotacao_id
           JOIN cotacao_resposta_item cri ON cri.cotacao_fornecedor_id = cf.id
          WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.numero = ?`,
        [m.estA, ano, doc],
      );
      const id = Number(prop!.pedido);
      await op('registrarProposta', { pedido, proposta: Number(prop!.id), valorUnitario: 10 });
      await op('definirVencedorCotacao', {
        pedido,
        item: m.insumo,
        seq: 1,
        vencedoras: [Number(prop!.id)],
        justificativa: 'Melhor proposta (teste sintético)',
      });
      const supervisor = { ...c, usuario: m.usuario3 } as ContextoSuprimentos;
      const trilha: TrilhaDaGravacao = {
        estabelecimento: m.estA,
        usuario: m.usuario3,
        acao: 'operacao',
        entidade: 'pedido_compra',
        entidadeId: null,
        dadosDepois: { evento: 'suprimentos.pedido.aprovado' },
        correlacao: null,
      };
      const aprovar = () =>
        porta.gravarSgh(supervisor, trilha, (g) =>
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
      const reservas = () =>
        ler<{ linha: number; reservado: string; consumido: string; liberado: string; situacao: string }>(
          `SELECT linha_orcamento_id AS linha, valor_reservado AS reservado, valor_consumido AS consumido,
                  valor_liberado AS liberado, situacao
             FROM reserva_orcamentaria WHERE tipo_documento = 'pedido_compra' AND pedido_compra_id = ?`,
          [id],
        );
      const aprovado = () =>
        contar(
          "SELECT COUNT(*) AS n FROM pedido_compra WHERE id = ? AND situacao = 'aprovado' AND aprovado_em IS NOT NULL",
          [id],
        );

      // 100 sobre 50 de saldo, regra de bloqueio e nenhuma exceção: a aprovação é recusada e nada fica gravado.
      expect(await codigoDe(aprovar())).toBe('regra-violada');
      expect(await aprovado()).toBe(0);
      expect(await reservas()).toEqual([]);

      // Com saldo na linha, a mesma aprovação passa e deixa a reserva do pedido na linha do centro.
      await orcadoNoMes(1000);
      expect((await aprovar()).valor).toBe(100);
      expect(await aprovado()).toBe(1);
      const r1 = await reservas();
      expect(r1.map((r) => [Number(r.linha), Number(r.reservado), Number(r.consumido), r.situacao])).toEqual([
        [linha, 100, 0, 'ativa'],
      ]);

      const hoje = new Date().toISOString().slice(0, 10);
      const base = 800_000 + (Date.now() % 99_999);
      const nota = (numero: number, quantidade: number, valorUnitario: number, frete = 0) =>
        op('registrarEntradaNF', {
          fornecedor: m.fornecedor,
          frete,
          numero,
          emissao: hoje,
          local: m.localA,
          pedido,
          itens: [
            {
              item: m.insumo,
              quantidade,
              valorUnitario,
              lotes: [{ lote: `${m.marca}O${numero % 1000}`, validade: '2030-01-31', quantidade }],
            },
          ],
        });
      const ajustes = async () =>
        (
          await ler<{ realizado: string; ajuste: string }>(
            `SELECT a.valor_realizado AS realizado, a.valor_ajuste AS ajuste FROM ajuste_orcamento_nota a
               JOIN reserva_orcamentaria r ON r.id = a.reserva_orcamentaria_id
              WHERE r.pedido_compra_id = ? ORDER BY a.id`,
            [id],
          )
        ).map((a) => [Number(a.realizado), Number(a.ajuste)]);
      const notas = () => contar('SELECT COUNT(*) AS n FROM nota_entrada WHERE pedido_compra_id = ?', [id]);

      // Nota parcial (4 × 10): a reserva fica parcial com 40 consumidos e o ajuste da nota registra o realizado.
      await nota(base, 4, 10);
      expect((await reservas()).map((r) => [Number(r.consumido), r.situacao])).toEqual([[40, 'parcial']]);
      expect(await ajustes()).toEqual([[40, 0]]);

      // Nota final acima da reserva (6 × 10 + 12 de frete = 72 contra 60 em aberto) com a linha sem saldo: o bloqueio sem exceção
      // recusa a nota inteira; nem a nota nem o consumo ficam gravados.
      await orcadoNoMes(100);
      expect(await codigoDe(nota(base + 1, 6, 10, 12))).toBe('regra-violada');
      expect(await notas()).toBe(1);
      expect((await reservas()).map((r) => [Number(r.consumido), r.situacao])).toEqual([[40, 'parcial']]);
      expect(await ajustes()).toEqual([[40, 0]]);

      // Nota final dentro da reserva (6 × 10): a reserva é consumida inteira e o pedido fica recebido.
      await nota(base + 2, 6, 10);
      expect((await reservas()).map((r) => [Number(r.consumido), r.situacao])).toEqual([[100, 'consumida']]);
      expect(await notas()).toBe(2);
      expect(await ajustes()).toEqual([
        [40, 0],
        [60, 0],
      ]);
      expect(
        await contar("SELECT COUNT(*) AS n FROM pedido_compra WHERE id = ? AND situacao = 'recebido'", [id]),
      ).toBe(1);
    });
  },
);
