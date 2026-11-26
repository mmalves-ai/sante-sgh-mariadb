// Gasto de sala do ato cirúrgico (F3.4, 04-CC linha 100), no banco do cliente. As regras são as puras de
// @sgh/dominio-cirurgia (gasto-sala); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - lista padrão: `lista_material_procedimento` por procedimento (do serviço ou do cirurgião, geral ou por tipo de
//     anestesia), produto ou kit, quantidade e obrigatoriedade; tirar de uso grava `ativo` (nada apagado);
//   - tela do ato: o gasto (ou nenhum), os itens vigentes, os motivos, a sugestão pela lista padrão e a diferença;
//   - gravar (só aberta): `consumo_cirurgia` 'aberta' (criado na primeira vez) com o local de estoque e a conta aberta
//     do atendimento; os itens trocados ficam com `excluido_em` (nunca apagados) e os novos entram com a sequência
//     seguinte; a justificativa do obrigatório não usado vira `consumo_cirurgia_motivo` 'item_nao_usado'. O gasto que
//     o domínio recusa (obrigatório sem justificativa, implante sem lote, repetido) não grava nada (422);
//   - conferir: 'conferida' com `conferido_em` e `conferido_por_usuario_id`, depois de nova conferência pelo domínio;
//   - reabrir (conferida → aberta) e cancelar: o motivo em `consumo_cirurgia_motivo` e a situação, com a versão lida;
//   - debitar (só conferida, com conta aberta): a saída do estoque ao paciente pelo motor do estoque (documento,
//     movimento, saldo e, para o item faturável, `conta_hospitalar_item` com a memória do preço); o item que não se
//     fatura sai para o setor (centro de custo do local); cada `consumo_cirurgia_item` aponta o movimento e o item da
//     conta; o gasto fica 'debitada' com `debitado_em` e a conta.
// Correção F3.4-5: toda gravação no gasto trava a linha do ato (FOR UPDATE) antes de procurar ou criar o gasto (dois
// gastos vivos do mesmo ato nunca nascem juntos) e recusa o ato cancelado; o cirurgião da lista é um cirurgião da
// equipe viva do ato e fica gravado no gasto (conferir usa o gravado); o lote é conferido pelo id, produto,
// estabelecimento, exclusão e situação liberada na gravação e no débito, e vai inteiro ao motor; o OPME exige o lote
// pelo cadastro do produto; a lista padrão só aceita kit, produto, profissional e tipo de anestesia válidos aqui.
import {
  cirurgiaoDoGasto,
  conferirGastoSala,
  diferencasDaSugestao,
  type ItemGastoSala,
  type ItemSugerido,
  type LinhaListaMaterial,
  sugerirGastoSala,
  type SituacaoGastoSala,
  transicaoGastoSala,
} from '@sgh/dominio-cirurgia';
import { linhasDoKitPadrao } from '@sgh/contratos/regras-suprimentos';
import { SITUACOES_CONTA_LANCAVEL } from '@sgh/contratos/regras-faturamento';
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
import { lerKitsPadraoDosProcedimentos } from '../suprimentos/kit-padrao.js';

export const PORTA_GASTO_SALA = Symbol('PORTA_GASTO_SALA');

const TABELAS = [
  'lista_material_procedimento',
  'consumo_cirurgia',
  'consumo_cirurgia_item',
  'consumo_cirurgia_motivo',
  ...TABELAS_OPERACOES_SUPRIMENTOS,
];

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const motivo = z.string().trim().min(5).max(500);
const versao = z.number().int().positive();

const esquemaLinhaLista = z
  .object({
    procedimento: id,
    cirurgiao: id.nullable(),
    tipoAnestesia: id.nullable(),
    insumo: id.nullable(),
    kit: id.nullable(),
    quantidade: z.number().positive().max(99999),
    obrigatorio: z.boolean(),
  })
  .strict();

const esquemaGravar = z
  .object({
    local: id,
    cirurgiao: id.nullable().optional(),
    observacao: z.string().max(500).nullable().optional(),
    versao: versao.optional(),
    itens: z
      .array(
        z
          .object({
            insumo: id,
            quantidade: z.number().positive().max(99999),
            lote: id.nullable().optional(),
            implantePermanente: z.boolean().optional(),
            faturar: z.boolean().optional(),
          })
          .strict(),
      )
      .max(300),
    justificativas: z
      .array(z.object({ insumo: id, motivo }).strict())
      .max(300)
      .optional(),
  })
  .strict();

export interface ItemGastoLido extends ItemGastoSala {
  readonly id: number;
  readonly sequencia: number;
  readonly insumoNome: string;
  readonly movimento: number | null;
  readonly itemConta: number | null;
}

export interface GastoSalaLido {
  readonly ato: {
    id: number;
    numero: string;
    atendimento: number;
    situacao: string;
    tipoAnestesia: number | null;
    procedimentos: { id: number; descricao: string }[];
  };
  readonly gasto: {
    id: number;
    situacao: SituacaoGastoSala;
    local: number | null;
    conta: number | null;
    cirurgiao: number | null;
    conferidoEm: Date | null;
    conferidoPor: number | null;
    debitadoEm: Date | null;
    observacao: string | null;
    versao: number;
  } | null;
  readonly itens: ItemGastoLido[];
  readonly motivos: {
    tipo: string;
    insumo: number | null;
    motivo: string;
    registradoEm: Date;
    usuario: number;
  }[];
  /** O cirurgião cuja lista vale (gravado no gasto ou, sem gasto, o da equipe); null: lista do serviço. */
  readonly cirurgiaoLista: number | null;
  readonly sugestao: (ItemSugerido & { insumoNome: string })[];
  readonly diferencas: ReturnType<typeof diferencasDaSugestao>;
  readonly pendencias: { campo: string; mensagem: string }[];
}

function linhaLista(x: Linha): LinhaListaMaterial & { versao: number } {
  return {
    id: num(x['id']),
    procedimento: num(x['procedimento_cirurgico_id']),
    cirurgiao: numOuNull(x['cirurgiao_profissional_id']),
    tipoAnestesia: numOuNull(x['tipo_anestesia_id']),
    insumo: numOuNull(x['insumo_id']),
    kit: numOuNull(x['kit_material_id']),
    quantidade: num(x['quantidade']),
    obrigatorio: bool(x['obrigatorio']),
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
  };
}

export class PortaGastoSalaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'cirurgia.gasto-sala');
  }

  // ── Apoio da tela: locais de estoque, produtos e lotes do estabelecimento ─────────────────────────────

  /** Os locais de estoque vivos do estabelecimento e, com a busca (3+ letras ou o código), os produtos ativos. */
  apoio(c: ContextoPortaPropria, busca: string | null) {
    const termo = (busca ?? '').trim();
    return this.ler(c, 'apoio', async (l, est) => ({
      locais: (
        await l.consultar<Linha>(
          `SELECT id, nome, centro_custo_id FROM local_estoque
            WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 500`,
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']), comCentro: x['centro_custo_id'] !== null })),
      produtos:
        termo.length < 3
          ? []
          : (
              await l.consultar<Linha>(
                `SELECT id, codigo, nome, controla_lote, opme FROM insumo
                  WHERE excluido_em IS NULL AND situacao = 'ativo' AND (nome LIKE ? OR codigo = ?)
                  ORDER BY nome LIMIT 30`,
                [`%${termo}%`, termo],
              )
            ).map((x) => ({
              id: num(x['id']),
              codigo: String(x['codigo']),
              nome: String(x['nome']),
              controlaLote: bool(x['controla_lote']),
              opme: bool(x['opme']),
            })),
    }));
  }

  /** Os lotes liberados e na validade do produto no estabelecimento, com o saldo no local (validade primeiro). */
  lotes(c: ContextoPortaPropria, insumo: number, local: number | null) {
    return this.ler(c, 'lotes', async (l, est) => {
      const hoje = await hojeNoEstabelecimento(l, est.id);
      return (
        await l.consultar<Linha>(
          `SELECT lt.id, lt.numero_lote, lt.validade, COALESCE(SUM(sl.quantidade), 0) AS saldo
             FROM lote_insumo lt
             LEFT JOIN saldo_lote sl ON sl.lote_insumo_id = lt.id AND sl.local_estoque_id = ?
            WHERE lt.insumo_id = ? AND lt.estabelecimento_id = ? AND lt.excluido_em IS NULL
              AND lt.situacao = 'liberado' AND lt.validade >= ?
            GROUP BY lt.id, lt.numero_lote, lt.validade ORDER BY lt.validade, lt.id LIMIT 100`,
          [local, insumo, est.id, hoje],
        )
      ).map((x) => {
        const v = x['validade'];
        return {
          id: num(x['id']),
          numero: String(x['numero_lote']),
          validade: v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10),
          saldo: num(x['saldo']),
        };
      });
    });
  }

  // ── Lista padrão de material por procedimento ──────────────────────────────────────────────────────────

  listarLista(c: ContextoPortaPropria, procedimento: number | null) {
    return this.ler(c, 'lista', async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT lm.*, i.nome AS insumo_nome, k.nome AS kit_nome, pc.descricao AS procedimento_descricao
             FROM lista_material_procedimento lm
             LEFT JOIN insumo i ON i.id = lm.insumo_id
             LEFT JOIN kit_material k ON k.id = lm.kit_material_id
             JOIN procedimento_cirurgico pc ON pc.id = lm.procedimento_cirurgico_id
            WHERE lm.estabelecimento_id = ? AND (? IS NULL OR lm.procedimento_cirurgico_id = ?)
            ORDER BY pc.descricao, lm.cirurgiao_profissional_id IS NOT NULL, lm.id LIMIT 2000`,
          [est.id, procedimento, procedimento],
        )
      ).map((x) => ({
        ...linhaLista(x),
        nome: txtOuNull(x['insumo_nome']) ?? txtOuNull(x['kit_nome']),
        procedimentoDescricao: txtOuNull(x['procedimento_descricao']),
      })),
    );
  }

  incluirLinhaLista(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaLinhaLista, entrada);
    if ((e.insumo === null) === (e.kit === null))
      throw recusaRegra('Linha recusada', [
        { campo: 'insumo', mensagem: 'Informe o produto ou o kit (um dos dois).' },
      ]);
    return this.gravar(
      c,
      'cirurgia.gasto-sala.lista.incluir',
      ['lista_material_procedimento'],
      async (tx, est) => {
        const pc = await tx.uma('SELECT id FROM procedimento_cirurgico WHERE id = ?', [e.procedimento]);
        if (!pc) throw naoEncontrado('Procedimento cirúrgico');
        if (
          e.kit !== null &&
          !(await tx.uma(
            'SELECT id FROM kit_material WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
            [e.kit, est.id],
          ))
        )
          throw naoEncontrado('Kit de material');
        if (
          e.insumo !== null &&
          !(await tx.uma(
            "SELECT id FROM insumo WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
            [e.insumo],
          ))
        )
          throw naoEncontrado('Produto');
        if (
          e.cirurgiao !== null &&
          !(await tx.uma(
            "SELECT id FROM profissional WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
            [e.cirurgiao],
          ))
        )
          throw naoEncontrado('Cirurgião');
        if (
          e.tipoAnestesia !== null &&
          !(await tx.uma('SELECT id FROM tipo_anestesia WHERE id = ? AND ativo', [e.tipoAnestesia]))
        )
          throw naoEncontrado('Tipo de anestesia');
        const dup = await tx.uma(
          `SELECT id FROM lista_material_procedimento
            WHERE estabelecimento_id = ? AND procedimento_cirurgico_id = ? AND cirurgiao_profissional_id <=> ?
              AND tipo_anestesia_id <=> ? AND insumo_id <=> ? AND kit_material_id <=> ? AND ativo`,
          [est.id, e.procedimento, e.cirurgiao, e.tipoAnestesia, e.insumo, e.kit],
        );
        if (dup)
          throw new ErroOperacao(
            409,
            'linha-repetida',
            'Linha repetida',
            'O produto já está nesta lista: altere a quantidade da linha existente.',
          );
        const unidade = e.insumo
          ? await tx.uma('SELECT estoque_unidade_medida_id AS u FROM insumo WHERE id = ?', [e.insumo])
          : null;
        const novo = await tx.incluir('lista_material_procedimento', {
          estabelecimento_id: est.id,
          procedimento_cirurgico_id: e.procedimento,
          cirurgiao_profissional_id: e.cirurgiao,
          tipo_anestesia_id: e.tipoAnestesia,
          insumo_id: e.insumo,
          kit_material_id: e.kit,
          quantidade: e.quantidade,
          unidade_medida_id: numOuNull(unidade?.['u']),
          obrigatorio: e.obrigatorio,
          ativo: true,
        });
        return { tabela: 'lista_material_procedimento', id: novo };
      },
    );
  }

  /** Tira de uso ou volta ao uso, ou troca a quantidade e a obrigatoriedade (com a versão lida; nada apagado). */
  alterarLinhaLista(c: ContextoPortaPropria, linha: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(
      z
        .object({
          versao,
          ativo: z.boolean().optional(),
          quantidade: z.number().positive().max(99999).optional(),
          obrigatorio: z.boolean().optional(),
        })
        .strict(),
      entrada,
    );
    return this.gravar(
      c,
      'cirurgia.gasto-sala.lista.alterar',
      ['lista_material_procedimento'],
      async (tx, est) => {
        const a = await tx.uma(
          'SELECT id FROM lista_material_procedimento WHERE id = ? AND estabelecimento_id = ?',
          [linha, est.id],
        );
        if (!a) throw naoEncontrado('Linha da lista');
        const { versao: v, ...mud } = x;
        await tx.alterar('lista_material_procedimento', linha, v, mud);
        return { tabela: 'lista_material_procedimento', id: linha };
      },
    );
  }

  // ── Gasto de sala do ato ───────────────────────────────────────────────────────────────────────────────

  /** O ato do estabelecimento; `travar` (na gravação) trava a linha do ato e recusa o ato cancelado. */
  private async atoDo(l: Leitor, est: number, ato: number, travar = false) {
    const sql = `SELECT id, numero, atendimento_id, situacao, tipo_anestesia_id FROM ato_cirurgico
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`;
    const a = travar
      ? (await (l as TxOperacao).consultarParaAtualizar<Linha>(sql, [ato, est]))[0]
      : await l.uma<Linha>(sql, [ato, est]);
    if (!a) throw naoEncontrado('Ato cirúrgico');
    if (travar && String(a['situacao']) === 'cancelado')
      throw recusaRegra('Gasto de sala recusado', [
        { campo: 'ato', mensagem: 'O ato foi cancelado: o gasto de sala não muda.' },
      ]);
    const procs = await l.consultar<Linha>(
      `SELECT ap.procedimento_cirurgico_id AS id, pc.descricao FROM ato_cirurgico_procedimento ap
         JOIN procedimento_cirurgico pc ON pc.id = ap.procedimento_cirurgico_id
        WHERE ap.ato_cirurgico_id = ? AND ap.excluido_em IS NULL ORDER BY ap.principal DESC, ap.sequencia`,
      [ato],
    );
    return {
      id: num(a['id']),
      numero: String(a['numero']),
      atendimento: num(a['atendimento_id']),
      situacao: String(a['situacao']),
      tipoAnestesia: numOuNull(a['tipo_anestesia_id']),
      procedimentos: procs.map((p) => ({ id: num(p['id']), descricao: String(p['descricao'] ?? '') })),
    };
  }

  /** O cirurgião da lista: um cirurgião (grau de participação 00) da equipe viva do ato (domínio). */
  private async cirurgiaoDe(
    l: Leitor,
    ato: number,
    informado: number | null | undefined,
    gravado: number | null,
  ) {
    const equipe = await l.consultar<Linha>(
      `SELECT pc.profissional_id, f.grau_participacao_tiss FROM participante_cirurgia pc
         JOIN funcao_equipe_cirurgica f ON f.id = pc.funcao_equipe_cirurgica_id
        WHERE pc.ato_cirurgico_id = ? AND pc.excluido_em IS NULL ORDER BY pc.id`,
      [ato],
    );
    const r = cirurgiaoDoGasto(
      equipe.map((m) => ({
        profissional: num(m['profissional_id']),
        cirurgiao: txtOuNull(m['grau_participacao_tiss']) === '00',
      })),
      informado,
      gravado,
    );
    if ('problema' in r) throw recusaRegra('Gasto de sala recusado', [r.problema]);
    return r.cirurgiao;
  }

  private async sugestaoDo(
    l: Leitor,
    est: number,
    ato: Awaited<ReturnType<PortaGastoSalaPropria['atoDo']>>,
    cirurgiao: number | null,
  ) {
    const procs = ato.procedimentos.map((p) => p.id);
    if (!procs.length) return [];
    const gravada = (
      await l.consultar<Linha>(
        `SELECT * FROM lista_material_procedimento
          WHERE estabelecimento_id = ? AND ativo AND procedimento_cirurgico_id IN (${procs.map(() => '?').join(', ')})`,
        [est, ...procs],
      )
    ).map(linhaLista);
    // F3.6 (05-SUP linha 13): o kit padrão da cirurgia entra na sugestão quando a lista não o cita.
    const lista = [
      ...gravada,
      ...linhasDoKitPadrao(gravada, await lerKitsPadraoDosProcedimentos(l, est, procs)),
    ];
    const idsKit = [...new Set(lista.map((x) => x.kit).filter((k): k is number => k !== null))];
    const kits = idsKit.length
      ? (
          await l.consultar<Linha>(
            `SELECT ki.kit_material_id, ki.insumo_id, ki.quantidade FROM kit_material_item ki
               JOIN kit_material k ON k.id = ki.kit_material_id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
              WHERE ki.kit_material_id IN (${idsKit.map(() => '?').join(', ')}) AND ki.excluido_em IS NULL`,
            [est, ...idsKit],
          )
        ).map((k) => ({
          kit: num(k['kit_material_id']),
          insumo: num(k['insumo_id']),
          quantidade: num(k['quantidade']),
        }))
      : [];
    return sugerirGastoSala(lista, kits, {
      procedimentos: procs,
      cirurgiao,
      tipoAnestesia: ato.tipoAnestesia,
    });
  }

  private async gastoDo(l: Leitor, ato: number, travar = false): Promise<Linha | null> {
    const sql = `SELECT * FROM consumo_cirurgia
                  WHERE ato_cirurgico_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
                  ORDER BY id DESC LIMIT 1`;
    if (travar) {
      const [g] = await (l as TxOperacao).consultarParaAtualizar<Linha>(sql, [ato]);
      return g ?? null;
    }
    return (await l.uma<Linha>(sql, [ato])) ?? null;
  }

  private async itensDo(l: Leitor, gasto: number): Promise<ItemGastoLido[]> {
    return (
      await l.consultar<Linha>(
        `SELECT ci.*, i.nome AS insumo_nome, i.opme AS insumo_opme FROM consumo_cirurgia_item ci
           JOIN insumo i ON i.id = ci.insumo_id
          WHERE ci.consumo_cirurgia_id = ? AND ci.excluido_em IS NULL ORDER BY ci.sequencia`,
        [gasto],
      )
    ).map((x) => ({
      id: num(x['id']),
      sequencia: num(x['sequencia']),
      insumo: num(x['insumo_id']),
      insumoNome: String(x['insumo_nome'] ?? ''),
      quantidade: num(x['quantidade']),
      lote: numOuNull(x['lote_insumo_id']),
      implantePermanente: bool(x['implante_permanente']),
      faturar: bool(x['faturar']),
      opme: bool(x['insumo_opme']),
      movimento: numOuNull(x['movimento_estoque_id']),
      itemConta: numOuNull(x['conta_hospitalar_item_id']),
    }));
  }

  private async motivosDo(l: Leitor, gasto: number) {
    return (
      await l.consultar<Linha>(
        `SELECT tipo, insumo_id, motivo, registrado_em, usuario_id FROM consumo_cirurgia_motivo
          WHERE consumo_cirurgia_id = ? ORDER BY id`,
        [gasto],
      )
    ).map((m) => ({
      tipo: String(m['tipo']),
      insumo: numOuNull(m['insumo_id']),
      motivo: String(m['motivo']),
      registradoEm: m['registrado_em'] as Date,
      usuario: num(m['usuario_id']),
    }));
  }

  /** As justificativas que valem: a última de cada produto obrigatório que segue fora do gasto. */
  private justificativasVigentes(
    motivos: Awaited<ReturnType<PortaGastoSalaPropria['motivosDo']>>,
    itens: readonly ItemGastoSala[],
  ) {
    const usados = new Set(itens.map((i) => i.insumo));
    const ult = new Map<number, string>();
    for (const m of motivos)
      if (m.tipo === 'item_nao_usado' && m.insumo !== null) ult.set(m.insumo, m.motivo);
    return [...ult.entries()].filter(([i]) => !usados.has(i)).map(([insumo, motivo]) => ({ insumo, motivo }));
  }

  /** A tela do ato: o gasto, a sugestão pela lista padrão, a diferença e as pendências da conferência. */
  lerDoAto(c: ContextoPortaPropria, ato: number, cirurgiao: number | null): Promise<GastoSalaLido> {
    return this.ler(c, 'ato', async (l, est) => {
      const a = await this.atoDo(l, est.id, ato);
      const g = await this.gastoDo(l, ato);
      const itens = g ? await this.itensDo(l, num(g['id'])) : [];
      const motivos = g ? await this.motivosDo(l, num(g['id'])) : [];
      // Com gasto, vale o cirurgião gravado (o mesmo da conferência); sem gasto, o escolhido da equipe ou o principal.
      const cirurgiaoLista = g
        ? numOuNull(g['cirurgiao_profissional_id'])
        : await this.cirurgiaoDe(l, ato, cirurgiao, null);
      const sug = await this.sugestaoDo(l, est.id, a, cirurgiaoLista);
      const nomes = sug.length
        ? await l.consultar<Linha>(
            `SELECT id, nome FROM insumo WHERE id IN (${sug.map(() => '?').join(', ')})`,
            sug.map((s) => s.insumo),
          )
        : [];
      const nome = new Map(nomes.map((n) => [num(n['id']), String(n['nome'] ?? '')]));
      return {
        ato: a,
        gasto: g
          ? {
              id: num(g['id']),
              situacao: String(g['situacao']) as SituacaoGastoSala,
              local: numOuNull(g['local_estoque_id']),
              conta: numOuNull(g['conta_hospitalar_id']),
              cirurgiao: numOuNull(g['cirurgiao_profissional_id']),
              conferidoEm: (g['conferido_em'] as Date | null) ?? null,
              conferidoPor: numOuNull(g['conferido_por_usuario_id']),
              debitadoEm: (g['debitado_em'] as Date | null) ?? null,
              observacao: txtOuNull(g['observacao']),
              versao: num(g['versao']),
            }
          : null,
        itens,
        motivos,
        cirurgiaoLista,
        sugestao: sug.map((s) => ({ ...s, insumoNome: nome.get(s.insumo) ?? '' })),
        diferencas: diferencasDaSugestao(itens, sug),
        pendencias: g ? conferirGastoSala(itens, sug, this.justificativasVigentes(motivos, itens)) : [],
      };
    });
  }

  private async contaAberta(tx: Leitor, est: number, atendimento: number): Promise<number | null> {
    const r = await tx.uma<Linha>(
      `SELECT id FROM conta_hospitalar WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          AND situacao IN (${SITUACOES_CONTA_LANCAVEL.map(() => '?').join(', ')})
        ORDER BY (tipo_cobranca = 'total') DESC, id DESC LIMIT 1`,
      [atendimento, est, ...SITUACOES_CONTA_LANCAVEL],
    );
    return r ? num(r['id']) : null;
  }

  /** O lote do produto neste estabelecimento, vivo, liberado e na validade; senão, recusa no item. */
  private async loteValido(tx: Leitor, est: number, insumo: number, lote: number, hoje: string, k: number) {
    const lt = await tx.uma<Linha>(
      `SELECT numero_lote, validade, situacao FROM lote_insumo
        WHERE id = ? AND insumo_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [lote, insumo, est],
    );
    const v = lt ? lt['validade'] : null;
    const validade = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
    // O lote migrado sem validade não vai a paciente: a recusa diz o motivo (nunca "vencido").
    if (lt && (v === null || v === undefined))
      throw recusaRegra('Gasto de sala recusado', [
        {
          campo: `itens.${k}.lote`,
          mensagem: `Item ${k + 1}: lote sem validade (não informada na origem): informe a validade do lote antes de usar.`,
        },
      ]);
    if (!lt || lt['situacao'] !== 'liberado' || validade < hoje)
      throw recusaRegra('Gasto de sala recusado', [
        {
          campo: `itens.${k}.lote`,
          mensagem: !lt
            ? `Item ${k + 1}: o lote não é deste produto neste estabelecimento.`
            : `Item ${k + 1}: o lote não está liberado para uso (bloqueado, em quarentena, recolhido ou vencido).`,
        },
      ]);
    return lt;
  }

  private exigir(situacao: SituacaoGastoSala, acao: Parameters<typeof transicaoGastoSala>[1], m?: string) {
    const t = transicaoGastoSala(situacao, acao, m);
    if ('problema' in t) throw recusaRegra('Gasto de sala recusado', [t.problema]);
    return t.situacao;
  }

  /** Grava o gasto aberto (cria na primeira vez): os itens lançados e as justificativas, conferidos pelo domínio. */
  gravarDoAto(c: ContextoPortaPropria, ato: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaGravar, entrada);
    return this.gravar(
      c,
      'cirurgia.gasto-sala.gravar',
      ['consumo_cirurgia', 'consumo_cirurgia_item', 'consumo_cirurgia_motivo'],
      async (tx, est, usuario) => {
        const a = await this.atoDo(tx, est.id, ato, true);
        const local = await tx.uma(
          'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
          [e.local, est.id],
        );
        if (!local) throw naoEncontrado('Local de estoque');
        const g = await this.gastoDo(tx, ato, true);
        const cirurgiao = await this.cirurgiaoDe(
          tx,
          ato,
          e.cirurgiao,
          g ? numOuNull(g['cirurgiao_profissional_id']) : null,
        );
        // O cadastro do produto decide o rastreio (OPME exige o lote), e o lote é conferido aqui, não só no débito.
        const hoje = await hojeNoEstabelecimento(tx, est.id);
        const unidades = new Map<number, number | null>();
        const itens: ItemGastoSala[] = [];
        for (const [k, i] of e.itens.entries()) {
          const ins = await tx.uma<Linha>(
            'SELECT estoque_unidade_medida_id AS u, opme FROM insumo WHERE id = ? AND excluido_em IS NULL',
            [i.insumo],
          );
          if (!ins) throw naoEncontrado(`Produto ${i.insumo}`);
          unidades.set(i.insumo, numOuNull(ins['u']));
          if (i.lote !== null && i.lote !== undefined)
            await this.loteValido(tx, est.id, i.insumo, i.lote, hoje, k);
          itens.push({
            insumo: i.insumo,
            quantidade: i.quantidade,
            lote: i.lote ?? null,
            implantePermanente: i.implantePermanente ?? false,
            faturar: i.faturar ?? true,
            opme: bool(ins['opme']),
          });
        }
        const anteriores = g ? await this.motivosDo(tx, num(g['id'])) : [];
        const novas = e.justificativas ?? [];
        const justificativas = [
          ...this.justificativasVigentes(anteriores, itens).filter(
            (j) => !novas.some((n) => n.insumo === j.insumo),
          ),
          ...novas,
        ];
        const problemas = conferirGastoSala(
          itens,
          await this.sugestaoDo(tx, est.id, a, cirurgiao),
          justificativas,
        );
        if (problemas.length) throw recusaRegra('Gasto de sala recusado', problemas);
        let gasto: number;
        if (!g) {
          gasto = await tx.incluir('consumo_cirurgia', {
            ato_cirurgico_id: ato,
            conta_hospitalar_id: await this.contaAberta(tx, est.id, a.atendimento),
            local_estoque_id: e.local,
            cirurgiao_profissional_id: cirurgiao,
            situacao: 'aberta',
            observacao: e.observacao ?? null,
          });
        } else {
          this.exigir(String(g['situacao']) as SituacaoGastoSala, 'editar');
          if (e.versao === undefined)
            throw recusaRegra('Gasto de sala recusado', [
              { campo: 'versao', mensagem: 'Informe a versão lida do gasto.' },
            ]);
          gasto = num(g['id']);
          await tx.alterar('consumo_cirurgia', gasto, e.versao, {
            local_estoque_id: e.local,
            cirurgiao_profissional_id: cirurgiao,
            observacao: e.observacao ?? txtOuNull(g['observacao']),
          });
          // Os itens anteriores saem por exclusão lógica (o histórico fica); os novos entram na sequência seguinte.
          for (const x of await tx.consultar<Linha>(
            'SELECT id, versao FROM consumo_cirurgia_item WHERE consumo_cirurgia_id = ? AND excluido_em IS NULL',
            [gasto],
          ))
            await tx.alterar('consumo_cirurgia_item', num(x['id']), num(x['versao']), {
              excluido_em: new Date(),
              excluido_por: usuario,
            });
        }
        const seq = await tx.uma<Linha>(
          'SELECT COALESCE(MAX(sequencia), 0) AS s FROM consumo_cirurgia_item WHERE consumo_cirurgia_id = ?',
          [gasto],
        );
        let s = num(seq?.['s']);
        for (const it of itens) {
          await tx.incluir('consumo_cirurgia_item', {
            consumo_cirurgia_id: gasto,
            sequencia: ++s,
            insumo_id: it.insumo,
            lote_insumo_id: it.lote,
            unidade_medida_id: unidades.get(it.insumo) ?? null,
            quantidade: it.quantidade,
            local_estoque_id: e.local,
            faturar: it.faturar,
            implante_permanente: it.implantePermanente,
          });
        }
        for (const j of novas)
          if (
            !anteriores.some(
              (m) => m.tipo === 'item_nao_usado' && m.insumo === j.insumo && m.motivo === j.motivo,
            )
          )
            await tx.incluir('consumo_cirurgia_motivo', {
              consumo_cirurgia_id: gasto,
              tipo: 'item_nao_usado',
              insumo_id: j.insumo,
              motivo: j.motivo,
              registrado_em: new Date(),
              usuario_id: usuario,
            });
        return { tabela: 'consumo_cirurgia', id: gasto };
      },
    );
  }

  /** Confere o gasto aberto (nova conferência pelo domínio) e marca quem conferiu. */
  conferir(c: ContextoPortaPropria, ato: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(z.object({ versao }).strict(), entrada);
    return this.gravar(c, 'cirurgia.gasto-sala.conferir', ['consumo_cirurgia'], async (tx, est, usuario) => {
      const a = await this.atoDo(tx, est.id, ato, true);
      const g = await this.gastoDo(tx, ato, true);
      if (!g) throw naoEncontrado('Gasto de sala');
      const nova = this.exigir(String(g['situacao']) as SituacaoGastoSala, 'conferir');
      const itens = await this.itensDo(tx, num(g['id']));
      if (!itens.length)
        throw recusaRegra('Conferência recusada', [{ campo: 'itens', mensagem: 'O gasto não tem item.' }]);
      const problemas = conferirGastoSala(
        itens,
        // A conferência usa o cirurgião gravado no gasto, nunca um id do pedido.
        await this.sugestaoDo(tx, est.id, a, numOuNull(g['cirurgiao_profissional_id'])),
        this.justificativasVigentes(await this.motivosDo(tx, num(g['id'])), itens),
      );
      if (problemas.length) throw recusaRegra('Conferência recusada', problemas);
      await tx.alterar('consumo_cirurgia', num(g['id']), x.versao, {
        situacao: nova,
        conferido_em: new Date(),
        conferido_por_usuario_id: usuario,
      });
      return { tabela: 'consumo_cirurgia', id: num(g['id']) };
    });
  }

  /** Reabre a conferência ou cancela o gasto, com o motivo registrado (nada apagado). */
  mudarComMotivo(
    c: ContextoPortaPropria,
    ato: number,
    acao: 'reabrir' | 'cancelar',
    entrada: unknown,
    /** Quem tem o nível de conferência: só ele cancela o gasto já conferido (quem lança cancela o aberto). */
    podeConferir = false,
  ): Promise<{ id: number }> {
    const x = entradaValida(z.object({ versao, motivo }).strict(), entrada);
    return this.gravar(
      c,
      `cirurgia.gasto-sala.${acao}`,
      ['consumo_cirurgia', 'consumo_cirurgia_motivo'],
      async (tx, est, usuario) => {
        await this.atoDo(tx, est.id, ato, true);
        const g = await this.gastoDo(tx, ato, true);
        if (!g) throw naoEncontrado('Gasto de sala');
        if (acao === 'cancelar' && String(g['situacao']) === 'conferida' && !podeConferir)
          throw new ErroOperacao(
            403,
            'sem-permissao',
            'Cancelamento recusado',
            'O gasto já foi conferido: só quem confere pode cancelá-lo.',
          );
        const nova = this.exigir(String(g['situacao']) as SituacaoGastoSala, acao, x.motivo);
        await tx.alterar('consumo_cirurgia', num(g['id']), x.versao, {
          situacao: nova,
          ...(acao === 'reabrir' ? { conferido_em: null, conferido_por_usuario_id: null } : {}),
        });
        await tx.incluir('consumo_cirurgia_motivo', {
          consumo_cirurgia_id: num(g['id']),
          tipo: acao === 'reabrir' ? 'reabertura' : 'cancelamento',
          insumo_id: null,
          motivo: x.motivo,
          registrado_em: new Date(),
          usuario_id: usuario,
        });
        return { tabela: 'consumo_cirurgia', id: num(g['id']) };
      },
    );
  }

  /** Debita o gasto conferido: saída do estoque ao paciente (e ao setor o que não se fatura) e item na conta. */
  debitar(
    c: ContextoPortaPropria,
    ato: number,
    entrada: unknown,
  ): Promise<{ id: number; itensConta: number }> {
    const x = entradaValida(z.object({ versao }).strict(), entrada);
    return this.gravar(c, 'cirurgia.gasto-sala.debitar', TABELAS, async (tx, est) => {
      const a = await this.atoDo(tx, est.id, ato, true);
      const g = await this.gastoDo(tx, ato, true);
      if (!g) throw naoEncontrado('Gasto de sala');
      const nova = this.exigir(String(g['situacao']) as SituacaoGastoSala, 'debitar');
      const conta = (await this.contaAberta(tx, est.id, a.atendimento)) ?? null;
      if (conta === null)
        throw recusaRegra('Débito recusado', [
          { campo: 'conta', mensagem: 'O atendimento não tem conta aberta para receber o gasto de sala.' },
        ]);
      const local = await tx.uma<Linha>('SELECT id, centro_custo_id FROM local_estoque WHERE id = ?', [
        numOuNull(g['local_estoque_id']),
      ]);
      if (!local || local['centro_custo_id'] === null)
        throw recusaRegra('Débito recusado', [
          { campo: 'local', mensagem: 'O local de estoque do gasto não tem centro de custo no cadastro.' },
        ]);
      const itens = await this.itensDo(tx, num(g['id']));
      if (!itens.length)
        throw recusaRegra('Débito recusado', [{ campo: 'itens', mensagem: 'O gasto não tem item.' }]);
      const hoje = await hojeNoEstabelecimento(tx, est.id);
      let itensConta = 0;
      for (const faturar of [true, false]) {
        const grupo = itens.filter((i) => i.faturar === faturar);
        if (!grupo.length) continue;
        // O lote do item vai com o número e a validade do cadastro (o motor do estoque confere o saldo do lote).
        const lotes = new Map<number, { lote: string; validade: string }>();
        for (const [k, i] of grupo.entries()) {
          if (i.lote === null) continue;
          const lt = await this.loteValido(tx, est.id, i.insumo, i.lote, hoje, k);
          const v = lt['validade'];
          // O número vai inteiro (até 50 no cadastro): o motor do estoque procura o lote pelo número exato.
          lotes.set(i.lote, {
            lote: String(lt['numero_lote']),
            validade: v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10),
          });
        }
        const r = await registrarSaida(
          tx,
          est.id,
          {
            destino: faturar ? 1 : 2,
            origem: 'E',
            local: num(local['id']),
            centroCusto: num(local['centro_custo_id']),
            localConsumo: 1,
            ...(faturar ? { atendimento: a.atendimento } : {}),
            observacao: `Gasto de sala do ato ${a.numero}`.slice(0, 60),
            itens: grupo.map((i) => ({
              item: i.insumo,
              quantidade: i.quantidade,
              lotes: i.lote ? [{ ...lotes.get(i.lote)!, quantidade: i.quantidade }] : [],
            })),
          } as Parameters<typeof registrarSaida>[2],
          hoje,
        );
        // O documento da saída tem os itens na ordem enviada: cada item do gasto aponta o movimento e o item da conta.
        const movs = await tx.consultar<Linha>(
          `SELECT di.sequencia, m.id, m.conta_hospitalar_item_id FROM documento_estoque_item di
             JOIN movimento_estoque m ON m.documento_estoque_item_id = di.id AND m.estorno_movimento_estoque_id IS NULL
            WHERE di.documento_estoque_id = ? ORDER BY di.sequencia, m.id`,
          [num(r['id'])],
        );
        for (const [k, it] of grupo.entries()) {
          const m = movs.find((v) => num(v['sequencia']) === k + 1);
          const itemConta = numOuNull(m?.['conta_hospitalar_item_id']);
          if (itemConta !== null) itensConta += 1;
          const atual = await tx.uma<Linha>('SELECT versao FROM consumo_cirurgia_item WHERE id = ?', [it.id]);
          await tx.alterar('consumo_cirurgia_item', it.id, num(atual?.['versao']), {
            movimento_estoque_id: numOuNull(m?.['id']),
            conta_hospitalar_item_id: itemConta,
          });
        }
      }
      await tx.alterar('consumo_cirurgia', num(g['id']), x.versao, {
        situacao: nova,
        debitado_em: new Date(),
        conta_hospitalar_id: conta,
      });
      return { tabela: 'consumo_cirurgia', id: num(g['id']), itensConta };
    });
  }
}
