// Desligamento do outro sistema, Firebird 5 e UTF-8, por hospital (ficha do M58; cap-10 §10.13; cap-09 §9.15;
// cap-07 §7.5 e §7.6; cap-08 §8.10; cap-15 §15.3.5; BRIEF §4.1 e §4.2). Contratos da fatia M58-F1 (inventário de
// desligamento) e o vocabulário que as fatias F2 a F5 reaproveitam: os passos e a ordem deles, o inventário dos
// executáveis, serviços, tarefas e painéis do fornecedor com o substituto de cada um no novo, as contas técnicas do
// banco e o destino de cada uma, as funções externas que o Firebird 4 em diante desliga por padrão, o parâmetro do
// charset efetivo (`legado.charset`) e a chave da entrada sem restrição (`entrada.utf8`).
//
// Desligar o outro sistema NÃO desliga o banco nem os gatilhos (regra 1): conta, guia, saldo, retratos, filas e
// bancos externos continuam. O novo nunca apaga gatilho, procedure ou generator e não muda o modelo de dados; a
// execução em produção é da TI do hospital, com autorização do dono (a IA nunca conecta à produção).
//
// Os ids e os fatos técnicos ficam aqui; os textos da tela ficam no i18n da web (sem citar o outro sistema pelo nome,
// ADR 0023). Os números medidos são da cópia pc (READ ONLY, 24/10/2026; docs/marcos/M58/preparo-e1.md §2).
import { z } from 'zod';
import { RE_TEXTO_SEM_DADO_PESSOAL } from '../homologacao/homologacao.js';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Passos e fatias ─────────────────────────────────────────────────────────────────────────────────────

/** As fatias do marco por hospital (ficha, seção 2; regra 3 da Fase 6). A F4 é condicional (fachada). */
export const FATIAS_DESLIGAMENTO = ['M58-F1', 'M58-F2', 'M58-F3', 'M58-F4', 'M58-F5'] as const;
export type FatiaDesligamento = (typeof FATIAS_DESLIGAMENTO)[number];

/**
 * Os três passos autorizados um a um pelo dono em `ESTADO.md` › Autorizações (ficha, seção 12), nesta ordem: desligar
 * o outro sistema; trocar o motor para o Firebird 5 (backup e restauração ensaiados); converter o texto para UTF-8
 * (ensaiado na cópia já em Firebird 5). Nenhum passo pula o anterior.
 */
export const PASSOS_DESLIGAMENTO = ['desligamento', 'firebird5', 'utf8'] as const;
export type PassoDesligamento = (typeof PASSOS_DESLIGAMENTO)[number];

/** A fatia que ensaia cada passo e a que executa a janela. */
export const FATIA_DO_PASSO: Readonly<Record<PassoDesligamento, FatiaDesligamento>> = {
  desligamento: 'M58-F1',
  firebird5: 'M58-F2',
  utf8: 'M58-F3',
};

/** Situação de um passo no hospital (o painel mostra; só a janela da TI muda para `executado`). */
export const SITUACOES_PASSO = ['bloqueado', 'pronto-para-autorizar', 'autorizado', 'executado'] as const;
export type SituacaoPasso = (typeof SITUACOES_PASSO)[number];

/** Por que um passo está bloqueado (códigos estáveis; o texto fica no i18n). */
export const MOTIVOS_BLOQUEIO_PASSO = [
  'passo-anterior-pendente',
  'dp6-sem-data',
  'fim-da-coexistencia-nao-registrado',
  'sessoes-na-janela',
  'inventario-pendente',
  'contingencia-nao-definida',
  'ensaio-nao-aprovado',
  'funcoes-externas-pendentes',
  'parceiros-nao-avisados',
  'sante-api-sem-contrato',
  'autorizacao-ausente',
] as const;
export type MotivoBloqueioPasso = (typeof MOTIVOS_BLOQUEIO_PASSO)[number];

// ── Critério de "nenhuma sessão de pessoa" (regra 3) ───────────────────────────────────────────────────

/** Duas semanas sem sessão de pessoa no outro sistema (cap-15 §15.3.5; padrão aprovado da DP-5). */
export const JANELA_SEM_SESSAO_DIAS = 14;
/** O cap-14 §14.9.4 propõe 30 dias; o painel mostra os dois (regra 2 do M43), o de 14 decide. */
export const JANELA_SEM_SESSAO_DIAS_CAP14 = 30;

/**
 * Logins do grupo de painéis e totens do outro sistema: não são pessoa, mas só saem da conta quando a TV ou o totem
 * passou ao token de dispositivo (regra 4 do M43). O grupo é excluído da contagem pelo nome do grupo, nunca por login.
 */
export const GRUPOS_NAO_PESSOA = ['PAINEIS'] as const;

// ── Inventário de desligamento (regra 2) ─────────────────────────────────────────────────────────────────

export const TIPOS_RECURSO_FORNECEDOR = [
  'aplicacao-estacao',
  'servico',
  'tarefa-agendada',
  'painel',
] as const;
export type TipoRecursoFornecedor = (typeof TIPOS_RECURSO_FORNECEDOR)[number];

/**
 * Como o item sai (regra 2): o substituto está em uso, ou a área aceitou perdê-lo; `pendente` enquanto nenhum dos
 * dois foi registrado pelo responsável da área.
 */
export const SITUACOES_ITEM_DESLIGAMENTO = ['pendente', 'substituto-em-uso', 'aceito-como-perdido'] as const;
export type SituacaoItemDesligamento = (typeof SITUACOES_ITEM_DESLIGAMENTO)[number];

/** A contingência que a DP-6 define para o item depois do desligamento (ficha, seção 12, "Recolher"). */
export const CONTINGENCIAS_DESLIGAMENTO = [
  /** Desinstalado; o modelo de dados não mudou, então pode ser reinstalado no período de contingência. */
  'reinstalavel-no-periodo',
  /** Só consulta por um período (leitura, sem gravação), se a DP-6 decidir. */
  'somente-consulta-no-periodo',
  /** Nenhuma volta: o item é perdido (aceito pela área). */
  'nenhuma',
] as const;
export type ContingenciaDesligamento = (typeof CONTINGENCIAS_DESLIGAMENTO)[number];

export interface SubstitutoNoNovo {
  /** Marco que constrói o substituto. */
  readonly marco: string;
  /** Item da árvore do menu do novo (`ARVORE_MENU`); null quando o substituto é o sistema inteiro. */
  readonly itemMenu: string | null;
  /** A equivalência ainda tem de ser confirmada com a TI do hospital (DP-16) antes da checklist. */
  readonly aConfirmar: boolean;
}

export interface ItemInventarioDesligamento {
  readonly id: string;
  readonly tipo: TipoRecursoFornecedor;
  /** Área dona do aceite (papel; nunca nome de pessoa). */
  readonly areaResponsavel: string;
  /** Contas técnicas do banco que o item usa (nomes de usuário Firebird do fornecedor; nenhuma é de pessoa). */
  readonly contas: readonly string[];
  /** Tabelas do outro sistema que caracterizam o item (só para contagem e para o mapa do preparo). */
  readonly tabelas: readonly string[];
  /** O substituto no novo; null quando não há (a área tem de aceitar perder). */
  readonly substituto: SubstitutoNoNovo | null;
  /** Fonte no planejamento. */
  readonly fonte: string;
}

/**
 * Executáveis, serviços, tarefas e painéis do fornecedor (cap-07 §7.5 e §7.6; cap-08 §8.10; ficha, regra 2). Os 4
 * primeiros são os que a ficha nomeia; os serviços seguintes são os das contas técnicas com escrita (cap-08 §8.10), que
 * param junto com o fornecedor. A lista é revista com a TI na checklist da M58-F1 (DP-16).
 */
export const INVENTARIO_DESLIGAMENTO: readonly ItemInventarioDesligamento[] = [
  {
    id: 'aplicacao-estacoes',
    tipo: 'aplicacao-estacao',
    areaResponsavel: 'coordenação da coexistência',
    contas: [],
    tabelas: ['TBSGHCONEXAO'],
    substituto: { marco: 'M43', itemMenu: null, aConfirmar: false },
    fonte: 'cap-10 §10.13; cap-15 §15.3.5; ficha do M58, regras 2 e 3',
  },
  {
    id: 'portal-resultados',
    tipo: 'servico',
    areaResponsavel: 'SADT',
    contas: ['RESULTADOWEB'],
    tabelas: ['SILIBERACAOEXAME', 'SIWEBCADPERFIL', 'SIMODULO_SIWEBATOS', 'SIWEBPARLAUDO', 'SICADATE'],
    substituto: {
      marco: 'M50',
      itemMenu: 'portais.portal-de-resultados-paciente-e-medico-externo',
      aConfirmar: false,
    },
    fonte: 'cap-07 §7.6; ficha do M58, regra 2',
  },
  {
    id: 'paineis-tv',
    tipo: 'painel',
    areaResponsavel: 'TI do hospital',
    contas: [],
    tabelas: ['PNCONFIGPORTAL'],
    substituto: {
      marco: 'M19',
      itemMenu: 'relatorios-e-bi.paineis-de-tv-e-central-de-comando',
      aConfirmar: false,
    },
    fonte: 'cap-07 §7.5.2; cap-08 §8.3; ficha do M58, regra 2; regra 4 do M43',
  },
  {
    id: 'envio-agendado-relatorios',
    tipo: 'tarefa-agendada',
    areaResponsavel: 'curador do catálogo de relatórios',
    contas: [],
    tabelas: ['TBEDITREL_AGENDA', 'TBEDITREL_AGENDA_LOG'],
    substituto: { marco: 'M34', itemMenu: 'relatorios-e-bi.envio-agendado-por-e-mail', aConfirmar: false },
    fonte: 'cap-07 §7.5 (o envio de origem não entrega desde 2020); ficha do M58, regra 2',
  },
  {
    id: 'editor-relatorios',
    tipo: 'aplicacao-estacao',
    areaResponsavel: 'curador do catálogo de relatórios',
    contas: [],
    tabelas: ['TBEDITREL'],
    substituto: {
      marco: 'M34',
      itemMenu: 'relatorios-e-bi.catalogo-de-relatorios-parametrizados',
      aConfirmar: false,
    },
    fonte: 'cap-07 §7.5.1 (triagem dos 252 relatórios)',
  },
  {
    id: 'servico-autorizador',
    tipo: 'servico',
    areaResponsavel: 'faturamento',
    contas: ['AUTORIZADOR'],
    tabelas: [],
    substituto: {
      marco: 'M31',
      itemMenu: 'recepcao.atendimento.elegibilidade-e-autorizacao-previa-tiss',
      aConfirmar: true,
    },
    fonte: 'cap-08 §8.10',
  },
  {
    id: 'servico-tiss',
    tipo: 'servico',
    areaResponsavel: 'faturamento',
    contas: ['TISSWS'],
    tabelas: [],
    substituto: {
      marco: 'M31',
      itemMenu: 'faturamento.convenios-tiss.webservices-tiss-por-operadora',
      aConfirmar: false,
    },
    fonte: 'cap-08 §8.10; cap-12',
  },
  {
    id: 'servico-portal',
    tipo: 'servico',
    areaResponsavel: 'TI do hospital',
    contas: ['PORTALSERV'],
    tabelas: [],
    substituto: { marco: 'M50', itemMenu: null, aConfirmar: true },
    fonte: 'cap-08 §8.10',
  },
  {
    id: 'servico-sac-movel',
    tipo: 'servico',
    areaResponsavel: 'TI do hospital',
    contas: ['SACMOBILE'],
    tabelas: [],
    substituto: null,
    fonte: 'cap-08 §8.10 (sem substituto nomeado no planejamento: aceite da área ou decisão na checklist)',
  },
  {
    id: 'servico-importador-pep',
    tipo: 'servico',
    areaResponsavel: 'TI do hospital',
    contas: ['IMPORTARDORPEP'],
    tabelas: [],
    substituto: { marco: 'M34', itemMenu: null, aConfirmar: true },
    fonte: 'cap-08 §8.10',
  },
  {
    id: 'servico-integracao-apoio',
    tipo: 'servico',
    areaResponsavel: 'SADT',
    contas: ['INTEGRACAOAOL'],
    tabelas: [],
    substituto: { marco: 'M26', itemMenu: null, aConfirmar: true },
    fonte: 'cap-08 §8.10',
  },
  {
    id: 'servico-integracao-resultados',
    tipo: 'servico',
    areaResponsavel: 'SADT',
    contas: ['INTEGRARESULTADOS'],
    tabelas: [],
    substituto: { marco: 'M26', itemMenu: null, aConfirmar: true },
    fonte: 'cap-08 §8.10',
  },
];

export const IDS_ITEM_DESLIGAMENTO = INVENTARIO_DESLIGAMENTO.map((i) => i.id) as readonly string[];

// ── Contas técnicas do banco (cap-08 §8.10; cap-12, Atenção; DP-16) ────────────────────────────────────────

export const DESTINOS_CONTA_TECNICA = [
  /** Serviço do fornecedor: a conta para junto com ele (a TI revoga na janela, depois do aceite do item). */
  'para-com-o-fornecedor',
  /** Continua (backup; a sante-api da Hal-AI): o privilégio é reduzido depois, no M59. */
  'continua',
  /** Leitura por planilha: a TI desliga quando o relatório equivalente estiver no catálogo e a área concordar. */
  'desligar-quando-a-area-concordar',
  /** Parceiro que lê o banco: continua, entra no ensaio da F2/F3 e é avisado antes da janela (regra 10; DP-16). */
  'parceiro-no-ensaio',
] as const;
export type DestinoContaTecnica = (typeof DESTINOS_CONTA_TECNICA)[number];

export interface ContaTecnicaDeclarada {
  /** Usuário Firebird (nome técnico do fornecedor ou do parceiro; nenhuma conta de pessoa). */
  readonly conta: string;
  /** Prefixo: a conta é uma família (`RELATORIO_*`, 4 na cópia pc). */
  readonly prefixo?: true;
  readonly destino: DestinoContaTecnica;
  /** O item do inventário que a conta serve, quando há. */
  readonly item?: string;
}

export const CONTAS_TECNICAS_DECLARADAS: readonly ContaTecnicaDeclarada[] = [
  { conta: 'AUTORIZADOR', destino: 'para-com-o-fornecedor', item: 'servico-autorizador' },
  { conta: 'PORTALSERV', destino: 'para-com-o-fornecedor', item: 'servico-portal' },
  { conta: 'RESULTADOWEB', destino: 'para-com-o-fornecedor', item: 'portal-resultados' },
  { conta: 'TISSWS', destino: 'para-com-o-fornecedor', item: 'servico-tiss' },
  { conta: 'SACMOBILE', destino: 'para-com-o-fornecedor', item: 'servico-sac-movel' },
  { conta: 'IMPORTARDORPEP', destino: 'para-com-o-fornecedor', item: 'servico-importador-pep' },
  { conta: 'INTEGRACAOAOL', destino: 'para-com-o-fornecedor', item: 'servico-integracao-apoio' },
  { conta: 'INTEGRARESULTADOS', destino: 'para-com-o-fornecedor', item: 'servico-integracao-resultados' },
  { conta: 'SGHBACKUP', destino: 'continua' },
  { conta: 'HAL_AI', destino: 'continua' },
  { conta: 'EPIMED', destino: 'parceiro-no-ensaio' },
  { conta: 'ZGLOSA', destino: 'parceiro-no-ensaio' },
  { conta: 'CONSULT', destino: 'desligar-quando-a-area-concordar' },
  { conta: 'CONSULT_DIRETORES', destino: 'desligar-quando-a-area-concordar' },
  { conta: 'CONSULT_GERENTE', destino: 'desligar-quando-a-area-concordar' },
  { conta: 'EXCEL', destino: 'desligar-quando-a-area-concordar' },
  { conta: 'EXCEL_ADM', destino: 'desligar-quando-a-area-concordar' },
  { conta: 'EXCEL_FIN', destino: 'desligar-quando-a-area-concordar' },
  { conta: 'RELATORIO_', prefixo: true, destino: 'desligar-quando-a-area-concordar' },
  { conta: 'TOLIFE', destino: 'parceiro-no-ensaio' },
  { conta: 'UNIMEDPR', destino: 'parceiro-no-ensaio' },
  { conta: 'INTEGRAUNIMED', destino: 'parceiro-no-ensaio' },
  { conta: 'BHSOFT', destino: 'parceiro-no-ensaio' },
  { conta: 'CM_TECNOLOGIA', destino: 'parceiro-no-ensaio' },
  { conta: 'MEDIA_PLUS', destino: 'parceiro-no-ensaio' },
  { conta: 'BIOSLAB', destino: 'parceiro-no-ensaio' },
  { conta: 'PORTAL_PLANO', destino: 'parceiro-no-ensaio' },
  { conta: 'FIRST', destino: 'parceiro-no-ensaio' },
];

/** Prefixos das visões que parceiros leem direto (regra 10; cap-12, Atenção). */
export const PREFIXOS_VISOES_PARCEIROS = ['V_EPIMED_', 'V_FIRST_', 'V_MEDIA_PLUS_', 'VW_ZG_'] as const;

// ── Funções externas (regra 5; cap-10 §10.13; RDB$FUNCTIONS da cópia) ──────────────────────────────────────

export interface FuncaoExternaEsperada {
  readonly nome: string;
  readonly modulo: string;
  readonly entrada: string;
}

/** As 5 funções externas da cópia pc (as demais 13 de RDB$FUNCTIONS são PSQL, sem biblioteca). */
export const FUNCOES_EXTERNAS_ESPERADAS: readonly FuncaoExternaEsperada[] = [
  { nome: 'LTRIM', modulo: 'ib_udf', entrada: 'IB_UDF_ltrim' },
  { nome: 'RTRIM', modulo: 'ib_udf', entrada: 'IB_UDF_rtrim' },
  { nome: 'STRLEN', modulo: 'ib_udf', entrada: 'IB_UDF_strlen' },
  { nome: 'SUBSTR', modulo: 'ib_udf', entrada: 'IB_UDF_substr' },
  { nome: 'VLR_MED', modulo: 'vlr_med', entrada: 'vlrmed' },
];

/** Como cada função externa é resolvida antes da troca (a escolha vai ao ADR depois do ensaio da F2). */
export const RESOLUCOES_FUNCAO_EXTERNA = ['pendente', 'habilitada-por-configuracao', 'substituida'] as const;
export type ResolucaoFuncaoExterna = (typeof RESOLUCOES_FUNCAO_EXTERNA)[number];

/** A partir desta versão maior, o motor desliga as funções externas por padrão (`UdfAccess = None`). */
export const VERSAO_MAIOR_SEM_UDF = 4;

// ── Charset efetivo e entrada sem restrição (regras 6 e 7; seção 6 e 12) ───────────────────────────────

export const CHARSETS_LEGADO = ['CP1252', 'UTF8'] as const;
export type CharsetLegado = (typeof CHARSETS_LEGADO)[number];

/** Chave do parâmetro (SGH_CFG_PARAMETRO, por estabelecimento) lido pelo codec do adaptador na partida. */
export const PARAMETRO_CHARSET_LEGADO = 'legado.charset';
/** M59 (regra 1): o período de contingência do estabelecimento (SGH_CFG_PARAMETRO; padrão ligado). */
export const PARAMETRO_CONTINGENCIA_LEGADO = 'legado.contingencia';
/** Chave de recurso (SGH_CFG_LIBERACAO) que tira a restrição CP1252 da entrada, só depois do UTF-8. */
export const CHAVE_ENTRADA_UTF8 = 'entrada.utf8';

// ── API: registro da checklist e painel ──────────────────────────────────────────────────────────────────

/**
 * A mesma trava do registro versionado dos passos (RE_TEXTO_SEM_DADO_PESSOAL): recusa sequência de 4 dígitos ou mais
 * (CPF, prontuário, telefone, documento), CPF ou CNPJ pontuado e e-mail. A referência de chamado ou ata vai sem o número longo (D-TEXTO-58).
 */
/** CPF ou CNPJ com pontuação (123.456.789-09, 12.345.678/0001-90), que a trava de 4 dígitos seguidos não pega. */
const RE_DOCUMENTO_FORMATADO = /\d{2,3}[.\s-]\d{3}[.\s-]\d{3}/;
const semDadoPessoal = (t: string) => RE_TEXTO_SEM_DADO_PESSOAL.test(t) && !RE_DOCUMENTO_FORMATADO.test(t);
export const MSG_EVIDENCIA_SEM_DADO_PESSOAL =
  'Informe a referência (ata, chamado, protocolo) sem número de documento, prontuário ou e-mail.';
export const MSG_PAPEL_SEM_DADO_PESSOAL =
  'Informe o papel (cargo ou área), sem número de documento nem e-mail.';

/** Registro do aceite de um item pelo responsável da área (checklist da M58-F1). */
export const esquemaRegistrarItemDesligamento = z
  .object({
    item: z.string().refine((x) => IDS_ITEM_DESLIGAMENTO.includes(x), 'Item fora do inventário.'),
    situacao: z.enum(SITUACOES_ITEM_DESLIGAMENTO),
    contingencia: z.enum(CONTINGENCIAS_DESLIGAMENTO),
    /** Papel de quem aceitou (nunca o nome da pessoa: o login vai à trilha). */
    papelResponsavel: textoCp1252(60)
      .refine((t) => t.trim().length >= 2, { message: 'Informe o papel.' })
      .refine(semDadoPessoal, { message: MSG_PAPEL_SEM_DADO_PESSOAL }),
    /** Referência da evidência (ata, chamado, protocolo); nunca segredo nem dado de paciente. */
    evidencia: textoCp1252(200)
      .refine((t) => t.trim().length >= 3, { message: 'Informe a evidência.' })
      .refine(semDadoPessoal, { message: MSG_EVIDENCIA_SEM_DADO_PESSOAL }),
  })
  .refine((x) => x.situacao !== 'pendente', {
    message: 'Registre se o substituto está em uso ou se a área aceitou perder o item.',
    path: ['situacao'],
  });
export type RegistrarItemDesligamento = z.infer<typeof esquemaRegistrarItemDesligamento>;

/**
 * A DIFERENCA da SGH_TRILHA do registro de um item (a história do UPDATE): os códigos de antes e depois da situação e
 * da contingência e só os NOMES dos campos de texto livre alterados (papel e evidência ficam fora da trilha). Sem
 * linha anterior, o antes é "-". Ex.: `situacao=aceito-como-perdido>substituto-em-uso;contingencia=reinstalavel-no-periodo>nenhuma;alterados=papel,evidencia`.
 */
export function diferencaItemDesligamento(
  anterior: { situacao: string; contingencia: string; papelResponsavel: string; evidencia: string } | null,
  novo: { situacao: string; contingencia: string; papelResponsavel: string; evidencia: string },
): string {
  const a = anterior ?? { situacao: '-', contingencia: '-', papelResponsavel: '', evidencia: '' };
  const alterados = [
    ...(a.papelResponsavel !== novo.papelResponsavel ? ['papel'] : []),
    ...(a.evidencia !== novo.evidencia ? ['evidencia'] : []),
  ];
  return [
    `situacao=${a.situacao}>${novo.situacao}`,
    `contingencia=${a.contingencia}>${novo.contingencia}`,
    `alterados=${alterados.length ? alterados.join(',') : 'nenhum'}`,
  ]
    .join(';')
    .slice(0, 1000);
}

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const esquemaSessoesOutroSistema = z.object({
  janelaDias: z.number().int().positive(),
  /** Pessoas (logins distintos, fora das contas técnicas, de contingência e dos grupos não pessoa) por dia. */
  porDia: z.array(z.object({ dia, pessoas: z.number().int().nonnegative() })),
  /** Pessoas com última conexão dentro da janela (agregado; a lista por pessoa é do M43, só para o comitê). */
  pessoasNaJanela: z.number().int().nonnegative(),
  /** Dias desde a última sessão de pessoa; null quando não há nenhuma no período lido. */
  diasSemSessao: z.number().int().nonnegative().nullable(),
  cumprido: z.boolean(),
  /** A janela do cap-14 (30 dias), mostrada ao lado. */
  cumpridoCap14: z.boolean(),
});
export type SessoesOutroSistema = z.infer<typeof esquemaSessoesOutroSistema>;

export const esquemaItemDesligamentoAvaliado = z.object({
  item: z.string(),
  tipo: z.enum(TIPOS_RECURSO_FORNECEDOR),
  areaResponsavel: z.string(),
  situacao: z.enum(SITUACOES_ITEM_DESLIGAMENTO),
  contingencia: z.enum(CONTINGENCIAS_DESLIGAMENTO).nullable(),
  substituto: z
    .object({ marco: z.string(), itemMenu: z.string().nullable(), aConfirmar: z.boolean() })
    .nullable(),
  /** O item conta como resolvido para o passo `desligamento`. */
  resolvido: z.boolean(),
  /** Códigos do que falta (texto no i18n). */
  pendencias: z.array(
    z.enum(['sem-registro', 'sem-substituto-e-sem-aceite', 'substituto-a-confirmar', 'sem-contingencia']),
  ),
  registradoEm: z.iso.datetime().nullable(),
  /** O papel de quem registrou o aceite e a referência da evidência (nunca nome de pessoa; o login vai à trilha). */
  papelResponsavel: z.string().nullable().default(null),
  evidencia: z.string().nullable().default(null),
});
export type ItemDesligamentoAvaliado = z.infer<typeof esquemaItemDesligamentoAvaliado>;

export const esquemaContaTecnicaAvaliada = z.object({
  conta: z.string(),
  destino: z.enum(DESTINOS_CONTA_TECNICA),
  /** A conta existe com privilégio no banco do hospital. */
  presente: z.boolean(),
  /** Tem privilégio de escrita (INSERT, UPDATE ou DELETE) em alguma tabela. */
  escrita: z.boolean(),
});

export const esquemaPlataformaBanco = z.object({
  versaoMotor: z.string(),
  versaoMaior: z.number().int(),
  ods: z.string(),
  charsetBanco: z.string(),
  /** O parâmetro `legado.charset` do estabelecimento. */
  charsetParametro: z.enum(CHARSETS_LEGADO),
  /** O parâmetro casa com o catálogo do banco (regra 6; a partida do adaptador recusa o desencontro). */
  charsetConfere: z.boolean(),
  funcoesExternas: z.array(
    z.object({
      nome: z.string(),
      modulo: z.string(),
      dependentes: z.number().int().nonnegative(),
      esperada: z.boolean(),
    }),
  ),
  /** A impressão digital homologada (resumo), da tela de verificação de schema. */
  impressao: z.string().nullable(),
});
export type PlataformaBanco = z.infer<typeof esquemaPlataformaBanco>;

export const esquemaPassoAvaliado = z.object({
  passo: z.enum(PASSOS_DESLIGAMENTO),
  fatia: z.enum(FATIAS_DESLIGAMENTO),
  situacao: z.enum(SITUACOES_PASSO),
  motivos: z.array(z.enum(MOTIVOS_BLOQUEIO_PASSO)),
});
export type PassoAvaliado = z.infer<typeof esquemaPassoAvaliado>;

/** Resposta de GET administracao/coexistencia/desligamento (painel "Prontidão do desligamento por hospital"). */
export const esquemaPainelDesligamento = z.object({
  hospital: z.string(),
  em: z.iso.datetime(),
  sessoes: esquemaSessoesOutroSistema,
  itens: z.array(esquemaItemDesligamentoAvaliado),
  contas: z.object({
    declaradas: z.array(esquemaContaTecnicaAvaliada),
    /** Contas com privilégio no banco que não estão na lista declarada (só o número; a TI revê na DP-16). */
    naoDeclaradas: z.number().int().nonnegative(),
  }),
  plataforma: esquemaPlataformaBanco,
  passos: z.array(esquemaPassoAvaliado),
  /**
   * A medida diária do M43 (retratos de 15 em 15 minutos e a série das conexões ao banco), que fecha a regra 3 junto
   * com a tabela de conexões: a tabela guarda só a última conexão e, numa cópia congelada ou num relógio parado, ficaria
   * "zerada" sem ninguém ter medido. O critério só se cumpre com as duas (falha fechada, D-SESS2-58).
   */
  medidaDiaria: z.object({
    diasLimpos: z.number().int().nonnegative(),
    exigidos: z.number().int().positive(),
    paradaSemMedida: dia.nullable(),
    ultimaSessao: dia.nullable(),
  }),
  /** Regra 3 inteira: a tabela de conexões sem pessoa na janela E a medida diária com os dias exigidos. */
  sessoesCumprido: z.boolean(),
  /** O dia mais recente da tabela de conexões (o relógio do outro lado). */
  ultimoDiaTabela: dia.nullable(),
  /** Quantas contas técnicas e de contingência combinadas saem da contagem (o registro do fim, M43). */
  contasCombinadas: z.number().int().nonnegative(),
  /** O fim da coexistência e a DP-6 como estão no registro do fim do hospital (M43). */
  fimRegistradoEm: dia.nullable(),
  dp6: z.object({ decididaEm: dia.nullable(), previstaPara: dia.nullable() }),
  /** O registro versionado dos passos (docs/coexistencia/desligamento/<h>.yaml) e o motivo, se não valer. */
  registro: z.string(),
  registroInvalido: z.string().nullable(),
  /** A ação de registrar aparece para quem tem a permissão (o servidor confere de novo). */
  podeRegistrar: z.boolean(),
});
export type PainelDesligamento = z.infer<typeof esquemaPainelDesligamento>;

/** Resposta do registro de um item da checklist. */
export const esquemaResultadoRegistroDesligamento = z.object({
  item: z.string(),
  registradoEm: z.iso.datetime(),
});
export type ResultadoRegistroDesligamento = z.infer<typeof esquemaResultadoRegistroDesligamento>;

/** Resposta de GET administracao/coexistencia/desligamento/plataforma (cartão da verificação de schema). */
export const esquemaCartaoPlataforma = z.object({
  hospital: z.string(),
  em: z.iso.datetime(),
  plataforma: esquemaPlataformaBanco,
  /** A entrada de texto hoje (regra 6): restrita ao CP1252 até a conversão e a chave `entrada.utf8`. */
  restricaoEntrada: z.enum(['cp1252', 'livre']),
  /** As funções externas que bloqueiam a troca para a versão 5 (regra 5). */
  funcoesPendentes: z.array(z.string()),
  colunasTexto: z.array(
    z.object({
      tipo: z.enum(['char', 'varchar', 'blob-texto']),
      charset: z.string(),
      colunas: z.number().int().nonnegative(),
    }),
  ),
  indicesComTexto: z.number().int().nonnegative(),
});
export type CartaoPlataforma = z.infer<typeof esquemaCartaoPlataforma>;

// ── Registro versionado dos passos por hospital (docs/coexistencia/desligamento/<h>.yaml) ──────────────────

const textoRegistro = z
  .string()
  .regex(RE_TEXTO_SEM_DADO_PESSOAL, 'texto sem dado pessoal (até 600 caracteres)');
const referenciaData = z.object({ data: dia, referencia: textoRegistro }).strict();
const PASSO_VAZIO = { autorizacao: null, ensaio: null, execucao: null };
const passoRegistrado = z
  .object({
    autorizacao: referenciaData.nullable().default(null),
    ensaio: z
      .object({ data: dia, relatorio: textoRegistro, resultado: z.enum(['aprovado', 'reprovado']) })
      .strict()
      .nullable()
      .default(null),
    execucao: referenciaData.nullable().default(null),
  })
  .strict()
  .default(PASSO_VAZIO);

/**
 * O que a F1 não mede e que o dono, a TI e os ensaios registram por PR revisado (como o registro do fim do M43): a
 * autorização de cada passo (ESTADO.md › Autorizações), o ensaio de cada fatia com o relatório, a execução na janela, a
 * resolução das funções externas (ADR da F2), o aviso aos parceiros e os contratos da API da Hal-AI. Sem dado pessoal.
 * Ausente ou fora do esquema: vale vazio (tudo bloqueado), com o aviso no painel (falha fechada, D-AUT-58).
 */
export const esquemaRegistroDesligamento = z
  .object({
    formato: z.literal(1),
    estabelecimento: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
    passos: z
      .object({ desligamento: passoRegistrado, firebird5: passoRegistrado, utf8: passoRegistrado })
      .strict()
      .default({
        desligamento: PASSO_VAZIO,
        firebird5: PASSO_VAZIO,
        utf8: PASSO_VAZIO,
      }),
    funcoes: z
      .array(
        z
          .object({
            nome: z.string().regex(/^[A-Z][A-Z0-9_$]{0,62}$/),
            resolucao: z.enum(RESOLUCOES_FUNCAO_EXTERNA),
            referencia: textoRegistro,
          })
          .strict(),
      )
      .default([]),
    parceirosAvisados: referenciaData.nullable().default(null),
    contratosHalAi: referenciaData.nullable().default(null),
  })
  .strict()
  .superRefine((r, ctx) => {
    // Um passo executado tem autorização e ensaio aprovado antes (regras 4 e 6; ficha, seção 12).
    for (const p of PASSOS_DESLIGAMENTO) {
      const x = r.passos[p];
      if (x.execucao && (!x.autorizacao || x.ensaio?.resultado !== 'aprovado'))
        ctx.addIssue({
          code: 'custom',
          path: ['passos', p, 'execucao'],
          message: 'execução sem autorização ou sem ensaio aprovado',
        });
    }
    const nomes = new Set<string>();
    for (const [i, f] of r.funcoes.entries()) {
      if (nomes.has(f.nome))
        ctx.addIssue({ code: 'custom', path: ['funcoes', i, 'nome'], message: 'função repetida' });
      nomes.add(f.nome);
    }
  });
export type RegistroDesligamento = z.infer<typeof esquemaRegistroDesligamento>;

export const caminhoRegistroDesligamento = (estabelecimento: string): string =>
  `docs/coexistencia/desligamento/${estabelecimento}.yaml`;
