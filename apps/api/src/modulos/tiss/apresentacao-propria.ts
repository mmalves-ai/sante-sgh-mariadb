// Regras de apresentação TISS por fonte pagadora, conferência do credenciamento e fatura ao pagador na geração do lote
// (06-FAT linhas 29, 30 e 31), sobre o banco do cliente. As regras são do @sgh/dominio-faturamento (apresentacao.ts) e
// do @sgh/dominio-preco (credenciamento): aqui só se lê, aplica pelo domínio e grava.
//   - regra_apresentacao_tiss (por fonte pagadora e tipo de conta) e regra_apresentacao_tiss_item (o que vai em cada
//     guia: código apresentado, fora do arquivo, soma de lançamentos);
//   - valor_padrao_campo_tiss (o campo da guia que o atendimento não informou, ou que a fonte pagadora quer fixo);
//   - o credenciamento: a fonte pagadora diz se barra a cobrança sem credenciamento (fonte_pagadora.
//     bloqueia_sem_credenciamento, no cadastro do convênio). Barrando, todo item com executante precisa poder ser cobrado
//     por ele (credenciamento ou exceção), senão o lote é recusado com o item e o motivo; sem barrar, o lote sai e avisa;
//   - cada conta é conferida pela própria regra (o tipo da conta escolhe a regra); cabeçalho divergente recusa o lote;
//   - a fatura ao pagador (fatura_fonte_pagadora e as contas) nasce fechada com o lote e acompanha o protocolo.
// Nada se apaga: item de regra sai por `ativo = FALSE`; valor padrão sai pela vigência encerrada.
import type { ContaTiss } from '@sgh/contratos';
import {
  apresentarConta,
  type CampoPadraoTiss,
  conferirRegrasDoLote,
  escolherRegraApresentacao,
  type ItemRegraApresentacao,
  ordenarGuias,
  type OrigemItemConta,
  type OrdenacaoGuias,
  type RegraApresentacao,
  type TipoGuiaApresentacao,
  validarValorPadraoCampo,
  type ValorPadraoCampo,
  aplicarValoresPadrao,
  valorApresentado,
} from '@sgh/dominio-faturamento';
import { tipoAtendimentoDaConta } from '@sgh/dominio-preco';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { podeNoEstabelecimento } from '../faturamento/conta-movimentos-propria.js';
import { conferirCobrancaPropria } from '../precos/cobranca-propria.js';
import { aplicarDeParaNaConta } from '../precos/de-para-guia.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const txn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const bool = (v: unknown) => v === true || n(v) === 1;
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';
const SITUACOES_SEM_COBRANCA = "('sem_cobranca','transferido','estornado')";

function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}

// ── Leitura ─────────────────────────────────────────────────────────────────────────────────────────

const regraDe = (r: Linha): RegraApresentacao & { versao: number } => ({
  id: n(r['id']),
  tipoContaId: nn(r['tipo_conta_id']),
  registroAns: txn(r['registro_ans']),
  codigoContratadoOperadora: txn(r['codigo_contratado_operadora']),
  limiteGuiasLote: nn(r['limite_guias_lote']),
  ordenacaoGuias: (texto(r['ordenacao_guias']) || 'numero_guia') as OrdenacaoGuias,
  usaGuiaConsulta: bool(r['usa_guia_consulta']),
  agrupaItens: bool(r['agrupa_itens']),
  omiteGuiaSemValor: bool(r['omite_guia_sem_valor']),
  usaFaturamentoEletronico: bool(r['usa_faturamento_eletronico']),
  ativo: bool(r['ativo']),
  versao: n(r['versao']),
});

const itemRegraDe = (r: Linha): ItemRegraApresentacao & { regraId: number; versao: number } => ({
  id: n(r['id']),
  regraId: n(r['regra_apresentacao_tiss_id']),
  grupoId: nn(r['grupo_faturamento_id']),
  itemId: nn(r['item_faturavel_id']),
  funcaoId: nn(r['funcao_equipe_cobranca_id']),
  setorId: nn(r['setor_funcional_id']),
  profissionalId: nn(r['profissional_id']),
  tipoGuia: txn(r['tipo_guia']) as TipoGuiaApresentacao | null,
  codigoApresentacao: txn(r['codigo_apresentacao']),
  descricaoApresentacao: txn(r['descricao_apresentacao']),
  agrupa: bool(r['agrupa']),
  agrupamentoData: txn(r['agrupamento_data']) as ItemRegraApresentacao['agrupamentoData'],
  naoExporta: bool(r['nao_exporta']),
  ativo: bool(r['ativo']),
  versao: n(r['versao']),
});

const padraoDe = (r: Linha): ValorPadraoCampo & { versao: number } => ({
  id: n(r['id']),
  campo: texto(r['campo_tiss']),
  valor: texto(r['valor_padrao']),
  sobrepoe: bool(r['sobrepoe_informado']),
  estabelecimentoId: nn(r['estabelecimento_id']),
  regraId: nn(r['regra_apresentacao_tiss_id']),
  regimeId: nn(r['regime_atendimento_id']),
  origemId: nn(r['origem_entrada_atendimento_id']),
  itemId: nn(r['item_faturavel_id']),
  vigenciaInicio: dataIso(r['vigencia_inicio']),
  vigenciaFim: dataIso(r['vigencia_fim']) || null,
  ativo: bool(r['ativo']),
  versao: n(r['versao']),
});

type Consulta = Pick<Leitor, 'consultar'>;

/** A regra de apresentação da fonte pagadora no estabelecimento: regras, itens e valores padrão. */
export async function lerApresentacao(l: Consulta, est: number, fonte: number) {
  const regras = (
    await l.consultar<Linha>(
      'SELECT * FROM regra_apresentacao_tiss WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? ORDER BY id',
      [est, fonte],
    )
  ).map(regraDe);
  const itens = regras.length
    ? (
        await l.consultar<Linha>(
          `SELECT * FROM regra_apresentacao_tiss_item WHERE regra_apresentacao_tiss_id IN (${regras
            .map(() => '?')
            .join(', ')}) ORDER BY id`,
          regras.map((r) => r.id),
        )
      ).map(itemRegraDe)
    : [];
  const padroes = (
    await l.consultar<Linha>(
      `SELECT * FROM valor_padrao_campo_tiss
        WHERE fonte_pagadora_id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
        ORDER BY campo_tiss, vigencia_inicio DESC, id DESC`,
      [fonte, est],
    )
  ).map(padraoDe);
  return { regras, itens, padroes };
}

// ── Aplicação na geração do lote ────────────────────────────────────────────────────────────────────

export interface ContaParaApresentar {
  readonly linha: Linha;
  readonly conta: ContaTiss;
  /** Campos da guia que vieram do cadastro do atendimento (o valor padrão só os troca com `sobrepoe`). */
  readonly informados: ReadonlySet<CampoPadraoTiss>;
}

export interface LoteApresentado {
  readonly montadas: ContaTiss[];
  /** Contas cuja guia não vai ao arquivo (ficou sem valor e a fonte pagadora não quer guia zerada): não entram no lote
   * nem na fatura e continuam na fila do faturamento. */
  readonly omitidas: number[];
  /** Valor apresentado de cada conta que foi ao arquivo (a guia depois da regra), pelo id da conta. */
  readonly valores: ReadonlyMap<number, number>;
  readonly registroAns: string | null;
  readonly codigoPrestador: string | null;
  readonly avisos: string[];
}

/**
 * Aplica a regra de apresentação e os valores padrão às contas do lote, confere o credenciamento de quem executou e
 * ordena as guias como a fonte pagadora pede. Recusa o lote (nada é gravado) quando a regra ou o credenciamento barram.
 */
export async function apresentarLote(
  tx: TxOperacao,
  est: number,
  fonte: number,
  tipoGuia: 1 | 2 | 3 | 4,
  contas: readonly ContaParaApresentar[],
  hoje: string,
): Promise<LoteApresentado> {
  const { regras, itens, padroes } = await lerApresentacao(tx, est, fonte);
  // A configuração explícita do convênio decide se o credenciamento barra; sem barrar, só avisa (e só confere quando
  // a fonte tem credenciamento cadastrado no estabelecimento, para não pesar no lote de quem não controla).
  const fp = await tx.uma<Linha>('SELECT bloqueia_sem_credenciamento FROM fonte_pagadora WHERE id = ?', [
    fonte,
  ]);
  const barraCredenciamento = bool(fp?.['bloqueia_sem_credenciamento']);
  const confereCredenciamento =
    barraCredenciamento ||
    (await tx.uma<Linha>(
      `SELECT 1 AS ok FROM credenciamento_cobranca
        WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND excluido_em IS NULL LIMIT 1`,
      [est, fonte],
    )) !== null;
  // A mesma conferência (quem, o quê, tipo de conta e dia) é feita uma vez só no lote.
  const credenciamento = new Map<string, Promise<string | null>>();
  // Equipes vigentes de quem executou no dia (a exceção por equipe vale para os membros).
  const equipesDoDia = new Map<string, Promise<number[]>>();
  const equipesDe = (prof: number, dia: string) => {
    const k = `${prof}|${dia}`;
    let r = equipesDoDia.get(k);
    if (!r) {
      r = tx
        .consultar<Linha>(
          `SELECT DISTINCT m.equipe_profissional_id
             FROM equipe_profissional_membro m
             JOIN equipe_profissional e ON e.id = m.equipe_profissional_id
            WHERE m.profissional_id = ? AND e.estabelecimento_id = ? AND e.ativo = TRUE
              AND m.excluido_em IS NULL AND e.excluido_em IS NULL
              AND m.vigencia_inicio <= ? AND (m.vigencia_fim IS NULL OR m.vigencia_fim >= ?)
              AND e.vigencia_inicio <= ? AND (e.vigencia_fim IS NULL OR e.vigencia_fim >= ?)
            ORDER BY m.equipe_profissional_id
            LIMIT 20`,
          [prof, est, dia, dia, dia, dia],
        )
        .then((ls) => ls.map((l) => n(l['equipe_profissional_id'])));
      equipesDoDia.set(k, r);
    }
    return r;
  };
  const avisos: string[] = [];
  const barrados: string[] = [];
  const saida: { conta: ContaTiss; regra: RegraApresentacao | null }[] = [];
  const conferidas: { rotulo: string; regra: RegraApresentacao | null }[] = [];
  const omitidas: number[] = [];
  const valores = new Map<number, number>();
  for (const c of contas) {
    const id = n(c.linha['id']);
    const rotulo = texto(c.linha['numero']) || String(id);
    const tipoConta = nn(c.linha['tipo_conta_id']);
    const plano = nn(c.linha['plano_fonte_pagadora_id']);
    const tipoAtendimento = tipoAtendimentoDaConta(texto(c.linha['natureza']) || null);
    const regra = escolherRegraApresentacao(regras, tipoConta);
    conferidas.push({ rotulo, regra });
    const origens = await tx.consultar<Linha>(
      `SELECT ci.sequencia, ci.item_faturavel_id, ci.executante_profissional_id, ci.setor_funcional_id,
              ci.funcao_equipe_cobranca_id, ci.quantidade, ci.realizado_em, f.grupo_faturamento_id
         FROM conta_hospitalar_item ci JOIN item_faturavel f ON f.id = ci.item_faturavel_id
        WHERE ci.conta_hospitalar_id = ? AND ci.excluido_em IS NULL AND ci.situacao NOT IN ${SITUACOES_SEM_COBRANCA}
        ORDER BY ci.sequencia`,
      [id],
    );
    const at = c.linha['atendimento_id']
      ? await tx.uma<Linha>(
          'SELECT regime_atendimento_id, origem_entrada_atendimento_id FROM atendimento WHERE id = ?',
          [c.linha['atendimento_id']],
        )
      : null;
    if (confereCredenciamento) {
      for (const o of origens) {
        const prof = nn(o['executante_profissional_id']);
        if (prof === null) continue;
        const item = n(o['item_faturavel_id']);
        const dia = dataIso(o['realizado_em']) || hoje;
        const chave = `${prof}|${item}|${tipoConta ?? ''}|${plano ?? ''}|${tipoAtendimento ?? ''}|${dia}`;
        let motivo = credenciamento.get(chave);
        if (!motivo) {
          motivo = equipesDe(prof, dia)
            .then((equipeIds) =>
              conferirCobrancaPropria(tx as unknown as Leitor, est, {
                fontePagadoraId: fonte,
                planoId: plano,
                itemId: item,
                profissionalId: prof,
                prestadorId: null,
                equipeIds,
                tipoContaId: tipoConta,
                tipoAtendimento,
                quantidade: 1,
                data: dia,
              }),
            )
            .then((r) =>
              r.credenciamento.permitido
                ? null
                : (r.credenciamento.motivo ?? 'quem executou não pode cobrar este item nesta fonte pagadora'),
            );
          credenciamento.set(chave, motivo);
        }
        const m = await motivo;
        if (m !== null) barrados.push(`conta ${rotulo}, item ${n(o['sequencia'])}: ${m}`);
      }
    }
    const origem: OrigemItemConta[] = origens.map((o) => ({
      itemId: n(o['item_faturavel_id']),
      grupoId: nn(o['grupo_faturamento_id']),
      funcaoId: nn(o['funcao_equipe_cobranca_id']),
      setorId: nn(o['setor_funcional_id']),
      profissionalId: nn(o['executante_profissional_id']),
    }));
    // De-para da fonte pagadora (06-FAT linha 9) antes da regra de apresentação, que pode trocar o código depois.
    const dp = await aplicarDeParaNaConta(tx as unknown as Leitor, fonte, c.conta, origem, tipoConta);
    if (dp.trocados)
      avisos.push(`a conta ${rotulo} leva o código da fonte pagadora em ${dp.trocados} item(ns)`);
    const ap = apresentarConta(
      dp.conta,
      origem,
      regra,
      regra ? itens.filter((i) => i.regraId === regra.id) : [],
    );
    const vp = aplicarValoresPadrao(
      ap.conta,
      padroes,
      {
        estabelecimentoId: est,
        regraId: regra?.id ?? null,
        regimeId: nn(at?.['regime_atendimento_id']),
        origemId: nn(at?.['origem_entrada_atendimento_id']),
        itemIds: origem.map((o) => o.itemId),
        data: dataIso(c.linha['inicio_em']) || hoje,
      },
      c.informados,
    );
    if (ap.retirados || ap.trocados || ap.somados)
      avisos.push(
        `a conta ${rotulo} segue a regra da fonte pagadora (${ap.retirados} item(ns) fora do arquivo, ${ap.trocados} código(s) trocado(s), ${ap.somados} lançamento(s) somado(s))`,
      );
    if (vp.aplicados.length)
      avisos.push(`a conta ${rotulo} leva o valor padrão em ${vp.aplicados.join(', ')}`);
    if (ap.omitida) {
      omitidas.push(id);
      avisos.push(
        `a conta ${rotulo} ficou sem valor e não foi ao arquivo (a fonte pagadora não recebe guia zerada): segue na fila do faturamento`,
      );
      continue;
    }
    if (!vp.conta.itens.length)
      throw recusa(
        'guia-sem-itens',
        `A conta ${rotulo} ficou sem itens para a guia pela regra de apresentação da fonte pagadora.`,
      );
    valores.set(id, valorApresentado(vp.conta));
    saida.push({ conta: vp.conta, regra });
  }
  if (barrados.length) {
    const resumo = `${barrados.length} item(ns) sem credenciamento para cobrar nesta fonte pagadora (${barrados
      .slice(0, 5)
      .join('; ')}${barrados.length > 5 ? '; …' : ''})`;
    if (barraCredenciamento)
      throw recusa('credenciamento-barra-cobranca', `O lote não foi gerado: ${resumo}.`);
    avisos.push(`a fonte pagadora não barra pela falta de credenciamento, mas há ${resumo}`);
  }
  const r = conferirRegrasDoLote(conferidas, tipoGuia, saida.length);
  if (r.recusa) throw recusa(r.recusa.codigo, r.recusa.mensagem);
  if (!saida.length)
    throw recusa('lote-vazio', 'Todas as guias ficaram sem valor e a fonte pagadora não recebe guia zerada.');
  const ordenadas = ordenarGuias(saida, r.regra?.ordenacaoGuias ?? 'numero_guia');
  return {
    montadas: ordenadas.map((g) => g.conta),
    omitidas,
    valores,
    registroAns: r.regra?.registroAns ?? null,
    codigoPrestador: r.regra?.codigoContratadoOperadora ?? null,
    avisos,
  };
}

/** A fatura ao pagador do lote: nasce fechada com as contas e o valor apresentado (o protocolo a atualiza). */
export async function gravarFaturaDoLote(
  tx: TxOperacao,
  est: number,
  d: {
    readonly fonte: number;
    readonly lote: number;
    readonly contas: readonly { readonly id: number; readonly valor: number; readonly competencia: string }[];
    readonly valor: number;
    readonly usuario: number | null;
    readonly agora: Date;
    readonly hoje: string;
  },
): Promise<{ fatura: number; numero: string }> {
  await garantirSequencia(
    tx,
    { tipo: 'fatura_fonte_pagadora', estabelecimento: est, inicio: 1 },
    { usuario: d.usuario, agora: d.agora },
  );
  const numero = String((await tx.proximoNumero('fatura_fonte_pagadora')).valor);
  const competencia = d.contas.map((c) => c.competencia).sort()[0] ?? `${d.hoje.slice(0, 7)}-01`;
  const fatura = await tx.incluir('fatura_fonte_pagadora', {
    estabelecimento_id: est,
    numero,
    fonte_pagadora_id: d.fonte,
    competencia,
    tipo_fatura: 'normal',
    lote_tiss_id: d.lote,
    data_abertura: d.hoje,
    fechado_em: d.agora,
    fechado_por_usuario_id: d.usuario,
    quantidade_contas: d.contas.length,
    valor_apresentado: d.valor,
    situacao: 'fechada',
  });
  let seq = 0;
  for (const c of d.contas)
    await tx.incluir('fatura_fonte_pagadora_conta', {
      fatura_fonte_pagadora_id: fatura,
      sequencia: ++seq,
      conta_hospitalar_id: c.id,
      valor_apresentado: c.valor,
    });
  return { fatura, numero };
}

/** O protocolo do lote chega à fatura do lote: número, data de entrega e situação. */
export async function protocolarFaturaDoLote(
  tx: TxOperacao,
  lote: number,
  protocolo: string | null,
  data: string | null,
): Promise<void> {
  const f = await tx.uma<Linha>(
    `SELECT id, versao, situacao FROM fatura_fonte_pagadora
      WHERE lote_tiss_id = ? AND excluido_em IS NULL AND situacao IN ('fechada','enviada','protocolada')
      ORDER BY id DESC LIMIT 1`,
    [lote],
  );
  if (!f) return;
  await tx.alterar('fatura_fonte_pagadora', n(f['id']), n(f['versao']), {
    protocolo_recebimento: protocolo,
    data_entrega: protocolo ? data : null,
    situacao: protocolo ? 'protocolada' : 'fechada',
  });
}

// ── Gravações do cadastro ───────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const idN = id.nullable().default(null);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versao = z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]);

const esquemaRegra = z.object({
  id: id.optional(),
  versao: versao.optional(),
  fontePagadoraId: id,
  tipoContaId: idN,
  versaoPadraoTissId: id,
  registroAns: z
    .string()
    .regex(/^\d{6}$/)
    .nullable()
    .default(null),
  codigoContratadoOperadora: z.string().trim().min(1).max(20).nullable().default(null),
  limiteGuiasLote: z.number().int().min(1).max(9999).nullable().default(null),
  ordenacaoGuias: z.enum(['numero_guia', 'paciente', 'data_atendimento']).default('numero_guia'),
  usaGuiaConsulta: z.boolean().default(true),
  agrupaItens: z.boolean().default(false),
  omiteGuiaSemValor: z.boolean().default(false),
  usaFaturamentoEletronico: z.boolean().default(true),
  ativo: z.boolean().default(true),
});

const esquemaItemRegra = z
  .object({
    regraId: id,
    grupoFaturamentoId: idN,
    itemFaturavelId: idN,
    funcaoEquipeCobrancaId: idN,
    setorFuncionalId: idN,
    profissionalId: idN,
    tipoGuia: z
      .enum(['consulta', 'sp_sadt', 'resumo_internacao', 'honorario', 'outras_despesas'])
      .nullable()
      .default(null),
    codigoApresentacao: z.string().trim().min(1).max(20).nullable().default(null),
    descricaoApresentacao: z.string().trim().min(1).max(150).nullable().default(null),
    agrupa: z.boolean().default(false),
    agrupamentoData: z.enum(['por_dia', 'primeira_data', 'ultima_data']).nullable().default(null),
    naoExporta: z.boolean().default(false),
  })
  .superRefine((v, c) => {
    if (v.grupoFaturamentoId === null && v.itemFaturavelId === null && v.funcaoEquipeCobrancaId === null)
      c.addIssue({
        code: 'custom',
        path: ['itemFaturavelId'],
        message: 'Escolha o item, o grupo ou a função na equipe.',
      });
    if (v.naoExporta && (v.codigoApresentacao || v.agrupa))
      c.addIssue({
        code: 'custom',
        path: ['naoExporta'],
        message: 'O item fora do arquivo não leva código apresentado nem soma.',
      });
    if (v.agrupamentoData !== null && !v.agrupa)
      c.addIssue({
        code: 'custom',
        path: ['agrupamentoData'],
        message: 'A data do agrupamento só vale com a soma.',
      });
  });

const esquemaDesativar = z.object({ id, versao });

const esquemaPadrao = z.object({
  fontePagadoraId: id,
  estabelecimentoProprio: z.boolean().default(true),
  regraId: idN,
  campo: z.string().trim().min(1).max(100),
  valor: z.string().trim().min(1).max(200),
  regimeAtendimentoId: idN,
  origemEntradaAtendimentoId: idN,
  itemFaturavelId: idN,
  sobrepoe: z.boolean().default(false),
  vigenciaInicio: data,
  vigenciaFim: data.nullable().default(null),
});

const esquemaEncerrarPadrao = z.object({ id, versao, vigenciaFim: data });

/**
 * O valor padrão sem estabelecimento vale em todos os estabelecimentos do cliente: só quem edita o contrato do convênio
 * em todos eles o cria ou encerra (o usuário de um estabelecimento não muda o arquivo enviado pelos outros).
 */
async function exigirAlcanceDoCliente(tx: TxOperacao, usuario: number | null): Promise<void> {
  const ests = await tx.consultar<Linha>(
    'SELECT id FROM estabelecimento WHERE excluido_em IS NULL ORDER BY id',
  );
  for (const e of ests)
    if (!(await podeNoEstabelecimento(tx, usuario, n(e['id']), 'convenio.contrato.editar')))
      throw recusa(
        'padrao-global-sem-alcance',
        'O valor padrão de todos os estabelecimentos só é criado ou encerrado por quem edita o contrato do convênio em todos eles. Grave o valor só para este estabelecimento.',
        { campos: ['estabelecimentoProprio'] },
      );
}

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
}

async function regraDoEstabelecimento(tx: TxOperacao, est: number, regraId: number): Promise<Linha> {
  const r = await tx.uma<Linha>(
    'SELECT * FROM regra_apresentacao_tiss WHERE id = ? AND estabelecimento_id = ?',
    [regraId, est],
  );
  if (!r)
    throw recusa('regra-inexistente', 'A regra de apresentação não existe neste estabelecimento.', {
      campos: ['regraId'],
    });
  return r;
}

const opGravarRegra = definirOperacao({
  nome: 'faturamento.gravar-regra-apresentacao-tiss',
  tabelas: ['regra_apresentacao_tiss'],
  entrada: esquemaRegra,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const valores = {
      tipo_conta_id: e.tipoContaId,
      versao_padrao_tiss_id: e.versaoPadraoTissId,
      registro_ans: e.registroAns,
      codigo_contratado_operadora: e.codigoContratadoOperadora,
      limite_guias_lote: e.limiteGuiasLote,
      ordenacao_guias: e.ordenacaoGuias,
      usa_guia_consulta: e.usaGuiaConsulta,
      agrupa_itens: e.agrupaItens,
      omite_guia_sem_valor: e.omiteGuiaSemValor,
      usa_faturamento_eletronico: e.usaFaturamentoEletronico,
      ativo: e.ativo,
    };
    if (e.id !== undefined) {
      const r = await regraDoEstabelecimento(tx, est, e.id);
      if (n(r['fonte_pagadora_id']) !== e.fontePagadoraId)
        throw recusa('fonte-divergente', 'A regra é de outra fonte pagadora.', {
          campos: ['fontePagadoraId'],
        });
      const v = await tx.alterar('regra_apresentacao_tiss', e.id, e.versao ?? n(r['versao']), valores);
      return { id: e.id, versao: v };
    }
    const dup = await tx.uma<Linha>(
      `SELECT id FROM regra_apresentacao_tiss WHERE estabelecimento_id = ? AND fonte_pagadora_id = ?
          AND tipo_conta_id <=> ?`,
      [est, e.fontePagadoraId, e.tipoContaId],
    );
    if (dup)
      throw recusa(
        'regra-existente',
        'Já existe regra desta fonte pagadora para este tipo de conta: altere a existente.',
        {
          campos: ['tipoContaId'],
        },
      );
    const novo = await tx.incluir('regra_apresentacao_tiss', {
      estabelecimento_id: est,
      fonte_pagadora_id: e.fontePagadoraId,
      ...valores,
    });
    return { id: novo, versao: 1 };
  },
  alvo: (_e, r) => ({ tabela: 'regra_apresentacao_tiss', id: n(r['id']) }),
});

const opIncluirItemRegra = definirOperacao({
  nome: 'faturamento.incluir-item-regra-apresentacao-tiss',
  tabelas: ['regra_apresentacao_tiss_item'],
  entrada: esquemaItemRegra,
  async gravar(tx, e, ctx) {
    await regraDoEstabelecimento(tx, estabelecimentoDe(ctx), e.regraId);
    const novo = await tx.incluir('regra_apresentacao_tiss_item', {
      regra_apresentacao_tiss_id: e.regraId,
      grupo_faturamento_id: e.grupoFaturamentoId,
      item_faturavel_id: e.itemFaturavelId,
      funcao_equipe_cobranca_id: e.funcaoEquipeCobrancaId,
      setor_funcional_id: e.setorFuncionalId,
      profissional_id: e.profissionalId,
      tipo_guia: e.tipoGuia,
      codigo_apresentacao: e.codigoApresentacao,
      descricao_apresentacao: e.descricaoApresentacao,
      agrupa: e.agrupa,
      agrupamento_data: e.agrupamentoData,
      nao_exporta: e.naoExporta,
      ativo: true,
    });
    return { id: novo, versao: 1 };
  },
  alvo: (_e, r) => ({ tabela: 'regra_apresentacao_tiss_item', id: n(r['id']) }),
});

const opDesativarItemRegra = definirOperacao({
  nome: 'faturamento.desativar-item-regra-apresentacao-tiss',
  tabelas: ['regra_apresentacao_tiss_item'],
  entrada: esquemaDesativar,
  async gravar(tx, e, ctx) {
    const it = await tx.uma<Linha>(
      `SELECT i.id FROM regra_apresentacao_tiss_item i JOIN regra_apresentacao_tiss r ON r.id = i.regra_apresentacao_tiss_id
        WHERE i.id = ? AND r.estabelecimento_id = ?`,
      [e.id, estabelecimentoDe(ctx)],
    );
    if (!it) throw recusa('item-regra-inexistente', 'O item da regra não existe neste estabelecimento.');
    const v = await tx.alterar('regra_apresentacao_tiss_item', e.id, e.versao, { ativo: false });
    return { id: e.id, versao: v };
  },
  alvo: (e) => ({ tabela: 'regra_apresentacao_tiss_item', id: e.id }),
});

const opIncluirPadrao = definirOperacao({
  nome: 'faturamento.incluir-valor-padrao-campo-tiss',
  tabelas: ['valor_padrao_campo_tiss'],
  entrada: esquemaPadrao,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    exigirValido(validarValorPadraoCampo(e));
    if (!e.estabelecimentoProprio) await exigirAlcanceDoCliente(tx, ctx.usuario);
    if (e.regraId !== null) {
      const r = await regraDoEstabelecimento(tx, est, e.regraId);
      if (n(r['fonte_pagadora_id']) !== e.fontePagadoraId)
        throw recusa('fonte-divergente', 'A regra é de outra fonte pagadora.', { campos: ['regraId'] });
    }
    const novo = await tx.incluir('valor_padrao_campo_tiss', {
      fonte_pagadora_id: e.fontePagadoraId,
      estabelecimento_id: e.estabelecimentoProprio ? est : null,
      regra_apresentacao_tiss_id: e.regraId,
      campo_tiss: e.campo,
      regime_atendimento_id: e.regimeAtendimentoId,
      origem_entrada_atendimento_id: e.origemEntradaAtendimentoId,
      item_faturavel_id: e.itemFaturavelId,
      valor_padrao: e.valor,
      sobrepoe_informado: e.sobrepoe,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: true,
    });
    return { id: novo, versao: 1 };
  },
  alvo: (_e, r) => ({ tabela: 'valor_padrao_campo_tiss', id: n(r['id']) }),
});

const opEncerrarPadrao = definirOperacao({
  nome: 'faturamento.encerrar-valor-padrao-campo-tiss',
  tabelas: ['valor_padrao_campo_tiss'],
  entrada: esquemaEncerrarPadrao,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const p = await tx.uma<Linha>(
      'SELECT id, vigencia_inicio, estabelecimento_id FROM valor_padrao_campo_tiss WHERE id = ?',
      [e.id],
    );
    if (!p || (p['estabelecimento_id'] !== null && n(p['estabelecimento_id']) !== est))
      throw recusa('valor-padrao-inexistente', 'O valor padrão não existe neste estabelecimento.');
    if (p['estabelecimento_id'] === null) await exigirAlcanceDoCliente(tx, ctx.usuario);
    if (e.vigenciaFim < dataIso(p['vigencia_inicio']))
      throw recusa('vigencia-invalida', 'O fim da vigência não pode ser antes do início.', {
        campos: ['vigenciaFim'],
      });
    const v = await tx.alterar('valor_padrao_campo_tiss', e.id, e.versao, { vigencia_fim: e.vigenciaFim });
    return { id: e.id, versao: v };
  },
  alvo: (e) => ({ tabela: 'valor_padrao_campo_tiss', id: e.id }),
});

export const OPERACOES_APRESENTACAO = {
  regra: opGravarRegra,
  'regra-item': opIncluirItemRegra,
  'regra-item.desativar': opDesativarItemRegra,
  'valor-padrao': opIncluirPadrao,
  'valor-padrao.encerrar': opEncerrarPadrao,
} as const;
export type NomeOperacaoApresentacao = keyof typeof OPERACOES_APRESENTACAO;

/** Executa a gravação pelo Executor (trilha, autoria e idempotência na mesma transação). */
export async function gravarApresentacao(
  executor: Executor,
  nome: NomeOperacaoApresentacao,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_APRESENTACAO[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
