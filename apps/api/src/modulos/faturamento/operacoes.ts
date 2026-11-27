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
import {
  estornarFatosDaOrigem,
  publicarFatos,
  TABELAS_PUBLICACAO_FATO,
} from '../contabil/publicacao-fato.js';
import { sincronizarProducaoDaConta, TABELAS_PRODUCAO_CONTA } from '../repasse/producao-conta.js';
import {
  apurarLancamentosAutomaticos,
  apurarLancamentosDoDia,
  TABELAS_CONTA_ENTRADA,
} from './conta-entrada.js';

import { conferirLancamentoNoPeriodo, tipoLancamentoDoItem } from './conta-periodos-propria.js';
import { conferirCoberturaNoLancamento } from './restricao-cobertura-propria.js';
import { versaoNumero } from './esquemas.js';
import { dispararKitsDoItem } from './kit-lancamento.js';
import { apurarReceitaContabilDaConta, TABELAS_RECEITA_CONTABIL } from './receita-contabil-propria.js';
import { type PrecoVigente, precoVigente, tabelasDePreco } from './preco-conta.js';
import { aplicarAcordoNoItem, lancarExcedenteNoDestino } from './regras-acordo-conta.js';
import {
  conferirCompetenciaDaConta,
  conferirConferenciaItens,
  conferirFechamentoConta,
  conferirLancamento,
  conferirReaberturaConta,
  tiposDoGrupo,
  valorDoItem,
} from './regras-conta.js';

/** Tabelas do pacote na conta tocadas ao lançar (06-FAT linha 20; a função mora nos ajustes, importada tarde). */
const TABELAS_PACOTE_AO_LANCAR = [
  'conta_hospitalar_pacote',
  'pacote',
  'pacote_versao',
  'pacote_contrato',
  'pacote_item_incluso',
  'pacote_excecao',
  'pacote_teto',
  'pacote_diaria_acomodacao',
  'lancamento_automatico_conta',
  ...TABELAS_CONTA_ENTRADA,
];

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

export { type PrecoVigente, precoVigente, tabelasDePreco };

/** O total da conta a partir dos itens cobrados (sem gatilho): itens, filme e total com acréscimo e desconto. */
export async function totalDosItens(
  tx: Pick<TxOperacao, 'uma'>,
  conta: number,
): Promise<{ valor_itens: number; valor_filme: number; valor_total: number }> {
  const soma = await tx.uma<Linha>(
    `SELECT COALESCE(SUM(valor_total), 0) AS itens, COALESCE(SUM(valor_filme), 0) AS filme
       FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
        AND situacao NOT IN ('estornado','transferido','sem_cobranca')`,
    [conta],
  );
  const cab = await tx.uma<Linha>(
    'SELECT valor_acrescimo, valor_desconto FROM conta_hospitalar WHERE id = ?',
    [conta],
  );
  const itens = n(soma?.['itens']);
  return {
    valor_itens: itens,
    valor_filme: n(soma?.['filme']),
    valor_total: Math.max(0, r2(itens + n(cab?.['valor_acrescimo']) - n(cab?.['valor_desconto']))),
  };
}

/** Data de hoje no fuso do hospital (a data contábil do fechamento e da reabertura). */
function hojeNoHospital(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// ── Operações ───────────────────────────────────────────────────────────────────────────────────────────

export const fecharConta = definirOperacao<FecharContaEntrada, ResultadoOperacao>({
  nome: 'faturamento.fechar-conta',
  tabelas: [
    'conta_hospitalar',
    'conta_hospitalar_etapa',
    ...TABELAS_PRODUCAO_CONTA,
    ...TABELAS_PUBLICACAO_FATO,
    ...TABELAS_RECEITA_CONTABIL,
  ],
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
    // O total sai dos itens na hora de fechar: a diária, o mat/med do estoque e o lançamento manual entram pelo mesmo
    // cálculo (a saída do estoque só marca a conta como não calculada).
    const total = await totalDosItens(tx, conta.id);
    await tx.alterar('conta_hospitalar', conta.id, conta.versao, {
      ...total,
      calculada: true,
      situacao: 'fechada',
      fechada_em: new Date(),
      fechada_por_usuario_id: ctx.usuario,
    });
    await registrarEtapa(
      tx,
      conta,
      'fechada',
      { etapa: 'fechamento', situacao: 'registrada' },
      null,
      total.valor_total,
    );
    // A produção do repasse do momento "fechamento" nasce na mesma transação (no momento "lançamento" já existe).
    await sincronizarProducaoDaConta(
      tx,
      { conta: conta.id, evento: 'fechamento' },
      { estabelecimento: est, usuario: ctx.usuario },
    );
    // ADR 0003: a receita da conta fechada vira fato contábil na mesma transação (a regra publicada do tipo
    // receitaConta escolhe as contas pela fonte pagadora e pelo plano).
    await publicarFatos(tx, est, [
      {
        tipo: 'receitaConta',
        entidade: 'conta_hospitalar',
        entidadeId: conta.id,
        data: hojeNoHospital(),
        valorCentavos: Math.round(total.valor_total * 100),
        centroCusto: null,
        documento: `conta ${conta.id}`,
        campos: { fontePagadora: conta.fonte, plano: conta.plano, tabelaPreco: conta.tabela },
      },
    ]);
    // F3.7 (06-FAT L37): a receita contábil por item, pela regra de conta contábil (chave do fato com o ciclo).
    await apurarReceitaContabilDaConta(tx, est, conta.id);
    return { conta: conta.id };
  },
  eventos: (_e, r) => [{ tipo: 'faturamento.conta.fechada', carga: { conta: Number(r['conta']) } }],
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.conta }),
});

export const reabrirConta = definirOperacao<ReabrirContaEntrada, ResultadoOperacao>({
  nome: 'faturamento.reabrir-conta',
  tabelas: [
    'conta_hospitalar',
    'conta_hospitalar_etapa',
    ...TABELAS_PUBLICACAO_FATO,
    ...TABELAS_RECEITA_CONTABIL,
  ],
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
    // A receita reconhecida no fechamento é estornada (o fato original fica; ITG 2000, item 32).
    await estornarFatosDaOrigem(
      tx,
      estabelecimentoDe(ctx),
      'conta_hospitalar',
      [conta.id],
      hojeNoHospital(),
      e.motivo,
    );
    // F3.7 (06-FAT L37): o estorno do que o fechamento deste ciclo contabilizou (um só, pela chave da reabertura).
    await apurarReceitaContabilDaConta(tx, estabelecimentoDe(ctx), conta.id);
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
      `SELECT id, versao, situacao, conta_hospitalar_id, realizado_em, tipo_lancamento_id FROM conta_hospitalar_item
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
    // 06-FAT linha 12: o item cuja data cai num período fechado da conta não muda de situação (reabra o período).
    for (const i of e.itens) {
      const x = porId.get(i.id)!;
      const tipo = x['tipo_lancamento_id'] == null ? null : n(x['tipo_lancamento_id']);
      await conferirLancamentoNoPeriodo(tx, conta.id, x['realizado_em'] as Date, tipo);
    }
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
  /** A marcação de onde veio o atendimento, com a mesma condição da agenda. */
  readonly marcacao: number | null;
}

async function atendimentoDoItem(
  tx: TxOperacao,
  conta: { readonly id: number; readonly fonte: number },
  executante: number | null,
): Promise<AtendimentoDoItem> {
  const f = await tx.uma<Linha>('SELECT tipo FROM fonte_pagadora WHERE id = ?', [conta.fonte]);
  const at = await tx.uma<Linha>(
    `SELECT a.profissional_id, ha.agenda_servico_id, m.id AS marcacao_id
       FROM conta_hospitalar c JOIN atendimento a ON a.id = c.atendimento_id
       LEFT JOIN marcacao_horario m ON m.id = a.marcacao_horario_id
       LEFT JOIN horario_agenda ha ON ha.id = m.horario_agenda_id
      WHERE c.id = ?`,
    [conta.id],
  );
  const doAtendimento = at?.['profissional_id'] == null ? null : n(at['profissional_id']);
  const agenda = at?.['agenda_servico_id'] == null ? null : n(at['agenda_servico_id']);
  const profissional = executante ?? doAtendimento;
  const daAgenda = profissional !== null && profissional === doAtendimento;
  return {
    particular: texto(f?.['tipo']) === 'particular',
    profissional,
    agenda: daAgenda ? agenda : null,
    marcacao: daAgenda && agenda !== null && at?.['marcacao_id'] != null ? n(at['marcacao_id']) : null,
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
  const agendavel = await tx.consultar<Linha>(
    `SELECT DISTINCT tipo_item FROM item_agendavel WHERE item_faturavel_id = ? AND tipo_item IN ('consulta','exame')
        AND excluido_em IS NULL`,
    [n(item['id'])],
  );
  const consulta = agendavel.some((x) => texto(x['tipo_item']) === 'consulta') ? true : null;
  // O exame da agenda (alvo "exame", só da agenda): o item agendável de exame que a agenda da marcação oferece
  // (agenda_item_agendavel) ou que é o item da própria marcação. O exame de outra agenda segue a tabela do particular.
  const exame =
    quem.agenda !== null &&
    agendavel.some((x) => texto(x['tipo_item']) === 'exame') &&
    (await tx.uma<Linha>(
      `SELECT ia.id FROM item_agendavel ia
        WHERE ia.item_faturavel_id = ? AND ia.tipo_item = 'exame' AND ia.excluido_em IS NULL
          AND (EXISTS (SELECT 1 FROM agenda_item_agendavel aia
                        WHERE aia.item_agendavel_id = ia.id AND aia.agenda_servico_id = ? AND aia.excluido_em IS NULL)
               OR EXISTS (SELECT 1 FROM marcacao_horario m WHERE m.id = ? AND m.item_agendavel_id = ia.id)
               OR EXISTS (SELECT 1 FROM marcacao_horario_item mi
                           WHERE mi.marcacao_horario_id = ? AND mi.item_agendavel_id = ia.id AND mi.excluido_em IS NULL))
        LIMIT 1`,
      [n(item['id']), quem.agenda, quem.marcacao ?? 0, quem.marcacao ?? 0],
    )) !== null;
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
      exame,
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
  tabelas: [
    'conta_hospitalar_item',
    'conta_hospitalar_item_memoria',
    'conta_hospitalar',
    ...TABELAS_PRODUCAO_CONTA,
    // F3.7 (06-FAT linha 20): o pacote reconhecido pelo procedimento entra e os aplicados reclassificam ao lançar.
    ...TABELAS_PACOTE_AO_LANCAR,
  ],
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
    // 06-FAT linha 5: o item CH ou PORTE sai do índice do acordo da conta, com o setor do lançamento e o regime da conta
    // (o horário especial da conta entra pela faixa de acréscimo do item, nunca duas vezes).
    const doTabela = regra
      ? null
      : await precoVigente(tx, tabelas, n(item['id']), e.data, {
          est,
          fonte: conta.fonte,
          conta: conta.id,
          setor: e.local > 0 ? e.local : null,
        });
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
    // 06-FAT linha 1: o acordo da fonte (percentual, desconto por grupo, isento, teto e alto custo) no item da tabela.
    const acordo =
      valorizacao === 'tabela' && !regra && preco
        ? await aplicarAcordoNoItem(
            tx,
            est,
            { id: conta.id, fonte: conta.fonte, plano: conta.plano },
            {
              item: n(item['id']),
              grupo: item['grupo_faturamento_id'] == null ? null : n(item['grupo_faturamento_id']),
              tabela: preco.tabela || null,
              funcaoEquipe: e.funcao,
              quantidade: e.quantidade,
              honorario: preco.honorario,
              // O preço sem parcelas (só o unitário) entra inteiro como custo operacional no cálculo do acordo.
              custoOperacional: r2(preco.unitario - preco.honorario - preco.filme),
              filme: preco.filme,
              data: e.data,
              via: e.via ?? null,
            },
          )
        : null;
    if (acordo?.recusa) throw recusa(acordo.recusa.codigo, acordo.recusa.mensagem, { campos: ['codigo'] });
    const comAcordo = acordo && (acordo.aplicadas.length > 0 || acordo.alertas.length > 0) ? acordo : null;
    if (comAcordo) unitario = comAcordo.unitario;
    const fuso = await tx.uma<Linha>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
    const realizado = new Date(
      dataHoraParaInstante(e.data, e.hora, texto(fuso?.['fuso_horario']) || undefined),
    );
    // 06-FAT linha 12: a data que cai num período fechado da conta parcial é recusada. O tipo de lançamento do item
    // (pela terminologia do termo equivalente) vale para o período por tipo; sem tipo, só o período geral conta.
    const tipoLancamento = await tipoLancamentoDoItem(tx, n(item['id']));
    await conferirLancamentoNoPeriodo(tx, conta.id, realizado, tipoLancamento);
    // F7 (09-AREA linha 76): restrição de cobertura da fonte e compatibilidade com a conta, antes de gravar (o bloqueio
    // recusa; a exceção do atendimento libera e fica na memória).
    const cobertura = await conferirCoberturaNoLancamento(tx, est, conta.id, {
      itemId: n(item['id']),
      grupoId: item['grupo_faturamento_id'] == null ? null : n(item['grupo_faturamento_id']),
      tabelaId: preco?.tabela || (naTabela ? n(naTabela['tabela_preco_id']) : null),
      data: e.data,
      hora: e.hora,
      setorId: setor,
      profissionalId: e.executante,
      quantidade: e.quantidade,
      valorTotal: comAcordo ? comAcordo.total : valorDoItem(unitario, e.quantidade),
      justificado: !!e.justificativaCobertura?.trim(),
    });
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [conta.id],
    );
    const valor = comAcordo ? comAcordo.total : valorDoItem(unitario, e.quantidade);
    const id = await tx.incluir('conta_hospitalar_item', {
      conta_hospitalar_id: conta.id,
      sequencia: n(seq?.['proxima']),
      item_faturavel_id: n(item['id']),
      grupo_faturamento_id: item['grupo_faturamento_id'] ?? null,
      setor_funcional_id: setor,
      realizado_em: realizado,
      tipo_lancamento_id: tipoLancamento,
      quantidade: e.quantidade,
      valor_unitario: unitario,
      valor_honorario: comAcordo
        ? comAcordo.honorario
        : valorizacao === 'tabela' && preco
          ? r2(preco.honorario * e.quantidade)
          : 0,
      valor_custo_operacional: comAcordo
        ? comAcordo.custoOperacional
        : valorizacao === 'tabela' && preco
          ? r2(preco.custoOperacional * e.quantidade)
          : 0,
      valor_filme: comAcordo
        ? comAcordo.filme
        : valorizacao === 'tabela' && preco
          ? r2(preco.filme * e.quantidade)
          : 0,
      valor_total: valor,
      tipo_valorizacao: valorizacao,
      // O executor e a função na equipe: a produção do repasse sai deles (sem executor informado, não há produção).
      executante_profissional_id: e.executante,
      funcao_equipe_cobranca_id: e.funcao,
      situacao: 'lancado',
      observacao: e.precoManual ? `Preço manual: ${e.precoManual.justificativa}`.slice(0, 2000) : null,
    });
    // 06-FAT linha 1: o excedente do teto que transfere entra na conta da fonte de destino, na mesma transação.
    const excedente =
      comAcordo?.excedente && comAcordo.excedente.valor > 0
        ? await lancarExcedenteNoDestino(
            tx,
            est,
            { conta: conta.id, fonte: conta.fonte, item: id },
            comAcordo.excedente,
            {
              itemFaturavel: n(item['id']),
              grupo: item['grupo_faturamento_id'] == null ? null : n(item['grupo_faturamento_id']),
              realizado,
              honorario: comAcordo.honorario,
              custoOperacional: comAcordo.custoOperacional,
              filme: comAcordo.filme,
              executante: e.executante,
              funcao: e.funcao,
            },
            ctx.usuario,
          )
        : null;
    if (excedente)
      await tx.alterar(
        'conta_hospitalar',
        excedente.conta,
        excedente.versao,
        await totalDosItens(tx, excedente.conta),
      );
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
        cobertura: cobertura
          ? {
              situacao: cobertura.situacao,
              achados: cobertura.achados,
              justificativa: e.justificativaCobertura ?? null,
            }
          : null,
        // 06-FAT linha 1: as regras do acordo aplicadas, o excedente transferido e o que o alto custo exige.
        acordo: comAcordo
          ? {
              aplicadas: comAcordo.aplicadas,
              isento: comAcordo.isento,
              cobrancaAParte: comAcordo.cobrancaAParte,
              exigeAutorizacao: comAcordo.exigeAutorizacao,
              excedente: comAcordo.excedente
                ? { ...comAcordo.excedente, conta: excedente?.conta ?? null, item: excedente?.item ?? null }
                : null,
              alertas: comAcordo.alertas,
            }
          : null,
      }),
      ocorrido_em: new Date(),
      usuario_id: ctx.usuario,
    });
    // F3.7 (06-FAT linha 16): o item que é gatilho de kit lança o kit junto, na mesma transação.
    const kits = await dispararKitsDoItem(
      tx,
      est,
      { id: conta.id, fontePagadora: conta.fonte, plano: conta.plano, tabela: conta.tabela },
      n(item['id']),
      e.quantidade,
      e.data,
      ctx.usuario,
    );
    // O total da conta a partir dos itens, na mesma transação (sem gatilho).
    await tx.alterar('conta_hospitalar', conta.id, conta.versao, await totalDosItens(tx, conta.id));
    // F3.7 (06-FAT linha 17): o acréscimo de horário especial entra ao lançar (o item e os do kit), pelo relógio do
    // hospital e pelo caráter do atendimento, na mesma transação. Importação tardia: o módulo dos ajustes usa o total
    // dos itens daqui.
    const { aplicarHorarioEspecialNaConta } = await import('./conta-ajustes-propria.js');
    const horario = await aplicarHorarioEspecialNaConta(tx, est, conta.id, { soSeEditavel: true });
    // F3.7 (06-FAT linha 20): o pacote de lançamento automático cujo procedimento acaba de ser lançado entra na conta, e
    // o item lançado depois da aplicação já entra no pacote (ou vai à parte), sem o botão de reclassificar.
    const { pacotesDaContaAoLancar } = await import('./conta-ajustes-propria.js');
    const pacotes = await pacotesDaContaAoLancar(tx, est, conta.id);
    // A produção do repasse do item (momento "lançamento"), na mesma transação e pela mesma conta.
    await sincronizarProducaoDaConta(
      tx,
      { conta: conta.id, itens: [id], evento: 'lancamento' },
      { estabelecimento: est, usuario: ctx.usuario },
    );
    // Decisão 25: o alerta de credenciamento volta no resultado (o resultado da operação é plano).
    const doHorario = {
      ...(horario.alterados ? { horarioEspecial: horario.alterados } : {}),
      ...(pacotes.aplicados ? { pacotesAplicados: pacotes.aplicados } : {}),
      ...(pacotes.reclassificados ? { pacoteReclassificados: pacotes.reclassificados } : {}),
      ...(comAcordo?.alertas.length ? { alertasAcordo: comAcordo.alertas.join(',') } : {}),
      // F7 (09-AREA linha 76): o aviso da cobertura e a liberação por exceção (o resultado da operação é plano).
      ...(cobertura
        ? {
            coberturaSituacao: cobertura.situacao,
            coberturaMotivos: cobertura.achados.map((a) => a.motivo).join(' | '),
          }
        : {}),
    };
    const doKit = kits.kits.length
      ? { kits: kits.kits.join(','), itensKit: kits.itens.length, semPrecoKit: kits.semPreco }
      : {};
    return alerta
      ? {
          id,
          conta: conta.id,
          valor,
          alerta: 'profissional-nao-credenciado',
          alertaMotivo: alerta.motivo,
          ...doKit,
          ...doHorario,
        }
      : { id, conta: conta.id, valor, ...doKit, ...doHorario };
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
  'faturamento.apurarLancamentosAutomaticos': comoOperacao(apurarLancamentosAutomaticos),
  'faturamento.apurarLancamentosDoDia': comoOperacao(apurarLancamentosDoDia),
};
