// Onda 4: faturamento, auditoria de contas, financeiro e repasse (ficha do M42; cap-15 §15.3.3 e §15.4.1; cap-14
// §14.9.4). Vocabulário único do pacote da onda: os setores com a ordem recomendada (campo 12), as operações que cada
// um leva a `liberada` (campo 5), as chaves de liberação (POL-3), os grupos de usuários acompanhados (campo 4), as
// saídas externas que só existem em produção (regra 5), os envios SUS que continuam no outro sistema (regra 6), as
// respostas do faturamento e do fiscal que viram cenário de assinatura (regra 8), os cenários mínimos de assinatura
// (campo 9) casados com os do catálogo e o contrato do painel "Acompanhamento da competência" (campo 7).
// Nenhuma operação nova: as receitas são as das fichas M30 a M33 (docs/operacoes/catalogo). Os textos daqui
// podem aparecer na tela: nunca citam o outro sistema pelo nome (ADR 0023).
import { z } from 'zod';
import type { ItemCriterioLiberacao } from '../onda2/onda2.js';

// ── Setores e ordem da onda ──────────────────────────────────────────────────────────────────────────────────

/** Momento em que o setor entra, dentro da competência (ficha, campo 12). */
export const MOMENTOS_ONDA_4 = [
  'abertura-da-competencia',
  'fim-da-competencia',
  'com-os-demonstrativos',
  'em-paralelo',
  'primeira-apuracao',
  'conforme-dp-38',
] as const;
export type MomentoOnda4 = (typeof MOMENTOS_ONDA_4)[number];

export const ROTULO_MOMENTO_ONDA_4: Readonly<Record<MomentoOnda4, string>> = {
  'abertura-da-competencia': 'Na abertura da competência',
  'fim-da-competencia': 'No fim da competência',
  'com-os-demonstrativos': 'Com os demonstrativos da operadora',
  'em-paralelo': 'Em paralelo com o faturamento',
  'primeira-apuracao': 'Na primeira apuração da competência',
  'conforme-dp-38': 'Conforme a resposta do fiscal',
};

export interface SetorOnda4 {
  /** Setor da chave de liberação (`SGH_CFG_LIBERACAO`, escopo setor; campo 12). */
  readonly id: string;
  readonly nome: string;
  readonly ordem: number;
  readonly momento: MomentoOnda4;
  /** Marco que construiu as telas e as receitas do setor. */
  readonly marco: 'M13' | 'M30' | 'M31' | 'M32' | 'M33';
  /** Operações de gravação que a onda leva a `liberada` (nomes do catálogo de operações). */
  readonly operacoes: readonly string[];
  /** Funcionalidades (POL-3) que o setor liga junto. */
  readonly recursos: readonly string[];
  /** Perfis de acesso (nome) acompanhados em "quem ainda usa o outro sistema". */
  readonly grupos: readonly string[];
  /** Respostas do questionário que viram cenário antes da liberação da parte (regra 8). */
  readonly respostas: readonly string[];
}

/** Grupos do faturamento e do financeiro da ficha (campo 4, "Quem ainda fatura"). */
export const GRUPOS_ONDA_4 = [
  'FATURAMENTO',
  'FATURAMENTO_AUDITORIA',
  'FATURAMENTO_ASSISTENCIAL',
  'FINANCEIRO',
  'FINANCEIRO_CONTAS_A_RECEBER',
] as const;

export const SETORES_ONDA_4: readonly SetorOnda4[] = [
  {
    id: 'faturamento-convenio',
    nome: 'Faturamento por convênio',
    ordem: 1,
    momento: 'abertura-da-competencia',
    marco: 'M30',
    operacoes: [
      'faturamento.fecharConta',
      'faturamento.reabrirConta',
      'faturamento.conferirItem',
      'faturamento.lancarItem',
    ],
    recursos: [
      'faturamento.contas',
      'faturamento.lancamentoManual',
      'faturamento.lancamentoTardio',
      'faturamento.regras',
      'faturamento.particular',
      'faturamento.pagamentoEletronico',
    ],
    grupos: ['FATURAMENTO', 'FATURAMENTO_ASSISTENCIAL'],
    respostas: ['FAT-01', 'FAT-02', 'FAT-03', 'FAT-04', 'FAT-05', 'FAT-06', 'FAT-11', 'FAT-12', 'FAT-13'],
  },
  {
    id: 'auditoria-contas',
    nome: 'Auditoria de contas',
    ordem: 2,
    momento: 'abertura-da-competencia',
    marco: 'M30',
    operacoes: ['faturamento.conferirItem'],
    recursos: ['faturamento.auditoria'],
    grupos: ['FATURAMENTO_AUDITORIA'],
    respostas: [],
  },
  {
    id: 'tiss-lotes',
    nome: 'Lotes e protocolo TISS',
    ordem: 3,
    momento: 'fim-da-competencia',
    marco: 'M31',
    operacoes: ['faturamento.gerarLote', 'faturamento.registrarProtocolo', 'faturamento.fecharCompetencia'],
    recursos: ['faturamento.lote', 'faturamento.competencia', 'integracao.tiss'],
    grupos: ['FATURAMENTO'],
    respostas: ['FAT-07', 'FAT-14'],
  },
  {
    id: 'glosa-recurso',
    nome: 'Glosa e recurso',
    ordem: 4,
    momento: 'com-os-demonstrativos',
    marco: 'M31',
    operacoes: [
      'faturamento.registrarGlosa',
      'faturamento.registrarRecurso',
      'faturamento.registrarRetornoRecurso',
    ],
    recursos: ['faturamento.protocoloRecurso', 'faturamento.conciliacao'],
    grupos: ['FATURAMENTO'],
    respostas: ['FAT-08', 'FAT-09'],
  },
  {
    id: 'contas-a-pagar',
    nome: 'Contas a pagar',
    ordem: 5,
    momento: 'em-paralelo',
    marco: 'M32',
    operacoes: ['financeiro.criarTituloPagar', 'financeiro.baixarTitulo'],
    recursos: ['financeiro.contasPagar'],
    grupos: ['FINANCEIRO'],
    respostas: ['FIS-08'],
  },
  {
    id: 'contas-a-receber',
    nome: 'Contas a receber',
    ordem: 6,
    momento: 'em-paralelo',
    marco: 'M32',
    operacoes: ['financeiro.criarTituloReceber', 'financeiro.baixarTitulo'],
    recursos: ['financeiro.contasReceber'],
    grupos: ['FINANCEIRO_CONTAS_A_RECEBER'],
    respostas: ['FIS-09'],
  },
  {
    id: 'tesouraria',
    nome: 'Tesouraria',
    ordem: 7,
    momento: 'em-paralelo',
    marco: 'M32',
    operacoes: ['financeiro.lancarMovimento'],
    recursos: ['financeiro.tesouraria'],
    grupos: ['FINANCEIRO'],
    respostas: ['FIS-09'],
  },
  {
    id: 'repasse',
    nome: 'Repasse médico',
    ordem: 8,
    momento: 'primeira-apuracao',
    marco: 'M33',
    operacoes: ['repasse.lancarEvento', 'repasse.emitirRpa', 'repasse.integrarItens'],
    recursos: ['repasse'],
    grupos: ['FATURAMENTO', 'FINANCEIRO'],
    respostas: ['FAT-10', 'FIS-04'],
  },
  {
    id: 'fiscal',
    nome: 'Fiscal',
    ordem: 9,
    momento: 'conforme-dp-38',
    marco: 'M32',
    operacoes: [],
    recursos: ['financeiro.fiscal'],
    grupos: ['FINANCEIRO'],
    respostas: ['FIS-01', 'FIS-02', 'FIS-03', 'FIS-04', 'FIS-05'],
  },
  {
    id: 'catalogos-de-preco',
    nome: 'Carga dos catálogos de preço',
    ordem: 10,
    momento: 'em-paralelo',
    marco: 'M13',
    operacoes: [
      'catalogo.importarBrasindice',
      'catalogo.importarSimpro',
      'catalogo.importarTuss',
      'catalogo.importarCbhpm',
    ],
    recursos: [],
    grupos: ['FATURAMENTO'],
    respostas: ['FAT-03', 'FAT-04'],
  },
];

/** Todas as operações da onda, sem repetição, na ordem dos setores. */
export function operacoesDaOnda4(): string[] {
  return [...new Set(SETORES_ONDA_4.flatMap((s) => s.operacoes))];
}

/**
 * Rótulo de produto de cada operação da onda (o que a tela e a exportação mostram no lugar do nome técnico do catálogo).
 * Toda operação de `operacoesDaOnda4()` tem rótulo (teste do contrato).
 */
export const ROTULOS_OPERACAO_ONDA_4: Readonly<Record<string, string>> = {
  'faturamento.fecharConta': 'Fechamento de conta',
  'faturamento.reabrirConta': 'Reabertura de conta',
  'faturamento.conferirItem': 'Conferência de item da conta',
  'faturamento.lancarItem': 'Lançamento de item na conta',
  'faturamento.gerarLote': 'Geração de lote',
  'faturamento.registrarProtocolo': 'Registro de protocolo do lote',
  'faturamento.fecharCompetencia': 'Fechamento da competência do convênio',
  'faturamento.reabrirCompetencia': 'Reabertura da competência do convênio',
  'faturamento.registrarGlosa': 'Registro de glosa',
  'faturamento.registrarRecurso': 'Recurso de glosa',
  'faturamento.registrarRetornoRecurso': 'Desfecho do recurso de glosa',
  'financeiro.criarTituloPagar': 'Título a pagar',
  'financeiro.baixarTitulo': 'Baixa de título',
  'financeiro.criarTituloReceber': 'Título a receber',
  'financeiro.lancarMovimento': 'Lançamento no movimento bancário',
  'repasse.lancarEvento': 'Evento do repasse',
  'repasse.emitirRpa': 'Emissão de RPA',
  'repasse.integrarItens': 'Integração de itens ao repasse',
  'catalogo.importarBrasindice': 'Carga do Brasíndice',
  'catalogo.importarSimpro': 'Carga do Simpro',
  'catalogo.importarTuss': 'Carga da TUSS',
  'catalogo.importarCbhpm': 'Carga da CBHPM',
};

/** O rótulo de produto da operação da onda (a operação fora do mapa sai como "Outra gravação"). */
export function rotuloOperacaoOnda4(operacao: string): string {
  return ROTULOS_OPERACAO_ONDA_4[operacao] ?? 'Outra gravação';
}

/** Setores que usam a operação (uma operação pode servir a mais de um setor: `baixarTitulo`, `conferirItem`). */
export function setoresDaOperacaoOnda4(operacao: string): readonly SetorOnda4[] {
  return SETORES_ONDA_4.filter((s) => s.operacoes.includes(operacao));
}

// ── Regra 5: saídas externas só em produção e com autorização ──────────────────────────────────────────────

export const SAIDAS_EXTERNAS_ONDA_4 = [
  { id: 'webservice-tiss', nome: 'Webservices TISS das operadoras', marco: 'M31' },
  { id: 'remessa-bancaria', nome: 'Remessa bancária', marco: 'M32' },
  { id: 'nfse', nome: 'NFS-e', marco: 'M32' },
  { id: 'efd-reinf', nome: 'EFD-REINF', marco: 'M32' },
  { id: 'email-agendado', nome: 'Envio agendado de relatórios por e-mail', marco: 'M34' },
] as const;
export type SaidaExternaOnda4 = (typeof SAIDAS_EXTERNAS_ONDA_4)[number]['id'];

/**
 * A saída pode ser ligada? Só em produção e com a autorização registrada daquele destino (regra 5): em qualquer outro
 * ambiente fica no simulador, mesmo com autorização.
 */
export function saidaExternaPermitida(ambiente: string, autorizacao: string | null): boolean {
  return ambiente === 'producao' && typeof autorizacao === 'string' && autorizacao.trim() !== '';
}

// ── Regra 6: envios SUS continuam no outro sistema ──────────────────────────────────────────────────────────

/** Arquivos SUS que nenhuma operação do novo gera nesta onda (DP-35: sem SUS no CNES; M51 nasce desligado). */
export const ENVIOS_SUS_FORA_DA_ONDA = ['SISAIH01', 'BPA', 'APAC', 'CIHA'] as const;

/** Nenhuma operação da onda gera arquivo SUS: devolve as que o nome denuncia (deve ser vazio). */
export function operacoesSusNaOnda4(operacoes: readonly string[] = operacoesDaOnda4()): string[] {
  const sus = new Set(['sus', 'aih', 'bpa', 'apac', 'ciha', 'sisaih', 'sisaih01']);
  // Palavras do nome em camelCase (`gerarBpa` → gerar, bpa): `suspenderItem` não é SUS.
  const palavras = (acao: string) => acao.split(/(?=[A-Z])/).map((p) => p.toLowerCase());
  return operacoes.filter((o) => palavras(o.split('.')[1] ?? '').some((p) => sus.has(p)));
}

// ── Regra 8: respostas do faturamento e do fiscal ───────────────────────────────────────────────────────────

/** Parte afetada por resposta (regra 8): sem resposta vale o padrão de mercado (POL-1) e a parte não para. */
export const PARTES_POR_RESPOSTA: Readonly<Record<string, string>> = {
  'FAT-01': 'honorários',
  'FAT-02': 'múltiplos procedimentos',
  'FAT-03': 'mat/med por convênio',
  'FAT-04': 'CBHPM por contrato',
  'FAT-05': 'data-base do preço',
  'FAT-06': 'pacotes',
  'FAT-07': 'versão e canal TISS',
  'FAT-08': 'demonstrativo e baixa',
  'FAT-09': 'recurso de glosa',
  'FAT-10': 'repasse',
  'FAT-11': 'códigos da conta',
  'FAT-12': 'particular',
  'FAT-13': 'convênios Unimed',
  'FAT-14': 'TISS 04.03.00',
  'FIS-01': 'NFS-e (emissão)',
  'FIS-02': 'NFS-e (padrão nacional e ativação)',
  'FIS-03': 'IBS e CBS',
  'FIS-04': 'EFD-REINF',
  'FIS-05': 'DMED',
  'FIS-08': 'códigos do contas a pagar',
  'FIS-09': 'códigos do contas a receber e da tesouraria',
};

/** Situações do acompanhamento das respostas (respostas/*.md). */
export const SITUACOES_RESPOSTA = ['enviado', 'respondido', 'parcial', 'sem-resposta', 'aplicado'] as const;
export type SituacaoResposta = (typeof SITUACOES_RESPOSTA)[number];

/**
 * Como a parte entra na liberação: `padrao-de-mercado` (sem resposta: o parâmetro de mercado vale e a parte segue),
 * `cenario-pendente` (respondida e ainda não aplicada: falta o cenário de assinatura) ou `aplicada`.
 */
export function situacaoDaParte(s: SituacaoResposta): 'padrao-de-mercado' | 'cenario-pendente' | 'aplicada' {
  if (s === 'aplicado') return 'aplicada';
  if (s === 'respondido' || s === 'parcial') return 'cenario-pendente';
  return 'padrao-de-mercado';
}

// ── Campo 9: cenários mínimos de assinatura casados com o catálogo ─────────────────────────────────────────

export interface CenarioMinimoOnda4 {
  readonly operacao: string;
  /** Nome do cenário na ficha do M42. */
  readonly ficha: string;
  /** Cenário equivalente já no catálogo (`cenarios_assinatura`), ou nulo se falta criar. */
  readonly catalogo: string | null;
  /** Operação onde o cenário mora quando não é a da ficha (o desfecho do recurso é a do retorno). */
  readonly emOperacao?: string;
}

/**
 * Cenários mínimos do campo 9 da ficha e o equivalente no catálogo (D-CEN-42: com o M32 e o M33 mesclados, os do
 * financeiro e do repasse casados pelo que o cenário grava). Os nulos (5) entram como `cenario-controlado` do M36 na
 * homologação, antes da regressão da abertura da competência (DP-15).
 */
export const CENARIOS_MINIMOS_ONDA_4: readonly CenarioMinimoOnda4[] = [
  { operacao: 'faturamento.fecharConta', ficha: 'externa-convenio', catalogo: 'externa-emitida' },
  { operacao: 'faturamento.fecharConta', ficha: 'internacao-convenio', catalogo: 'internacao-emitida' },
  { operacao: 'faturamento.fecharConta', ficha: 'particular', catalogo: null },
  { operacao: 'faturamento.fecharConta', ficha: 'conta-com-irregularidade', catalogo: null },
  { operacao: 'faturamento.reabrirConta', ficha: 'fechada-sem-lote', catalogo: 'fechada-s' },
  { operacao: 'faturamento.reabrirConta', ficha: 'em-lote-protocolado', catalogo: 'em-lote' },
  { operacao: 'faturamento.gerarLote', ficha: 'lote-04.03.00', catalogo: 'sp-sadt' },
  { operacao: 'faturamento.gerarLote', ficha: 'lote-com-varias-guias', catalogo: 'varias-contas' },
  { operacao: 'faturamento.registrarGlosa', ficha: 'glosa-parcial', catalogo: 'pago-parcial-com-motivo' },
  { operacao: 'faturamento.registrarGlosa', ficha: 'glosa-total', catalogo: 'glosado-total' },
  { operacao: 'faturamento.registrarGlosa', ficha: 'baixa-sem-glosa', catalogo: 'pago-integral' },
  { operacao: 'faturamento.registrarRecurso', ficha: 'recurso-enviado', catalogo: 'recurso-padrao' },
  {
    operacao: 'faturamento.registrarRecurso',
    ficha: 'recurso-aceito',
    catalogo: 'acatado',
    emOperacao: 'faturamento.registrarRetornoRecurso',
  },
  {
    operacao: 'faturamento.registrarRecurso',
    ficha: 'recurso-indeferido',
    catalogo: 'negado',
    emOperacao: 'faturamento.registrarRetornoRecurso',
  },
  { operacao: 'financeiro.criarTituloPagar', ficha: 'origem-estoque', catalogo: null },
  { operacao: 'financeiro.criarTituloPagar', ficha: 'origem-repasse', catalogo: 'medico' },
  { operacao: 'financeiro.criarTituloPagar', ficha: 'manual', catalogo: 'fornecedor-parcela-unica' },
  { operacao: 'financeiro.baixarTitulo', ficha: 'baixa-total', catalogo: 'pagar-sem-bordero' },
  { operacao: 'financeiro.baixarTitulo', ficha: 'baixa-parcial', catalogo: null },
  { operacao: 'financeiro.baixarTitulo', ficha: 'titulo-ja-pago', catalogo: 'recusa-ja-baixado' },
  { operacao: 'repasse.emitirRpa', ficha: 'rpa-com-inss-irrf', catalogo: 'rpa-medico-pf' },
  { operacao: 'repasse.emitirRpa', ficha: 'cooperativa', catalogo: null },
];

// ── Campo 7: painel "Acompanhamento da competência" ───────────────────────────────────────────────────────
// A API devolve e a tela valida com o mesmo Zod. Só agregados: nenhum nome de paciente nem de pessoa.

/** Filtro do painel: competência AAAA-MM e, opcionalmente, um convênio (o escopo da sessão vale no servidor). */
export const esquemaFiltroAcompanhamento = z
  .object({
    competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competência no formato AAAA-MM'),
    convenio: z.coerce.number().int().positive().optional(),
  })
  .strict();
export type FiltroAcompanhamento = z.infer<typeof esquemaFiltroAcompanhamento>;

const n0 = z.number().int().min(0);
const valor = z.number();

/** Bloco do painel sem a leitura do setor (permissão) ou sem a leitura no banco: mostra o motivo em vez de zero. */
export const esquemaBlocoIndisponivel = z
  .object({ disponivel: z.literal(false), motivo: z.string() })
  .strict();
export type BlocoIndisponivel = z.infer<typeof esquemaBlocoIndisponivel>;

export const esquemaContasAcompanhamento = z
  .object({
    disponivel: z.literal(true),
    contas: n0,
    valor,
    porSituacao: z.array(z.object({ situacao: z.string(), rotulo: z.string(), contas: n0, valor }).strict()),
    fechadas: n0,
    fechadasPeloNovo: n0,
    fechadasPeloOutro: n0,
    parcelaDoNovo: z.number().min(0).max(1).nullable(),
    porConvenio: z.array(
      z
        .object({ convenio: n0, nome: z.string(), contas: n0, fechadas: n0, fechadasPeloNovo: n0, valor })
        .strict(),
    ),
  })
  .strict();
export type ContasAcompanhamento = z.infer<typeof esquemaContasAcompanhamento>;

export const esquemaLotesAcompanhamento = z
  .object({
    disponivel: z.literal(true),
    lotes: n0,
    comProtocolo: n0,
    semProtocolo: n0,
    contasEmLote: n0,
    conveniosFechados: n0,
    conveniosComConta: n0,
  })
  .strict();
export type LotesAcompanhamento = z.infer<typeof esquemaLotesAcompanhamento>;

export const esquemaGlosasAcompanhamento = z
  .object({
    disponivel: z.literal(true),
    emitido: valor,
    conciliado: valor,
    glosa: valor,
    contestado: valor,
    recuperado: valor,
    exitoRotulo: z.string(),
  })
  .strict();
export type GlosasAcompanhamento = z.infer<typeof esquemaGlosasAcompanhamento>;

export const esquemaTitulosAcompanhamento = z
  .object({
    disponivel: z.literal(true),
    aPagar: z.object({ titulos: n0, valor, pagos: n0, valorPago: valor }).strict().nullable(),
    aReceber: z.object({ titulos: n0, valor, recebidos: n0, valorRecebido: valor }).strict().nullable(),
    /** Movimento bancário do mês pelo tipo de transferência cru da origem; a legenda é "a confirmar" (regra 9). */
    movimento: z
      .array(z.object({ tipo: z.string(), rotulo: z.string(), lancamentos: n0, valor }).strict())
      .nullable(),
  })
  .strict();
export type TitulosAcompanhamento = z.infer<typeof esquemaTitulosAcompanhamento>;

export const esquemaRepasseAcompanhamento = z
  .object({
    disponivel: z.literal(true),
    itensIntegrados: n0,
    valorIntegrado: valor,
    eventos: n0,
    valorEventos: valor,
    rpas: n0,
  })
  .strict();
export type RepasseAcompanhamento = z.infer<typeof esquemaRepasseAcompanhamento>;

/** Gravações deste sistema por operação: `operacao` e `setor` são chaves; `rotulo` e `setorNome` são o que a tela mostra. */
export const esquemaGravacoesPorSistema = z
  .object({
    operacao: z.string(),
    rotulo: z.string(),
    setor: z.string(),
    setorNome: z.string(),
    peloNovo: n0,
  })
  .strict();
export type GravacoesPorSistema = z.infer<typeof esquemaGravacoesPorSistema>;

/** Quem ainda usa o outro sistema nos grupos da onda (só contagens por grupo; abaixo de 5 vira "<5" na tela). */
export const esquemaUsoPorGrupoOnda4 = z
  .object({ grupo: z.string(), usuarios: n0, conectadosDesde: n0 })
  .strict();

export const esquemaAcompanhamentoCompetencia = z
  .object({
    competencia: z.string(),
    convenio: z.number().int().nullable(),
    contas: esquemaContasAcompanhamento,
    lotes: esquemaLotesAcompanhamento,
    glosas: z.union([esquemaGlosasAcompanhamento, esquemaBlocoIndisponivel]),
    titulos: z.union([esquemaTitulosAcompanhamento, esquemaBlocoIndisponivel]),
    repasse: z.union([esquemaRepasseAcompanhamento, esquemaBlocoIndisponivel]),
    gravacoes: z.array(esquemaGravacoesPorSistema),
    uso: z.union([
      z
        .object({ disponivel: z.literal(true), desde: z.string(), grupos: z.array(esquemaUsoPorGrupoOnda4) })
        .strict(),
      esquemaBlocoIndisponivel,
    ]),
    geradoEm: z.string(),
    emCache: z.boolean(),
  })
  .strict();
export type AcompanhamentoCompetencia = z.infer<typeof esquemaAcompanhamentoCompetencia>;

// ── Campo 4: conferência da competência no outro sistema (relatório de diferenças, que deve ser vazio) ──────────
// O chave-usuário lê, nos relatórios do outro sistema, a mesma competência e digita aqui, por bloco: as contas por
// convênio (contas, fechadas e valor), os lotes e protocolos, as glosas e recursos, os títulos a pagar e a receber, o
// movimento bancário por tipo e o repasse. O novo compara com o que leu agora (diferencasDaCompetencia), bloco a bloco:
// só os blocos informados entram, e, dentro de um bloco informado, a chave que só existe de um lado (o convênio ou o
// tipo de movimento não informado, ou o informado que este sistema não tem) é diferença de presença. Nada é gravado
// (D-CONF-42).

export const esquemaLinhaConferenciaCompetencia = z
  .object({
    convenio: z.number().int().positive(),
    contas: z.number().int().min(0),
    fechadas: z.number().int().min(0),
    valor: z.number().min(0),
  })
  .strict();

const inteiro0 = z.number().int().min(0);
const reais0 = z.number().min(0);

/** Blocos da conferência além das contas por convênio (cada um opcional; o informado é comparado inteiro). */
export const esquemaBlocosConferenciaCompetencia = z
  .object({
    lotes: z.object({ lotes: inteiro0, protocolados: inteiro0 }).strict().optional(),
    glosas: z.object({ emitido: reais0, glosa: reais0, recuperado: reais0 }).strict().optional(),
    aPagar: z.object({ titulos: inteiro0, valor: reais0 }).strict().optional(),
    aReceber: z.object({ titulos: inteiro0, valor: reais0 }).strict().optional(),
    movimento: z
      .array(z.object({ tipo: z.string().max(5), lancamentos: inteiro0, valor: reais0 }).strict())
      .max(50)
      .refine((m) => new Set(m.map((x) => x.tipo)).size === m.length, 'Cada tipo de movimento só uma vez.')
      .optional(),
    repasse: z.object({ eventos: inteiro0, valorEventos: reais0, rpas: inteiro0 }).strict().optional(),
  })
  .strict();

export const esquemaPedidoConferenciaCompetencia = z
  .object({
    competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competência no formato AAAA-MM'),
    /**
     * As contas por convênio lidas no outro sistema. Informado (mesmo vazio), o bloco compara TODOS os convênios do
     * escopo com conta na competência: o que ficou de fora é diferença de presença.
     */
    linhas: z.array(esquemaLinhaConferenciaCompetencia).max(500).optional(),
    blocos: esquemaBlocosConferenciaCompetencia.optional(),
  })
  .strict()
  .refine(
    (p) => new Set((p.linhas ?? []).map((l) => l.convenio)).size === (p.linhas ?? []).length,
    'Cada convênio só uma vez.',
  )
  .refine(
    (p) => p.linhas !== undefined || Object.values(p.blocos ?? {}).some((b) => b !== undefined),
    'Informe ao menos um bloco para conferir.',
  );
export type PedidoConferenciaCompetencia = z.infer<typeof esquemaPedidoConferenciaCompetencia>;

export const esquemaConferenciaCompetencia = z
  .object({
    competencia: z.string(),
    comparados: n0,
    diferencas: z.array(
      z
        .object({
          chave: z.string(),
          campo: z.string(),
          novo: z.union([z.number(), z.string()]).nullable(),
          outro: z.union([z.number(), z.string()]).nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type ConferenciaCompetencia = z.infer<typeof esquemaConferenciaCompetencia>;

// ── Liberação por setor (aba "Onda 4" do painel de migração; regras 1 a 8 do M40 com as condições da onda) ──────

/** Setores da onda 4 que entram no catálogo de prontidão (os da carga de catálogo ficam no setor de cadastros). */
export const IDS_SETOR_ONDA_4 = [
  'faturamento-convenio',
  'auditoria-contas',
  'tiss-lotes',
  'glosa-recurso',
  'contas-a-pagar',
  'contas-a-receber',
  'tesouraria',
  'repasse',
  'fiscal',
] as const;
export type IdSetorOnda4 = (typeof IDS_SETOR_ONDA_4)[number];

/**
 * A carga dos catálogos de preço fica com o setor de cadastros (onda 1, que já tem `catalogo.*`): pela DP-36, o
 * importador do novo só assume a carga com contrato; sem ele, a carga continua no outro sistema (D-SET-42).
 */
export const SETOR_CATALOGOS_FORA_DA_PRONTIDAO = 'catalogos-de-preco';

/** Ordem recomendada (campo 12; um setor por passo). */
export const ORDEM_SETORES_ONDA_4: readonly (readonly string[])[] = SETORES_ONDA_4.filter((s) =>
  (IDS_SETOR_ONDA_4 as readonly string[]).includes(s.id),
)
  .sort((a, b) => a.ordem - b.ordem)
  .map((s) => [s.id]);

export const SETORES_ONDA_4_PRONTIDAO: readonly string[] = ORDEM_SETORES_ONDA_4.flat();

/**
 * Itens a mais do critério por setor da onda 4 (somados aos gerais do M40): a conferência no outro sistema do que o
 * novo gravou na cópia (campo 12, "Antes"), a reprodução da competência sem diferença nos setores da conta e do lote
 * (regra 3) e o início na abertura de uma competência nos setores que entram nela (regra 1).
 */
export const ITENS_CRITERIO_POR_SETOR_ONDA_4: Readonly<
  Record<IdSetorOnda4, readonly ItemCriterioLiberacao[]>
> = {
  'faturamento-convenio': ['abertura-da-competencia', 'reproducao-sem-diferenca', 'registros-conferidos'],
  'auditoria-contas': ['abertura-da-competencia', 'reproducao-sem-diferenca', 'registros-conferidos'],
  'tiss-lotes': ['reproducao-sem-diferenca', 'registros-conferidos'],
  'glosa-recurso': ['registros-conferidos'],
  'contas-a-pagar': ['registros-conferidos'],
  'contas-a-receber': ['registros-conferidos'],
  tesouraria: ['registros-conferidos'],
  repasse: ['registros-conferidos'],
  fiscal: ['registros-conferidos'],
};

/** Código da recusa do lote (ou da chave) de um setor da onda 4 com o critério incompleto (regra 1 do M40). */
export const CODIGO_CRITERIO_ONDA_4_INCOMPLETO = 'criterio-onda4-incompleto';

/** Código da recusa do registro do início fora da abertura de uma competência (regra 1 da onda 4). */
export const CODIGO_FORA_DA_ABERTURA = 'fora-da-abertura-da-competencia';

/**
 * Recursos da onda que só existem no novo (regra 6 do M40, roteiro de recolhimento): ao recolher, voltam ao processo
 * de hoje. O indeferimento do recurso de glosa fica nas tabelas próprias (o outro sistema não registra).
 */
export const RECURSOS_SO_NO_NOVO_ONDA_4: Readonly<Record<string, string>> = {
  'faturamento.regras': 'as regras de faturabilidade e o simulador de preço',
  'faturamento.pagamentoEletronico': 'o pagamento por Pix e cartão do particular',
  'faturamento.protocoloRecurso': 'o indeferimento e o desfecho do recurso de glosa',
  'faturamento.conciliacao': 'a conciliação item a item do demonstrativo',
};

const itemAvaliado4 = z
  .object({
    item: z.string(),
    rotulo: z.string(),
    ok: z.boolean(),
    origem: z.enum(['calculado', 'registrado']),
    situacao: z.enum(['cumprido', 'pendente', 'nao-se-aplica']),
    falta: z.string().nullable(),
    detalhe: z.string(),
  })
  .strict();

export const esquemaSetorMigracaoOnda4 = z
  .object({
    setor: z.string(),
    nome: z.string(),
    passo: z.number().int().min(1),
    momento: z.enum(MOMENTOS_ONDA_4),
    momentoRotulo: z.string(),
    podeLiberar: z.boolean(),
    itens: z.array(itemAvaliado4),
    registrados: z.array(
      z
        .object({
          item: z.string(),
          situacao: z.enum(['cumprido', 'pendente', 'nao-se-aplica']),
          evidencia: z.string(),
          em: z.string().nullable(),
          alteradoPor: z.string(),
          alteradoEm: z.string(),
        })
        .strict(),
    ),
    operacoes: z.array(z.object({ nome: z.string(), estado: z.string(), fora: z.boolean() }).strict()),
    antesFaltam: z.array(z.string()),
    /** Regra 1: o setor entra na abertura de uma competência. */
    exigeAbertura: z.boolean(),
    /** Regra 8: as respostas que viram cenário antes da parte, com a situação lida do acompanhamento. */
    respostas: z.array(
      z
        .object({
          pergunta: z.string(),
          parte: z.string(),
          situacao: z.string(),
          comoEntra: z.enum(['padrao-de-mercado', 'cenario-pendente', 'aplicada']),
        })
        .strict(),
    ),
    recursosSoNoNovo: z.array(z.object({ chave: z.string(), imprime: z.string() }).strict()),
    recolhimento: z.object({ chaves: z.array(z.string()), bloquear: z.array(z.string()) }).strict(),
  })
  .strict();
export type SetorMigracaoOnda4 = z.infer<typeof esquemaSetorMigracaoOnda4>;

export const esquemaPainelMigracaoOnda4 = z
  .object({
    estabelecimento: z.string(),
    primeiro: z.string(),
    seguramHospital: z.array(z.string()),
    ordem: z.array(z.array(z.string())),
    setores: z.array(esquemaSetorMigracaoOnda4),
    pentest: z.object({ bloqueia: z.boolean(), motivo: z.string() }).strict(),
    /** Regra 1: hoje, a abertura da competência corrente e a próxima (feriados do estabelecimento). */
    abertura: z
      .object({
        hoje: z.string(),
        competencia: z.string(),
        abertura: z.string(),
        proximaAbertura: z.string().nullable(),
        hojeEhAbertura: z.boolean(),
      })
      .strict(),
    /** Regra 4: dias sem versão (fechamento da competência) e se hoje é um deles. */
    semVersao: z
      .object({ dias: z.array(z.string()), hojeSemVersao: z.boolean(), motivo: z.string() })
      .strict(),
    /** Regra 5: saídas externas e se podem ligar neste ambiente. */
    saidasExternas: z.array(
      z.object({ id: z.string(), nome: z.string(), marco: z.string(), permitida: z.boolean() }).strict(),
    ),
    /** Regra 6: envios SUS que continuam com o outro sistema e as operações da onda que gerariam arquivo SUS. */
    sus: z.object({ fora: z.array(z.string()), operacoesSus: z.array(z.string()) }).strict(),
    /** Regra 9: códigos de baixa confiança, com os valores vistos e a legenda. */
    codigosAConfirmar: z.array(
      z
        .object({
          coluna: z.string(),
          dp: z.string(),
          pergunta: z.string(),
          citados: z.array(z.string()),
          vistos: z.array(z.string()),
        })
        .strict(),
    ),
    /** O setor de carga dos catálogos de preço (DP-36): fica com o setor de cadastros até o contrato. */
    catalogos: z.object({ operacoes: z.array(z.string()), motivo: z.string() }).strict(),
  })
  .strict();
export type PainelMigracaoOnda4 = z.infer<typeof esquemaPainelMigracaoOnda4>;
