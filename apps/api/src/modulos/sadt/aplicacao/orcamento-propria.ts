// Orçamento de exames particulares e a conversão em atendimento (F3.5, 05-SADT linha 26), no banco do cliente. A regra
// mora em @sgh/dominio-sadt (orcamento/montagem.ts e conversao.ts); aqui ficam a leitura do cadastro (exame, preço da
// tabela da fonte particular, setores executantes, atendimentos do paciente) e a gravação pelo Executor do núcleo, com a
// trilha na mesma transação. A conversão abre o pedido de exames (uma requisição por setor executante) e marca o
// orçamento realizado na MESMA transação: ou tudo fica, ou nada. Nada se apaga: o orçamento convertido fica com o
// atendimento, a data e o aceite, e a requisição aponta para ele.
import {
  conferirConversao,
  conferirDestinoDaConversao,
  conferirInteressado,
  type ExameOrcado,
  montarOrcamentoExames,
  RecusaOrcamento,
  setoresDaConversao,
  validadeDoOrcamento,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import { precoVigente, tabelasDePreco } from '../../faturamento/public-api.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';
import {
  esquemaPedidoExames,
  type PedidoGravado,
  ServicoPedidoSadt,
  TABELAS_PEDIDO,
} from './pedido-propria.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const lista = (k: number) => Array.from({ length: k }, () => '?').join(',');
const dataIso = (v: unknown) =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

// ── Entradas ────────────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();

export const esquemaOrcamentoExames = z
  .object({
    /** Paciente cadastrado; sem ele, o nome (e o CPF, se houver) do interessado. */
    paciente: id.nullable().default(null),
    nome: z.string().trim().max(150).nullable().default(null),
    cpf: z
      .string()
      .trim()
      .transform((x) => x.replace(/\D/g, ''))
      .nullable()
      .default(null),
    telefone: z.string().trim().max(20).nullable().default(null),
    /** A fonte pagadora particular cuja tabela dá o preço. */
    fontePagadora: id,
    solicitante: id.nullable().default(null),
    exames: z
      .array(
        z
          .object({
            exame: id,
            quantidade: z.number().int().default(1),
            /** Valor unitário digitado no balcão; nulo usa o preço da tabela. */
            valor: z.number().nullable().default(null),
          })
          .strict(),
      )
      .max(100),
    desconto: z.number().default(0),
    validadeDias: z.number().int().min(1).max(180).default(30),
    observacao: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();
export type OrcamentoExamesEntrada = z.infer<typeof esquemaOrcamentoExames>;

export const esquemaConversaoOrcamento = z
  .object({ atendimento: id, solicitante: id.nullable().default(null) })
  .strict();

export interface PreviaOrcamento {
  readonly itens: readonly {
    exame: number;
    codigo: string;
    nome: string;
    quantidade: number;
    unitario: number;
    total: number;
    origemPreco: 'tabela' | 'informado';
    precoTabela: number | null;
  }[];
  readonly bruto: number;
  readonly desconto: number;
  readonly total: number;
  readonly validade: string;
}

export interface AtendimentoParaConversao {
  readonly id: number;
  readonly numero: string;
  readonly entradaEm: string;
  readonly situacao: string;
  readonly fonte: string;
}

const TABELAS = [...TABELAS_PEDIDO, 'orcamento_particular', 'orcamento_particular_item'] as const;

function daRegra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RecusaOrcamento) throw recusa(e.codigo, e.message, { campos: [...e.campos] });
    throw e;
  }
}

async function hojeDo(l: Leitor, est: number): Promise<string> {
  const f = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return relogioNoFuso(texto(f?.['fuso_horario']) || FUSO_PADRAO).hoje;
}

export class ServicoOrcamentoSadt {
  private readonly executor: Executor;
  private readonly pedido: ServicoPedidoSadt;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
    this.pedido = new ServicoPedidoSadt(nucleo, this.executor);
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private ler<T>(c: ContextoSadt, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) => fn(l, est));
  }

  private async gravar<T extends { readonly id: number }>(
    c: ContextoSadt,
    nome: string,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = this.est(c);
    let saida: { valor: T } | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(tx, est) };
        return { valor: JSON.stringify(saida.valor) };
      },
      alvo: () => ({ tabela: 'orcamento_particular', id: saida ? saida.valor.id : null }),
      trilha: () => ({ dados: { evento: nome }, motivo: null }),
    });
    const chave = `sadt:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    if (saida) return (saida as { valor: T }).valor;
    const v = r.resultado['valor'];
    return (typeof v === 'string' ? JSON.parse(v) : null) as T;
  }

  /** Lê os exames, o preço da tabela da fonte particular e monta o orçamento pela regra (sem gravar). */
  private async montar(l: Leitor, est: number, e: OrcamentoExamesEntrada): Promise<PreviaOrcamento> {
    daRegra(() => conferirInteressado({ paciente: e.paciente, nome: e.nome, cpf: e.cpf }));
    if (e.paciente !== null) {
      const p = await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente]);
      if (!p) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['paciente'] });
    }
    const fonte = await l.uma('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [
      e.fontePagadora,
    ]);
    if (!fonte)
      throw recusa('fonte-inexistente', 'A fonte pagadora não existe.', { campos: ['fontePagadora'] });
    const ids = [...new Set(e.exames.map((x) => x.exame))];
    const linhas = ids.length
      ? await l.consultar(
          `SELECT id, codigo, nome, item_faturavel_id FROM exame
            WHERE ativo = TRUE AND excluido_em IS NULL AND id IN (${lista(ids.length)})`,
          ids,
        )
      : [];
    if (linhas.length !== ids.length)
      throw recusa('exame-inexistente', 'Algum exame não existe ou está inativo.', { campos: ['exames'] });
    const porId = new Map(linhas.map((x) => [n(x['id']), x]));
    const hoje = await hojeDo(l, est);
    const tabelas = await tabelasDePreco(l, est, e.fontePagadora, null);
    const orcados: (ExameOrcado & { codigo: string })[] = [];
    for (const x of e.exames) {
      const ex = porId.get(x.exame)!;
      const item = nn(ex['item_faturavel_id']);
      const p = item === null ? null : await precoVigente(l, tabelas, item, hoje);
      orcados.push({
        exame: x.exame,
        codigo: texto(ex['codigo']),
        nome: texto(ex['nome']),
        quantidade: x.quantidade,
        precoTabela: p ? p.unitario : null,
        valorInformado: x.valor,
      });
    }
    const m = daRegra(() => montarOrcamentoExames(orcados, e.desconto));
    return {
      itens: m.itens.map((i, k) => ({
        ...i,
        codigo: orcados[k]!.codigo,
        nome: orcados[k]!.nome,
        precoTabela: orcados[k]!.precoTabela,
      })),
      bruto: m.bruto,
      desconto: m.desconto,
      total: m.total,
      validade: validadeDoOrcamento(hoje, e.validadeDias),
    };
  }

  /** A prévia na hora: o preço da tabela, o total com as parcelas e a recusa com o campo, sem gravar nada. */
  previa(c: ContextoSadt, entrada: unknown): Promise<PreviaOrcamento> {
    const e = esquemaOrcamentoExames.parse(entrada);
    return this.ler(c, (l, est) => this.montar(l, est, e));
  }

  /** Grava o orçamento emitido com os itens de exame (número de negócio, validade, valores). */
  criar(
    c: ContextoSadt,
    entrada: unknown,
  ): Promise<{ id: number; numero: string; total: number; validade: string }> {
    const e = esquemaOrcamentoExames.parse(entrada);
    return this.gravar(c, 'sadt.orcamento.criado', async (tx, est) => {
      const m = await this.montar(tx, est, e);
      const usuario = tx.contexto.usuario;
      await garantirSequencia(
        tx,
        { tipo: 'orcamento_particular', estabelecimento: est, prefixo: 'OP-' },
        { usuario, agora: new Date() },
      );
      const numero = (await tx.proximoNumero('orcamento_particular')).formatado;
      const hoje = await hojeDo(tx, est);
      const orcamento = await tx.incluir('orcamento_particular', {
        estabelecimento_id: est,
        numero,
        paciente_id: e.paciente,
        nome_interessado: e.paciente === null ? e.nome : null,
        cpf_interessado: e.paciente === null ? e.cpf : null,
        telefone: e.telefone,
        fonte_pagadora_id: e.fontePagadora,
        solicitante_profissional_id: e.solicitante,
        data_orcamento: hoje,
        validade_ate: m.validade,
        valor_bruto: m.bruto,
        valor_desconto: m.desconto,
        valor_total: m.total,
        observacao: e.observacao,
        situacao: 'emitido',
        origem: 'sistema',
      });
      for (const [k, i] of m.itens.entries()) {
        const ex = await tx.uma('SELECT item_faturavel_id FROM exame WHERE id = ?', [i.exame]);
        await tx.incluir('orcamento_particular_item', {
          orcamento_particular_id: orcamento,
          sequencia: k + 1,
          tipo_item: 'exame',
          exame_id: i.exame,
          item_faturavel_id: nn(ex?.['item_faturavel_id']),
          descricao: i.codigo.slice(0, 150),
          quantidade: i.quantidade,
          valor_unitario: i.unitario,
          valor_total: i.total,
          origem: 'sistema',
        });
      }
      return { id: orcamento, numero, total: m.total, validade: m.validade };
    });
  }

  /** Os atendimentos do paciente do orçamento (abertos primeiro), para a conversão num clique. */
  atendimentos(c: ContextoSadt, orcamento: number): Promise<AtendimentoParaConversao[]> {
    return this.ler(c, async (l, est) => {
      const o = await l.uma(
        'SELECT paciente_id, cpf_interessado FROM orcamento_particular WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [orcamento, est],
      );
      if (!o) throw recusa('orcamento-inexistente', 'O orçamento não existe neste estabelecimento.');
      if (o['paciente_id'] === null && o['cpf_interessado'] === null) return [];
      const filtro = o['paciente_id'] !== null ? 'a.paciente_id = ?' : 'pf.cpf = ?';
      const valor = o['paciente_id'] !== null ? n(o['paciente_id']) : texto(o['cpf_interessado']);
      const ls = await l.consultar(
        `SELECT a.id, a.numero, a.entrada_em, a.situacao, fp.nome AS fonte
           FROM atendimento a JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
          WHERE a.estabelecimento_id = ? AND ${filtro} AND a.excluido_em IS NULL
          ORDER BY a.saida_em IS NULL DESC, a.entrada_em DESC LIMIT 20`,
        [est, valor],
      );
      return ls.map((r: Linha) => ({
        id: n(r['id']),
        numero: texto(r['numero']),
        entradaEm: r['entrada_em'] instanceof Date ? r['entrada_em'].toISOString() : texto(r['entrada_em']),
        situacao: texto(r['situacao']),
        fonte: texto(r['fonte']),
      }));
    });
  }

  /**
   * A conversão: confere a situação e o paciente pela regra, abre uma requisição por setor executante no atendimento
   * (com as restrições do pedido) e marca o orçamento realizado, com o aceite e o atendimento, na mesma transação.
   */
  converter(
    c: ContextoSadt,
    orcamento: number,
    entrada: unknown,
  ): Promise<{ id: number; atendimento: number; requisicoes: readonly PedidoGravado[] }> {
    const e = esquemaConversaoOrcamento.parse(entrada);
    return this.gravar(c, 'sadt.orcamento.convertido', async (tx, est) => {
      const [o] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, paciente_id, cpf_interessado, validade_ate, aceito_em, solicitante_profissional_id
           FROM orcamento_particular WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [orcamento, est],
        { teto: 1 },
      );
      if (!o) throw recusa('orcamento-inexistente', 'O orçamento não existe neste estabelecimento.');
      const situacao = texto(o['situacao']);
      if (!['rascunho', 'emitido', 'aceito', 'realizado'].includes(situacao))
        throw recusa(
          'orcamento-indisponivel',
          'O orçamento recusado, expirado ou cancelado não se converte.',
        );
      const itens = await tx.consultar(
        `SELECT oi.exame_id, oi.quantidade, oi.valor_total, e.nome
           FROM orcamento_particular_item oi JOIN exame e ON e.id = oi.exame_id
          WHERE oi.orcamento_particular_id = ? AND oi.tipo_item = 'exame' AND oi.excluido_em IS NULL
          ORDER BY oi.sequencia`,
        [orcamento],
      );
      const hoje = await hojeDo(tx, est);
      const conf = conferirConversao(
        {
          validade: dataIso(o['validade_ate']) ?? '',
          convertido: situacao === 'realizado',
          itens: itens.map((i) => ({ exame: String(n(i['exame_id'])), valor: n(i['valor_total']) })),
        },
        hoje,
      );
      if (!conf.pode)
        throw recusa(
          situacao === 'realizado' ? 'orcamento-convertido' : 'orcamento-nao-converte',
          conf.motivo ?? 'O orçamento não se converte.',
        );
      const at = await tx.uma(
        `SELECT a.id, a.paciente_id, pf.cpf FROM atendimento a JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [e.atendimento, est],
      );
      if (!at)
        throw recusa('atendimento-inexistente', 'O atendimento não existe neste estabelecimento.', {
          campos: ['atendimento'],
        });
      const destino = daRegra(() =>
        conferirDestinoDaConversao(
          {
            paciente: nn(o['paciente_id']),
            cpfInteressado: o['cpf_interessado'] === null ? null : texto(o['cpf_interessado']),
          },
          { paciente: n(at['paciente_id']), cpfPaciente: at['cpf'] === null ? null : texto(at['cpf']) },
        ),
      );
      const ids = itens.map((i) => n(i['exame_id']));
      const setores = await tx.consultar(
        `SELECT ese.exame_id, ese.setor_diagnostico_id, ese.padrao FROM exame_setor_executante ese
           JOIN setor_diagnostico sd ON sd.id = ese.setor_diagnostico_id
          WHERE ese.ativo = TRUE AND ese.excluido_em IS NULL AND sd.estabelecimento_id = ? AND sd.excluido_em IS NULL
            AND ese.exame_id IN (${lista(ids.length)})`,
        [est, ...ids],
      );
      const grupos = daRegra(() =>
        setoresDaConversao(
          itens.map((i) => ({
            exame: n(i['exame_id']),
            nome: texto(i['nome']),
            quantidade: Math.max(1, Math.round(n(i['quantidade']))),
            setores: setores
              .filter((s) => n(s['exame_id']) === n(i['exame_id']))
              .map((s) => ({ setor: n(s['setor_diagnostico_id']), padrao: Boolean(s['padrao']) })),
          })),
        ),
      );
      const requisicoes: PedidoGravado[] = [];
      for (const [setor, exames] of grupos) {
        const r = await this.pedido.abrirNaTransacao(
          tx,
          est,
          esquemaPedidoExames.parse({
            atendimento: e.atendimento,
            setor,
            solicitante: e.solicitante ?? nn(o['solicitante_profissional_id']),
            tipo: 'lancado_no_setor',
            prioridade: 'rotina',
            exames: exames.map((x) => ({ ...x, setor, material: null, urgente: false })),
            kits: [],
            indicacaoClinica: null,
            confirmado: true,
            justificativa: null,
          }),
        );
        const [req] = await tx.consultar('SELECT versao FROM requisicao_exame WHERE id = ?', [r.requisicao]);
        await tx.alterar('requisicao_exame', r.requisicao, n(req?.['versao']), {
          orcamento_particular_id: orcamento,
        });
        requisicoes.push(r);
      }
      const agora = new Date();
      await tx.alterar('orcamento_particular', orcamento, n(o['versao']), {
        situacao: 'realizado',
        atendimento_id: e.atendimento,
        realizado_em: hoje,
        aceito_em: o['aceito_em'] ?? agora,
        ...(destino.vinculaPaciente ? { paciente_id: n(at['paciente_id']) } : {}),
      });
      return { id: orcamento, atendimento: e.atendimento, requisicoes };
    });
  }
}
