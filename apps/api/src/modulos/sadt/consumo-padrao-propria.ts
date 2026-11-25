// Consumo padrão de insumos por exame (F8, 05-SADT linha 22), no banco do cliente. As regras são as puras de
// @sgh/dominio-sadt (exame/consumo-padrao); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - cadastro: `consumo_padrao_exame` por exame e setor executante (nulo: todos), com a baixa automática e o
//     lançamento na conta (desligado: o material está no preço do exame, pacote), e `consumo_padrao_exame_item`
//     (produto ou kit, quantidade, ajustável na execução). A alteração confere a versão; o item que sai fica com
//     `excluido_em` (nunca apagado) e o novo entra na sequência seguinte; desativar grava `ativo` (nada apagado);
//   - realização: o exame do estabelecimento (não cancelado nem recusado, ainda sem consumo baixado) fica com
//     `realizado_em` e `realizado_por_usuario_id` (se ainda não tinha), e cada produto que baixa vira
//     `item_exame_insumo` (quantidade, lote único, cobrável, `consumo_padrao_exame_id`) apontando o movimento do
//     estoque e, quando foi à conta, o `conta_hospitalar_item`. A baixa é a saída do motor do estoque na mesma
//     transação: o cobrável sai ao paciente (o motor lança na conta aberta do atendimento pelo preço vigente, com a
//     memória); o resto sai ao setor (centro de custo do local). Saldo, lote, mês fechado ou local sem permissão
//     recusam tudo (nada gravado).
import {
  conferirConsumoPadrao,
  consumoDaRealizacao,
  escolherConsumoPadrao,
  type ItemConsumoPadrao,
  produtosDoConsumo,
} from '@sgh/dominio-sadt';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import {
  hojeNoEstabelecimento,
  registrarSaida,
  TABELAS_OPERACOES_SUPRIMENTOS,
} from '../suprimentos/porta-propria.js';

export const CONSUMO_PADRAO_EXAME = Symbol('CONSUMO_PADRAO_EXAME');

const TABELAS = [
  'consumo_padrao_exame',
  'consumo_padrao_exame_item',
  'item_exame_insumo',
  'exame_item',
  'conta_hospitalar',
  'conta_hospitalar_item',
  'conta_hospitalar_item_memoria',
  ...TABELAS_OPERACOES_SUPRIMENTOS,
];

type Linha = Record<string, unknown>;
const id = z.number().int().positive();
const quantidade = z.number().positive().max(99999);

export const esquemaConsumoPadrao = z
  .object({
    id: id.optional(),
    versao: z.number().int().positive().optional(),
    exame: id,
    setor: id.nullable(),
    descricao: z.string().trim().max(150).nullable().optional(),
    baixaAutomatica: z.boolean(),
    lancamentoConta: z.boolean(),
    ativo: z.boolean().optional(),
    itens: z
      .array(
        z
          .object({
            insumo: id.nullable(),
            kit: id.nullable(),
            quantidade,
            ajustavel: z.boolean(),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();

export const esquemaRealizacao = z
  .object({
    local: id,
    ajustes: z
      .array(
        z
          .object({
            insumo: id,
            quantidade: z.number().min(0).max(99999),
            cobrar: z.boolean().optional(),
          })
          .strict(),
      )
      .max(60)
      .default([]),
  })
  .strict();

export interface ConsumoPadraoLido {
  readonly id: number;
  readonly exame: number;
  readonly exameNome: string;
  readonly setor: number | null;
  readonly setorNome: string | null;
  readonly descricao: string | null;
  readonly baixaAutomatica: boolean;
  readonly lancamentoConta: boolean;
  readonly ativo: boolean;
  readonly versao: number;
  readonly itens: {
    id: number;
    sequencia: number;
    insumo: number | null;
    kit: number | null;
    nome: string;
    quantidade: number;
    ajustavel: boolean;
  }[];
}

const chaveItem = (i: { insumo: number | null; kit: number | null }) =>
  i.insumo !== null ? `p${i.insumo}` : `k${i.kit ?? 0}`;

export class PortaConsumoPadraoExamePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'sadt.consumo-padrao');
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Locais de estoque e kits vivos do estabelecimento e, com a busca (3+ letras ou o código), os produtos ativos. */
  apoio(c: ContextoPortaPropria, busca: string | null) {
    const termo = (busca ?? '').trim();
    return this.ler(c, 'apoio', async (l, est) => ({
      locais: (
        await l.consultar<Linha>(
          `SELECT id, nome FROM local_estoque WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 500`,
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) })),
      kits: (
        await l.consultar<Linha>(
          `SELECT id, nome FROM kit_material WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY nome LIMIT 500`,
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) })),
      produtos:
        termo.length < 3
          ? []
          : (
              await l.consultar<Linha>(
                `SELECT id, codigo, nome FROM insumo WHERE excluido_em IS NULL AND situacao = 'ativo'
                    AND (nome LIKE ? OR codigo = ?) ORDER BY nome LIMIT 30`,
                [`%${termo}%`, termo],
              )
            ).map((x) => ({ id: num(x['id']), codigo: String(x['codigo']), nome: String(x['nome']) })),
    }));
  }

  /** Os consumos padrão do estabelecimento (do exame, quando informado), com os itens vivos. */
  listar(c: ContextoPortaPropria, exame: number | null): Promise<ConsumoPadraoLido[]> {
    return this.ler(c, 'listar', (l, est) => this.consumos(l, est.id, exame, null));
  }

  private async consumos(
    l: Leitor,
    est: number,
    exame: number | null,
    soId: number | null,
  ): Promise<ConsumoPadraoLido[]> {
    const cab = await l.consultar<Linha>(
      `SELECT cp.*, e.nome AS exame_nome, sd.nome AS setor_nome FROM consumo_padrao_exame cp
         JOIN exame e ON e.id = cp.exame_id LEFT JOIN setor_diagnostico sd ON sd.id = cp.setor_diagnostico_id
        WHERE cp.estabelecimento_id = ? AND (? IS NULL OR cp.exame_id = ?) AND (? IS NULL OR cp.id = ?)
        ORDER BY e.nome, cp.setor_diagnostico_id IS NOT NULL, cp.id LIMIT 500`,
      [est, exame, exame, soId, soId],
    );
    if (!cab.length) return [];
    const ids = cab.map((x) => num(x['id']));
    const itens = await l.consultar<Linha>(
      `SELECT ci.*, COALESCE(i.nome, k.nome) AS nome FROM consumo_padrao_exame_item ci
         LEFT JOIN insumo i ON i.id = ci.insumo_id LEFT JOIN kit_material k ON k.id = ci.kit_material_id
        WHERE ci.consumo_padrao_exame_id IN (${ids.map(() => '?').join(', ')}) AND ci.excluido_em IS NULL
        ORDER BY ci.consumo_padrao_exame_id, ci.sequencia`,
      ids,
    );
    return cab.map((x) => ({
      id: num(x['id']),
      exame: num(x['exame_id']),
      exameNome: String(x['exame_nome']),
      setor: numOuNull(x['setor_diagnostico_id']),
      setorNome: txtOuNull(x['setor_nome']),
      descricao: txtOuNull(x['descricao']),
      baixaAutomatica: bool(x['baixa_estoque_automatica']),
      lancamentoConta: bool(x['lancamento_conta_automatico']),
      ativo: bool(x['ativo']),
      versao: num(x['versao']),
      itens: itens
        .filter((i) => num(i['consumo_padrao_exame_id']) === num(x['id']))
        .map((i) => ({
          id: num(i['id']),
          sequencia: num(i['sequencia']),
          insumo: numOuNull(i['insumo_id']),
          kit: numOuNull(i['kit_material_id']),
          nome: String(i['nome'] ?? ''),
          quantidade: num(i['quantidade']),
          ajustavel: bool(i['ajustavel_na_execucao']),
        })),
    }));
  }

  /** Os exames recentes (14 dias) do setor ainda sem consumo baixado, cujo exame tem consumo padrão ativo. */
  pendentes(c: ContextoPortaPropria, setor: number | null) {
    return this.ler(c, 'pendentes', async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT ei.id, ei.situacao, e.nome AS exame_nome, r.numero, r.solicitado_em, r.atendimento_id,
                  COALESCE(pf.nome_social, pf.nome) AS paciente_nome, sd.nome AS setor_nome
             FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
             JOIN exame e ON e.id = ei.exame_id
             LEFT JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
             LEFT JOIN paciente p ON p.id = r.paciente_id LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND ei.excluido_em IS NULL
              AND ei.situacao NOT IN ('cancelado', 'recusado')
              AND r.solicitado_em >= DATE_SUB(NOW(), INTERVAL 14 DAY)
              AND (? IS NULL OR COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) = ?)
              AND EXISTS (SELECT 1 FROM consumo_padrao_exame cp WHERE cp.estabelecimento_id = r.estabelecimento_id
                            AND cp.exame_id = ei.exame_id AND cp.ativo)
              AND NOT EXISTS (SELECT 1 FROM item_exame_insumo x WHERE x.exame_item_id = ei.id AND x.excluido_em IS NULL)
            ORDER BY r.solicitado_em, ei.id LIMIT 200`,
          [est.id, setor, setor],
        )
      ).map((x) => ({
        item: num(x['id']),
        situacao: String(x['situacao']),
        exame: String(x['exame_nome']),
        requisicao: String(x['numero']),
        solicitadoEm:
          x['solicitado_em'] instanceof Date ? x['solicitado_em'].toISOString() : String(x['solicitado_em']),
        paciente: txtOuNull(x['paciente_nome']),
        setor: txtOuNull(x['setor_nome']),
        comAtendimento: x['atendimento_id'] !== null && x['atendimento_id'] !== undefined,
      })),
    );
  }

  /** A sugestão da realização: o consumo que vale para o exame no setor, os produtos (kit aberto) e o já baixado. */
  sugestao(c: ContextoPortaPropria, item: number) {
    return this.ler(c, 'sugestao', (l, est) => this.montarSugestao(l, est.id, item));
  }

  private async montarSugestao(l: Leitor, est: number, item: number) {
    const ei = await l.uma<Linha>(
      `SELECT ei.id, ei.versao, ei.situacao, ei.exame_id, ei.realizado_em, r.atendimento_id, e.nome AS exame_nome,
              COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) AS setor
         FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id JOIN exame e ON e.id = ei.exame_id
        WHERE ei.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL AND ei.excluido_em IS NULL`,
      [item, est],
    );
    if (!ei) throw naoEncontrado('Exame');
    const setor = numOuNull(ei['setor']);
    const candidatos = await this.consumos(l, est, num(ei['exame_id']), null);
    const consumo = escolherConsumoPadrao(candidatos, setor);
    const itensPadrao: ItemConsumoPadrao[] = (consumo?.itens ?? []).map((i) => ({
      insumo: i.insumo,
      kit: i.kit,
      quantidade: i.quantidade,
      ajustavel: i.ajustavel,
    }));
    const kits = [...new Set(itensPadrao.map((i) => i.kit).filter((k): k is number => k !== null))];
    const produtosKit = kits.length
      ? (
          await l.consultar<Linha>(
            `SELECT kit_material_id, insumo_id, quantidade FROM kit_material_item
              WHERE kit_material_id IN (${kits.map(() => '?').join(', ')}) AND excluido_em IS NULL`,
            kits,
          )
        ).map((x) => ({
          kit: num(x['kit_material_id']),
          insumo: num(x['insumo_id']),
          quantidade: num(x['quantidade']),
        }))
      : [];
    const produtos = produtosDoConsumo(itensPadrao, produtosKit);
    const cadastro = produtos.length
      ? await l.consultar<Linha>(
          `SELECT i.id, i.nome, i.cobravel, i.controla_lote, f.id AS faturavel FROM insumo i
             LEFT JOIN item_faturavel f ON f.id = i.item_faturavel_id AND f.excluido_em IS NULL AND f.situacao = 'ativo'
            WHERE i.id IN (${produtos.map(() => '?').join(', ')})`,
          produtos.map((p) => p.insumo),
        )
      : [];
    const baixados = await l.consultar<Linha>(
      `SELECT x.insumo_id, i.nome, x.quantidade_consumida, x.cobravel, x.movimento_estoque_id, x.conta_hospitalar_item_id
         FROM item_exame_insumo x JOIN insumo i ON i.id = x.insumo_id
        WHERE x.exame_item_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia`,
      [item],
    );
    return {
      item,
      versao: num(ei['versao']),
      situacao: String(ei['situacao']),
      exame: String(ei['exame_nome']),
      setor,
      comAtendimento: ei['atendimento_id'] !== null && ei['atendimento_id'] !== undefined,
      realizadoEm: ei['realizado_em'] instanceof Date ? ei['realizado_em'].toISOString() : null,
      consumo: consumo
        ? {
            id: consumo.id,
            baixaAutomatica: consumo.baixaAutomatica,
            lancamentoConta: consumo.lancamentoConta,
          }
        : null,
      produtos: produtos.map((p) => {
        const x = cadastro.find((k) => num(k['id']) === p.insumo);
        return {
          ...p,
          nome: String(x?.['nome'] ?? ''),
          cobravelNoCadastro:
            bool(x?.['cobravel']) && x?.['faturavel'] !== null && x?.['faturavel'] !== undefined,
        };
      }),
      baixados: baixados.map((b) => ({
        insumo: num(b['insumo_id']),
        nome: String(b['nome']),
        quantidade: num(b['quantidade_consumida']),
        cobravel: bool(b['cobravel']),
        movimento: numOuNull(b['movimento_estoque_id']),
        itemConta: numOuNull(b['conta_hospitalar_item_id']),
      })),
    };
  }

  // ── Cadastro ───────────────────────────────────────────────────────────────────────────────────────────

  async salvar(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; versao: number }> {
    const e = entradaValida(esquemaConsumoPadrao, entrada);
    const itens = e.itens.map((i) => ({ ...i }));
    const recusas = conferirConsumoPadrao(itens);
    if (recusas.length) throw recusaRegra('Consumo padrão recusado', recusas);
    if (e.id !== undefined && e.versao === undefined)
      throw recusaRegra('Consumo padrão recusado', [{ campo: 'versao', mensagem: 'Informe a versão lida.' }]);
    return this.gravar(
      c,
      e.id === undefined ? 'sadt.consumo-padrao.incluir' : 'sadt.consumo-padrao.alterar',
      ['consumo_padrao_exame', 'consumo_padrao_exame_item'],
      async (tx, est, usuario) => {
        const ex = await tx.uma('SELECT id FROM exame WHERE id = ? AND ativo AND excluido_em IS NULL', [
          e.exame,
        ]);
        if (!ex) throw naoEncontrado('Exame');
        if (
          e.setor !== null &&
          !(await tx.uma(
            'SELECT id FROM setor_diagnostico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [e.setor, est.id],
          ))
        )
          throw naoEncontrado('Setor executante');
        for (const [k, i] of itens.entries()) {
          const ok =
            i.insumo !== null
              ? await tx.uma(
                  "SELECT id FROM insumo WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
                  [i.insumo],
                )
              : await tx.uma(
                  'SELECT id FROM kit_material WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
                  [i.kit, est.id],
                );
          if (!ok)
            throw recusaRegra('Consumo padrão recusado', [
              {
                campo: `itens.${k}`,
                mensagem: `Linha ${k + 1}: produto ou kit inexistente neste estabelecimento.`,
              },
            ]);
        }
        const cabecalho = {
          descricao: e.descricao ?? null,
          baixa_estoque_automatica: e.baixaAutomatica,
          lancamento_conta_automatico: e.lancamentoConta,
          ativo: e.ativo ?? true,
        };
        let consumo: number;
        let versao: number;
        if (e.id === undefined) {
          // O UNIQUE do banco não pega o setor nulo (todos): a duplicidade é conferida aqui.
          const dup = await tx.consultarParaAtualizar<Linha>(
            `SELECT id FROM consumo_padrao_exame WHERE estabelecimento_id = ? AND exame_id = ? AND setor_diagnostico_id <=> ?`,
            [est.id, e.exame, e.setor],
          );
          if (dup.length)
            throw new ErroOperacao(
              409,
              'consumo-repetido',
              'Consumo padrão repetido',
              'O exame já tem consumo padrão para este setor: altere o existente.',
            );
          consumo = await tx.incluir('consumo_padrao_exame', {
            estabelecimento_id: est.id,
            exame_id: e.exame,
            setor_diagnostico_id: e.setor,
            ...cabecalho,
          });
          versao = 1;
          for (const [k, i] of itens.entries()) await this.incluirItem(tx, consumo, k + 1, i);
        } else {
          const [cab] = await tx.consultarParaAtualizar<Linha>(
            'SELECT id, versao, exame_id, setor_diagnostico_id FROM consumo_padrao_exame WHERE id = ? AND estabelecimento_id = ?',
            [e.id, est.id],
            { teto: 1 },
          );
          if (!cab) throw naoEncontrado('Consumo padrão');
          if (num(cab['exame_id']) !== e.exame || numOuNull(cab['setor_diagnostico_id']) !== e.setor)
            throw recusaRegra('Consumo padrão recusado', [
              { campo: 'exame', mensagem: 'O exame e o setor do consumo não mudam: inclua outro consumo.' },
            ]);
          consumo = e.id;
          versao = await tx.alterar('consumo_padrao_exame', consumo, e.versao!, cabecalho);
          const vivos = await tx.consultarParaAtualizar<Linha>(
            'SELECT * FROM consumo_padrao_exame_item WHERE consumo_padrao_exame_id = ? AND excluido_em IS NULL',
            [consumo],
          );
          const [mx] = await tx.consultar<Linha>(
            'SELECT COALESCE(MAX(sequencia), 0) AS s FROM consumo_padrao_exame_item WHERE consumo_padrao_exame_id = ?',
            [consumo],
          );
          let seq = num(mx?.['s']);
          const pedidos = new Set(itens.map(chaveItem));
          for (const v of vivos) {
            const k = chaveItem({ insumo: numOuNull(v['insumo_id']), kit: numOuNull(v['kit_material_id']) });
            if (!pedidos.has(k))
              await tx.alterar('consumo_padrao_exame_item', num(v['id']), num(v['versao']), {
                excluido_em: new Date(),
                excluido_por: usuario,
              });
          }
          for (const i of itens) {
            const v = vivos.find(
              (x) =>
                chaveItem({ insumo: numOuNull(x['insumo_id']), kit: numOuNull(x['kit_material_id']) }) ===
                chaveItem(i),
            );
            if (!v) await this.incluirItem(tx, consumo, ++seq, i);
            else if (
              num(v['quantidade']) !== i.quantidade ||
              bool(v['ajustavel_na_execucao']) !== i.ajustavel
            )
              await tx.alterar('consumo_padrao_exame_item', num(v['id']), num(v['versao']), {
                quantidade: i.quantidade,
                ajustavel_na_execucao: i.ajustavel,
              });
          }
        }
        return { tabela: 'consumo_padrao_exame', id: consumo, versao };
      },
    );
  }

  private async incluirItem(tx: TxOperacao, consumo: number, sequencia: number, i: ItemConsumoPadrao) {
    const u = i.insumo
      ? await tx.uma<Linha>('SELECT estoque_unidade_medida_id AS u FROM insumo WHERE id = ?', [i.insumo])
      : null;
    await tx.incluir('consumo_padrao_exame_item', {
      consumo_padrao_exame_id: consumo,
      sequencia,
      insumo_id: i.insumo,
      kit_material_id: i.kit,
      quantidade: i.quantidade,
      unidade_medida_id: numOuNull(u?.['u']),
      ajustavel_na_execucao: i.ajustavel,
    });
  }

  // ── Realização: baixa no estoque e lançamento na conta ───────────────────────────────────────────────────

  async realizar(
    c: ContextoPortaPropria,
    item: number,
    entrada: unknown,
  ): Promise<{ id: number; baixados: number; itensConta: number }> {
    const e = entradaValida(esquemaRealizacao, entrada);
    return this.gravar(c, 'sadt.consumo-padrao.realizar', TABELAS, async (tx, est, usuario) => {
      // Trava o exame antes de olhar o consumo já baixado: duas realizações simultâneas nunca baixam duas vezes.
      const [ei] = await tx.consultarParaAtualizar<Linha>(
        `SELECT ei.id, ei.versao, ei.situacao, ei.realizado_em, r.atendimento_id, r.numero
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE ei.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL AND ei.excluido_em IS NULL`,
        [item, est.id],
        { teto: 1 },
      );
      if (!ei) throw naoEncontrado('Exame');
      if (['cancelado', 'recusado'].includes(String(ei['situacao'])))
        throw new ErroOperacao(
          409,
          'exame-cancelado',
          'Exame cancelado',
          'O exame cancelado ou recusado não baixa consumo.',
        );
      const s = await this.montarSugestao(tx, est.id, item);
      if (s.baixados.length)
        throw new ErroOperacao(
          409,
          'consumo-ja-baixado',
          'Consumo já baixado',
          'O consumo deste exame já foi baixado.',
        );
      if (!s.consumo || !s.produtos.length)
        throw new ErroOperacao(
          422,
          'sem-consumo-padrao',
          'Sem consumo padrão',
          'O exame não tem consumo padrão ativo.',
        );
      if (!s.consumo.baixaAutomatica)
        throw new ErroOperacao(
          422,
          'baixa-manual',
          'Baixa manual',
          'O consumo deste exame está marcado sem baixa automática: use a saída ao paciente do estoque.',
        );
      const r = consumoDaRealizacao({
        produtos: s.produtos,
        ajustes: e.ajustes,
        lancamentoContaAutomatico: s.consumo.lancamentoConta,
        comAtendimento: s.comAtendimento,
      });
      if (!r.ok) throw recusaRegra('Realização recusada', r.recusas);
      const local = await tx.uma<Linha>(
        'SELECT id, centro_custo_id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.local, est.id],
      );
      if (!local) throw naoEncontrado('Local de estoque');
      if (local['centro_custo_id'] === null)
        throw recusaRegra('Realização recusada', [
          { campo: 'local', mensagem: 'O local de estoque não tem centro de custo no cadastro.' },
        ]);
      const hoje = await hojeNoEstabelecimento(tx, est.id);
      const atendimento = numOuNull(ei['atendimento_id']);
      let seq = 0;
      let itensConta = 0;
      for (const cobrar of [true, false]) {
        const grupo = r.baixas.filter((b) => b.cobravel === cobrar);
        if (!grupo.length) continue;
        const saida = await registrarSaida(
          tx,
          est.id,
          {
            destino: cobrar ? 1 : 2,
            origem: 'E',
            local: e.local,
            centroCusto: num(local['centro_custo_id']),
            localConsumo: 1,
            ...(cobrar && atendimento !== null ? { atendimento } : {}),
            observacao: `Exame ${String(ei['numero'])}`.slice(0, 60),
            itens: grupo.map((b) => ({ item: b.insumo, quantidade: b.quantidade, lotes: [] })),
          } as Parameters<typeof registrarSaida>[2],
          hoje,
        );
        // O documento da saída tem os itens na ordem enviada: cada linha aponta o movimento, o lote e o item da conta.
        const movs = await tx.consultar<Linha>(
          `SELECT di.sequencia, m.id, m.conta_hospitalar_item_id, m.unidade_medida_id,
                  (SELECT MIN(ml.lote_insumo_id) FROM movimento_lote ml WHERE ml.movimento_estoque_id = m.id) AS lote,
                  (SELECT COUNT(*) FROM movimento_lote ml WHERE ml.movimento_estoque_id = m.id) AS lotes
             FROM documento_estoque_item di
             JOIN movimento_estoque m ON m.documento_estoque_item_id = di.id AND m.estorno_movimento_estoque_id IS NULL
            WHERE di.documento_estoque_id = ? ORDER BY di.sequencia, m.id`,
          [num(saida['id'])],
        );
        for (const [k, b] of grupo.entries()) {
          const m = movs.find((v) => num(v['sequencia']) === k + 1);
          const itemConta = numOuNull(m?.['conta_hospitalar_item_id']);
          if (itemConta !== null) itensConta += 1;
          await tx.incluir('item_exame_insumo', {
            exame_item_id: item,
            sequencia: ++seq,
            insumo_id: b.insumo,
            lote_insumo_id: num(m?.['lotes']) === 1 ? numOuNull(m?.['lote']) : null,
            unidade_medida_id: num(m?.['unidade_medida_id']),
            quantidade_consumida: b.quantidade,
            quantidade_perdida: 0,
            cobravel: b.cobravel,
            movimento_estoque_id: numOuNull(m?.['id']),
            conta_hospitalar_item_id: itemConta,
            consumo_padrao_exame_id: s.consumo.id,
          });
        }
      }
      if (ei['realizado_em'] === null || ei['realizado_em'] === undefined)
        await tx.alterar('exame_item', item, num(ei['versao']), {
          realizado_em: new Date(),
          realizado_por_usuario_id: usuario,
        });
      return { tabela: 'exame_item', id: item, baixados: r.baixas.length, itensConta };
    });
  }
}
