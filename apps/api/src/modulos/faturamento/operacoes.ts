// Operações de gravação da conta do paciente (M30) sobre o banco do cliente, pelo Executor do @sgh/nucleo: fechar,
// reabrir, conferir itens e lançar item. Cada uma declara as tabelas que grava; trilha, outbox e idempotência vão na
// mesma transação, e a conta é travada e relida (trava otimista pela coluna `versao`). As regras ficam em
// regras-conta.ts (puras); aqui ficam as conferências sob a trava e as escritas.
// Melhoria: o fechamento e a reabertura mudam a situação do modelo e registram a passagem em conta_hospitalar_etapa
// (situação anterior e nova, valor da conta, motivo), sem marca de texto nem gatilho; o lançamento busca o preço na
// tabela de preço da conta (vigência em preco_procedimento_valor), confere o preço manual pela faixa da tabela e
// recalcula o total da conta na própria operação, a partir dos itens (nada de recálculo por gatilho).
// Melhoria: fechar e lançar recusam a competência fechada da fonte pagadora (regra 9), lida sob a transação; o
// lançamento grava a memória do cálculo (conta_hospitalar_item_memoria: tabela, vigência, unitário da tabela, preço
// manual com aprovador e justificativa, ato) e liga o setor ao setor_funcional do estabelecimento.
// Decisão: o item que não está em nenhuma tabela de preço da conta continua recusado ('item-fora-da-tabela'), mesmo
// com preço manual (o manual só vale contra a faixa de uma tabela); o item da tabela sem vigência na data aceita o
// preço manual, com aprovação, como na memória.
import {
  dataHoraParaInstante,
  type ConferirItemEntrada,
  esquemaConferirItem,
  esquemaFecharConta,
  esquemaLancarItem,
  esquemaReabrirConta,
  type FecharContaEntrada,
  type LancarItemEntrada,
  type ReabrirContaEntrada,
  type RegraPrecoParticular,
  type VerificacaoCredenciamento,
} from '@sgh/contratos';
import { conferirPrecoManual } from '@sgh/dominio-faturamento';
import { escolherRegraPrecoParticular, verificarCredenciamento } from '@sgh/dominio-preco';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  erroConflitoVersao,
  erroEntradaInvalida,
  type Leitor,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  candidatasPrecoParticular,
  credenciamentosVigentes,
  opcoesCredenciamentoConvenio,
} from '@sgh/persistencia';
import { versaoNumero } from './esquemas.js';
import {
  conferirCompetenciaDaConta,
  conferirConferenciaItens,
  conferirFechamentoConta,
  conferirLancamento,
  conferirReaberturaConta,
  tiposDoGrupo,
  valorDoItem,
} from './regras-conta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Faixa do preço manual em relação ao da tabela (10% abaixo, 20% acima) sem aprovação. */
export const FAIXA_PRECO_MANUAL = { abaixo: 0.1, acima: 0.2 } as const;

function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
const naoEncontrada = () =>
  new ErroOperacao(404, 'registro-inexistente', 'Conta inexistente', 'A conta não existe.');
const recusaDe = (r: { codigo: string; mensagem: string; campos?: readonly string[] }) =>
  recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});

function versaoDaTela(v: string): number {
  const x = versaoNumero(v);
  if (x === null) throw erroEntradaInvalida(['versao']);
  return x;
}

interface ContaLida {
  readonly id: number;
  readonly versao: number;
  readonly situacao: string;
  readonly fonte: number;
  readonly tabela: number | null;
  readonly plano: number | null;
  readonly total: number;
  /** A competência como veio do banco (primeiro dia do mês), devolvida como parâmetro. */
  readonly competencia: unknown;
}

/** A conta já travada pelo passo 2 do executor, relida com o que as operações precisam. */
async function contaDa(tx: TxOperacao, id: number, est: number): Promise<ContaLida> {
  const x = await tx.uma<Linha>(
    `SELECT id, versao, situacao, fonte_pagadora_id, tabela_preco_id, plano_fonte_pagadora_id, valor_total,
            competencia
       FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!x) throw naoEncontrada();
  return {
    id: n(x['id']),
    versao: n(x['versao']),
    situacao: texto(x['situacao']),
    fonte: n(x['fonte_pagadora_id']),
    tabela: x['tabela_preco_id'] === null ? null : n(x['tabela_preco_id']),
    plano: x['plano_fonte_pagadora_id'] === null ? null : n(x['plano_fonte_pagadora_id']),
    total: n(x['valor_total']),
    competencia: x['competencia'],
  };
}

/**
 * Regra 9: a competência da conta precisa estar aberta para a fonte pagadora. Lê, na transação e com trava
 * (o fechamento concorrente da competência espera), o fechamento da fonte e a competência do faturamento de convênios.
 */
async function conferirCompetencia(tx: TxOperacao, conta: ContaLida, est: number): Promise<void> {
  const [daFonte] = await tx.consultarParaAtualizar<Linha>(
    `SELECT situacao FROM fechamento_competencia_fonte_pagadora
      WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND excluido_em IS NULL`,
    [est, conta.fonte, conta.competencia],
    { teto: 1 },
  );
  const [geral] = await tx.consultarParaAtualizar<Linha>(
    `SELECT situacao FROM competencia_faturamento
      WHERE estabelecimento_id = ? AND modulo = 'fonte_pagadora' AND competencia = ? AND excluido_em IS NULL`,
    [est, conta.competencia],
    { teto: 1 },
  );
  const r = conferirCompetenciaDaConta(
    daFonte ? texto(daFonte['situacao']) : null,
    geral ? texto(geral['situacao']) : null,
  );
  if (r) throw recusaDe(r);
}

/** Confere, sob a trava, que a conta é do estabelecimento da sessão (outro estabelecimento: 404). */
async function conferirDoEstabelecimento(relido: Linha | null, ctx: ContextoOperacao): Promise<void> {
  if (!relido || n(relido['estabelecimento_id']) !== estabelecimentoDe(ctx) || relido['excluido_em'] !== null)
    throw naoEncontrada();
}

async function registrarEtapa(
  tx: TxOperacao,
  conta: ContaLida,
  nova: string,
  dados: Readonly<Record<string, unknown>>,
  motivo: string | null,
  total = conta.total,
): Promise<number> {
  return tx.incluir('conta_hospitalar_etapa', {
    conta_hospitalar_id: conta.id,
    situacao_anterior: conta.situacao,
    situacao_nova: nova,
    responsavel_usuario_id: tx.contexto.usuario,
    motivo,
    valor_total_conta: total,
    operacao: 'alteracao',
    dados: JSON.stringify(dados),
    ocorrido_em: new Date(),
    usuario_id: tx.contexto.usuario,
  });
}

const travaConta = (id: number, versaoEsperada?: number) => ({
  tabela: 'conta_hospitalar',
  id,
  colunas: ['estabelecimento_id', 'excluido_em', 'situacao'],
  ...(versaoEsperada !== undefined ? { versaoEsperada } : {}),
});

// ── Preço ───────────────────────────────────────────────────────────────────────────────────────────────

/** As tabelas de preço que valem para a conta: a da própria conta, a do plano e as da fonte pagadora. */
export async function tabelasDePreco(
  l: Leitor,
  est: number,
  fonte: number,
  plano: number | null,
  daConta: number | null = null,
): Promise<number[]> {
  const ids: number[] = [];
  if (daConta !== null) ids.push(daConta);
  if (plano !== null) {
    const p = await l.uma<Linha>('SELECT tabela_preco_id FROM plano_fonte_pagadora WHERE id = ?', [plano]);
    if (p?.['tabela_preco_id']) ids.push(n(p['tabela_preco_id']));
  }
  const r = await l.consultar<Linha>(
    `SELECT id FROM tabela_preco WHERE fonte_pagadora_id = ? AND excluido_em IS NULL AND situacao = 'ativa'
        AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
      ORDER BY estabelecimento_id IS NULL, id`,
    [fonte, est],
    { teto: 100 },
  );
  for (const x of r) if (!ids.includes(n(x['id']))) ids.push(n(x['id']));
  return ids;
}

export interface PrecoVigente {
  readonly modelo: string;
  readonly unitario: number;
  readonly honorario: number;
  readonly custoOperacional: number;
  readonly filme: number;
  readonly vigencia: string;
  readonly tabela: number;
}

/** O preço vigente do item na data, pela primeira tabela (na ordem dada) que o tem. */
export async function precoVigente(
  l: Leitor,
  tabelas: readonly number[],
  item: number,
  data: string,
): Promise<PrecoVigente | null> {
  for (const t of tabelas) {
    const v = await l.uma<Linha>(
      `SELECT pp.modelo_valor, pv.vigencia_inicio, pv.valor_honorario, pv.valor_custo_operacional, pv.valor_filme,
              pv.valor_total
         FROM preco_procedimento pp JOIN preco_procedimento_valor pv ON pv.preco_procedimento_id = pp.id
        WHERE pp.tabela_preco_id = ? AND pp.item_faturavel_id = ? AND pp.ativo = 1 AND pp.excluido_em IS NULL
          AND pv.vigencia_inicio <= ?
        ORDER BY pv.vigencia_inicio DESC, pv.id DESC`,
      [t, item, data],
    );
    if (!v) continue;
    const honorario = n(v['valor_honorario']);
    const custoOperacional = n(v['valor_custo_operacional']);
    const filme = n(v['valor_filme']);
    const total = v['valor_total'] === null ? r2(honorario + custoOperacional + filme) : n(v['valor_total']);
    const vig = v['vigencia_inicio'];
    return {
      modelo: texto(v['modelo_valor']),
      unitario: total,
      honorario,
      custoOperacional,
      filme,
      vigencia: vig instanceof Date ? vig.toISOString().slice(0, 10) : texto(vig).slice(0, 10),
      tabela: t,
    };
  }
  return null;
}

// ── Operações ───────────────────────────────────────────────────────────────────────────────────────────

export const fecharConta = definirOperacao<FecharContaEntrada, ResultadoOperacao>({
  nome: 'faturamento.fechar-conta',
  tabelas: ['conta_hospitalar', 'conta_hospitalar_etapa'],
  entrada: esquemaFecharConta,
  travar: (e) => travaConta(e.conta, versaoDaTela(e.versao)),
  conferir: (_tx, _e, ctx, relido) => conferirDoEstabelecimento(relido, ctx),
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    const conta = await contaDa(tx, e.conta, est);
    const soma = await tx.uma<Linha>(
      `SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
          AND situacao <> 'estornado'`,
      [conta.id],
    );
    const pend = await tx.uma<Linha>(
      `SELECT COUNT(*) AS n FROM pendencia_conta WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
          AND bloqueia_fechamento = 1 AND situacao IN ('aberta','em_tratamento')`,
      [conta.id],
    );
    const aud = await tx.uma<Linha>(
      `SELECT COUNT(*) AS n FROM auditoria_conta WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
          AND situacao = 'em_andamento' AND bloqueia_conta = 1`,
      [conta.id],
    );
    const r = conferirFechamentoConta({
      situacao: conta.situacao,
      itens: n(soma?.['n']),
      pendenciasBloqueantes: n(pend?.['n']),
      auditoriaBloqueante: n(aud?.['n']) > 0,
    });
    if (r) throw recusaDe(r);
    await conferirCompetencia(tx, conta, est);
    await tx.alterar('conta_hospitalar', conta.id, conta.versao, {
      situacao: 'fechada',
      fechada_em: new Date(),
      fechada_por_usuario_id: ctx.usuario,
    });
    await registrarEtapa(tx, conta, 'fechada', { etapa: 'fechamento', situacao: 'registrada' }, null);
    return { conta: conta.id };
  },
  eventos: (_e, r) => [{ tipo: 'faturamento.conta.fechada', carga: { conta: Number(r['conta']) } }],
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.conta }),
});

export const reabrirConta = definirOperacao<ReabrirContaEntrada, ResultadoOperacao>({
  nome: 'faturamento.reabrir-conta',
  tabelas: ['conta_hospitalar', 'conta_hospitalar_etapa'],
  entrada: esquemaReabrirConta,
  travar: (e) => travaConta(e.conta, versaoDaTela(e.versao)),
  conferir: (_tx, _e, ctx, relido) => conferirDoEstabelecimento(relido, ctx),
  async gravar(tx, e, ctx) {
    const conta = await contaDa(tx, e.conta, estabelecimentoDe(ctx));
    const lote = await tx.uma<Linha>(
      'SELECT COUNT(*) AS n FROM lote_tiss_conta WHERE conta_hospitalar_id = ? AND excluido_em IS NULL',
      [conta.id],
    );
    const r = conferirReaberturaConta({
      situacao: conta.situacao,
      emLote: n(lote?.['n']) > 0,
      motivo: e.motivo,
    });
    if (r) throw recusaDe(r);
    await tx.alterar('conta_hospitalar', conta.id, conta.versao, {
      situacao: 'aberta',
      reaberta_em: new Date(),
      fechada_em: null,
      fechada_por_usuario_id: null,
    });
    await registrarEtapa(tx, conta, 'aberta', { etapa: 'reabertura', situacao: 'registrada' }, e.motivo);
    return { conta: conta.id };
  },
  eventos: (_e, r) => [{ tipo: 'faturamento.conta.reaberta', carga: { conta: Number(r['conta']) } }],
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.conta }),
  trilha: (e) => ({ motivo: e.motivo }),
});

export const conferirItem = definirOperacao<ConferirItemEntrada, ResultadoOperacao>({
  nome: 'faturamento.conferir-item',
  tabelas: ['conta_hospitalar_item', 'conta_hospitalar_etapa'],
  entrada: esquemaConferirItem,
  travar: (e) => travaConta(e.conta),
  conferir: (_tx, _e, ctx, relido) => conferirDoEstabelecimento(relido, ctx),
  async gravar(tx, e, ctx) {
    const conta = await contaDa(tx, e.conta, estabelecimentoDe(ctx));
    const r = conferirConferenciaItens(conta.situacao);
    if (r) throw recusaDe(r);
    const ids = e.itens.map((i) => i.id);
    const linhas = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao, conta_hospitalar_id FROM conta_hospitalar_item
        WHERE id IN (${lista(ids.length)}) AND excluido_em IS NULL`,
      ids,
      { teto: ids.length },
    );
    const porId = new Map(linhas.map((x) => [n(x['id']), x]));
    const mudaram: string[] = [];
    for (const i of e.itens) {
      const x = porId.get(i.id);
      if (!x || n(x['conta_hospitalar_id']) !== conta.id)
        throw recusa('item-de-outra-conta', `O item ${i.id} não é desta conta.`, { campos: ['itens'] });
      if (n(x['versao']) !== versaoDaTela(i.versao)) mudaram.push(`item ${i.id}`);
      const sit = texto(x['situacao']);
      if (sit !== 'lancado' && sit !== 'conferido')
        throw recusa('item-sem-conferencia', `O item ${i.id} está ${sit}: só item lançado é conferido.`, {
          campos: ['itens'],
        });
    }
    if (mudaram.length) throw erroConflitoVersao(mudaram);
    for (const i of e.itens)
      await tx.alterar('conta_hospitalar_item', i.id, n(porId.get(i.id)?.['versao']), {
        situacao: 'conferido',
      });
    await registrarEtapa(
      tx,
      conta,
      conta.situacao,
      { etapa: 'conferencia-item', situacao: 'registrada', itens: e.itens.length },
      `${e.itens.length} item(ns)`,
    );
    return { conta: conta.id, itens: e.itens.length };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.conta }),
});

/** Quem atende o item e de onde veio o atendimento: o profissional e a agenda da marcação (ADR 0009). */
interface AtendimentoDoItem {
  readonly particular: boolean;
  /** O executante do item, quando vem no lançamento; senão, o profissional do atendimento. */
  readonly profissional: number | null;
  /** A agenda da marcação, só quando o item é do profissional dela (o executante é o do atendimento). */
  readonly agenda: number | null;
}

async function atendimentoDoItem(
  tx: TxOperacao,
  conta: { readonly id: number; readonly fonte: number },
  executante: number | null,
): Promise<AtendimentoDoItem> {
  const f = await tx.uma<Linha>('SELECT tipo FROM fonte_pagadora WHERE id = ?', [conta.fonte]);
  const at = await tx.uma<Linha>(
    `SELECT a.profissional_id, ha.agenda_servico_id
       FROM conta_hospitalar c JOIN atendimento a ON a.id = c.atendimento_id
       LEFT JOIN marcacao_horario m ON m.id = a.marcacao_horario_id
       LEFT JOIN horario_agenda ha ON ha.id = m.horario_agenda_id
      WHERE c.id = ?`,
    [conta.id],
  );
  const doAtendimento = at?.['profissional_id'] == null ? null : n(at['profissional_id']);
  const agenda = at?.['agenda_servico_id'] == null ? null : n(at['agenda_servico_id']);
  const profissional = executante ?? doAtendimento;
  return {
    particular: texto(f?.['tipo']) === 'particular',
    profissional,
    agenda: profissional !== null && profissional === doAtendimento ? agenda : null,
  };
}

/**
 * A regra de preço particular que vence para o item na conta (ADR 0009): só na conta de fonte particular. O
 * profissional é o executante do item (ou o do atendimento) e a agenda, a da marcação, só quando o item é do
 * profissional dela. "consulta" é o item faturável que o catálogo de agendamento marca como consulta (item_agendavel
 * de tipo consulta), com ou sem marcação: o honorário de um exame ou de outro médico não leva o preço da consulta.
 */
async function regraParticularDoItem(
  tx: TxOperacao,
  conta: { readonly id: number; readonly fonte: number },
  est: number,
  item: Linha,
  quem: AtendimentoDoItem,
  data: string,
): Promise<RegraPrecoParticular | null> {
  if (!quem.particular) return null;
  const consulta = await tx.uma<Linha>(
    `SELECT id FROM item_agendavel WHERE item_faturavel_id = ? AND tipo_item = 'consulta' AND excluido_em IS NULL
      LIMIT 1`,
    [n(item['id'])],
  );
  const pedido = {
    fontePagadoraId: conta.fonte,
    profissionalId: quem.profissional,
    agendaId: quem.agenda,
    estabelecimentoId: est,
    data,
  };
  const candidatas = await candidatasPrecoParticular(tx, pedido);
  return escolherRegraPrecoParticular(candidatas, {
    ...pedido,
    alvo: {
      itemFaturavelId: n(item['id']),
      grupoFaturamentoId: item['grupo_faturamento_id'] == null ? null : n(item['grupo_faturamento_id']),
      consulta: consulta !== null,
    },
  });
}

/**
 * Decisão 25 no lançamento: na conta de convênio, o profissional do item sem credenciamento vigente no convênio ou
 * no plano da conta gera ALERTA (devolvido no resultado e na memória) ou, quando o convênio pede, BLOQUEIO.
 */
async function credenciamentoDoItem(
  tx: TxOperacao,
  conta: { readonly fonte: number; readonly plano: number | null },
  est: number,
  quem: AtendimentoDoItem,
  data: string,
): Promise<VerificacaoCredenciamento | null> {
  if (quem.particular || quem.profissional === null) return null;
  let planoSuperiorId: number | null = null;
  if (conta.plano !== null) {
    const pl = await tx.uma<Linha>('SELECT plano_superior_id FROM plano_fonte_pagadora WHERE id = ?', [
      conta.plano,
    ]);
    planoSuperiorId = pl?.['plano_superior_id'] == null ? null : n(pl['plano_superior_id']);
  }
  const q = { profissionalId: quem.profissional, fontePagadoraId: conta.fonte, estabelecimentoId: est, data };
  const credenciamentos = await credenciamentosVigentes(tx, q);
  const opcoes = await opcoesCredenciamentoConvenio(tx, conta.fonte);
  const v = verificarCredenciamento({
    particular: false,
    profissionalId: quem.profissional,
    planoId: conta.plano,
    planoSuperiorId,
    data,
    credenciamentos,
    opcoes,
  });
  if (v.efeito === 'bloqueio')
    throw recusa(
      'profissional-nao-credenciado',
      v.motivo ?? 'O profissional não é credenciado no convênio.',
      {
        campos: ['executante'],
      },
    );
  return v.efeito === 'alerta' ? v : null;
}

export const lancarItem = definirOperacao<LancarItemEntrada, ResultadoOperacao>({
  nome: 'faturamento.lancar-item',
  tabelas: ['conta_hospitalar_item', 'conta_hospitalar_item_memoria', 'conta_hospitalar'],
  entrada: esquemaLancarItem,
  travar: (e) => travaConta(e.conta),
  conferir: (_tx, _e, ctx, relido) => conferirDoEstabelecimento(relido, ctx),
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const conta = await contaDa(tx, e.conta, est);
    const r = conferirLancamento(conta.situacao);
    if (r) throw recusaDe(r);
    await conferirCompetencia(tx, conta, est);
    // O catálogo de itens faturáveis é da rede inteira (sem estabelecimento).
    const tipos = tiposDoGrupo(e.tipo);
    const item = await tx.uma<Linha>(
      `SELECT id, grupo_faturamento_id FROM item_faturavel WHERE codigo = ? AND tipo_item IN (${lista(tipos.length)})
          AND excluido_em IS NULL AND situacao = 'ativo'`,
      [String(e.codigo), ...tipos],
    );
    if (!item)
      throw recusa('item-fora-do-catalogo', 'O item não está no catálogo de itens faturáveis.', {
        campos: ['codigo'],
      });
    // ADR 0009: no particular, a regra estruturada do médico ou da agenda vale ANTES da tabela do particular (o
    // convênio segue só a tabela: não há preço por médico em convênio).
    const quem = await atendimentoDoItem(tx, conta, e.executante);
    const alerta = await credenciamentoDoItem(tx, conta, est, quem, e.data);
    const regra = e.precoManual ? null : await regraParticularDoItem(tx, conta, est, item, quem, e.data);
    const tabelas = await tabelasDePreco(tx, est, conta.fonte, conta.plano, conta.tabela);
    const naTabela = regra
      ? null
      : tabelas.length
        ? await tx.uma<Linha>(
            `SELECT tabela_preco_id FROM preco_procedimento
            WHERE item_faturavel_id = ? AND tabela_preco_id IN (${lista(tabelas.length)}) AND ativo = 1
              AND excluido_em IS NULL LIMIT 1`,
            [n(item['id']), ...tabelas],
          )
        : null;
    if (!naTabela && !regra)
      throw recusa('item-fora-da-tabela', 'O item não está na tabela de preço da fonte pagadora da conta.', {
        campos: ['codigo'],
      });
    const doTabela = regra ? null : await precoVigente(tx, tabelas, n(item['id']), e.data);
    const preco: PrecoVigente | null = regra
      ? {
          modelo: 'regra_particular',
          unitario: regra.valor,
          honorario: 0,
          custoOperacional: 0,
          filme: 0,
          vigencia: regra.vigenciaInicio,
          tabela: 0,
        }
      : doTabela;
    // O setor onde o paciente estava: setor funcional do estabelecimento da sessão (0 na tela = sem setor).
    let setor: number | null = null;
    if (e.local > 0) {
      const x = await tx.uma<Linha>(
        `SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND ativo = 1 AND excluido_em IS NULL`,
        [e.local, est],
      );
      if (!x)
        throw recusa('setor-inexistente', 'O setor não existe neste estabelecimento.', { campos: ['local'] });
      setor = n(x['id']);
    }
    let unitario: number;
    let valorizacao: 'tabela' | 'manual' = 'tabela';
    if (e.precoManual) {
      const operador = await tx.uma<Linha>('SELECT login FROM usuario WHERE id = ?', [ctx.usuario]);
      const recusaManual = conferirPrecoManual({
        tabela: preco?.unitario ?? 0,
        manual: e.precoManual.unitario,
        faixa: FAIXA_PRECO_MANUAL,
        aprovador: e.precoManual.aprovador,
        justificativa: e.precoManual.justificativa,
        ...(operador ? { operador: texto(operador['login']) } : {}),
      });
      if (recusaManual) throw recusaDe(recusaManual);
      unitario = e.precoManual.unitario;
      valorizacao = 'manual';
    } else if (preco) unitario = preco.unitario;
    else
      throw recusa(
        'item-sem-preco',
        'O item não tem preço vigente na tabela da conta: informe o preço manual.',
        {
          campos: ['precoManual'],
        },
      );
    const fuso = await tx.uma<Linha>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
    const realizado = new Date(
      dataHoraParaInstante(e.data, e.hora, texto(fuso?.['fuso_horario']) || undefined),
    );
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [conta.id],
    );
    const valor = valorDoItem(unitario, e.quantidade);
    const id = await tx.incluir('conta_hospitalar_item', {
      conta_hospitalar_id: conta.id,
      sequencia: n(seq?.['proxima']),
      item_faturavel_id: n(item['id']),
      grupo_faturamento_id: item['grupo_faturamento_id'] ?? null,
      setor_funcional_id: setor,
      realizado_em: realizado,
      quantidade: e.quantidade,
      valor_unitario: unitario,
      valor_honorario: valorizacao === 'tabela' && preco ? r2(preco.honorario * e.quantidade) : 0,
      valor_custo_operacional:
        valorizacao === 'tabela' && preco ? r2(preco.custoOperacional * e.quantidade) : 0,
      valor_filme: valorizacao === 'tabela' && preco ? r2(preco.filme * e.quantidade) : 0,
      valor_total: valor,
      tipo_valorizacao: valorizacao,
      situacao: 'lancado',
      observacao: e.precoManual ? `Preço manual: ${e.precoManual.justificativa}`.slice(0, 2000) : null,
    });
    // A memória do cálculo: de onde veio o preço e, no manual, quem aprovou e por quê.
    await tx.incluir('conta_hospitalar_item_memoria', {
      conta_hospitalar_item_id: id,
      tabela_preco_id: regra ? null : (preco?.tabela ?? n(naTabela?.['tabela_preco_id'])),
      regra_preco_particular_id: regra?.id ?? null,
      valor_unitario_calculado: preco?.unitario ?? null,
      valor_total_calculado: preco ? valorDoItem(preco.unitario, e.quantidade) : null,
      preco_manual: valorizacao === 'manual' ? 1 : 0,
      operacao: 'inclusao',
      dados: JSON.stringify({
        origemPreco: regra
          ? regra.dono.tipo === 'agenda'
            ? 'regra_particular_agenda'
            : 'regra_particular_profissional'
          : valorizacao === 'manual'
            ? 'manual'
            : 'tabela',
        regraEstimada: regra ? regra.situacaoRevisao === 'estimada' : null,
        modelo: preco?.modelo ?? null,
        vigencia: preco?.vigencia ?? null,
        unitarioTabela: preco?.unitario ?? null,
        honorario: preco?.honorario ?? null,
        custoOperacional: preco?.custoOperacional ?? null,
        filme: preco?.filme ?? null,
        faixa: FAIXA_PRECO_MANUAL,
        manual: e.precoManual
          ? {
              unitario: e.precoManual.unitario,
              aprovador: e.precoManual.aprovador,
              justificativa: e.precoManual.justificativa,
            }
          : null,
        ato: e.ato > 0 ? e.ato : null,
        origem: e.origem ?? null,
        profissional: quem.profissional,
        credenciamento: alerta ? { efeito: alerta.efeito, motivo: alerta.motivo } : null,
      }),
      ocorrido_em: new Date(),
      usuario_id: ctx.usuario,
    });
    // O total da conta a partir dos itens, na mesma transação (sem gatilho).
    const soma = await tx.uma<Linha>(
      `SELECT COALESCE(SUM(valor_total), 0) AS itens, COALESCE(SUM(valor_filme), 0) AS filme
         FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
          AND situacao NOT IN ('estornado','transferido','sem_cobranca')`,
      [conta.id],
    );
    const cab = await tx.uma<Linha>(
      'SELECT valor_acrescimo, valor_desconto FROM conta_hospitalar WHERE id = ?',
      [conta.id],
    );
    const itens = n(soma?.['itens']);
    await tx.alterar('conta_hospitalar', conta.id, conta.versao, {
      valor_itens: itens,
      valor_filme: n(soma?.['filme']),
      valor_total: Math.max(0, r2(itens + n(cab?.['valor_acrescimo']) - n(cab?.['valor_desconto']))),
    });
    // Decisão 25: o alerta de credenciamento volta no resultado (o resultado da operação é plano).
    return alerta
      ? { id, conta: conta.id, valor, alerta: 'profissional-nao-credenciado', alertaMotivo: alerta.motivo }
      : { id, conta: conta.id, valor };
  },
  eventos: (_e, r) => [
    { tipo: 'faturamento.item.lancado', carga: { conta: Number(r['conta']), item: Number(r['id']) } },
  ],
  alvo: (_e, r) => ({ tabela: 'conta_hospitalar_item', id: Number(r['id']) }),
});

const comoOperacao = <E>(o: Operacao<E, ResultadoOperacao>) =>
  o as unknown as Operacao<never, ResultadoOperacao>;

/** As operações da conta pelo nome da tela (o executor as registra pelo nome em minúsculas). */
export const OPERACOES_CONTA: Readonly<Record<string, Operacao<never, ResultadoOperacao>>> = {
  'faturamento.fecharConta': comoOperacao(fecharConta),
  'faturamento.reabrirConta': comoOperacao(reabrirConta),
  'faturamento.conferirItem': comoOperacao(conferirItem),
  'faturamento.lancarItem': comoOperacao(lancarItem),
};
