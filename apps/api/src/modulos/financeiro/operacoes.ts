// Operações de gravação do financeiro (M32) sobre o banco do cliente, pelo Executor do @sgh/nucleo: cada uma declara
// as tabelas que grava; trilha, outbox e idempotência vão na mesma transação. As regras puras (credor, parcelas,
// alçada e segregação, baixa manual, movimento por tipo, rateio) são as do @sgh/dominio-financeiro; aqui ficam as
// conferências sob a trava (título em aberto, conta do escopo, cadastro existente) e a gravação no modelo próprio.
// Modelo: título a pagar com parcelas (titulo_pagar, parcela_pagar, retencao_titulo, rateio_lancamento), baixa por
// parcela (baixa_titulo) com o movimento da conta (movimento_bancario) e o borderô (bordero_pagamento); título a
// receber da conta hospitalar (titulo_receber, parcela_receber, documento_origem_titulo) e o recebimento manual
// (recebimento); o movimento avulso da tesouraria (movimento_bancario, uma linha por conta movimentada).
// Melhoria: o "id do título" das telas é a parcela (a baixa, o borderô e a conciliação são por parcela); o título tem
// número de negócio, valor bruto/líquido conferido pelo banco e a exclusão é lógica (excluido_em), com a versão.
// Melhoria: a baixa grava o movimento da conta e a baixa ligados (conciliáveis); o recebimento manual tem número,
// forma de recebimento do cadastro e o motivo; o título a receber liga TODAS as contas pelo vínculo de origem.
// Melhoria: o escopo de movimentação (pagar, receber, lançar, transferir) exige pode_movimentar; consultar, pode_consultar.
// Melhoria: o escopo de contas bancárias vem de permissao_conta_bancaria (quem não tem nenhuma linha vê todas as
// contas ativas do estabelecimento, como a regra do escopo sem restrição).
import {
  type BaixarTituloEntrada,
  type CriarTituloPagarEntrada,
  type CriarTituloReceberEntrada,
  esquemaCriarTituloPagar,
  type LancarMovimentoEntrada,
} from '@sgh/contratos';
import {
  type AprovacaoRegistrada,
  alcadaAplicavel,
  calcularRateio,
  centavos,
  conferirBaixaManual,
  conferirCredor,
  conferirExclusao,
  conferirMovimento,
  conferirPagamento,
  conferirParcelas,
  type FaixaAlcada,
  type RecusaFinanceiro,
  type TipoCredor,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  erroConflitoVersao,
  ErroOperacao,
  garantirSequencia,
  type Leitor,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import type { z } from 'zod';
import { ESQUEMAS_OPERACAO_FINANCEIRO } from './esquemas.js';
import {
  CREDOR_DO_TIPO,
  dataIso,
  formaDoCodigo,
  LANCAMENTO_PAGAMENTO,
  LANCAMENTO_RECEBIMENTO,
  MEIO_RECEBIMENTO,
  MOVIMENTO_DO_TIPO,
  codigoClassificacao,
  numero,
  tipoCredorDe,
  versaoDoTexto,
} from './vocabulario.js';

type Linha = Record<string, unknown>;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

export function estabelecimentoDe(ctx: { estabelecimento: number | null }): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return ctx.usuario;
}
/** Recusa de negócio do domínio → erro da operação (409, com os campos). */
// ── Regras das gravações diretas (puras; sem banco) ──────────────────────────────────────────────────────────

/** Item da conta ligado ao título, na forma que a regra da glosa precisa. */
export interface ItemGlosavel {
  readonly cobrado: number;
  readonly pago: number;
  /** A operadora já devolveu o item (pago, glosado ou marcado como glosado). */
  readonly comRetorno: boolean;
}

export const itemGlosavelDe = (r: Record<string, unknown>): ItemGlosavel => ({
  cobrado: numero(r['valor_total']),
  pago: numero(r['valor_pago']),
  comRetorno:
    numero(r['valor_pago']) > 0 ||
    numero(r['valor_glosado']) > 0 ||
    String(r['situacao'] ?? '') === 'glosado',
});

/** A glosa de um item: o item é de uma conta do título, já tem retorno e a glosa cabe no cobrado menos o pago. */
export function conferirItemGlosado(item: ItemGlosavel | null, valor: number): RecusaFinanceiro | null {
  if (!item)
    return {
      codigo: 'item-fora-do-titulo',
      mensagem: 'O item glosado não é de uma conta deste título.',
      campos: ['item'],
    };
  if (!item.comRetorno)
    return {
      codigo: 'item-sem-retorno',
      mensagem: 'O item ainda não tem retorno da operadora: não há glosa a registrar.',
      campos: ['item'],
    };
  if (valor > item.cobrado - item.pago + 0.005)
    return {
      codigo: 'glosa-acima-do-item',
      mensagem: 'A glosa passa da diferença entre o cobrado e o pago do item.',
      campos: ['valor'],
    };
  return null;
}

/** Efeito da glosa no título: só a aceita reduz o saldo; o recurso deferido vira recebível; o indeferido só registra. */
export function efeitoDaGlosa(situacao: 'aceita' | 'recurso-deferido' | 'recurso-indeferido'): {
  aceita: boolean;
  recurso: boolean;
} {
  return { aceita: situacao === 'aceita', recurso: situacao === 'recurso-deferido' };
}

/** A linha do extrato (valor com sinal: crédito positivo) casa com o movimento na natureza e no valor. */
export function conferirLinhaContraMovimento(
  valorLinha: number,
  mov: { natureza: 'credito' | 'debito'; valor: number },
): RecusaFinanceiro | null {
  const natureza = valorLinha >= 0 ? 'credito' : 'debito';
  if (natureza !== mov.natureza)
    return {
      codigo: 'natureza-divergente',
      mensagem: `A linha do extrato é um ${natureza === 'credito' ? 'crédito' : 'débito'} e o movimento escolhido não.`,
    };
  if (Math.abs(Math.abs(valorLinha) - Math.abs(mov.valor)) > 0.005)
    return {
      codigo: 'valor-divergente',
      mensagem: 'O valor da linha do extrato difere do valor do movimento escolhido.',
    };
  return null;
}

export function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
const cadastroIncompleto = (oQue: string) =>
  recusa(
    'cadastro-incompleto',
    `Falta no cadastro do financeiro: ${oQue}. Peça ao administrador para cadastrar.`,
  );
const naoEncontrado = (detalhe: string) =>
  new ErroOperacao(404, 'registro-inexistente', 'Registro não encontrado', detalhe);
const hojeIso = () => new Date().toISOString().slice(0, 10);
const conferirVersao = (lida: string | null | undefined, atual: unknown) => {
  const v = versaoDoTexto(lida ?? null);
  if (lida && (v === null || v !== numero(atual))) throw erroConflitoVersao(['versao']);
};

// ── Leituras comuns (porta e operações) ─────────────────────────────────────────────────────────────────────────

/** Login de um usuário (a segregação compara pessoas pelo login). */
export async function loginDe(l: Leitor, usuario: unknown): Promise<string | null> {
  if (usuario === null || usuario === undefined) return null;
  const r = await l.uma<{ login: string }>('SELECT login FROM usuario WHERE id = ?', [usuario]);
  return r?.login ?? null;
}

/**
 * As contas bancárias do escopo do usuário no estabelecimento (regra 15): as de permissao_conta_bancaria vigentes;
 * sem nenhuma linha de permissão, todas as contas ativas (escopo sem restrição). `uso`: 'consultar' (pode_consultar)
 * para ler; 'movimentar' (pode_movimentar) para pagar, receber, lançar, transferir, conciliar e atribuir crédito.
 */
export async function contasDoEscopo(
  l: Leitor,
  est: number,
  usuario: number | null,
  uso: 'consultar' | 'movimentar' = 'consultar',
): Promise<number[]> {
  const hoje = hojeIso();
  if (usuario !== null) {
    // Lista branca: a coluna da permissão vem do uso, nunca da entrada.
    const coluna = uso === 'movimentar' ? 'p.pode_movimentar' : 'p.pode_consultar';
    const linhas = await l.consultar(
      `SELECT p.conta_bancaria_id, (${coluna} AND (p.vigencia_inicio IS NULL OR p.vigencia_inicio <= ?)
              AND (p.vigencia_fim IS NULL OR p.vigencia_fim >= ?)) AS vale
         FROM permissao_conta_bancaria p JOIN conta_bancaria c ON c.id = p.conta_bancaria_id
        WHERE p.usuario_id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
          AND c.excluido_em IS NULL AND c.situacao = 'ativa'`,
      [hoje, hoje, usuario, est],
    );
    if (linhas.length > 0)
      return linhas.filter((x) => Number(x['vale'] ?? 0) === 1).map((x) => numero(x['conta_bancaria_id']));
  }
  const todas = await l.consultar(
    "SELECT id FROM conta_bancaria WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'ativa'",
    [est],
  );
  return todas.map((x) => numero(x['id']));
}

/** Tipo de documento de aprovação dos títulos a pagar (nativo do sistema). */
export const TIPO_APROVACAO_TITULO = 'titulo_pagar';

/**
 * Faixas de alçada do estabelecimento (e as da rede inteira, sem estabelecimento): fluxo_aprovacao do título a
 * pagar com a primeira etapa (quantas aprovações, a permissão e o tipo de credor na condição de entrada).
 */
export async function faixasLidas(l: Leitor, est: number): Promise<FaixaAlcada[]> {
  const linhas = await l.consultar(
    `SELECT f.id, f.centro_custo_id, f.valor_minimo, f.valor_maximo, f.vigencia_inicio, f.vigencia_fim, f.ativo,
            e.quantidade_minima_aprovadores, e.condicao_entrada
       FROM fluxo_aprovacao f
       JOIN tipo_documento_aprovacao t ON t.id = f.tipo_documento_aprovacao_id AND t.codigo = ?
       LEFT JOIN etapa_fluxo_aprovacao e ON e.fluxo_aprovacao_id = f.id AND e.sequencia = 1 AND e.excluido_em IS NULL
      WHERE (f.estabelecimento_id = ? OR f.estabelecimento_id IS NULL)
      ORDER BY f.id`,
    [TIPO_APROVACAO_TITULO, est],
  );
  return linhas.map(faixaDe);
}

export function faixaDe(r: Linha): FaixaAlcada {
  let cond: { tipoCredor?: unknown; permissao?: unknown } = {};
  try {
    const bruto = r['condicao_entrada'];
    cond = (typeof bruto === 'string' ? JSON.parse(bruto) : (bruto ?? {})) as typeof cond;
  } catch {
    cond = {};
  }
  const tipo =
    typeof cond.tipoCredor === 'string' && cond.tipoCredor ? (cond.tipoCredor as TipoCredor) : null;
  return {
    id: numero(r['id']),
    empresa: 1,
    centroCusto:
      r['centro_custo_id'] === null || r['centro_custo_id'] === undefined
        ? null
        : numero(r['centro_custo_id']),
    tipoCredor: tipo,
    valorDe: numero(r['valor_minimo']),
    valorAte:
      r['valor_maximo'] === null || r['valor_maximo'] === undefined ? null : numero(r['valor_maximo']),
    aprovacoes: numero(r['quantidade_minima_aprovadores']) === 2 ? 2 : 1,
    permissao: typeof cond.permissao === 'string' ? cond.permissao : 'financeiro.tituloPagar.aprovar',
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '2000-01-01',
    vigenciaFim: dataIso(r['vigencia_fim']),
    ativa: Number(r['ativo'] ?? 0) === 1 || r['ativo'] === true,
  };
}

/** Aprovações registradas por título a pagar (decisões aprovadas do pedido de aprovação do título). */
export async function aprovacoesPorTitulo(
  l: Leitor,
  est: number,
  titulos: readonly number[],
): Promise<Map<number, (AprovacaoRegistrada & { usuario: number })[]>> {
  const m = new Map<number, (AprovacaoRegistrada & { usuario: number })[]>();
  if (titulos.length === 0) return m;
  const linhas = await l.consultar(
    `SELECT p.entidade_id, p.resumo_documento, d.nivel, d.ocorrido_em, d.aprovador_usuario_id, u.login
       FROM pedido_aprovacao p
       JOIN decisao_aprovacao d ON d.pedido_aprovacao_id = p.id AND d.decisao = 'aprovado'
       JOIN usuario u ON u.id = d.aprovador_usuario_id
      WHERE p.estabelecimento_id = ? AND p.entidade = 'titulo_pagar' AND p.excluido_em IS NULL
        AND p.situacao <> 'cancelado' AND p.entidade_id IN (${lista(titulos.length)})
      ORDER BY d.ocorrido_em, d.id`,
    [est, ...titulos],
  );
  for (const r of linhas) {
    const t = numero(r['entidade_id']);
    let faixa: number;
    try {
      const bruto = r['resumo_documento'];
      const j = (typeof bruto === 'string' ? JSON.parse(bruto) : bruto) as { faixa?: unknown } | null;
      faixa = numero(j?.faixa);
    } catch {
      faixa = 0;
    }
    const a = {
      aprovador: String(r['login'] ?? ''),
      ordem: (numero(r['nivel']) === 2 ? 2 : 1) as 1 | 2,
      faixa,
      em: r['ocorrido_em'] instanceof Date ? r['ocorrido_em'].toISOString() : String(r['ocorrido_em'] ?? ''),
      usuario: numero(r['aprovador_usuario_id']),
    };
    m.set(t, [...(m.get(t) ?? []), a]);
  }
  return m;
}

/** Centro de custo da alçada do título: o do maior rateio ou o do documento. */
export async function centroDaAlcada(
  l: Leitor,
  titulo: number,
  doDocumento: unknown,
): Promise<number | null> {
  const r = await l.uma(
    'SELECT centro_custo_id FROM rateio_lancamento WHERE titulo_pagar_id = ? AND excluido_em IS NULL ORDER BY percentual DESC, sequencia LIMIT 1',
    [titulo],
  );
  if (r) return numero(r['centro_custo_id']);
  return doDocumento === null || doDocumento === undefined ? null : numero(doDocumento);
}

async function idObrigatorio(l: Leitor, sql: string, p: readonly unknown[], oQue: string): Promise<number> {
  const r = await l.uma(sql, p);
  if (!r) throw cadastroIncompleto(oQue);
  return numero(r['id']);
}

export async function naturezaDaClassificacao(
  l: Leitor,
  c: { grupo: number; subgrupo: number; item: number },
): Promise<number> {
  const r = await l.uma(
    'SELECT id FROM natureza_financeira WHERE codigo = ? AND ativo = TRUE AND excluido_em IS NULL',
    [codigoClassificacao(c)],
  );
  if (!r)
    throw recusa('classificacao-inexistente', 'A classificação gerencial não existe no cadastro.', {
      campos: ['classificacao'],
    });
  return numero(r['id']);
}

const tipoLancamento = (l: Leitor, codigo: string) =>
  idObrigatorio(
    l,
    'SELECT id FROM tipo_lancamento_bancario WHERE codigo = ? AND ativo = TRUE',
    [codigo],
    `o tipo de lançamento bancário "${codigo}"`,
  );

async function exigirContaDoEscopo(
  tx: TxOperacao,
  est: number,
  usuario: number,
  conta: number,
  uso: 'pagamento' | 'recebimento' | 'movimento',
): Promise<Linha> {
  const escopo = await contasDoEscopo(tx, est, usuario, 'movimentar');
  if (!escopo.includes(conta))
    throw recusa('fora-do-escopo', 'A conta bancária não está no seu escopo de contas.', {
      campos: ['conta'],
    });
  const c = await tx.uma(
    'SELECT id, permite_pagamento, permite_recebimento FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ?',
    [conta, est],
  );
  if (!c) throw naoEncontrado('A conta bancária não existe neste estabelecimento.');
  if (uso === 'pagamento' && !Number(c['permite_pagamento']))
    throw recusa('conta-nao-paga', 'Esta conta bancária não é usada para pagamentos.', { campos: ['conta'] });
  if (uso === 'recebimento' && !Number(c['permite_recebimento']))
    throw recusa('conta-nao-recebe', 'Esta conta bancária não é usada para recebimentos.', {
      campos: ['conta'],
    });
  return c;
}

// ── financeiro.criarTituloPagar ─────────────────────────────────────────────────────────────────────────────────

/** Tabelas que a inclusão do título a pagar grava (quem compõe o gravador na própria operação as declara). */
export const TABELAS_TITULO_PAGAR: readonly string[] = [
  'titulo_pagar',
  'parcela_pagar',
  'retencao_titulo',
  'rateio_lancamento',
  'sequencia_negocio',
];

async function incluirTituloPagar(
  tx: TxOperacao,
  e: Extract<CriarTituloPagarEntrada, { acao: 'incluir' }>,
  ctx: ContextoOperacao,
): Promise<ResultadoOperacao> {
  const est = estabelecimentoDe(ctx);
  usuarioDe(ctx);
  const mapa = CREDOR_DO_TIPO[e.tipo];
  const credor = e.tipo === 'M' ? (e.profissional ?? e.credor) : e.credor;
  const existe = async (): Promise<boolean> => {
    switch (mapa.coluna) {
      case 'empresa_fornecedora_id':
        return !!(await tx.uma(
          "SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL AND situacao <> 'inativo'",
          [credor],
        ));
      case 'profissional_id':
        return !!(await tx.uma(
          "SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL AND situacao <> 'inativo'",
          [credor],
        ));
      default:
        return !!(await tx.uma(
          'SELECT id FROM colaborador WHERE id = ? AND excluido_em IS NULL AND ativo = TRUE',
          [credor],
        ));
    }
  };
  const credorExiste = await existe();
  recusar(
    conferirCredor({
      tipo: e.tipo,
      credorExiste,
      profissional: e.profissional,
      profissionalExiste: e.tipo === 'M' ? credorExiste : true,
      comRetencao: e.retencoes.length > 0,
    }),
  );
  recusar(conferirParcelas(e.parcelas, e.valorDocumento, e.emissao));
  const natureza = await naturezaDaClassificacao(tx, e.classificacao);
  const tipoCredor = await idObrigatorio(
    tx,
    'SELECT id FROM tipo_credor WHERE codigo = ? AND ativo = TRUE',
    [mapa.codigo],
    `o tipo de credor "${mapa.codigo}"`,
  );
  const tipoDocumento = await idObrigatorio(
    tx,
    `SELECT id FROM tipo_documento_financeiro WHERE ativo = TRUE AND sentido IN ('pagar','ambos')
      ORDER BY (codigo = ?) DESC, nativo_sistema DESC, id LIMIT 1`,
    [e.nf > 0 ? 'nota_fiscal' : 'recibo'],
    'o tipo de documento financeiro a pagar',
  );
  const serie = e.serie.trim().toUpperCase() || null;
  const documento = String(e.documento);
  const duplicado = await tx.uma(
    `SELECT id FROM titulo_pagar WHERE estabelecimento_id = ? AND tipo_credor_id = ? AND ${mapa.coluna} = ?
        AND numero_documento = ? AND COALESCE(serie_documento, '') = ? AND situacao <> 'cancelado' AND excluido_em IS NULL`,
    [est, tipoCredor, credor, documento, serie ?? ''],
  );
  if (duplicado)
    throw recusa(
      'duplicado',
      'Já existe título com este credor, documento, tipo e série: abra o título existente.',
      {
        campos: ['documento'],
      },
    );
  const tributos = e.retencoes.length
    ? await tx.consultar(
        `SELECT id FROM tributo WHERE ativo = TRUE AND id IN (${lista(e.retencoes.length)})`,
        [...e.retencoes.map((r) => r.codigo)],
      )
    : [];
  const conhecidos = new Set(tributos.map((t) => numero(t['id'])));
  if (e.retencoes.some((r) => !conhecidos.has(r.codigo)))
    throw recusa('retencao-inexistente', 'A conta de retenção não existe no cadastro.', {
      campos: ['retencoes'],
    });
  const retido = centavos(e.retencoes.reduce((x, r) => x + r.valor, 0));
  if (retido > e.valorDocumento)
    throw recusa('retencao-acima-do-documento', 'As retenções passam do valor do documento.', {
      campos: ['retencoes'],
    });
  if (
    e.centroCusto !== null &&
    !(await tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ?', [
      e.centroCusto,
      est,
    ]))
  )
    throw recusa('centro-custo-inexistente', 'O centro de custo não existe neste estabelecimento.', {
      campos: ['centroCusto'],
    });
  const rateio = calcularRateio(e.rateio, e.valorDocumento);
  if (!rateio.ok) recusar(rateio.recusa);
  const linhasRateio = rateio.ok ? rateio.rateio : [];
  if (linhasRateio.length) {
    const ccs = await tx.consultar(
      `SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND id IN (${lista(linhasRateio.length)})`,
      [est, ...linhasRateio.map((r) => r.centroCusto)],
    );
    if (ccs.length !== linhasRateio.length)
      throw recusa(
        'centro-custo-inexistente',
        'Um centro de custo do rateio não existe neste estabelecimento.',
        {
          campos: ['rateio'],
        },
      );
  }
  await garantirSequencia(
    tx,
    { tipo: 'titulo_pagar', estabelecimento: est, prefixo: 'TP-' },
    { usuario: ctx.usuario, agora: new Date() },
  );
  const num = await tx.proximoNumero('titulo_pagar');
  const hoje = hojeIso();
  const titulo = await tx.incluir('titulo_pagar', {
    estabelecimento_id: est,
    numero: num.formatado,
    tipo_credor_id: tipoCredor,
    [mapa.coluna]: credor,
    tipo_documento_financeiro_id: tipoDocumento,
    numero_documento: documento,
    serie_documento: serie,
    contrato_fornecedor_id: e.contrato?.contrato ?? null,
    data_emissao: e.emissao,
    data_entrada: e.entrada,
    data_lancamento: hoje > e.emissao ? hoje : e.emissao,
    valor_bruto: e.valorDocumento,
    valor_retencoes: retido,
    valor_liquido: centavos(e.valorDocumento - retido),
    quantidade_parcelas: e.parcelas.length,
    natureza_financeira_id: natureza,
    centro_custo_id: e.centroCusto,
    referente: e.referente.trim() || null,
    observacao: e.observacao.trim() || null,
  });
  const parcelas: number[] = [];
  for (const p of e.parcelas)
    parcelas.push(
      await tx.incluir('parcela_pagar', {
        titulo_pagar_id: titulo,
        sequencia: p.parcela,
        vencimento: p.vencimento,
        vencimento_original: p.vencimento,
        valor: p.valor,
        saldo: p.valor,
      }),
    );
  const competencia = `${e.emissao.slice(0, 7)}-01`;
  for (const [i, r] of e.retencoes.entries())
    await tx.incluir('retencao_titulo', {
      parcela_pagar_id: parcelas[0],
      sequencia: i + 1,
      tributo_id: r.codigo,
      competencia,
      data_fato_gerador: e.emissao,
      base_calculo: e.valorDocumento,
      aliquota: Math.round((r.valor / e.valorDocumento) * 1_000_000) / 10_000,
      valor_retido: r.valor,
    });
  for (const [i, r] of linhasRateio.entries())
    await tx.incluir('rateio_lancamento', {
      titulo_pagar_id: titulo,
      sequencia: i + 1,
      natureza_financeira_id: natureza,
      centro_custo_id: r.centroCusto,
      percentual: r.percentual,
      valor: r.valor,
    });
  return {
    titulo: parcelas[0] ?? 0,
    tituloPagar: titulo,
    numero: num.formatado,
    parcelas: parcelas.length,
    documento: e.documento,
    credor,
    tipo: e.tipo,
    serie: serie ?? '',
    acao: 'incluir',
    ids: parcelas.join(','),
  };
}

async function excluirTituloPagar(
  tx: TxOperacao,
  e: Extract<CriarTituloPagarEntrada, { acao: 'excluir' }>,
  ctx: ContextoOperacao,
): Promise<ResultadoOperacao> {
  const est = estabelecimentoDe(ctx);
  const usuario = usuarioDe(ctx);
  const [p] = await tx.consultarParaAtualizar(
    `SELECT p.id, p.versao, p.titulo_pagar_id, t.versao AS versao_titulo, t.numero_documento, t.serie_documento,
            t.empresa_fornecedora_id, t.profissional_id, t.colaborador_id, tc.codigo AS tipo_codigo, tc.natureza
       FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
       JOIN tipo_credor tc ON tc.id = t.tipo_credor_id
      WHERE p.id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL`,
    [e.titulo, est],
    { teto: 1 },
  );
  if (!p) throw recusa('titulo-inexistente', 'O título não existe (talvez já excluído).');
  conferirVersao(e.versao, p['versao']);
  const titulo = numero(p['titulo_pagar_id']);
  const irmas = await tx.consultarParaAtualizar(
    'SELECT id, versao, valor_pago, quitada_em FROM parcela_pagar WHERE titulo_pagar_id = ? AND excluido_em IS NULL',
    [titulo],
  );
  const pago = centavos(irmas.reduce((x, r) => x + numero(r['valor_pago']), 0));
  const quitada = irmas.map((r) => dataIso(r['quitada_em'])).find((d) => d) ?? null;
  const emBordero = await tx.uma(
    `SELECT COUNT(*) AS n FROM item_bordero i JOIN parcela_pagar p ON p.id = i.parcela_pagar_id
      WHERE p.titulo_pagar_id = ? AND i.excluido_em IS NULL AND i.situacao NOT IN ('rejeitado','retirado')`,
    [titulo],
  );
  recusar(conferirExclusao({ pago, dataPagamento: quitada, bordero: numero(emBordero?.['n']) }));
  const agora = new Date();
  await tx.executar(
    `UPDATE retencao_titulo SET excluido_em = ?, excluido_por = ?, versao = versao + 1
      WHERE excluido_em IS NULL AND parcela_pagar_id IN (SELECT id FROM parcela_pagar WHERE titulo_pagar_id = ?)`,
    [agora, usuario, titulo],
  );
  await tx.executar(
    'UPDATE rateio_lancamento SET excluido_em = ?, excluido_por = ?, versao = versao + 1 WHERE titulo_pagar_id = ? AND excluido_em IS NULL',
    [agora, usuario, titulo],
  );
  for (const r of irmas)
    await tx.alterar('parcela_pagar', numero(r['id']), numero(r['versao']), {
      excluido_em: agora,
      excluido_por: usuario,
    });
  await tx.alterar('titulo_pagar', titulo, numero(p['versao_titulo']), {
    excluido_em: agora,
    excluido_por: usuario,
  });
  const credor = numero(p['empresa_fornecedora_id'] ?? p['profissional_id'] ?? p['colaborador_id']);
  return {
    titulo: e.titulo,
    tituloPagar: titulo,
    parcelas: irmas.length,
    documento: String(p['numero_documento'] ?? ''),
    credor,
    tipo: tipoCredorDe(p['tipo_codigo'], p['natureza']),
    serie: String(p['serie_documento'] ?? ''),
    acao: 'excluir',
    ids: irmas.map((r) => numero(r['id'])).join(','),
  };
}

/** O título a pagar gravado na transação de quem compôs o gravador. */
export interface TituloPagarGravado {
  readonly tituloPagar: number;
  readonly numero: string;
  /** As parcelas, na ordem. */
  readonly parcelas: readonly number[];
  /** O evento que a operação que compõe publica (o mesmo de financeiro.criarTituloPagar). */
  readonly evento: {
    readonly tipo: 'financeiro.titulo_pagar.lancado';
    readonly carga: { titulo: number; parcelas: number };
  };
}

/** A entrada do título composto: a de financeiro.criarTituloPagar (acao incluir), antes dos padrões do contrato. */
export type EntradaTituloComposto = Omit<
  Extract<z.input<typeof esquemaCriarTituloPagar>, { acao: 'incluir' }>,
  'acao'
>;

/** Gravador do título a pagar sobre a transação de outra operação do Executor (integração folha → financeiro). */
export interface GravadorTituloPagar {
  /**
   * Inclui o título com as parcelas, as retenções e o rateio, com as mesmas validações e recusas de
   * financeiro.criarTituloPagar (credor, documento repetido, parcelas, retenções, centro de custo), no estabelecimento
   * e com o usuário do contexto da transação. A operação que compõe declara TABELAS_TITULO_PAGAR e publica o evento.
   */
  incluir(entrada: EntradaTituloComposto): Promise<TituloPagarGravado>;
}

export function gravadorTituloPagar(tx: TxOperacao): GravadorTituloPagar {
  return {
    async incluir(entrada) {
      const analise = esquemaCriarTituloPagar.safeParse({ ...entrada, acao: 'incluir' });
      if (!analise.success || (analise.data as CriarTituloPagarEntrada).acao !== 'incluir')
        throw recusa('titulo-invalido', 'O título a pagar composto não passou na validação do contrato.');
      const e = analise.data as Extract<CriarTituloPagarEntrada, { acao: 'incluir' }>;
      const r = await incluirTituloPagar(tx, e, tx.contexto);
      const parcelas = String(r['ids'] ?? '')
        .split(',')
        .filter((x) => x !== '')
        .map(Number);
      const tituloPagar = numero(r['tituloPagar']);
      return {
        tituloPagar,
        numero: String(r['numero']),
        parcelas,
        evento: {
          tipo: 'financeiro.titulo_pagar.lancado',
          carga: { titulo: tituloPagar, parcelas: parcelas.length },
        },
      };
    },
  };
}

const criarTituloPagar = definirOperacao<CriarTituloPagarEntrada, ResultadoOperacao>({
  nome: 'financeiro.criar_titulo_pagar',
  tabelas: TABELAS_TITULO_PAGAR,
  entrada: ESQUEMAS_OPERACAO_FINANCEIRO['financeiro.criarTituloPagar'] as never,
  async gravar(tx, e, ctx) {
    if (e.acao === 'incluir-folha')
      throw recusa('operacao-desconhecida', 'Os títulos da folha são lançados pela integração da folha.');
    return e.acao === 'excluir' ? excluirTituloPagar(tx, e, ctx) : incluirTituloPagar(tx, e, ctx);
  },
  alvo: (_e, r) => ({ tabela: 'titulo_pagar', id: numero(r['tituloPagar']) || null }),
  eventos: (_e, r) => [
    {
      tipo: r['acao'] === 'excluir' ? 'financeiro.titulo_pagar.excluido' : 'financeiro.titulo_pagar.lancado',
      carga: { titulo: numero(r['tituloPagar']), parcelas: numero(r['parcelas']) },
    },
  ],
});

// ── financeiro.baixarTitulo ─────────────────────────────────────────────────────────────────────────────────────

async function pagar(
  tx: TxOperacao,
  e: Extract<BaixarTituloEntrada, { cenario: 'pagar' }>,
  ctx: ContextoOperacao,
): Promise<ResultadoOperacao> {
  const est = estabelecimentoDe(ctx);
  const usuario = usuarioDe(ctx);
  const forma = formaDoCodigo(e.formaPagamento);
  if (!forma)
    throw recusa('forma-pagamento-invalida', 'Escolha uma forma de pagamento da lista.', {
      campos: ['formaPagamento'],
    });
  await exigirContaDoEscopo(tx, est, usuario, e.conta, 'pagamento');
  const pagador = (await loginDe(tx, usuario)) ?? '';
  const faixas = await faixasLidas(tx, est);
  const lidos: Linha[] = [];
  for (const it of [...e.titulos].sort((a, b) => a.titulo - b.titulo)) {
    const [p] = await tx.consultarParaAtualizar(
      `SELECT p.id, p.versao, p.saldo, p.valor_pago, p.situacao, p.titulo_pagar_id, t.valor_bruto, t.criado_por,
              t.centro_custo_id, t.numero_documento, t.natureza_financeira_id, tc.codigo AS tipo_codigo, tc.natureza
         FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
         JOIN tipo_credor tc ON tc.id = t.tipo_credor_id
        WHERE p.id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL
          AND t.situacao <> 'cancelado'`,
      [it.titulo, est],
      { teto: 1 },
    );
    if (!p) throw recusa('titulo-inexistente', 'O título não existe.');
    conferirVersao(it.versao, p['versao']);
    const baixa = await tx.uma(
      "SELECT id FROM baixa_titulo WHERE parcela_pagar_id = ? AND situacao = 'efetivada' AND excluido_em IS NULL LIMIT 1",
      [it.titulo],
    );
    if (
      baixa ||
      ['paga', 'parcial', 'cancelada', 'renegociada'].includes(String(p['situacao'])) ||
      !(numero(p['saldo']) > 0)
    )
      throw recusa('titulo-ja-baixado', 'O título já foi baixado por outra via: releia.');
    const titulo = numero(p['titulo_pagar_id']);
    const faixa = alcadaAplicavel(
      faixas,
      {
        empresa: 1,
        centroCusto: await centroDaAlcada(tx, titulo, p['centro_custo_id']),
        tipo: tipoCredorDe(p['tipo_codigo'], p['natureza']),
        valor: numero(p['valor_bruto']),
      },
      e.dataPagamento,
    );
    const aprovacoes = (await aprovacoesPorTitulo(tx, est, [titulo])).get(titulo) ?? [];
    recusar(conferirPagamento({ faixa, aprovacoes, pagador, lancador: await loginDe(tx, p['criado_por']) }));
    lidos.push(p);
  }
  const total = centavos(lidos.reduce((x, p) => x + numero(p['saldo']), 0));
  let bordero = 0;
  let numeroBordero = '';
  if (e.porBordero) {
    await garantirSequencia(
      tx,
      { tipo: 'bordero_pagamento', estabelecimento: est, prefixo: 'BP-' },
      { usuario, agora: new Date() },
    );
    const num = await tx.proximoNumero('bordero_pagamento');
    numeroBordero = num.formatado;
    bordero = await tx.incluir('bordero_pagamento', {
      estabelecimento_id: est,
      numero: num.formatado,
      conta_bancaria_id: e.conta,
      data_pagamento: e.dataPagamento,
      data_emissao: e.dataPagamento,
      quantidade_parcelas: lidos.length,
      valor_total: total,
      situacao: 'processado',
    });
  }
  const tipoMov = await tipoLancamento(tx, LANCAMENTO_PAGAMENTO);
  const titulos = new Set<number>();
  for (const p of lidos) {
    const valor = numero(p['saldo']);
    const mov = await tx.incluir('movimento_bancario', {
      estabelecimento_id: est,
      conta_bancaria_id: e.conta,
      tipo_lancamento_bancario_id: tipoMov,
      natureza: 'debito',
      tipo_origem: 'baixa_titulo',
      data_movimento: e.dataPagamento,
      numero_documento: String(p['numero_documento'] ?? '').slice(0, 30) || null,
      historico: `Pagamento do título ${String(p['numero_documento'] ?? '')}`.slice(0, 300),
      valor,
      natureza_financeira_id: p['natureza_financeira_id'],
    });
    const baixa = await tx.incluir('baixa_titulo', {
      estabelecimento_id: est,
      parcela_pagar_id: p['id'],
      data_pagamento: e.dataPagamento,
      conta_bancaria_id: e.conta,
      forma_pagamento: forma,
      valor_principal: valor,
      valor_pago: valor,
      bordero_pagamento_id: bordero || null,
      movimento_bancario_id: mov,
    });
    await tx.alterar('movimento_bancario', mov, 1, { baixa_titulo_id: baixa });
    await tx.alterar('parcela_pagar', numero(p['id']), numero(p['versao']), {
      valor_pago: centavos(numero(p['valor_pago']) + valor),
      saldo: 0,
      situacao: 'paga',
      quitada_em: e.dataPagamento,
    });
    titulos.add(numero(p['titulo_pagar_id']));
  }
  for (const t of titulos) {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT t.versao, SUM(p.saldo > 0) AS abertas FROM titulo_pagar t
         JOIN parcela_pagar p ON p.titulo_pagar_id = t.id AND p.excluido_em IS NULL
        WHERE t.id = ? GROUP BY t.id, t.versao`,
      [t],
      { teto: 1 },
    );
    if (r)
      await tx.alterar('titulo_pagar', t, numero(r['versao']), {
        situacao: numero(r['abertas']) > 0 ? 'pago_parcial' : 'pago',
      });
  }
  return {
    cenario: e.porBordero ? 'pagar-por-bordero' : 'pagar-sem-bordero',
    titulos: lidos.length,
    bordero: numeroBordero ? Number(numeroBordero.replace(/\D/g, '')) || bordero : 0,
    idBordero: bordero,
    valor: total,
    ids: lidos.map((p) => numero(p['id'])).join(','),
    conta: e.conta,
  };
}

async function receber(
  tx: TxOperacao,
  e: Extract<BaixarTituloEntrada, { cenario: 'receber' }>,
  ctx: ContextoOperacao,
): Promise<ResultadoOperacao> {
  const est = estabelecimentoDe(ctx);
  const usuario = usuarioDe(ctx);
  const forma = formaDoCodigo(e.formaPagamento);
  if (!forma)
    throw recusa('forma-pagamento-invalida', 'Escolha uma forma de recebimento da lista.', {
      campos: ['formaPagamento'],
    });
  await exigirContaDoEscopo(tx, est, usuario, e.conta, 'recebimento');
  const [t] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, valor_recebido, numero_documento, natureza_financeira_id FROM titulo_receber
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [e.titulo, est],
    { teto: 1 },
  );
  if (!t) throw recusa('titulo-inexistente', 'O título não existe.');
  conferirVersao(e.versao, t['versao']);
  const [p] = await tx.consultarParaAtualizar(
    `SELECT id, versao, saldo, valor_recebido FROM parcela_receber
      WHERE titulo_receber_id = ? AND excluido_em IS NULL AND saldo > 0 AND situacao IN ('aberta','parcial')
      ORDER BY sequencia LIMIT 1`,
    [e.titulo],
    { teto: 1 },
  );
  const r = conferirBaixaManual({
    emAberto: !!p && ['aberto', 'recebido_parcial'].includes(String(t['situacao'])),
    valorTitulo: numero(p?.['saldo']),
    valorRecebido: e.valorRecebido,
    motivo: e.motivo,
    temPermissaoManual: true,
  });
  if (r) recusar(r.codigo === 'titulo-baixado' ? { ...r, codigo: 'titulo-ja-baixado' } : r);
  if (!p) throw recusa('titulo-ja-baixado', 'O título já foi baixado por outra via: releia.');
  const formaRecebimento = await idObrigatorio(
    tx,
    "SELECT id FROM forma_recebimento WHERE meio = ? AND ativo = TRUE AND uso IN ('recebimento','ambos') ORDER BY padrao DESC, id LIMIT 1",
    [MEIO_RECEBIMENTO[forma]],
    `a forma de recebimento "${MEIO_RECEBIMENTO[forma]}"`,
  );
  const tipoMov = await tipoLancamento(tx, LANCAMENTO_RECEBIMENTO);
  const mov = await tx.incluir('movimento_bancario', {
    estabelecimento_id: est,
    conta_bancaria_id: e.conta,
    tipo_lancamento_bancario_id: tipoMov,
    natureza: 'credito',
    tipo_origem: 'manual',
    data_movimento: e.dataRecebimento,
    numero_documento: String(t['numero_documento'] ?? '').slice(0, 30) || null,
    historico: `Recebimento manual do título ${String(t['numero_documento'] ?? '')}`.slice(0, 300),
    valor: e.valorRecebido,
    natureza_financeira_id: t['natureza_financeira_id'],
  });
  await garantirSequencia(
    tx,
    { tipo: 'recebimento', estabelecimento: est, prefixo: 'RC-' },
    { usuario, agora: new Date() },
  );
  const num = await tx.proximoNumero('recebimento');
  const recebimento = await tx.incluir('recebimento', {
    estabelecimento_id: est,
    numero: num.formatado,
    parcela_receber_id: p['id'],
    data_recebimento: e.dataRecebimento,
    forma_recebimento_id: formaRecebimento,
    conta_bancaria_id: e.conta,
    valor_recebido: e.valorRecebido,
    meio_baixa: 'manual',
    movimento_bancario_id: mov,
    observacao: e.motivo.trim().slice(0, 500),
  });
  const saldo = centavos(Math.max(0, numero(p['saldo']) - e.valorRecebido));
  await tx.alterar('parcela_receber', numero(p['id']), numero(p['versao']), {
    valor_recebido: centavos(numero(p['valor_recebido']) + e.valorRecebido),
    saldo,
    situacao: saldo > 0 ? 'parcial' : 'recebida',
    quitada_em: saldo > 0 ? null : e.dataRecebimento,
  });
  const abertas = await tx.uma(
    'SELECT COUNT(*) AS n FROM parcela_receber WHERE titulo_receber_id = ? AND excluido_em IS NULL AND saldo > 0 AND id <> ?',
    [e.titulo, p['id']],
  );
  await tx.alterar('titulo_receber', e.titulo, numero(t['versao']), {
    valor_recebido: centavos(numero(t['valor_recebido']) + e.valorRecebido),
    situacao: saldo > 0 || numero(abertas?.['n']) > 0 ? 'recebido_parcial' : 'recebido',
  });
  return {
    cenario: 'receber-manual',
    titulos: 1,
    bordero: 0,
    idBordero: 0,
    valor: e.valorRecebido,
    ids: String(e.titulo),
    conta: e.conta,
    recebimento,
  };
}

const baixarTitulo = definirOperacao<BaixarTituloEntrada, ResultadoOperacao>({
  nome: 'financeiro.baixar_titulo',
  tabelas: [
    'titulo_pagar',
    'parcela_pagar',
    'baixa_titulo',
    'bordero_pagamento',
    'movimento_bancario',
    'titulo_receber',
    'parcela_receber',
    'recebimento',
    'sequencia_negocio',
  ],
  entrada: ESQUEMAS_OPERACAO_FINANCEIRO['financeiro.baixarTitulo'] as never,
  gravar: (tx, e, ctx) => (e.cenario === 'pagar' ? pagar(tx, e, ctx) : receber(tx, e, ctx)),
  alvo: (e, r) =>
    e.cenario === 'pagar'
      ? { tabela: 'parcela_pagar', id: Number(String(r['ids']).split(',')[0]) || null }
      : { tabela: 'titulo_receber', id: e.titulo },
  eventos: (e, r) => [
    {
      tipo: e.cenario === 'pagar' ? 'financeiro.titulo_pagar.pago' : 'financeiro.titulo_receber.recebido',
      carga: { titulos: numero(r['titulos']), conta: numero(r['conta']) },
    },
  ],
});

// ── financeiro.criarTituloReceber ───────────────────────────────────────────────────────────────────────────────

/** Situações da conta hospitalar que geram título a receber (fechada ou já apresentada/faturada). */
export const SITUACOES_CONTA_TITULAVEL = ['fechada', 'faturada', 'enviada'] as const;

const criarTituloReceber = definirOperacao<CriarTituloReceberEntrada, ResultadoOperacao>({
  nome: 'financeiro.criar_titulo_receber',
  tabelas: ['titulo_receber', 'parcela_receber', 'documento_origem_titulo', 'sequencia_negocio'],
  entrada: ESQUEMAS_OPERACAO_FINANCEIRO['financeiro.criarTituloReceber'] as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const ids = [...new Set(e.contas.map((c) => c.conta))];
    const contas = await tx.consultarParaAtualizar(
      `SELECT c.id, c.versao, c.numero, c.fonte_pagadora_id, c.paciente_id, c.atendimento_id, c.competencia, c.situacao,
              c.valor_total, c.natureza, f.tipo AS tipo_fonte
         FROM conta_hospitalar c JOIN fonte_pagadora f ON f.id = c.fonte_pagadora_id
        WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.id IN (${lista(ids.length)})
        ORDER BY c.id`,
      [est, ...ids],
    );
    if (contas.length !== ids.length)
      throw recusa('conta-inexistente', 'A conta não existe.', { campos: ['contas'] });
    const porId = new Map(contas.map((c) => [numero(c['id']), c]));
    for (const x of e.contas) conferirVersao(x.versao, porId.get(x.conta)?.['versao']);
    const tituladas = await tx.consultar(
      `SELECT d.entidade_id FROM documento_origem_titulo d JOIN titulo_receber t ON t.id = d.titulo_receber_id
        WHERE d.entidade = 'conta_hospitalar' AND d.excluido_em IS NULL AND t.excluido_em IS NULL
          AND t.situacao <> 'cancelado' AND d.entidade_id IN (${lista(ids.length)})`,
      ids,
    );
    if (tituladas.length)
      throw recusa('conta-titulada', 'A conta já tem título a receber: abra o título existente.', {
        campos: ['contas'],
      });
    for (const c of contas) {
      if (!(SITUACOES_CONTA_TITULAVEL as readonly string[]).includes(String(c['situacao'])))
        throw recusa('conta-aberta', 'Só a conta fechada ou apresentada gera título a receber.', {
          campos: ['contas'],
        });
      if (!(numero(c['valor_total']) > 0))
        throw recusa('conta-sem-valor', 'A conta não tem valor a receber.', { campos: ['contas'] });
    }
    const p = contas[0]!;
    const internacao = (c: Linha) => String(c['natureza']) === 'internacao';
    if (
      contas.some(
        (c) =>
          numero(c['fonte_pagadora_id']) !== numero(p['fonte_pagadora_id']) ||
          internacao(c) !== internacao(p) ||
          dataIso(c['competencia']) !== dataIso(p['competencia']),
      )
    )
      throw recusa('contas-misturadas', 'As contas de um título são do mesmo convênio, tipo e competência.', {
        campos: ['contas'],
      });
    const particular = String(p['tipo_fonte']) === 'particular';
    if (particular && contas.length > 1)
      throw recusa('contas-misturadas', 'O título do particular é de uma conta só.', { campos: ['contas'] });
    if (!particular && !(e.documento > 0))
      throw recusa('documento-obrigatorio', 'Informe o número da fatura do convênio.', {
        campos: ['documento'],
      });
    const natureza = await idObrigatorio(
      tx,
      `SELECT n.id FROM natureza_financeira n WHERE n.tipo = 'receita' AND n.ativo = TRUE AND n.excluido_em IS NULL
        ORDER BY n.receita_operacional DESC, n.ordem IS NULL, n.ordem, n.id LIMIT 1`,
      [],
      'a natureza financeira de receita',
    );
    const tipoDocumento = await idObrigatorio(
      tx,
      `SELECT id FROM tipo_documento_financeiro WHERE ativo = TRUE AND sentido IN ('receber','ambos')
        ORDER BY (codigo = 'fatura') DESC, nativo_sistema DESC, id LIMIT 1`,
      [],
      'o tipo de documento financeiro a receber',
    );
    const valor = centavos(contas.reduce((x, c) => x + numero(c['valor_total']), 0));
    await garantirSequencia(
      tx,
      { tipo: 'titulo_receber', estabelecimento: est, prefixo: 'TR-' },
      { usuario, agora: new Date() },
    );
    const num = await tx.proximoNumero('titulo_receber');
    const hoje = hojeIso();
    const titulo = await tx.incluir('titulo_receber', {
      estabelecimento_id: est,
      numero: num.formatado,
      tipo_devedor: particular ? 'paciente' : 'fonte_pagadora',
      fonte_pagadora_id: particular ? null : p['fonte_pagadora_id'],
      paciente_id: particular ? p['paciente_id'] : null,
      tipo_origem: 'conta',
      conta_hospitalar_id: p['id'],
      atendimento_id: contas.length === 1 ? p['atendimento_id'] : null,
      tipo_documento_financeiro_id: tipoDocumento,
      numero_documento: e.documento > 0 ? String(e.documento) : String(p['numero']),
      data_emissao: hoje,
      data_lancamento: hoje,
      data_prevista_recebimento: e.vencimento,
      competencia: dataIso(p['competencia']),
      valor_bruto: valor,
      valor_liquido: valor,
      natureza_financeira_id: natureza,
      referente: e.referente.trim() || null,
    });
    await tx.incluir('parcela_receber', {
      titulo_receber_id: titulo,
      sequencia: 1,
      vencimento: e.vencimento,
      vencimento_original: e.vencimento,
      valor,
      saldo: valor,
    });
    for (const c of contas)
      await tx.incluir('documento_origem_titulo', {
        natureza_titulo: 'receber',
        titulo_receber_id: titulo,
        tipo_documento: 'outro',
        entidade: 'conta_hospitalar',
        entidade_id: c['id'],
        numero_documento: String(c['numero']).slice(0, 60),
      });
    return {
      titulo,
      numero: num.formatado,
      contas: contas.length,
      devedor: particular ? 'paciente' : 'fonte_pagadora',
      valor,
      documento: e.documento,
      ids: contas.map((c) => numero(c['id'])).join(','),
      convenio: numero(p['fonte_pagadora_id']),
    };
  },
  alvo: (_e, r) => ({ tabela: 'titulo_receber', id: numero(r['titulo']) || null }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.titulo_receber.criado',
      carga: { titulo: numero(r['titulo']), contas: numero(r['contas']) },
    },
  ],
});

// ── financeiro.lancarMovimento ──────────────────────────────────────────────────────────────────────────────────

const lancarMovimento = definirOperacao<LancarMovimentoEntrada, ResultadoOperacao>({
  nome: 'financeiro.lancar_movimento',
  tabelas: ['movimento_bancario', 'sequencia_negocio'],
  entrada: ESQUEMAS_OPERACAO_FINANCEIRO['financeiro.lancarMovimento'] as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    recusar(conferirMovimento(e));
    for (const c of [e.contaCredito, e.contaDebito])
      if (c) await exigirContaDoEscopo(tx, est, usuario, c, 'movimento');
    const natureza = await naturezaDaClassificacao(tx, e.classificacao);
    const mapa = MOVIMENTO_DO_TIPO[e.tipo];
    const tipoMov = await tipoLancamento(tx, mapa.codigo);
    await garantirSequencia(
      tx,
      { tipo: 'movimento_bancario', estabelecimento: est, prefixo: null },
      { usuario, agora: new Date() },
    );
    const doc = await tx.proximoNumero('movimento_bancario');
    const linha = (conta: number, natura: 'credito' | 'debito', contrapartida: number | null) =>
      tx.incluir('movimento_bancario', {
        estabelecimento_id: est,
        conta_bancaria_id: conta,
        tipo_lancamento_bancario_id: tipoMov,
        natureza: natura,
        tipo_origem: mapa.origem,
        data_movimento: e.data,
        numero_documento: String(doc.valor),
        historico: e.historico.trim(),
        valor: e.valor,
        contrapartida_conta_bancaria_id: contrapartida,
        natureza_financeira_id: natureza,
      });
    const ids: number[] = [];
    if (e.contaDebito) ids.push(await linha(e.contaDebito, 'debito', e.contaCredito));
    if (e.contaCredito) ids.push(await linha(e.contaCredito, 'credito', e.contaDebito));
    return { movimento: ids[0] ?? 0, doc: doc.valor, tipo: e.tipo, valor: e.valor, ids: ids.join(',') };
  },
  alvo: (_e, r) => ({ tabela: 'movimento_bancario', id: numero(r['movimento']) || null }),
  eventos: (e, r) => [
    { tipo: 'financeiro.movimento.lancado', carga: { movimento: numero(r['movimento']), tipo: e.tipo } },
  ],
});

/** Operação do executor pelo nome da tela (o nome do executor é minúsculo, com sublinhado). */
export const OPERACOES_FINANCEIRO: Readonly<Record<string, Operacao<never, ResultadoOperacao>>> = {
  'financeiro.criarTituloPagar': criarTituloPagar as unknown as Operacao<never, ResultadoOperacao>,
  'financeiro.baixarTitulo': baixarTitulo as unknown as Operacao<never, ResultadoOperacao>,
  'financeiro.criarTituloReceber': criarTituloReceber as unknown as Operacao<never, ResultadoOperacao>,
  'financeiro.lancarMovimento': lancarMovimento as unknown as Operacao<never, ResultadoOperacao>,
};
