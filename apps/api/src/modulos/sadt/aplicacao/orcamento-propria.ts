// Orçamento de exames particulares e a conversão em atendimento (F3.5, 05-SADT linha 26), no banco do cliente. A regra
// mora em @sgh/dominio-sadt (orcamento/montagem.ts e conversao.ts); aqui ficam a leitura do cadastro (exame, preço da
// tabela da fonte particular, setores executantes, atendimentos do paciente) e a gravação pelo Executor do núcleo, com a
// trilha na mesma transação. A conversão abre o pedido de exames (uma requisição por setor executante) e marca o
// orçamento realizado na MESMA transação: ou tudo fica, ou nada. Nada se apaga: o orçamento convertido fica com o
// atendimento, a data e o aceite, e a requisição aponta para ele.
import { SITUACOES_CONTA_LANCAVEL } from '@sgh/contratos/regras-faturamento';
import {
  conferirAtendimentoDaConversao,
  conferirConversao,
  conferirDestinoDaConversao,
  conferirFonteParticular,
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
import { abrirContaDaEntrada, TABELAS_CONTA_ENTRADA } from '../../faturamento/conta-entrada.js';
import { totalDosItens } from '../../faturamento/operacoes.js';
import { precoVigente, tabelasDePreco } from '../../faturamento/public-api.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';
import {
  esquemaPedidoExames,
  type PedidoGravado,
  type PedidoExames,
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
    /** Sem valor, vale o parâmetro sadt.validadeOrcamentoDias do estabelecimento (ou da rede; padrão 30). */
    validadeDias: z.number().int().min(1).max(180).optional(),
    observacao: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();
export type OrcamentoExamesEntrada = z.infer<typeof esquemaOrcamentoExames>;

export const esquemaConversaoOrcamento = z
  .object({
    atendimento: id,
    solicitante: id.nullable().default(null),
    /** Interessado sem cadastro e sem CPF para conferir: o id do paciente do atendimento, confirmado com o nome à vista. */
    confirmaPaciente: id.nullable().default(null),
    /** Os avisos das restrições do exame foram vistos e confirmados por quem converte. */
    confirmado: z.boolean().default(false),
    /** A justificativa da exceção ao bloqueio que a admite (10 caracteres ou mais). */
    justificativa: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
export type ConversaoOrcamentoEntrada = z.infer<typeof esquemaConversaoOrcamento>;

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
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly numero: string;
  readonly entradaEm: string;
  readonly situacao: string;
  readonly fonte: string;
}

const TABELAS = [
  ...new Set([
    ...TABELAS_PEDIDO,
    ...TABELAS_CONTA_ENTRADA,
    'orcamento_particular',
    'orcamento_particular_item',
  ]),
];

/** A avaliação da conversão antes do clique final: o paciente à vista e os avisos das restrições de cada exame. */
export interface AvaliacaoDaConversao {
  readonly paciente: { readonly id: number; readonly nome: string };
  /** O vínculo do interessado sem cadastro precisa da confirmação explícita (faltou CPF para conferir). */
  readonly confirmarPaciente: boolean;
  readonly restricoes: readonly {
    exame: number;
    tipo: string;
    mensagem: string;
    permiteExcecao: boolean;
  }[];
  readonly segue: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

interface ConversaoPreparada {
  readonly numero: string;
  readonly fonte: number;
  readonly desconto: number;
  readonly itens: readonly Linha[];
  readonly hoje: string;
  readonly at: Linha;
  readonly destino: { readonly vinculaPaciente: boolean };
  readonly grupos: ReadonlyMap<number, readonly { exame: number; quantidade: number }[]>;
}

function daRegra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RecusaOrcamento) throw recusa(e.codigo, e.message, { campos: [...e.campos] });
    throw e;
  }
}

/**
 * A validade padrão do orçamento (parâmetro sadt.validadeOrcamentoDias): o valor vigente do estabelecimento antes do da
 * rede; sem valor, o padrão da definição; sem definição carregada, 30 dias. Fora de 1 a 180, vale 30.
 */
async function validadePadrao(l: Leitor, est: number): Promise<number> {
  const r = await l.uma(
    `SELECT COALESCE((SELECT v.valor FROM parametro_valor v
                       WHERE v.parametro_definicao_id = d.id AND v.vigencia_inicio <= NOW()
                         AND (v.vigencia_fim IS NULL OR v.vigencia_fim > NOW())
                         AND ((v.nivel = 'estabelecimento' AND v.estabelecimento_id = ?) OR v.nivel = 'rede')
                       ORDER BY FIELD(v.nivel, 'estabelecimento', 'rede'), v.vigencia_inicio DESC LIMIT 1),
                     d.valor_padrao) AS valor
       FROM parametro_definicao d WHERE d.chave = 'sadt.validadeOrcamentoDias' AND d.ativo = TRUE`,
    [est],
  );
  const dias = Number(r?.['valor']);
  return Number.isInteger(dias) && dias >= 1 && dias <= 180 ? dias : 30;
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
    const fonte = await l.uma('SELECT id, tipo FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [
      e.fontePagadora,
    ]);
    if (!fonte)
      throw recusa('fonte-inexistente', 'A fonte pagadora não existe.', { campos: ['fontePagadora'] });
    daRegra(() => conferirFonteParticular(fonte['tipo'] === null ? null : texto(fonte['tipo'])));
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
      validade: validadeDoOrcamento(hoje, e.validadeDias ?? (await validadePadrao(l, est))),
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

  /**
   * O apoio da tela do orçamento: o catálogo de TODOS os exames do diagnóstico (laboratório, imagem e métodos
   * gráficos) e só as fontes pagadoras particulares ativas.
   */
  apoio(c: ContextoSadt): Promise<{
    exames: { id: number; codigo: string; nome: string; tipo: string }[];
    fontes: { id: number; nome: string }[];
  }> {
    return this.ler(c, async (l) => {
      const exames = await l.consultar(
        `SELECT id, codigo, nome, tipo_servico FROM exame WHERE ativo = TRUE AND excluido_em IS NULL
          ORDER BY nome, id LIMIT 5000`,
        [],
        { teto: 5000 },
      );
      const fontes = await l.consultar(
        `SELECT id, nome FROM fonte_pagadora
          WHERE tipo = 'particular' AND situacao = 'ativa' AND excluido_em IS NULL ORDER BY nome, id`,
        [],
      );
      return {
        exames: exames.map((r: Linha) => ({
          id: n(r['id']),
          codigo: texto(r['codigo']),
          nome: texto(r['nome']),
          tipo: texto(r['tipo_servico']),
        })),
        fontes: fontes.map((r: Linha) => ({ id: n(r['id']), nome: texto(r['nome']) })),
      };
    });
  }

  /**
   * Os atendimentos para a conversão, da mesma fonte particular do orçamento e não cancelados (abertos primeiro): do
   * paciente do orçamento; sem paciente, do CPF do interessado ou do paciente escolhido na busca da tela.
   */
  atendimentos(
    c: ContextoSadt,
    orcamento: number,
    pacienteEscolhido: number | null = null,
  ): Promise<AtendimentoParaConversao[]> {
    return this.ler(c, async (l, est) => {
      const o = await l.uma(
        'SELECT paciente_id, cpf_interessado, fonte_pagadora_id FROM orcamento_particular WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [orcamento, est],
      );
      if (!o) throw recusa('orcamento-inexistente', 'O orçamento não existe neste estabelecimento.');
      let filtro: string;
      let valor: unknown;
      if (o['paciente_id'] !== null) [filtro, valor] = ['a.paciente_id = ?', n(o['paciente_id'])];
      else if (pacienteEscolhido !== null) [filtro, valor] = ['a.paciente_id = ?', pacienteEscolhido];
      else if (o['cpf_interessado'] !== null) [filtro, valor] = ['pf.cpf = ?', texto(o['cpf_interessado'])];
      else return [];
      const ls = await l.consultar(
        `SELECT a.id, a.numero, a.entrada_em, a.situacao, a.paciente_id, pf.nome AS paciente_nome, fp.nome AS fonte
           FROM atendimento a JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
          WHERE a.estabelecimento_id = ? AND ${filtro} AND a.excluido_em IS NULL AND a.situacao <> 'cancelado'
            AND a.fonte_pagadora_id = ?
          ORDER BY a.saida_em IS NULL DESC, a.entrada_em DESC LIMIT 20`,
        [est, valor, n(o['fonte_pagadora_id'])],
      );
      return ls.map((r: Linha) => ({
        id: n(r['id']),
        paciente: n(r['paciente_id']),
        pacienteNome: texto(r['paciente_nome']),
        numero: texto(r['numero']),
        entradaEm: r['entrada_em'] instanceof Date ? r['entrada_em'].toISOString() : texto(r['entrada_em']),
        situacao: texto(r['situacao']),
        fonte: texto(r['fonte']),
      }));
    });
  }

  /**
   * O que a conversão confere antes de gravar, igual na avaliação e na gravação: a situação e a validade, o
   * atendimento (não cancelado, da mesma fonte particular), o paciente (ou o vínculo confirmado do interessado) e o
   * setor executante de cada exame.
   */
  private async preparar(
    l: Leitor,
    est: number,
    o: Linha,
    e: ConversaoOrcamentoEntrada,
    pacienteConfirmado: number | null,
  ): Promise<ConversaoPreparada> {
    const orcamento = n(o['id']);
    const situacao = texto(o['situacao']);
    if (!['rascunho', 'emitido', 'aceito', 'realizado'].includes(situacao))
      throw recusa('orcamento-indisponivel', 'O orçamento recusado, expirado ou cancelado não se converte.');
    const itens = await l.consultar(
      `SELECT oi.exame_id, oi.item_faturavel_id, oi.quantidade, oi.valor_unitario, oi.valor_total, e.nome
         FROM orcamento_particular_item oi JOIN exame e ON e.id = oi.exame_id
        WHERE oi.orcamento_particular_id = ? AND oi.tipo_item = 'exame' AND oi.excluido_em IS NULL
        ORDER BY oi.sequencia`,
      [orcamento],
    );
    const hoje = await hojeDo(l, est);
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
    const at = await l.uma(
      `SELECT a.id, a.paciente_id, a.situacao, a.fonte_pagadora_id, pf.cpf, pf.nome
         FROM atendimento a JOIN paciente p ON p.id = a.paciente_id
         JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
      [e.atendimento, est],
    );
    if (!at)
      throw recusa('atendimento-inexistente', 'O atendimento não existe neste estabelecimento.', {
        campos: ['atendimento'],
      });
    const fonte = n(o['fonte_pagadora_id']);
    daRegra(() =>
      conferirAtendimentoDaConversao(
        { fonte },
        { situacao: texto(at['situacao']), fonte: nn(at['fonte_pagadora_id']) },
      ),
    );
    const destino = daRegra(() =>
      conferirDestinoDaConversao(
        {
          paciente: nn(o['paciente_id']),
          cpfInteressado: o['cpf_interessado'] === null ? null : texto(o['cpf_interessado']),
        },
        { paciente: n(at['paciente_id']), cpfPaciente: at['cpf'] === null ? null : texto(at['cpf']) },
        pacienteConfirmado,
      ),
    );
    const ids = itens.map((i) => n(i['exame_id']));
    const setores = await l.consultar(
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
    return {
      numero: texto(o['numero']),
      fonte,
      desconto: n(o['valor_desconto']),
      itens,
      hoje,
      at,
      destino,
      grupos,
    };
  }

  private pedidoDoSetor(
    o: Linha,
    e: ConversaoOrcamentoEntrada,
    setor: number,
    exames: readonly { exame: number; quantidade: number }[],
  ): PedidoExames {
    return esquemaPedidoExames.parse({
      atendimento: e.atendimento,
      setor,
      solicitante: e.solicitante ?? nn(o['solicitante_profissional_id']),
      tipo: 'lancado_no_setor',
      prioridade: 'rotina',
      exames: exames.map((x) => ({ ...x, setor, material: null, urgente: false })),
      kits: [],
      indicacaoClinica: null,
      // A confirmação dos avisos e a justificativa da exceção vêm de quem converte (nunca presumidas).
      confirmado: e.confirmado,
      justificativa: e.justificativa,
    });
  }

  private static readonly COLUNAS_ORCAMENTO = `id, versao, numero, situacao, paciente_id, cpf_interessado, fonte_pagadora_id,
    validade_ate, aceito_em, solicitante_profissional_id, valor_desconto`;

  /**
   * A avaliação antes do clique final (nada gravado): o paciente do atendimento com o nome à vista, se o vínculo do
   * interessado pede confirmação, e os avisos e bloqueios das restrições de cada exame, como no pedido.
   */
  avaliarConversao(
    c: ContextoSadt,
    orcamento: number,
    entrada: unknown,
    podeAutorizarExcecao = false,
  ): Promise<AvaliacaoDaConversao> {
    const e = esquemaConversaoOrcamento.parse(entrada);
    return this.ler(c, async (l, est) => {
      const o = await l.uma(
        `SELECT ${ServicoOrcamentoSadt.COLUNAS_ORCAMENTO} FROM orcamento_particular
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [orcamento, est],
      );
      if (!o) throw recusa('orcamento-inexistente', 'O orçamento não existe neste estabelecimento.');
      const semCpf = o['paciente_id'] === null;
      // Na avaliação, o vínculo ainda não foi confirmado: confere só o que recusa de vez (CPFs diferentes, outro paciente).
      const atPaciente = await l.uma('SELECT paciente_id FROM atendimento WHERE id = ?', [e.atendimento]);
      const p = await this.preparar(l, est, o, e, nn(atPaciente?.['paciente_id']));
      const confirmarPaciente = semCpf && (o['cpf_interessado'] === null || p.at['cpf'] === null);
      const restricoes: AvaliacaoDaConversao['restricoes'][number][] = [];
      let decisao: { segue: boolean; codigo: string | null; motivo: string | null } = {
        segue: true,
        codigo: null,
        motivo: null,
      };
      for (const [setor, exames] of p.grupos) {
        const a = await this.pedido.avaliarPedido(
          c,
          this.pedidoDoSetor(o, e, setor, exames),
          podeAutorizarExcecao,
        );
        restricoes.push(
          ...a.restricoes.map((r) => ({
            exame: r.exame,
            tipo: r.tipo,
            mensagem: r.mensagem,
            permiteExcecao: r.permiteExcecao,
          })),
        );
        if (decisao.segue && !a.segue) decisao = { segue: false, codigo: a.codigo, motivo: a.motivo };
      }
      return {
        paciente: { id: n(p.at['paciente_id']), nome: texto(p.at['nome']) },
        confirmarPaciente,
        restricoes,
        ...decisao,
      };
    });
  }

  /**
   * A conversão: confere a situação, o atendimento e o paciente pela regra; abre uma requisição por setor executante
   * (com as restrições do pedido decididas por quem converte); lança os exames na conta do atendimento com os valores
   * APROVADOS no orçamento (unitário de cada item e o desconto) e confere que o lançado é o aprovado; marca o
   * orçamento realizado, com o aceite e o atendimento. Tudo na mesma transação.
   */
  converter(
    c: ContextoSadt,
    orcamento: number,
    entrada: unknown,
    podeAutorizarExcecao = false,
  ): Promise<{
    id: number;
    atendimento: number;
    conta: number;
    requisicoes: readonly PedidoGravado[];
  }> {
    const e = esquemaConversaoOrcamento.parse(entrada);
    return this.gravar(c, 'sadt.orcamento.convertido', async (tx, est) => {
      const [o] = await tx.consultarParaAtualizar(
        `SELECT ${ServicoOrcamentoSadt.COLUNAS_ORCAMENTO} FROM orcamento_particular
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [orcamento, est],
        { teto: 1 },
      );
      if (!o) throw recusa('orcamento-inexistente', 'O orçamento não existe neste estabelecimento.');
      const p = await this.preparar(tx, est, o, e, e.confirmaPaciente);
      const requisicoes: PedidoGravado[] = [];
      for (const [setor, exames] of p.grupos) {
        const r = await this.pedido.abrirNaTransacao(
          tx,
          est,
          this.pedidoDoSetor(o, e, setor, exames),
          podeAutorizarExcecao,
        );
        const [req] = await tx.consultar('SELECT versao FROM requisicao_exame WHERE id = ?', [r.requisicao]);
        await tx.alterar('requisicao_exame', r.requisicao, n(req?.['versao']), {
          orcamento_particular_id: orcamento,
        });
        requisicoes.push(r);
      }
      const conta = await this.lancarNaConta(tx, est, e.atendimento, orcamento, p);
      const agora = new Date();
      await tx.alterar('orcamento_particular', orcamento, n(o['versao']), {
        situacao: 'realizado',
        atendimento_id: e.atendimento,
        realizado_em: p.hoje,
        aceito_em: o['aceito_em'] ?? agora,
        ...(p.destino.vinculaPaciente ? { paciente_id: n(p.at['paciente_id']) } : {}),
      });
      return { id: orcamento, atendimento: e.atendimento, conta, requisicoes };
    });
  }

  /**
   * Lança os exames do orçamento na conta aberta do atendimento (abre a conta da fonte do atendimento quando falta),
   * com o valor unitário aprovado de cada item e o desconto do orçamento somado ao desconto da conta; a memória de
   * cada item aponta o orçamento. Depois confere, pela regra, que o lançado é o aprovado (mesmos exames, mesmos valores).
   */
  private async lancarNaConta(
    tx: TxOperacao,
    est: number,
    atendimento: number,
    orcamento: number,
    p: ConversaoPreparada,
  ): Promise<number> {
    const aberta = await abrirContaDaEntrada(tx, est, atendimento);
    if (aberta.conta === null)
      throw recusa(
        'conta-indisponivel',
        aberta.pendencia?.mensagem ?? 'O atendimento não tem conta para lançar os exames do orçamento.',
        { campos: ['atendimento'] },
      );
    const [conta] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, fonte_pagadora_id, valor_acrescimo, valor_desconto FROM conta_hospitalar
        WHERE id = ?`,
      [aberta.conta],
      { teto: 1 },
    );
    if (!conta || !(SITUACOES_CONTA_LANCAVEL as readonly string[]).includes(texto(conta['situacao'])))
      throw recusa(
        'conta-fechada',
        'A conta do atendimento não está aberta para lançamento: reabra a conta ou escolha outro atendimento.',
        { campos: ['atendimento'] },
      );
    if (n(conta['fonte_pagadora_id']) !== p.fonte)
      throw recusa('fonte-diferente', 'A conta do atendimento é de outra fonte pagadora.', {
        campos: ['atendimento'],
      });
    const contaId = n(conta['id']);
    const usuario = tx.contexto.usuario;
    const agora = new Date();
    const lancados: { exame: string; valor: number }[] = [];
    for (const i of p.itens) {
      const itemFat = nn(i['item_faturavel_id']);
      if (itemFat === null)
        throw recusa(
          'exame-sem-item-faturavel',
          `O exame ${texto(i['nome'])} não tem item faturável no catálogo: ligue o item antes de converter.`,
        );
      const fat = await tx.uma('SELECT grupo_faturamento_id FROM item_faturavel WHERE id = ?', [itemFat]);
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
        [contaId],
      );
      const unitario = n(i['valor_unitario']);
      const total = n(i['valor_total']);
      const item = await tx.incluir('conta_hospitalar_item', {
        conta_hospitalar_id: contaId,
        sequencia: n(seq?.['s']),
        item_faturavel_id: itemFat,
        grupo_faturamento_id: nn(fat?.['grupo_faturamento_id']),
        realizado_em: agora,
        quantidade: n(i['quantidade']),
        valor_unitario: unitario,
        percentual_cobranca: 100,
        valor_total: total,
        tipo_valorizacao: 'manual',
        situacao: 'lancado',
        observacao: `Valor aprovado no orçamento particular ${p.numero}.`.slice(0, 2000),
      });
      await tx.incluir('conta_hospitalar_item_memoria', {
        conta_hospitalar_item_id: item,
        operacao: 'inclusao',
        valor_unitario_calculado: unitario,
        valor_total_calculado: total,
        preco_manual: 1,
        percentual_aplicado: 100,
        dados: JSON.stringify({ origemPreco: 'orcamento_particular', orcamento, numero: p.numero }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
      const [gravado] = await tx.consultar('SELECT valor_total FROM conta_hospitalar_item WHERE id = ?', [
        item,
      ]);
      lancados.push({ exame: String(n(i['exame_id'])), valor: n(gravado?.['valor_total']) });
    }
    const conf = conferirConversao(
      {
        validade: '9999-12-31',
        convertido: false,
        itens: p.itens.map((i) => ({ exame: String(n(i['exame_id'])), valor: n(i['valor_total']) })),
      },
      p.hoje,
      lancados,
    );
    if (!conf.pode) throw recusa('lancamento-divergente', conf.motivo ?? 'O lançado difere do aprovado.');
    // O desconto aprovado no orçamento entra no desconto da conta; o total da conta sai dos itens (sem gatilho).
    const desconto = Math.round((n(conta['valor_desconto']) + p.desconto) * 100) / 100;
    const t = await totalDosItens(tx, contaId);
    await tx.alterar('conta_hospitalar', contaId, n(conta['versao']), {
      valor_itens: t.valor_itens,
      valor_filme: t.valor_filme,
      valor_desconto: desconto,
      valor_total: Math.max(
        0,
        Math.round((t.valor_itens + n(conta['valor_acrescimo']) - desconto) * 100) / 100,
      ),
      calculada: false,
    });
    return contaId;
  }
}
