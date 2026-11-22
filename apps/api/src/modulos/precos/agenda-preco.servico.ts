// ADR 0009 na API: regra de preço PARTICULAR do médico ou da agenda, o cálculo com a origem do preço, o
// credenciamento (alerta ou bloqueio, opção do convênio; credenciar todos ao criar) e a agenda estruturada (cobertura,
// restrições, preparo e o texto original ao lado), com as respostas às perguntas do paciente. As leituras e gravações
// são as da porta (@sgh/persistencia); quem escolhe e explica é o domínio (@sgh/dominio-preco, @sgh/dominio-agenda).
// As gravações passam pelo executor do núcleo (trilha, idempotência, tabelas declaradas).
import {
  esquemaEntradaCoberturaAgenda,
  esquemaEntradaCredenciamento,
  esquemaEntradaPreparoAgenda,
  esquemaEntradaRegraPrecoParticular,
  esquemaEntradaRestricaoAgenda,
  esquemaOpcoesCredenciamentoConvenio,
  SITUACOES_REVISAO_REGRA,
  type AgendaEstruturada,
  type Credenciamento,
  type FiltroRegrasPrecoParticular,
  type OpcoesCredenciamentoConvenio,
  type RegraPrecoParticular,
  type ResultadoCalculoPreco,
  type VerificacaoCredenciamento,
} from '@sgh/contratos';
import {
  agendaAtendeConvenio,
  agendaAtendePaciente,
  preparoDoExame,
  type RespostaConvenio,
  type RespostaPreparo,
  type RespostaRestricao,
} from '@sgh/dominio-agenda';
import {
  deveCredenciarTodosAoCriar,
  origemDaTabela,
  resolverPreco,
  verificarCredenciamento,
} from '@sgh/dominio-preco';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  erroConflitoVersao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
} from '@sgh/nucleo';
import {
  alterarRegraPrecoParticular,
  candidatasPrecoParticular,
  credenciamentosVigentes,
  codigoParticularDoParametro,
  credenciarTodosAtivos,
  definirOpcoesCredenciamentoConvenio,
  fonteParticularPadrao,
  incluirConvenio,
  incluirCoberturaAgenda,
  incluirCredenciamento,
  incluirPreparoAgenda,
  incluirRegraPrecoParticular,
  incluirRestricaoAgenda,
  lerAgendaEstruturada,
  listarCredenciamentosVigentes,
  listarRegrasPrecoParticular,
  opcoesCredenciamentoConvenio,
} from '@sgh/persistencia';
import { z } from 'zod';
import { precoVigente, tabelasDePreco } from '../faturamento/operacoes.js';

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function tipoDaFonte(l: Leitor, fonte: number): Promise<string | null> {
  const u = await l.uma<Linha>('SELECT tipo FROM fonte_pagadora WHERE id = ?', [fonte]);
  return u ? String(u['tipo']) : null;
}

// ---------------------------------------------------------------- operações (gravação)

export const opIncluirRegraParticular = definirOperacao({
  nome: 'preco.incluir-regra-particular',
  tabelas: ['regra_preco_particular'],
  entrada: esquemaEntradaRegraPrecoParticular,
  async gravar(tx, e, ctx) {
    // Decisão 24: a regra do médico ou da agenda só existe no particular.
    const tipo = await tipoDaFonte(tx, e.fontePagadoraId);
    if (tipo === null)
      throw recusa('fonte-inexistente', 'A fonte pagadora não existe.', { campos: ['fontePagadoraId'] });
    if (tipo !== 'particular')
      throw recusa(
        'convenio-sem-preco-por-medico',
        'Preço por médico ou agenda só no particular: no convênio, o preço vem da tabela da conta, do plano ou do convênio.',
        { campos: ['fontePagadoraId'] },
      );
    if (
      e.estabelecimentoId !== null &&
      ctx.estabelecimento !== null &&
      e.estabelecimentoId !== ctx.estabelecimento
    )
      throw recusa('fora-do-estabelecimento', 'A regra é de outro estabelecimento.', {
        campos: ['estabelecimentoId'],
      });
    return { id: await incluirRegraPrecoParticular(tx, e, ctx.usuario) };
  },
  alvo: (_e, s) => ({ tabela: 'regra_preco_particular', id: s.id }),
});

/** Revisão da regra (PUT): confirmar, recusar ou corrigir a estimada, com a versão lida. */
export const esquemaRevisaoRegraParticular = z.object({
  id,
  versao: z.number().int().positive(),
  valores: z
    .object({
      valor: z.number().nonnegative().multipleOf(0.01),
      prioridade: z.number().int().min(0).max(65_535),
      vigenciaInicio: data,
      vigenciaFim: data.nullable(),
      situacaoRevisao: z.enum(SITUACOES_REVISAO_REGRA),
      observacao: z.string().max(500).nullable(),
    })
    .partial()
    .strict()
    .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada a alterar.'),
});

export const opRevisarRegraParticular = definirOperacao({
  nome: 'preco.revisar-regra-particular',
  tabelas: ['regra_preco_particular'],
  entrada: esquemaRevisaoRegraParticular,
  async gravar(tx, e, ctx) {
    const atual = await tx.uma<Linha>(
      `SELECT estabelecimento_id, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS vi, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS vf
         FROM regra_preco_particular WHERE id = ? AND excluido_em IS NULL`,
      [e.id],
    );
    if (!atual) throw recusa('regra-inexistente', 'A regra de preço não existe.', { campos: ['id'] });
    const est = atual['estabelecimento_id'] == null ? null : Number(atual['estabelecimento_id']);
    if (est !== null && ctx.estabelecimento !== null && est !== ctx.estabelecimento)
      throw recusa('fora-do-estabelecimento', 'A regra é de outro estabelecimento.', { campos: ['id'] });
    const inicio = e.valores.vigenciaInicio ?? String(atual['vi']);
    const fim =
      e.valores.vigenciaFim === undefined
        ? atual['vf'] == null
          ? null
          : String(atual['vf'])
        : e.valores.vigenciaFim;
    if (fim !== null && fim < inicio)
      throw recusa('vigencia-invalida', 'O fim da vigência é anterior ao início.', {
        campos: ['valores.vigenciaFim'],
      });
    const n = await alterarRegraPrecoParticular(tx, e.id, e.versao, e.valores, ctx.usuario);
    if (n === 0) throw erroConflitoVersao(['versao']);
    return { id: e.id };
  },
  alvo: (e) => ({ tabela: 'regra_preco_particular', id: e.id }),
});

export const opIncluirCredenciamento = definirOperacao({
  nome: 'convenio.incluir-credenciamento',
  tabelas: ['profissional_fonte_pagadora'],
  entrada: esquemaEntradaCredenciamento,
  async gravar(tx, e, ctx) {
    if ((await tipoDaFonte(tx, e.fontePagadoraId)) === 'particular')
      throw recusa('particular-sem-credenciamento', 'O particular não tem credenciamento.', {
        campos: ['fontePagadoraId'],
      });
    return { id: await incluirCredenciamento(tx, e, ctx.usuario) };
  },
  alvo: (_e, s) => ({ tabela: 'profissional_fonte_pagadora', id: s.id }),
});

export const opDefinirOpcoesCredenciamento = definirOperacao({
  nome: 'convenio.definir-opcoes-credenciamento',
  tabelas: ['fonte_pagadora'],
  entrada: esquemaOpcoesCredenciamentoConvenio,
  async gravar(tx, e, ctx) {
    const n = await definirOpcoesCredenciamentoConvenio(tx, e, ctx.usuario);
    if (n === 0) throw recusa('fonte-inexistente', 'O convênio não existe.', { campos: ['fontePagadoraId'] });
    return { id: e.fontePagadoraId };
  },
  alvo: (e) => ({ tabela: 'fonte_pagadora', id: e.fontePagadoraId }),
});

export const opCredenciarTodos = definirOperacao({
  nome: 'convenio.credenciar-todos-ativos',
  tabelas: ['profissional_fonte_pagadora'],
  entrada: z.object({ fontePagadoraId: id, vigenciaInicio: data }),
  async gravar(tx, e, ctx) {
    if ((await tipoDaFonte(tx, e.fontePagadoraId)) === 'particular')
      throw recusa('particular-sem-credenciamento', 'O particular não tem credenciamento.', {
        campos: ['fontePagadoraId'],
      });
    return {
      credenciados: await credenciarTodosAtivos(tx, e.fontePagadoraId, e.vigenciaInicio, ctx.usuario),
    };
  },
  alvo: (e) => ({ tabela: 'fonte_pagadora', id: e.fontePagadoraId }),
});

/** Convênio novo (decisão 26): com credencia_todos_ao_criar, credencia na mesma transação todos os médicos ativos. */
export const esquemaConvenioNovo = z
  .object({
    codigo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,30}$/),
    nome: z.string().trim().min(2).max(150),
    tipo: z.enum([
      'operadora',
      'seguradora',
      'autogestao',
      'cooperativa',
      'medicina_grupo',
      'filantropia',
      'particular',
      'publico',
      'empresa',
      'convenio_proprio',
      'outro',
    ]),
    registroAns: z
      .string()
      .trim()
      .regex(/^\d{1,10}$/)
      .nullable()
      .default(null),
    bloqueiaSemCredenciamento: z.boolean().default(false),
    credenciaTodosAoCriar: z.boolean().default(false),
    /** Início da relação e da vigência do credenciamento em massa (AAAA-MM-DD). */
    dataInicioRelacao: data,
  })
  .strict();

export const opIncluirConvenio = definirOperacao({
  nome: 'convenio.incluir-convenio',
  tabelas: ['fonte_pagadora', 'profissional_fonte_pagadora'],
  entrada: esquemaConvenioNovo,
  acao: 'inclusao',
  async gravar(tx, e, ctx) {
    const particular = e.tipo === 'particular';
    if (particular && (e.bloqueiaSemCredenciamento || e.credenciaTodosAoCriar))
      throw recusa('particular-sem-credenciamento', 'O particular não tem credenciamento.', {
        campos: ['credenciaTodosAoCriar'],
      });
    const id = await incluirConvenio(tx, e, ctx.usuario);
    if (id === null)
      throw recusa('codigo-em-uso', 'Já existe uma fonte pagadora com este código.', { campos: ['codigo'] });
    const credenciados = deveCredenciarTodosAoCriar(
      {
        fontePagadoraId: id,
        bloqueiaSemCredenciamento: e.bloqueiaSemCredenciamento,
        credenciaTodosAoCriar: e.credenciaTodosAoCriar,
      },
      particular,
    )
      ? await credenciarTodosAtivos(tx, id, e.dataInicioRelacao, ctx.usuario)
      : 0;
    return { id, credenciados };
  },
  alvo: (_e, s) => ({ tabela: 'fonte_pagadora', id: s.id }),
});

export const opIncluirCobertura = definirOperacao({
  nome: 'agenda.incluir-cobertura',
  tabelas: ['agenda_cobertura'],
  entrada: esquemaEntradaCoberturaAgenda,
  async gravar(tx, e, ctx) {
    return { id: await incluirCoberturaAgenda(tx, e, ctx.usuario) };
  },
  alvo: (_e, s) => ({ tabela: 'agenda_cobertura', id: s.id }),
});

export const opIncluirRestricao = definirOperacao({
  nome: 'agenda.incluir-restricao',
  tabelas: ['agenda_restricao'],
  entrada: esquemaEntradaRestricaoAgenda,
  async gravar(tx, e, ctx) {
    return { id: await incluirRestricaoAgenda(tx, e, ctx.usuario) };
  },
  alvo: (_e, s) => ({ tabela: 'agenda_restricao', id: s.id }),
});

export const opIncluirPreparo = definirOperacao({
  nome: 'agenda.incluir-preparo',
  tabelas: ['agenda_preparo'],
  entrada: esquemaEntradaPreparoAgenda,
  async gravar(tx, e, ctx) {
    return { id: await incluirPreparoAgenda(tx, e, ctx.usuario) };
  },
  alvo: (_e, s) => ({ tabela: 'agenda_preparo', id: s.id }),
});

// ---------------------------------------------------------------- pedidos de leitura

export const esquemaPedidoCalculo = z.object({
  /** Nulo: o particular padrão do hospital (parâmetro faturamento.fontePagadoraParticularCodigo). */
  fontePagadoraId: id.nullable().default(null),
  planoId: id.nullable().default(null),
  profissionalId: id.nullable().default(null),
  agendaId: id.nullable().default(null),
  itemFaturavelId: id.nullable().default(null),
  /** O item é a consulta do profissional ou da agenda. */
  consulta: z.boolean().default(false),
  tabelaContaId: id.nullable().default(null),
  data,
});
export type PedidoCalculo = z.infer<typeof esquemaPedidoCalculo>;

export const esquemaPerguntasAgenda = z.object({
  data,
  fontePagadoraId: id.nullable().default(null),
  planoId: id.nullable().default(null),
  idadeAnos: z.number().int().min(0).max(130).nullable().default(null),
  sexo: z.enum(['feminino', 'masculino']).nullable().default(null),
  itemAgendavelId: id.nullable().default(null),
  retorno: z.boolean().default(false),
  encaixe: z.boolean().default(false),
});
export type PerguntasAgenda = z.infer<typeof esquemaPerguntasAgenda>;

export interface RespostasAgenda {
  readonly agendaId: number;
  readonly nome: string;
  readonly convenio: RespostaConvenio | null;
  readonly paciente: RespostaRestricao;
  readonly preparo: RespostaPreparo;
  /** Preço particular da consulta da agenda (regra da agenda ou do médico, senão a tabela do particular). */
  readonly precoParticular: ResultadoCalculoPreco | null;
  /** Os textos originais da agenda, íntegros, para mostrar ao lado das respostas. */
  readonly textos: AgendaEstruturada['textos'];
}

export class ServicoAgendaPreco {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoProprio,
    /** Código do particular padrão (parâmetro faturamento.fontePagadoraParticularCodigo); nulo: a única ativa. */
    private readonly codigoParticular: string | null = null,
  ) {
    this.executor = nucleo.criarExecutor({});
  }

  private ler<T>(ctx: ContextoNucleo, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: ctx.cliente, estabelecimento: ctx.estabelecimento, correlacao: ctx.correlacao },
      fn,
    );
  }

  /** O código do particular padrão: o fixado no construtor (testes) ou o parâmetro vigente do estabelecimento. */
  private async codigoDoParticular(l: Leitor, est: number): Promise<string | null> {
    return this.codigoParticular ?? (await codigoParticularDoParametro(l, est));
  }

  private estabelecimento(ctx: ContextoNucleo): number {
    if (ctx.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
    return ctx.estabelecimento;
  }

  private async gravar<E>(op: Parameters<Executor['executar']>[0], ctx: ContextoOperacao, e: E) {
    const r = await this.executor.executar(op, ctx.cliente, e, ctx);
    return r.resultado;
  }

  // -- regra de preço particular
  listarRegras(ctx: ContextoNucleo, f: FiltroRegrasPrecoParticular): Promise<RegraPrecoParticular[]> {
    return this.ler(ctx, (l) => listarRegrasPrecoParticular(l, f));
  }
  incluirRegra(ctx: ContextoOperacao, e: unknown) {
    return this.gravar(opIncluirRegraParticular, ctx, e);
  }
  revisarRegra(ctx: ContextoOperacao, e: unknown) {
    return this.gravar(opRevisarRegraParticular, ctx, e);
  }

  /**
   * Prévia do preço de um procedimento no atendimento, antes de lançar: a conta (ou a cobertura) dá o convênio, o
   * plano e a tabela; o profissional e a agenda da marcação são os do atendimento; "consulta" é o item que o catálogo
   * de agendamento marca como consulta. Os mesmos critérios do lançamento na conta (faturamento/operacoes.ts).
   * Nulo quando o atendimento não existe.
   */
  precoDoAtendimento(
    ctx: ContextoNucleo,
    atendimentoId: number,
    itemFaturavelId: number,
    data: string,
  ): Promise<ResultadoCalculoPreco | null> {
    const est = this.estabelecimento(ctx);
    return this.ler(ctx, async (l) => {
      const at = await l.uma<Linha>(
        `SELECT a.profissional_id, ha.agenda_servico_id FROM atendimento a
           LEFT JOIN marcacao_horario m ON m.id = a.marcacao_horario_id
           LEFT JOIN horario_agenda ha ON ha.id = m.horario_agenda_id
          WHERE a.id = ?`,
        [atendimentoId],
      );
      if (!at) return null;
      const num = (v: unknown) => (v == null ? null : Number(v));
      const conta = await l.uma<Linha>(
        `SELECT fonte_pagadora_id, plano_fonte_pagadora_id, tabela_preco_id FROM conta_hospitalar
          WHERE atendimento_id = ? AND excluido_em IS NULL AND conta_pai_id IS NULL ORDER BY id DESC LIMIT 1`,
        [atendimentoId],
      );
      const cobertura = conta
        ? null
        : await l.uma<Linha>(
            `SELECT fonte_pagadora_id, plano_fonte_pagadora_id FROM cobertura_atendimento
              WHERE atendimento_id = ? ORDER BY ordem LIMIT 1`,
            [atendimentoId],
          );
      const origem = conta ?? cobertura;
      const fonte = num(origem?.['fonte_pagadora_id']);
      if (fonte === null)
        throw recusa('atendimento-sem-convenio', 'O atendimento não tem conta nem convênio.', { campos: [] });
      const consulta = await l.uma<Linha>(
        `SELECT id FROM item_agendavel WHERE item_faturavel_id = ? AND tipo_item = 'consulta' AND excluido_em IS NULL
          LIMIT 1`,
        [itemFaturavelId],
      );
      return this.calcularCom(l, est, {
        fontePagadoraId: fonte,
        planoId: num(origem?.['plano_fonte_pagadora_id']),
        profissionalId: num(at['profissional_id']),
        agendaId: num(at['agenda_servico_id']),
        itemFaturavelId,
        consulta: consulta !== null,
        tabelaContaId: num(conta?.['tabela_preco_id']),
        data,
      });
    });
  }

  /** O cálculo do preço de um item com a origem (a mesma regra que o lançamento na conta usa). */
  calcular(ctx: ContextoNucleo, pedido: PedidoCalculo): Promise<ResultadoCalculoPreco> {
    const est = this.estabelecimento(ctx);
    return this.ler(ctx, (l) => this.calcularCom(l, est, pedido));
  }

  private async calcularCom(l: Leitor, est: number, p: PedidoCalculo): Promise<ResultadoCalculoPreco> {
    const fonte =
      p.fontePagadoraId ?? (await fonteParticularPadrao(l, await this.codigoDoParticular(l, est)));
    if (fonte === null)
      throw recusa(
        'particular-indefinido',
        'Defina o particular padrão do hospital (parâmetro do faturamento).',
        {
          campos: ['fontePagadoraId'],
        },
      );
    const tipo = await tipoDaFonte(l, fonte);
    if (tipo === null)
      throw recusa('fonte-inexistente', 'A fonte pagadora não existe.', { campos: ['fontePagadoraId'] });
    const particular = tipo === 'particular';
    let grupo: number | null = null;
    if (p.itemFaturavelId !== null) {
      const i = await l.uma<Linha>('SELECT grupo_faturamento_id FROM item_faturavel WHERE id = ?', [
        p.itemFaturavelId,
      ]);
      grupo = i?.['grupo_faturamento_id'] == null ? null : Number(i['grupo_faturamento_id']);
    }
    let planoSuperior: number | null = null;
    let tabelaPlano: number | null = null;
    if (p.planoId !== null) {
      const pl = await l.uma<Linha>(
        'SELECT plano_superior_id, tabela_preco_id FROM plano_fonte_pagadora WHERE id = ?',
        [p.planoId],
      );
      planoSuperior = pl?.['plano_superior_id'] == null ? null : Number(pl['plano_superior_id']);
      tabelaPlano = pl?.['tabela_preco_id'] == null ? null : Number(pl['tabela_preco_id']);
    }
    const candidatas = particular
      ? await candidatasPrecoParticular(l, {
          fontePagadoraId: fonte,
          profissionalId: p.profissionalId,
          agendaId: p.agendaId,
          estabelecimentoId: est,
          data: p.data,
        })
      : [];
    let tabela = null;
    if (p.itemFaturavelId !== null) {
      const ids = await tabelasDePreco(l, est, fonte, p.planoId, p.tabelaContaId);
      const v = await precoVigente(l, ids, p.itemFaturavelId, p.data);
      if (v)
        tabela = {
          valor: v.unitario,
          tabelaPrecoId: v.tabela,
          origem: origemDaTabela(v.tabela, p.tabelaContaId, tabelaPlano),
          vigencia: v.vigencia,
        };
    }
    const credenciamento =
      particular || p.profissionalId === null
        ? null
        : await this.verificarCom(l, est, {
            profissionalId: p.profissionalId,
            fontePagadoraId: fonte,
            planoId: p.planoId,
            planoSuperiorId: planoSuperior,
            data: p.data,
          });
    return resolverPreco({
      particular,
      pedido: {
        profissionalId: p.profissionalId,
        agendaId: p.agendaId,
        estabelecimentoId: est,
        fontePagadoraId: fonte,
        data: p.data,
        alvo: { itemFaturavelId: p.itemFaturavelId, grupoFaturamentoId: grupo, consulta: p.consulta },
      },
      candidatas,
      tabela,
      credenciamento,
    });
  }

  // -- credenciamento
  credenciamentos(
    ctx: ContextoNucleo,
    q: { profissionalId: number | null; fontePagadoraId: number | null; data: string },
  ): Promise<Credenciamento[]> {
    const est = this.estabelecimento(ctx);
    return this.ler(ctx, (l) => listarCredenciamentosVigentes(l, { ...q, estabelecimentoId: est }));
  }

  verificar(
    ctx: ContextoNucleo,
    q: { profissionalId: number; fontePagadoraId: number; planoId: number | null; data: string },
  ): Promise<VerificacaoCredenciamento> {
    const est = this.estabelecimento(ctx);
    return this.ler(ctx, async (l) => {
      let sup: number | null = null;
      if (q.planoId !== null) {
        const pl = await l.uma<Linha>('SELECT plano_superior_id FROM plano_fonte_pagadora WHERE id = ?', [
          q.planoId,
        ]);
        sup = pl?.['plano_superior_id'] == null ? null : Number(pl['plano_superior_id']);
      }
      return this.verificarCom(l, est, { ...q, planoSuperiorId: sup });
    });
  }

  private async verificarCom(
    l: Leitor,
    est: number,
    q: {
      profissionalId: number;
      fontePagadoraId: number;
      planoId: number | null;
      planoSuperiorId: number | null;
      data: string;
    },
  ): Promise<VerificacaoCredenciamento> {
    const particular = (await tipoDaFonte(l, q.fontePagadoraId)) === 'particular';
    const [credenciamentos, opcoes] = await Promise.all([
      credenciamentosVigentes(l, { ...q, estabelecimentoId: est }),
      opcoesCredenciamentoConvenio(l, q.fontePagadoraId),
    ]);
    return verificarCredenciamento({ ...q, particular, credenciamentos, opcoes });
  }

  opcoes(ctx: ContextoNucleo, fonte: number): Promise<OpcoesCredenciamentoConvenio | null> {
    return this.ler(ctx, (l) => opcoesCredenciamentoConvenio(l, fonte));
  }
  definirOpcoes(ctx: ContextoOperacao, e: unknown) {
    return this.gravar(opDefinirOpcoesCredenciamento, ctx, e);
  }
  incluirCredenciamento(ctx: ContextoOperacao, e: unknown) {
    return this.gravar(opIncluirCredenciamento, ctx, e);
  }
  credenciarTodos(ctx: ContextoOperacao, e: unknown) {
    return this.gravar(opCredenciarTodos, ctx, e);
  }
  incluirConvenio(ctx: ContextoOperacao, e: unknown) {
    return this.gravar(opIncluirConvenio, ctx, e);
  }

  // -- agenda estruturada
  agendaEstruturada(ctx: ContextoNucleo, agendaId: number, data?: string): Promise<AgendaEstruturada | null> {
    return this.ler(ctx, (l) => lerAgendaEstruturada(l, agendaId, data));
  }
  incluirCobertura(ctx: ContextoOperacao, e: unknown) {
    return this.gravar(opIncluirCobertura, ctx, e);
  }
  incluirRestricao(ctx: ContextoOperacao, e: unknown) {
    return this.gravar(opIncluirRestricao, ctx, e);
  }
  incluirPreparo(ctx: ContextoOperacao, e: unknown) {
    return this.gravar(opIncluirPreparo, ctx, e);
  }

  /** As perguntas do paciente (seção 6) respondidas pela regra estruturada, com o texto original ao lado. */
  responder(ctx: ContextoNucleo, agendaId: number, p: PerguntasAgenda): Promise<RespostasAgenda | null> {
    const est = this.estabelecimento(ctx);
    return this.ler(ctx, async (l) => {
      const a = await lerAgendaEstruturada(l, agendaId);
      if (!a) return null;
      let sup: number | null = null;
      if (p.planoId !== null) {
        const pl = await l.uma<Linha>('SELECT plano_superior_id FROM plano_fonte_pagadora WHERE id = ?', [
          p.planoId,
        ]);
        sup = pl?.['plano_superior_id'] == null ? null : Number(pl['plano_superior_id']);
      }
      const convenio =
        p.fontePagadoraId === null
          ? null
          : agendaAtendeConvenio(a, {
              fontePagadoraId: p.fontePagadoraId,
              planoId: p.planoId,
              planoSuperiorId: sup,
              data: p.data,
            });
      const paciente = agendaAtendePaciente(a, {
        data: p.data,
        idadeAnos: p.idadeAnos,
        sexo: p.sexo,
        fontePagadoraId: p.fontePagadoraId,
        planoId: p.planoId,
        itemAgendavelId: p.itemAgendavelId,
        retorno: p.retorno,
        encaixe: p.encaixe,
      });
      const preparo = preparoDoExame(a, { data: p.data, itemAgendavelId: p.itemAgendavelId });
      const particular = await fonteParticularPadrao(l, await this.codigoDoParticular(l, est));
      const precoParticular =
        particular === null
          ? null
          : await this.calcularCom(l, est, {
              fontePagadoraId: particular,
              planoId: null,
              profissionalId: a.profissionalId,
              agendaId: a.agendaId,
              itemFaturavelId: null,
              consulta: true,
              tabelaContaId: null,
              data: p.data,
            });
      return {
        agendaId: a.agendaId,
        nome: a.nome,
        convenio,
        paciente,
        preparo,
        precoParticular,
        textos: a.textos,
      };
    });
  }
}
