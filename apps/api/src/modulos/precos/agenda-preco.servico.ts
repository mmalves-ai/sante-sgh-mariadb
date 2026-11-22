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
import { origemDaTabela, resolverPreco, verificarCredenciamento } from '@sgh/dominio-preco';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
} from '@sgh/nucleo';
import {
  candidatasPrecoParticular,
  credenciamentosVigentes,
  credenciarTodosAtivos,
  definirOpcoesCredenciamentoConvenio,
  fonteParticularPadrao,
  incluirCoberturaAgenda,
  incluirCredenciamento,
  incluirPreparoAgenda,
  incluirRegraPrecoParticular,
  incluirRestricaoAgenda,
  lerAgendaEstruturada,
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

  /** O cálculo do preço de um item com a origem (a mesma regra que o lançamento na conta usa). */
  calcular(ctx: ContextoNucleo, pedido: PedidoCalculo): Promise<ResultadoCalculoPreco> {
    const est = this.estabelecimento(ctx);
    return this.ler(ctx, (l) => this.calcularCom(l, est, pedido));
  }

  private async calcularCom(l: Leitor, est: number, p: PedidoCalculo): Promise<ResultadoCalculoPreco> {
    const fonte = p.fontePagadoraId ?? (await fonteParticularPadrao(l, this.codigoParticular));
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
    q: { profissionalId: number; fontePagadoraId: number; data: string },
  ): Promise<Credenciamento[]> {
    const est = this.estabelecimento(ctx);
    return this.ler(ctx, (l) => credenciamentosVigentes(l, { ...q, estabelecimentoId: est }));
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
      const particular = await fonteParticularPadrao(l, this.codigoParticular);
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
