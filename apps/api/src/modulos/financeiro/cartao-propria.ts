// F3.8, 07-FIN linha 89: cartão de débito e crédito no banco próprio. A regra é a do domínio (escolherTaxa,
// gerarParcelasRecebivel, planejarVigenciaTaxa, repartirCreditoCartao); aqui ficam a leitura e a gravação.
// Cadastro: a administradora e a taxa por bandeira, modalidade e faixa de parcelas, com vigência. A taxa nova encerra
// na véspera a que valia; nada é apagado, e a venda antiga continua explicada pela taxa da data dela.
// Recebimento: a venda em cartão grava UMA transação (bruto, taxa, líquido) e as parcelas a receber da administradora,
// líquidas e com a data prevista do crédito. O caixa do particular chama `gravarRecebivelCartao` dentro da própria
// transação do recebimento; a tesouraria registra a venda avulsa pela operação daqui.
// Fluxo de caixa: as parcelas previstas entram como entrada projetada na data prevista (`lancamentosFluxoCartao`).
// Baixa: o crédito da administradora na conta vira UM movimento bancário e marca as parcelas como recebidas; esse
// movimento é o que a conciliação bancária casa com a linha do extrato. A conferência contra a agenda da adquirente
// (arquivo dela) fica para a integração.
import {
  escolherTaxa,
  gerarParcelasRecebivel,
  type ModalidadeCartao,
  type ParcelaRecebivel,
  planejarVigenciaTaxa,
  type RecusaFinanceiro,
  repartirCreditoCartao,
  type TaxaAdministradora,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { exigirPeriodoAberto } from './periodo-propria.js';
import type { LancamentoFluxoPorta } from './porta.js';
import { dataIso, LANCAMENTO_RECEBIMENTO, numero, numeroOuNulo, texto } from './vocabulario.js';

type Linha = Record<string, unknown>;
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const MODALIDADES = ['debito', 'credito', 'pre_pago', 'voucher'] as const;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const sim = (v: unknown) => v === true || Number(v) === 1;
const ph = (n: readonly unknown[]) => n.map(() => '?').join(',');

function recusar<T extends object>(r: { recusa: RecusaFinanceiro } | T): T {
  if ('recusa' in r) {
    const x = r.recusa;
    throw recusa(x.codigo, x.mensagem, x.campos ? { campos: x.campos } : {});
  }
  return r;
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}

const COLUNAS_TAXA = `id, versao, administradora_cartao_id, bandeira_cartao_id, modalidade, parcela_inicial, parcela_final,
  tipo_taxa, percentual_taxa, valor_taxa, dias_repasse, vigencia_inicio, vigencia_fim, ativo`;

function taxaDe(r: Linha): TaxaAdministradora {
  return {
    id: numero(r['id']),
    administradora: numero(r['administradora_cartao_id']),
    bandeira: numeroOuNulo(r['bandeira_cartao_id']),
    modalidade: texto(r['modalidade']) as ModalidadeCartao,
    parcelaInicial: numero(r['parcela_inicial']),
    parcelaFinal: numero(r['parcela_final']),
    tipo: texto(r['tipo_taxa']) === 'valor_fixo' ? 'valor' : 'percentual',
    percentual: numeroOuNulo(r['percentual_taxa']),
    valor: numeroOuNulo(r['valor_taxa']),
    diasRepasse: numero(r['dias_repasse']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
    ativo: sim(r['ativo']),
  };
}

// ── Leituras ──

export interface AdministradoraCartaoLida {
  readonly id: number;
  readonly versao: number;
  readonly nome: string;
  readonly diasParaPagamento: number;
  readonly contaBancaria: number | null;
  readonly permiteParcelamento: boolean;
  readonly ativo: boolean;
}
export interface OpcoesCartao {
  readonly administradoras: readonly AdministradoraCartaoLida[];
  readonly bandeiras: readonly { id: number; nome: string; modalidade: string }[];
}

/** As administradoras do estabelecimento e as bandeiras ativas (para os combos do recebimento e do cadastro). */
export async function opcoesCartao(l: Leitor, est: number, soAtivas = false): Promise<OpcoesCartao> {
  const adm = await l.consultar(
    `SELECT id, versao, nome, dias_para_pagamento, conta_bancaria_id, permite_parcelamento, ativo
       FROM administradora_cartao
      WHERE estabelecimento_id = ? AND excluido_em IS NULL AND cartao_corporativo = FALSE ${soAtivas ? 'AND ativo = TRUE' : ''}
      ORDER BY nome LIMIT 500`,
    [est],
  );
  const bandeiras = await l.consultar(
    'SELECT id, descricao, modalidade FROM bandeira_cartao WHERE ativo = TRUE ORDER BY descricao LIMIT 500',
    [],
  );
  return {
    administradoras: adm.map((a) => ({
      id: numero(a['id']),
      versao: numero(a['versao']),
      nome: texto(a['nome']),
      diasParaPagamento: numero(a['dias_para_pagamento']),
      contaBancaria: numeroOuNulo(a['conta_bancaria_id']),
      permiteParcelamento: sim(a['permite_parcelamento']),
      ativo: sim(a['ativo']),
    })),
    bandeiras: bandeiras.map((b) => ({
      id: numero(b['id']),
      nome: texto(b['descricao']),
      modalidade: texto(b['modalidade']),
    })),
  };
}

export interface TaxaCartaoLida extends TaxaAdministradora {
  readonly versao: number;
  /** Vale hoje: ativa, já começou e não terminou. */
  readonly vigente: boolean;
}

/** As taxas da administradora, as vigentes primeiro e as encerradas depois (o histórico fica à vista). */
export async function taxasDaAdministradora(
  l: Leitor,
  est: number,
  administradora: number,
  hoje: string,
): Promise<TaxaCartaoLida[]> {
  const linhas = await l.consultar(
    `SELECT ${COLUNAS_TAXA} FROM taxa_administradora
      WHERE estabelecimento_id = ? AND administradora_cartao_id = ?
      ORDER BY modalidade, parcela_inicial, vigencia_inicio DESC LIMIT 2000`,
    [est, administradora],
  );
  return linhas
    .map((r) => {
      const t = taxaDe(r);
      const vigente =
        t.ativo && t.vigenciaInicio <= hoje && (t.vigenciaFim === null || t.vigenciaFim >= hoje);
      return { ...t, versao: numero(r['versao']), vigente };
    })
    .sort((a, b) => Number(b.vigente) - Number(a.vigente));
}

export interface PedidoCartao {
  readonly administradora: number;
  readonly bandeira: number;
  readonly modalidade: ModalidadeCartao;
  readonly parcelas: number;
  readonly valor: number;
  readonly dataVenda: string;
}
export interface PlanoCartao {
  readonly taxa: TaxaAdministradora;
  readonly parcelas: readonly ParcelaRecebivel[];
  readonly bruto: number;
  readonly taxaTotal: number;
  readonly liquido: number;
}

const BANDEIRA_ACEITA: Readonly<Record<ModalidadeCartao, readonly string[]>> = {
  credito: ['credito', 'credito_debito'],
  debito: ['debito', 'credito_debito'],
  pre_pago: ['credito', 'debito', 'credito_debito'],
  voucher: ['voucher'],
};

/** A taxa vigente e as parcelas a receber de uma venda (sem gravar): é a prévia que a tela mostra na hora. */
export async function planoDoCartao(l: Leitor, est: number, p: PedidoCartao): Promise<PlanoCartao> {
  const adm = await l.uma(
    'SELECT id, ativo, permite_parcelamento FROM administradora_cartao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [p.administradora, est],
  );
  if (!adm || !sim(adm['ativo']))
    throw recusa(
      'administradora-cartao-inexistente',
      'A administradora do cartão não existe ou está inativa neste estabelecimento.',
      { campos: ['administradora'] },
    );
  const bandeira = await l.uma('SELECT id, ativo, modalidade FROM bandeira_cartao WHERE id = ?', [
    p.bandeira,
  ]);
  if (!bandeira || !sim(bandeira['ativo']))
    throw recusa('bandeira-cartao-inexistente', 'A bandeira do cartão não existe ou está inativa.', {
      campos: ['bandeira'],
    });
  if (!BANDEIRA_ACEITA[p.modalidade].includes(texto(bandeira['modalidade'])))
    throw recusa('bandeira-cartao-modalidade', 'Esta bandeira não é aceita nesta modalidade de cartão.', {
      campos: ['bandeira', 'modalidade'],
    });
  if (p.parcelas > 1 && !sim(adm['permite_parcelamento']))
    throw recusa('administradora-sem-parcelamento', 'Esta administradora não aceita venda parcelada.', {
      campos: ['parcelas'],
    });
  const taxas = (
    await l.consultar(
      `SELECT ${COLUNAS_TAXA} FROM taxa_administradora
        WHERE estabelecimento_id = ? AND administradora_cartao_id = ? AND ativo = TRUE LIMIT 2000`,
      [est, p.administradora],
    )
  ).map(taxaDe);
  const { taxa } = recusar(
    escolherTaxa(taxas, {
      administradora: p.administradora,
      bandeira: p.bandeira,
      modalidade: p.modalidade,
      parcelas: p.parcelas,
      data: p.dataVenda,
    }),
  );
  const { parcelas } = recusar(
    gerarParcelasRecebivel({ valor: p.valor, parcelas: p.parcelas, dataVenda: p.dataVenda, taxa }),
  );
  if (parcelas.some((x) => x.bruto <= 0))
    throw recusa('valor-cartao-invalido', 'O valor é pequeno demais para este número de parcelas.', {
      campos: ['valor', 'parcelas'],
    });
  const bruto = r2(parcelas.reduce((s, x) => s + x.bruto, 0));
  const taxaTotal = r2(parcelas.reduce((s, x) => s + x.taxa, 0));
  return { taxa, parcelas, bruto, taxaTotal, liquido: r2(bruto - taxaTotal) };
}

export interface RecebivelCartaoLido {
  readonly id: number;
  readonly transacao: number;
  readonly administradora: number;
  readonly administradoraNome: string;
  readonly bandeira: string;
  readonly modalidade: string;
  readonly nsu: string;
  readonly dataVenda: string;
  readonly sequencia: number;
  readonly de: number;
  readonly dataPrevista: string;
  readonly bruto: number;
  readonly taxa: number;
  readonly liquido: number;
  readonly situacao: string;
  readonly recebidaEm: string | null;
  readonly valorRecebido: number | null;
  readonly contaSugerida: number | null;
}

/** As parcelas a receber das administradoras pela data prevista do crédito. */
export async function recebiveisCartao(
  l: Leitor,
  est: number,
  f: { de: string; ate: string; situacao: string | null; administradora: number | null },
): Promise<RecebivelCartaoLido[]> {
  const linhas = await l.consultar(
    `SELECT p.id, p.transacao_cartao_id, p.sequencia, p.data_prevista, p.valor_bruto, p.valor_taxa, p.valor_liquido,
            p.situacao, p.recebida_em, p.valor_recebido, t.administradora_cartao_id, t.tipo_cartao, t.nsu,
            t.quantidade_parcelas, t.data_hora_transacao, a.nome, a.conta_bancaria_id, b.descricao AS bandeira
       FROM parcela_recebivel_cartao p
       JOIN transacao_cartao t ON t.id = p.transacao_cartao_id
       JOIN administradora_cartao a ON a.id = t.administradora_cartao_id
       JOIN bandeira_cartao b ON b.id = t.bandeira_cartao_id
      WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND p.excluido_em IS NULL
        AND p.data_prevista BETWEEN ? AND ?
        AND (? IS NULL OR p.situacao = ?) AND (? IS NULL OR t.administradora_cartao_id = ?)
      ORDER BY p.data_prevista, a.nome, t.id, p.sequencia LIMIT 5000`,
    [est, f.de, f.ate, f.situacao, f.situacao, f.administradora, f.administradora],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    transacao: numero(r['transacao_cartao_id']),
    administradora: numero(r['administradora_cartao_id']),
    administradoraNome: texto(r['nome']),
    bandeira: texto(r['bandeira']),
    modalidade: texto(r['tipo_cartao']),
    nsu: texto(r['nsu']),
    dataVenda: dataIso(r['data_hora_transacao']) ?? '',
    sequencia: numero(r['sequencia']),
    de: numero(r['quantidade_parcelas']),
    dataPrevista: dataIso(r['data_prevista']) ?? '',
    bruto: numero(r['valor_bruto']),
    taxa: numero(r['valor_taxa']),
    liquido: numero(r['valor_liquido']),
    situacao: texto(r['situacao']),
    recebidaEm: dataIso(r['recebida_em']),
    valorRecebido: numeroOuNulo(r['valor_recebido']),
    contaSugerida: numeroOuNulo(r['conta_bancaria_id']),
  }));
}

/** As parcelas previstas no período, como entradas projetadas do fluxo de caixa (líquidas da taxa). */
export async function lancamentosFluxoCartao(
  l: Leitor,
  est: number,
  de: string,
  ate: string,
): Promise<LancamentoFluxoPorta[]> {
  const linhas = await l.consultar(
    `SELECT p.data_prevista, p.valor_liquido FROM parcela_recebivel_cartao p
       JOIN transacao_cartao t ON t.id = p.transacao_cartao_id
      WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND p.excluido_em IS NULL
        AND p.situacao = 'prevista' AND p.valor_liquido > 0 AND p.data_prevista BETWEEN ? AND ?`,
    [est, de, ate],
  );
  return linhas.map((r) => ({
    data: dataIso(r['data_prevista']) ?? de,
    valor: numero(r['valor_liquido']),
    sentido: 'entrada' as const,
    origem: 'receber' as const,
    realizado: false,
  }));
}

// ── Gravação compartilhada: a transação e as parcelas a receber de uma venda em cartão ──

export interface VendaCartao extends PedidoCartao {
  /** O instante da venda. */
  readonly instante: Date;
  readonly nsu: string;
  readonly autorizacao: string;
  readonly finalCartao?: string | null;
  readonly moduloOrigem: 'caixa' | 'recepcao' | 'financeiro' | 'portal';
  readonly caixa?: number | null;
  readonly sessaoCaixa?: number | null;
  readonly operador?: number | null;
}

/** Tabelas que a venda em cartão grava (a operação que chama declara estas). */
export const TABELAS_RECEBIVEL_CARTAO = ['transacao_cartao', 'parcela_recebivel_cartao'] as const;

/**
 * Grava a transação de cartão e as parcelas a receber pela regra do domínio, na transação de quem chama. O mesmo
 * comprovante (NSU e autorização) na mesma administradora não entra duas vezes.
 */
export async function gravarRecebivelCartao(
  tx: Leitor & Pick<TxOperacao, 'incluir'>,
  est: number,
  v: VendaCartao,
): Promise<{ transacao: number; plano: PlanoCartao }> {
  const plano = await planoDoCartao(tx, est, v);
  const nsu = v.nsu.trim().slice(0, 30);
  const autorizacao = v.autorizacao.trim().slice(0, 20);
  if (!nsu || !autorizacao)
    throw recusa(
      'comprovante-cartao-ausente',
      'Informe o comprovante do cartão (NSU e código de autorização).',
      {
        campos: ['nsu', 'autorizacao'],
      },
    );
  const repetida = await tx.uma(
    `SELECT id FROM transacao_cartao
      WHERE administradora_cartao_id = ? AND nsu = ? AND codigo_autorizacao = ? AND tipo_operacao = 'venda'`,
    [v.administradora, nsu, autorizacao],
  );
  if (repetida)
    throw recusa(
      'transacao-cartao-repetida',
      'Este comprovante de cartão já foi registrado para esta administradora.',
      { campos: ['nsu', 'autorizacao'] },
    );
  const transacao = await tx.incluir('transacao_cartao', {
    estabelecimento_id: est,
    administradora_cartao_id: v.administradora,
    bandeira_cartao_id: v.bandeira,
    caixa_id: v.caixa ?? null,
    sessao_caixa_id: v.sessaoCaixa ?? null,
    operador_usuario_id: v.operador ?? null,
    tipo_operacao: 'venda',
    tipo_cartao: v.modalidade,
    modalidade: v.parcelas > 1 ? 'parcelado_estabelecimento' : 'a_vista',
    quantidade_parcelas: v.parcelas,
    nsu,
    codigo_autorizacao: autorizacao,
    final_cartao: v.finalCartao ?? null,
    data_hora_transacao: v.instante,
    valor_bruto: plano.bruto,
    percentual_taxa: plano.parcelas[0]?.percentualTaxa ?? 0,
    valor_taxa: plano.taxaTotal,
    valor_liquido: plano.liquido,
    modulo_origem: v.moduloOrigem,
    situacao: 'autorizada',
  });
  for (const p of plano.parcelas)
    await tx.incluir('parcela_recebivel_cartao', {
      transacao_cartao_id: transacao,
      sequencia: p.sequencia,
      data_prevista: p.dataPrevista,
      valor_bruto: p.bruto,
      percentual_taxa: p.percentualTaxa,
      valor_taxa: p.taxa,
      valor_liquido: p.liquido,
      situacao: 'prevista',
    });
  return { transacao, plano };
}

// ── Operações ──

export const esquemaAdministradoraCartao = z
  .object({
    id: id.nullable().default(null),
    versao: z.number().int().positive().nullable().default(null),
    nome: z.string().trim().min(2).max(150),
    diasParaPagamento: z.number().int().min(0).max(400).default(30),
    contaBancaria: id.nullable().default(null),
    permiteParcelamento: z.boolean().default(true),
    ativo: z.boolean().default(true),
  })
  .strict();

const gravarAdministradora = definirOperacao<z.infer<typeof esquemaAdministradoraCartao>, ResultadoOperacao>({
  nome: 'financeiro.gravar_administradora_cartao',
  tabelas: ['administradora_cartao'],
  entrada: esquemaAdministradoraCartao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    if (e.contaBancaria !== null) {
      const conta = await tx.uma(
        'SELECT id FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.contaBancaria, est],
      );
      if (!conta)
        throw recusa('conta-inexistente', 'A conta bancária não existe neste estabelecimento.', {
          campos: ['contaBancaria'],
        });
    }
    const mesmoNome = await tx.uma(
      'SELECT id FROM administradora_cartao WHERE estabelecimento_id = ? AND nome = ? AND id <> ?',
      [est, e.nome, e.id ?? 0],
    );
    if (mesmoNome)
      throw recusa('administradora-cartao-repetida', 'Já existe uma administradora com este nome.', {
        campos: ['nome'],
      });
    const valores = {
      nome: e.nome,
      dias_para_pagamento: e.diasParaPagamento,
      conta_bancaria_id: e.contaBancaria,
      permite_parcelamento: e.permiteParcelamento,
      ativo: e.ativo,
    };
    if (e.id === null) {
      const novo = await tx.incluir('administradora_cartao', { estabelecimento_id: est, ...valores });
      return { administradora: novo, nome: e.nome };
    }
    const [atual] = await tx.consultarParaAtualizar(
      'SELECT id, versao FROM administradora_cartao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.id, est],
      { teto: 1 },
    );
    if (!atual)
      throw recusa('administradora-cartao-inexistente', 'A administradora não existe neste estabelecimento.');
    await tx.alterar('administradora_cartao', e.id, e.versao ?? numero(atual['versao']), valores);
    return { administradora: e.id, nome: e.nome };
  },
  alvo: (_e, r) => ({ tabela: 'administradora_cartao', id: numero(r['administradora']) || null }),
});

export const esquemaTaxaCartao = z
  .object({
    administradora: id,
    bandeira: id.nullable().default(null),
    modalidade: z.enum(MODALIDADES),
    parcelaInicial: z.number().int().min(1).max(99).default(1),
    parcelaFinal: z.number().int().min(1).max(99).default(1),
    tipo: z.enum(['percentual', 'valor']),
    percentual: z.number().min(0).max(100).nullable().default(null),
    valor: z.number().min(0).max(9_999_999).nullable().default(null),
    diasRepasse: z.number().int().min(0).max(9999).default(30),
    vigenciaInicio: DATA,
  })
  .strict();

const gravarTaxa = definirOperacao<z.infer<typeof esquemaTaxaCartao>, ResultadoOperacao>({
  nome: 'financeiro.gravar_taxa_administradora',
  tabelas: ['taxa_administradora'],
  entrada: esquemaTaxaCartao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const adm = await tx.uma(
      'SELECT id FROM administradora_cartao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.administradora, est],
    );
    if (!adm)
      throw recusa(
        'administradora-cartao-inexistente',
        'A administradora não existe neste estabelecimento.',
        {
          campos: ['administradora'],
        },
      );
    if (e.bandeira !== null) {
      const b = await tx.uma('SELECT id FROM bandeira_cartao WHERE id = ? AND ativo = TRUE', [e.bandeira]);
      if (!b)
        throw recusa('bandeira-cartao-inexistente', 'A bandeira do cartão não existe ou está inativa.', {
          campos: ['bandeira'],
        });
    }
    const linhas = await tx.consultarParaAtualizar(
      `SELECT ${COLUNAS_TAXA} FROM taxa_administradora
        WHERE estabelecimento_id = ? AND administradora_cartao_id = ? ORDER BY id`,
      [est, e.administradora],
      { teto: 2000 },
    );
    const nova = {
      ...e,
      percentual: e.tipo === 'percentual' ? e.percentual : null,
      valor: e.tipo === 'valor' ? e.valor : null,
    };
    const plano = recusar(planejarVigenciaTaxa(linhas.map(taxaDe), nova));
    const versoes = new Map(linhas.map((r) => [numero(r['id']), numero(r['versao'])]));
    for (const x of plano.encerrar)
      await tx.alterar('taxa_administradora', x.id, versoes.get(x.id) ?? 1, { vigencia_fim: x.vigenciaFim });
    const taxa = await tx.incluir('taxa_administradora', {
      estabelecimento_id: est,
      administradora_cartao_id: e.administradora,
      bandeira_cartao_id: e.bandeira,
      modalidade: e.modalidade,
      parcela_inicial: e.parcelaInicial,
      parcela_final: e.parcelaFinal,
      tipo_taxa: e.tipo === 'valor' ? 'valor_fixo' : 'percentual',
      percentual_taxa: nova.percentual,
      valor_taxa: nova.valor,
      dias_repasse: e.diasRepasse,
      vigencia_inicio: e.vigenciaInicio,
      ativo: true,
    });
    return { taxa, encerradas: plano.encerrar.length };
  },
  alvo: (_e, r) => ({ tabela: 'taxa_administradora', id: numero(r['taxa']) || null }),
});

export const esquemaEncerrarTaxaCartao = z.object({ taxa: id, vigenciaFim: DATA }).strict();

const encerrarTaxa = definirOperacao<z.infer<typeof esquemaEncerrarTaxaCartao>, ResultadoOperacao>({
  nome: 'financeiro.encerrar_taxa_administradora',
  tabelas: ['taxa_administradora'],
  entrada: esquemaEncerrarTaxaCartao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [t] = await tx.consultarParaAtualizar(
      `SELECT ${COLUNAS_TAXA} FROM taxa_administradora WHERE id = ? AND estabelecimento_id = ?`,
      [e.taxa, est],
      { teto: 1 },
    );
    if (!t) throw recusa('taxa-cartao-inexistente', 'A taxa não existe neste estabelecimento.');
    const atual = taxaDe(t);
    if (e.vigenciaFim < atual.vigenciaInicio)
      throw recusa('taxa-cartao-vigencia-invalida', 'O fim da vigência não pode ser antes do início.', {
        campos: ['vigenciaFim'],
      });
    if (atual.vigenciaFim !== null && atual.vigenciaFim < e.vigenciaFim)
      throw recusa(
        'taxa-cartao-ja-encerrada',
        'Esta taxa já foi encerrada antes desta data: cadastre uma nova vigência.',
        { campos: ['vigenciaFim'] },
      );
    await tx.alterar('taxa_administradora', e.taxa, numero(t['versao']), { vigencia_fim: e.vigenciaFim });
    return { taxa: e.taxa, vigenciaFim: e.vigenciaFim };
  },
  alvo: (e) => ({ tabela: 'taxa_administradora', id: e.taxa }),
});

export const esquemaRecebimentoCartao = z
  .object({
    administradora: id,
    bandeira: id,
    modalidade: z.enum(MODALIDADES),
    parcelas: z.number().int().min(1).max(99).default(1),
    valor: z.number().positive().max(9_999_999),
    dataVenda: DATA,
    nsu: z.string().trim().min(1).max(30),
    autorizacao: z.string().trim().min(1).max(20),
    finalCartao: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .default(null),
  })
  .strict();

const registrarRecebimento = definirOperacao<z.infer<typeof esquemaRecebimentoCartao>, ResultadoOperacao>({
  nome: 'financeiro.registrar_recebimento_cartao',
  tabelas: [...TABELAS_RECEBIVEL_CARTAO],
  entrada: esquemaRecebimentoCartao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    await exigirPeriodoAberto(tx, est, e.dataVenda, 'dataVenda');
    const { transacao, plano } = await gravarRecebivelCartao(tx, est, {
      ...e,
      instante: new Date(`${e.dataVenda}T12:00:00`),
      moduloOrigem: 'financeiro',
      operador: ctx.usuario,
    });
    return {
      transacao,
      parcelas: plano.parcelas.length,
      bruto: plano.bruto,
      taxa: plano.taxaTotal,
      liquido: plano.liquido,
      primeiroCredito: plano.parcelas[0]?.dataPrevista ?? null,
    };
  },
  alvo: (_e, r) => ({ tabela: 'transacao_cartao', id: numero(r['transacao']) || null }),
});

export const esquemaBaixarRecebiveisCartao = z
  .object({
    parcelas: z.array(id).min(1).max(500),
    conta: id,
    dataCredito: DATA,
    /** O que a administradora creditou; sem ele, vale o previsto (a soma dos líquidos). */
    valorCreditado: z.number().positive().max(9_999_999_999).nullable().default(null),
  })
  .strict();

const baixarRecebiveis = definirOperacao<z.infer<typeof esquemaBaixarRecebiveisCartao>, ResultadoOperacao>({
  nome: 'financeiro.baixar_recebiveis_cartao',
  tabelas: ['parcela_recebivel_cartao', 'transacao_cartao', 'movimento_bancario'],
  entrada: esquemaBaixarRecebiveisCartao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    await exigirPeriodoAberto(tx, est, e.dataCredito, 'dataCredito');
    if (new Set(e.parcelas).size !== e.parcelas.length)
      throw recusa('parcela-repetida', 'A mesma parcela foi escolhida duas vezes.', { campos: ['parcelas'] });
    const conta = await tx.uma(
      'SELECT id FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.conta, est],
    );
    if (!conta)
      throw recusa('conta-inexistente', 'A conta bancária não existe neste estabelecimento.', {
        campos: ['conta'],
      });
    const linhas = await tx.consultarParaAtualizar(
      `SELECT p.id, p.versao, p.situacao, p.valor_liquido, p.transacao_cartao_id, t.administradora_cartao_id, a.nome
         FROM parcela_recebivel_cartao p
         JOIN transacao_cartao t ON t.id = p.transacao_cartao_id
         JOIN administradora_cartao a ON a.id = t.administradora_cartao_id
        WHERE p.id IN (${ph(e.parcelas)}) AND t.estabelecimento_id = ? AND p.excluido_em IS NULL
        ORDER BY p.data_prevista, p.id`,
      [...e.parcelas, est],
      { teto: 500 },
    );
    if (linhas.length !== e.parcelas.length)
      throw recusa('recebivel-cartao-inexistente', 'Há parcela que não existe neste estabelecimento.', {
        campos: ['parcelas'],
      });
    if (linhas.some((p) => texto(p['situacao']) !== 'prevista'))
      throw recusa(
        'recebivel-cartao-ja-baixado',
        'Há parcela que já foi recebida ou cancelada: releia a lista.',
        { campos: ['parcelas'] },
      );
    if (new Set(linhas.map((p) => numero(p['administradora_cartao_id']))).size > 1)
      throw recusa(
        'recebivel-cartao-administradoras',
        'Um crédito é de uma administradora só: baixe as parcelas de cada administradora em separado.',
        { campos: ['parcelas'] },
      );
    const liquidos = linhas.map((p) => numero(p['valor_liquido']));
    const previsto = r2(liquidos.reduce((s, v) => s + v, 0));
    const creditado = e.valorCreditado ?? previsto;
    const { recebidos, diferenca } = recusar(repartirCreditoCartao(liquidos, creditado));
    const tipo = await tx.uma('SELECT id FROM tipo_lancamento_bancario WHERE codigo = ? AND ativo = TRUE', [
      LANCAMENTO_RECEBIMENTO,
    ]);
    if (!tipo)
      throw recusa('cadastro-ausente', 'Falta no cadastro o tipo de lançamento bancário do recebimento.');
    const nome = texto(linhas[0]?.['nome']);
    const movimento = await tx.incluir('movimento_bancario', {
      estabelecimento_id: est,
      conta_bancaria_id: e.conta,
      tipo_lancamento_bancario_id: tipo['id'],
      natureza: 'credito',
      tipo_origem: 'manual',
      data_movimento: e.dataCredito,
      historico: `Crédito de cartão da administradora ${nome} (${linhas.length} parcela(s))`.slice(0, 300),
      valor: creditado,
    });
    for (const [i, p] of linhas.entries())
      await tx.alterar('parcela_recebivel_cartao', numero(p['id']), numero(p['versao']), {
        situacao: 'recebida',
        recebida_em: e.dataCredito,
        valor_recebido: recebidos[i] ?? 0,
        movimento_bancario_id: movimento,
      });
    // A transação sem mais nada a receber fica conciliada.
    const transacoes = [...new Set(linhas.map((p) => numero(p['transacao_cartao_id'])))];
    const abertas = new Set(
      (
        await tx.consultar(
          `SELECT DISTINCT transacao_cartao_id AS t FROM parcela_recebivel_cartao
            WHERE transacao_cartao_id IN (${ph(transacoes)}) AND excluido_em IS NULL
              AND situacao IN ('prevista','contestada')`,
          [...transacoes],
        )
      ).map((r) => numero(r['t'])),
    );
    const fechar = transacoes.filter((t) => !abertas.has(t));
    if (fechar.length) {
      const ts = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM transacao_cartao WHERE id IN (${ph(fechar)}) ORDER BY id`,
        [...fechar],
        { teto: 500 },
      );
      for (const t of ts)
        await tx.alterar('transacao_cartao', numero(t['id']), numero(t['versao']), {
          situacao: 'conciliada',
        });
    }
    return {
      movimento,
      parcelas: linhas.length,
      previsto,
      creditado,
      diferenca,
      transacoesConciliadas: fechar.length,
    };
  },
  alvo: (_e, r) => ({ tabela: 'movimento_bancario', id: numero(r['movimento']) || null }),
});

export const OPERACOES_CARTAO = {
  'financeiro.gravarAdministradoraCartao': gravarAdministradora,
  'financeiro.gravarTaxaAdministradora': gravarTaxa,
  'financeiro.encerrarTaxaAdministradora': encerrarTaxa,
  'financeiro.registrarRecebimentoCartao': registrarRecebimento,
  'financeiro.baixarRecebiveisCartao': baixarRecebiveis,
} as const;

// ── Fluxo de caixa ──

interface ComFluxo {
  lancamentosFluxo(
    c: { cliente: string; estabelecimento: number | null; usuario: number | null; correlacao?: string },
    de: string,
    ate: string,
  ): Promise<LancamentoFluxoPorta[]>;
}

/**
 * A porta do financeiro com as parcelas previstas de cartão somadas aos lançamentos do fluxo de caixa: o que a
 * administradora ainda vai creditar aparece como entrada projetada na data prevista, já líquido da taxa.
 */
export function comCartaoNoFluxo<P extends ComFluxo>(porta: P, nucleo: NucleoProprio): P {
  const decorada = Object.create(porta) as P;
  decorada.lancamentosFluxo = async (c, de, ate) => {
    const base = await porta.lancamentosFluxo(c, de, ate);
    const est = c.estabelecimento;
    if (est === null) return base;
    const cartao = await nucleo.lerSomente(
      {
        cliente: c.cliente,
        estabelecimento: est,
        usuario: c.usuario,
        correlacao: (c.correlacao || 'financeiro').slice(0, 64),
      },
      (l) => lancamentosFluxoCartao(l, est, de, ate),
    );
    return [...base, ...cartao];
  };
  return decorada;
}
