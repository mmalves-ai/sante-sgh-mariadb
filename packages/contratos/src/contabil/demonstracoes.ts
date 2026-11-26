// Contabilidade, etapa 3 (M54-F3; ficha, seções 2, 4, 6, 7 e regra 5): balancete, diário, DRE e balanço lidos dos
// lançamentos gravados (SGH_CTB_LANCAMENTO e SGH_CTB_PARTIDA), a apuração do resultado do exercício (o lançamento de
// encerramento das contas de resultado contra o patrimônio líquido) e o SPED contábil (ECD e ECF), gerado a partir da
// contabilidade própria, com o hash e o recibo de cada arquivo (SGH_CTB_ARQUIVO_SPED, script 0976). O razão de uma conta
// é o da etapa 2 (`ROTAS_CONTABIL_F2.razao`). A parte SPED nasce DESLIGADA (chave `contabil.sped`, POL-3): a
// controladoria liga quando trouxer a escrituração para o novo; até lá a exportação ao contador continua.
//   - Valores sempre em CENTAVOS inteiros. Saldo do balancete com o sinal devedor (débitos − créditos; negativo = saldo
//     credor); a tela mostra "D" ou "C". Nas demonstrações (DRE e balanço), o valor vem na natureza do grupo.
//   - Toda conta agregada vem com as parcelas (regra 5): os totais do balancete somam só as contas analíticas, e a
//     conferência imprime débitos = créditos e saldos devedores = saldos credores.
//   - A DRE do exercício não conta o lançamento de apuração (nem o estorno dele): senão o resultado seria zero.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { CODIGO_CONTA } from './entradas.js';
import type { TipoLancamento } from './lancamentos.js';
import type { GrupoConta, LadoPartida, NaturezaConta, TipoConta } from './vocabulario.js';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const COMPETENCIA = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const EXERCICIO = z.number().int().min(2000).max(2100);
const JUSTIFICATIVA = textoCp1252(500).refine(
  (s) => s.trim().length >= 10,
  'Justificativa com ao menos 10 caracteres.',
);

const meses = (de: string, ate: string) => {
  const [a1, m1] = de.split('-').map(Number) as [number, number];
  const [a2, m2] = ate.split('-').map(Number) as [number, number];
  return (a2 - a1) * 12 + (m2 - m1) + 1;
};

// ── Vocabulário ───────────────────────────────────────────────────────────────────────────────────

/** As demonstrações da tela /contabil/demonstracoes. */
export const TIPOS_DEMONSTRACAO = {
  balancete: 'Balancete de verificação',
  diario: 'Livro diário',
  dre: 'Demonstração do resultado (DRE)',
  balanco: 'Balanço patrimonial',
} as const;
export type TipoDemonstracao = keyof typeof TIPOS_DEMONSTRACAO;

/** Tetos (ficha, seção 4: paginado, p95 < 2 s). */
export const TETO_DIARIO_LANCAMENTOS = 200;
/** Contas lidas de uma vez no balancete (o plano inteiro de um hospital cabe com folga). */
export const TETO_CONTAS_BALANCETE = 5_000;
/** O balancete, a DRE e o diário abrangem no máximo 12 meses. */
export const MESES_MAXIMOS_DEMONSTRACAO = 12;

/** Arquivos do SPED contábil gerados pelo novo. */
export const TIPOS_ARQUIVO_SPED = {
  ecd: 'ECD (Escrituração Contábil Digital)',
  ecf: 'ECF (Escrituração Contábil Fiscal)',
} as const;
export type TipoArquivoSped = keyof typeof TIPOS_ARQUIVO_SPED;
export const CODIGOS_TIPO_ARQUIVO_SPED = Object.keys(TIPOS_ARQUIVO_SPED) as TipoArquivoSped[];

/**
 * Situação do arquivo: gerado; transmitido (com o recibo); substituído (outro gerado depois para o mesmo exercício);
 * cancelado (com o motivo). Nada se apaga.
 */
export const SITUACOES_ARQUIVO_SPED = {
  gerado: 'Gerado',
  transmitido: 'Transmitido',
  substituido: 'Substituído',
  cancelado: 'Cancelado',
} as const;
export type SituacaoArquivoSped = keyof typeof SITUACOES_ARQUIVO_SPED;

/** Versões de leiaute escritas pelo gerador (conferência no validador oficial pendente: `leiauteConferido`). */
export const LEIAUTE_ECD = '9.00';
export const LEIAUTE_ECF = '0011';

/**
 * Forma de tributação do lucro na ECF (registro 0010, FORMA_TRIB). O gerador do novo escreve a ECF das entidades
 * imunes e isentas (blocos J, K e U); as outras formas (lucro real e presumido: blocos L, M, N e P) não são geradas
 * (D-ECF-543), e a tela mostra o motivo.
 */
export const FORMAS_TRIBUTACAO_ECF = {
  '1': 'Lucro real',
  '2': 'Lucro real e arbitrado',
  '3': 'Lucro presumido e real',
  '4': 'Lucro presumido, real e arbitrado',
  '5': 'Lucro presumido',
  '6': 'Lucro arbitrado',
  '7': 'Lucro presumido e arbitrado',
  '8': 'Imune do IRPJ',
  '9': 'Isenta do IRPJ',
} as const;
export type FormaTributacaoEcf = keyof typeof FORMAS_TRIBUTACAO_ECF;
/** As geradas: imune, isenta e o lucro real (com as apurações do LALUR); presumido e arbitrado ficam com o programa oficial. */
export const FORMAS_ECF_GERADAS: readonly FormaTributacaoEcf[] = ['1', '8', '9'];

/** Qualificação do signatário (tabela do SPED, os códigos mais usados): o contador é 900. */
export const QUALIFICACOES_SIGNATARIO = {
  '203': 'Diretor',
  '204': 'Conselheiro de administração',
  '205': 'Administrador',
  '206': 'Administrador do grupo',
  '207': 'Administrador de sociedade filiada',
  '220': 'Administrador judicial',
  '222': 'Representante legal',
  '309': 'Procurador',
  '312': 'Inventariante',
  '313': 'Liquidante',
  '315': 'Interventor',
  '801': 'Empresário',
  '900': 'Contador',
  '999': 'Outros',
} as const;
export type QualificacaoSignatario = keyof typeof QUALIFICACOES_SIGNATARIO;
const CODIGOS_QUALIFICACAO = Object.keys(QUALIFICACOES_SIGNATARIO) as [
  QualificacaoSignatario,
  ...QualificacaoSignatario[],
];

// ── Rotas ─────────────────────────────────────────────────────────────────────────────────────────

export const ROTAS_CONTABIL_F3 = {
  apoio: { caminho: 'contabil/demonstracoes/apoio', permissao: 'contabil.demonstracao.ler' },
  balancete: { caminho: 'contabil/demonstracoes/balancete', permissao: 'contabil.demonstracao.ler' },
  diario: { caminho: 'contabil/demonstracoes/diario', permissao: 'contabil.demonstracao.ler' },
  dre: { caminho: 'contabil/demonstracoes/dre', permissao: 'contabil.demonstracao.ler' },
  balanco: { caminho: 'contabil/demonstracoes/balanco', permissao: 'contabil.demonstracao.ler' },
  /** O balancete, o diário, a DRE ou o balanço em PDF/A ou XLSX (leitura auditada: `contabil.demonstracao.exportada`). */
  exportar: { caminho: 'contabil/demonstracoes/exportar', permissao: 'contabil.demonstracao.ler' },
  /** A prévia da apuração do resultado do exercício (o que o lançamento de encerramento vai mover). */
  apuracao: { caminho: 'contabil/demonstracoes/apuracao', permissao: 'contabil.demonstracao.ler' },
  /** Apurar: o "Encerramento de exercício" do outro sistema (opções 85 e 86); crítica, com a senha. */
  apurar: { caminho: 'contabil/demonstracoes/apuracao/apurar', permissao: 'contabil.periodo.encerrar' },
  spedApoio: { caminho: 'contabil/sped/apoio', permissao: 'contabil.sped.ler' },
  spedArquivos: { caminho: 'contabil/sped', permissao: 'contabil.sped.ler' },
  spedPrevia: { caminho: 'contabil/sped/previa', permissao: 'contabil.sped.ler' },
  spedGerar: { caminho: 'contabil/sped/gerar', permissao: 'contabil.sped.gerar' },
  spedBaixar: { caminho: 'contabil/sped/arquivo', permissao: 'contabil.sped.gerar' },
  spedSituacao: { caminho: 'contabil/sped/situacao', permissao: 'contabil.sped.gerar' },
  /** Os signatários vigentes do cadastro da empresa (com o CPF: só para quem gera). */
  spedSignatarios: { caminho: 'contabil/sped/signatarios', permissao: 'contabil.sped.gerar' },
} as const;

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────

/** Balancete de um intervalo de competências (no máximo 12 meses), até o nível pedido do plano. */
export const esquemaFiltroBalancete = z
  .object({
    empresa: z.number().int().positive(),
    de: COMPETENCIA,
    ate: COMPETENCIA,
    /** Último nível mostrado (1 = só os grupos); sem nível, todas as contas. */
    nivel: z.number().int().min(1).max(10).nullable().default(null),
    /** Também as contas sem saldo nem movimento. */
    incluirZeradas: z.boolean().default(false),
    centroCusto: z.number().int().positive().nullable().default(null),
  })
  .refine((f) => f.de <= f.ate, 'O início é depois do fim.')
  .refine((f) => meses(f.de, f.ate) <= MESES_MAXIMOS_DEMONSTRACAO, 'O balancete abrange no máximo 12 meses.');
export type FiltroBalancete = z.output<typeof esquemaFiltroBalancete>;

/** Diário de um intervalo de datas (no máximo 12 meses), paginado por lançamento. */
export const esquemaFiltroDiario = z
  .object({
    empresa: z.number().int().positive(),
    de: DATA,
    ate: DATA,
    pagina: z.number().int().min(1).max(100_000).default(1),
  })
  .refine((f) => f.de <= f.ate, 'O início é depois do fim.')
  .refine(
    (f) => meses(f.de.slice(0, 7), f.ate.slice(0, 7)) <= MESES_MAXIMOS_DEMONSTRACAO,
    'O diário abrange no máximo 12 meses.',
  );
export type FiltroDiario = z.output<typeof esquemaFiltroDiario>;

/** DRE de um intervalo de competências do mesmo exercício (no máximo 12 meses). */
export const esquemaFiltroDre = z
  .object({ empresa: z.number().int().positive(), de: COMPETENCIA, ate: COMPETENCIA })
  .refine((f) => f.de <= f.ate, 'O início é depois do fim.')
  .refine((f) => f.de.slice(0, 4) === f.ate.slice(0, 4), 'A DRE é de um só exercício.');
export type FiltroDre = z.output<typeof esquemaFiltroDre>;

/** Balanço no último dia da competência. */
export const esquemaFiltroBalanco = z.object({
  empresa: z.number().int().positive(),
  competencia: COMPETENCIA,
});
export type FiltroBalanco = z.output<typeof esquemaFiltroBalanco>;

export const esquemaFiltroApuracao = z.object({ empresa: z.number().int().positive(), exercicio: EXERCICIO });

/**
 * Apurar o resultado do exercício: um lançamento (tipo `apuracao`) no último dia do exercício, que zera cada conta de
 * resultado (receitas, custos e despesas; por centro de custo) contra a conta do patrimônio líquido escolhida. Período
 * de dezembro aberto; uma apuração ativa por exercício (a refeita exige estornar a anterior). A chave do lançamento é
 * a empresa, o exercício e o número da apuração (a segunda apuração simultânea colide na chave única).
 */
export const esquemaApurarResultado = z.object({
  empresa: z.number().int().positive(),
  exercicio: EXERCICIO,
  /** Conta analítica do patrimônio líquido que recebe o resultado (superávit ou déficit do exercício). */
  contaDestino: CODIGO_CONTA,
  observacao: textoCp1252(200).nullable().default(null),
});
export type ApurarResultado = z.output<typeof esquemaApurarResultado>;

const CPF = z.string().regex(/^\d{11}$/, 'CPF com 11 dígitos, sem pontos.');

/** Signatário da escrituração (J930 da ECD; 0930 da ECF). O CPF só vai ao arquivo, que é guardado cifrado. */
export const esquemaSignatarioSped = z
  .object({
    nome: textoCp1252(100).refine((s) => s.trim().length >= 3, 'Nome com ao menos 3 caracteres.'),
    cpf: CPF,
    qualificacao: z.enum(CODIGOS_QUALIFICACAO),
    /** Registro no conselho (obrigatório para o contador). */
    crc: textoCp1252(20).nullable().default(null),
    email: z.string().email().max(60).nullable().default(null),
    telefone: z
      .string()
      .regex(/^\d{10,11}$/)
      .nullable()
      .default(null),
  })
  .refine((s) => s.qualificacao !== '900' || (s.crc !== null && s.crc.trim().length > 0), {
    message: 'O contador precisa do número de registro no conselho.',
    path: ['crc'],
  });
export type SignatarioSped = z.output<typeof esquemaSignatarioSped>;

export const esquemaFiltroSped = z.object({
  empresa: z.number().int().positive(),
  tipo: z.enum(CODIGOS_TIPO_ARQUIVO_SPED as [TipoArquivoSped, ...TipoArquivoSped[]]),
  exercicio: EXERCICIO,
});

/** Gerar a ECD ou a ECF do exercício (a anterior do mesmo exercício, se gerada e não transmitida, fica substituída). */
export const esquemaGerarSped = esquemaFiltroSped
  .extend({
    /** Número de ordem do livro diário (ECD; I030 NUM_ORD). */
    numeroOrdem: z.number().int().min(1).max(99_999).default(1),
    /** Escrituração substituta (ECD IND_FIN_ESC = 1; ECF RETIFICADORA = S) com o recibo ou o hash da anterior. */
    substituta: z.boolean().default(false),
    hashAnterior: z.string().trim().max(40).nullable().default(null),
    /** Guardar os signatários no cadastro da empresa (a próxima geração já os traz). */
    guardarSignatarios: z.boolean().default(true),
    /** ECF: forma de tributação (imune, isenta e lucro real são geradas). */
    formaTributacao: z
      .enum(Object.keys(FORMAS_TRIBUTACAO_ECF) as [FormaTributacaoEcf, ...FormaTributacaoEcf[]])
      .nullable()
      .default(null),
    /** ECF das imunes e isentas: tipo da entidade (registro 0010, TIP_ENT; dois dígitos da tabela do SPED). */
    tipoEntidadeEcf: z
      .string()
      .regex(/^\d{2}$/)
      .nullable()
      .default(null),
    signatarios: z.array(esquemaSignatarioSped).min(2).max(10),
  })
  .refine((g) => g.signatarios.some((s) => s.qualificacao === '900'), {
    message: 'Entre os signatários, o contador (qualificação 900).',
    path: ['signatarios'],
  })
  .refine((g) => g.signatarios.some((s) => s.qualificacao !== '900'), {
    message: 'Entre os signatários, o responsável pela entidade além do contador.',
    path: ['signatarios'],
  })
  .refine((g) => !g.substituta || (g.hashAnterior !== null && g.hashAnterior.length > 0), {
    message: 'A substituta precisa do hash (ou recibo) da escrituração substituída.',
    path: ['hashAnterior'],
  })
  .refine((g) => g.tipo !== 'ecf' || g.formaTributacao !== null, {
    message: 'Informe a forma de tributação da ECF.',
    path: ['formaTributacao'],
  })
  .refine((g) => g.tipo !== 'ecf' || g.tipoEntidadeEcf !== null, {
    message: 'Informe o tipo da entidade imune ou isenta.',
    path: ['tipoEntidadeEcf'],
  });
export type GerarSped = z.output<typeof esquemaGerarSped>;

export const esquemaArquivoSped = z.object({
  empresa: z.number().int().positive(),
  id: z.number().int().positive(),
});

/** Registrar o recibo da transmissão (feita no programa oficial) ou cancelar o arquivo gerado. */
export const esquemaSituacaoSped = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('recibo'),
    empresa: z.number().int().positive(),
    id: z.number().int().positive(),
    recibo: z.string().trim().min(10).max(60),
    transmitidoEm: DATA,
  }),
  z.object({
    acao: z.literal('cancelar'),
    empresa: z.number().int().positive(),
    id: z.number().int().positive(),
    motivo: JUSTIFICATIVA,
  }),
]);
export type SituacaoSped = z.output<typeof esquemaSituacaoSped>;

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────────

export interface LinhaBalancete {
  readonly codigo: string;
  readonly nome: string;
  readonly nivel: number;
  readonly tipo: TipoConta;
  readonly grupo: GrupoConta;
  readonly natureza: NaturezaConta;
  /** Saldos com sinal devedor (D − C): negativo = saldo credor. */
  readonly saldoAnteriorCentavos: number;
  readonly debitosCentavos: number;
  readonly creditosCentavos: number;
  readonly saldoFinalCentavos: number;
  /** Conta com movimento que não está no plano (a tela destaca; não deveria acontecer). */
  readonly foraDoPlano: boolean;
}

export interface TotaisBalancete {
  readonly saldoAnteriorDevedorCentavos: number;
  readonly saldoAnteriorCredorCentavos: number;
  readonly debitosCentavos: number;
  readonly creditosCentavos: number;
  readonly saldoFinalDevedorCentavos: number;
  readonly saldoFinalCredorCentavos: number;
}

export interface Balancete {
  readonly empresa: number;
  readonly de: string;
  readonly ate: string;
  readonly nivel: number | null;
  readonly centroCusto: number | null;
  readonly linhas: readonly LinhaBalancete[];
  /** Somas só das contas analíticas (as sintéticas agregam; somar tudo contaria duas vezes). */
  readonly totais: TotaisBalancete;
  /**
   * Débitos = créditos e saldos devedores = saldos credores, no anterior e no final. Nulo com o filtro de centro de
   * custo (as partidas de um centro não fecham sozinhas).
   */
  readonly equilibrado: boolean | null;
  /** As parcelas impressas (regra 5). */
  readonly conferencia: readonly string[];
  /** As competências do intervalo ainda abertas (o balancete de período aberto ainda pode mudar). */
  readonly competenciasAbertas: readonly string[];
}

export interface PartidaDiario {
  readonly lado: LadoPartida;
  readonly conta: string;
  readonly contaNome: string;
  readonly valorCentavos: number;
  readonly centroCusto: number | null;
  readonly historico: string;
}

export interface LancamentoDiario {
  readonly id: number;
  readonly data: string;
  readonly tipo: TipoLancamento;
  readonly tipoRotulo: string;
  readonly historico: string;
  readonly debitosCentavos: number;
  readonly creditosCentavos: number;
  readonly estornaId: number | null;
  readonly partidas: readonly PartidaDiario[];
}

export interface Diario {
  readonly empresa: number;
  readonly de: string;
  readonly ate: string;
  readonly lancamentos: readonly LancamentoDiario[];
  /** Totais do intervalo inteiro (nunca cortados pela página), com as parcelas por tipo. */
  readonly totais: {
    readonly lancamentos: number;
    readonly debitosCentavos: number;
    readonly creditosCentavos: number;
  };
  readonly parcelas: readonly {
    readonly tipo: TipoLancamento;
    readonly lancamentos: number;
    readonly debitosCentavos: number;
  }[];
  readonly conferencia: string;
  readonly pagina: number;
  readonly parcial: boolean;
}

/** Uma parcela de demonstração: a conta (de nível 2, a aglutinação) e o valor na natureza do grupo. */
export interface ParcelaDemonstracao {
  readonly codigo: string;
  readonly nome: string;
  readonly valorCentavos: number;
}

export interface LinhaDre {
  readonly chave:
    'receitaBruta' | 'deducoes' | 'receitaLiquida' | 'custos' | 'resultadoBruto' | 'despesas' | 'resultado';
  readonly rotulo: string;
  /** Total da linha: receitas positivas; deduções, custos e despesas negativos; o resultado com o sinal. */
  readonly valorCentavos: number;
  readonly total: boolean;
  readonly parcelas: readonly ParcelaDemonstracao[];
}

export interface Dre {
  readonly empresa: number;
  readonly de: string;
  readonly ate: string;
  readonly linhas: readonly LinhaDre[];
  readonly resultadoCentavos: number;
  /** "Superávit" ou "Déficit" (o resultado zero é superávit zero). */
  readonly rotuloResultado: string;
  readonly conferencia: string;
}

export interface SecaoBalanco {
  readonly rotulo: string;
  readonly totalCentavos: number;
  readonly parcelas: readonly ParcelaDemonstracao[];
}

export interface Balanco {
  readonly empresa: number;
  readonly competencia: string;
  readonly data: string;
  readonly ativo: SecaoBalanco;
  readonly passivo: SecaoBalanco;
  readonly patrimonioLiquido: SecaoBalanco;
  /** Resultado do exercício ainda não apurado (contas de resultado do ano até a data). */
  readonly resultadoExercicioCentavos: number;
  /** Resultado de exercícios anteriores que não foi apurado (deveria ser zero depois das apurações). */
  readonly resultadoAnterioresCentavos: number;
  readonly totalAtivoCentavos: number;
  readonly totalPassivoPlCentavos: number;
  readonly compensacao: SecaoBalanco | null;
  readonly equilibrado: boolean;
  readonly conferencia: string;
}

/** Impedimento da apuração ou da geração do SPED (o motivo e a contagem). */
export interface ImpedimentoContabil {
  readonly codigo: string;
  readonly mensagem: string;
  readonly quantidade: number;
}

export interface PreviaApuracao {
  readonly empresa: number;
  readonly exercicio: string;
  readonly data: string;
  readonly receitasCentavos: number;
  readonly custosCentavos: number;
  readonly despesasCentavos: number;
  /** Receitas − custos − despesas, com a conferência impressa. */
  readonly resultadoCentavos: number;
  readonly conferencia: string;
  /** Partidas do lançamento (uma por conta e centro de custo com saldo, mais a do patrimônio líquido). */
  readonly partidas: number;
  /** A apuração ativa do exercício (não estornada), se houver. */
  readonly apuracaoAtiva: number | null;
  readonly impedimentos: readonly ImpedimentoContabil[];
  readonly podeApurar: boolean;
  /** Contas analíticas do patrimônio líquido (destino do resultado). */
  readonly contasDestino: readonly { readonly codigo: string; readonly nome: string }[];
}

export interface ResultadoApuracao {
  readonly ok: true;
  readonly id: number;
  readonly resultadoCentavos: number;
  readonly mensagem: string;
}

export interface CentroCustoDemonstracao {
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
}

export interface ApoioDemonstracoes {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly empresas: readonly number[];
  readonly hoje: string;
  /** Maior nível do plano (para o seletor do balancete). */
  readonly niveis: number;
  /** Centros de custo do estabelecimento, para o filtro do balancete (seleção com busca; o inativo vem marcado). */
  readonly centros: readonly CentroCustoDemonstracao[];
  readonly podeApurar: boolean;
  readonly podeVerSped: boolean;
  readonly tipos: readonly { readonly codigo: TipoDemonstracao; readonly rotulo: string }[];
}

export interface ResumoRegistrosSped {
  readonly registro: string;
  readonly quantidade: number;
}

export interface PreviaSped {
  readonly empresa: number;
  readonly tipo: TipoArquivoSped;
  readonly exercicio: number;
  readonly leiaute: string;
  readonly impedimentos: readonly ImpedimentoContabil[];
  /** Avisos que não impedem (ex.: conta analítica sem referencial numa conta sem saldo). */
  readonly avisos: readonly string[];
  readonly podeGerar: boolean;
  /** Quantidade de registros por tipo e linhas (sem o conteúdo, que só sai na geração). */
  readonly registros: readonly ResumoRegistrosSped[];
  readonly linhas: number;
}

export interface ArquivoSpedListado {
  readonly id: number;
  readonly empresa: number;
  readonly tipo: TipoArquivoSped;
  readonly exercicio: number;
  readonly numero: number;
  readonly situacao: SituacaoArquivoSped;
  readonly leiaute: string;
  readonly leiauteConferido: boolean;
  readonly nomeArquivo: string;
  readonly linhas: number;
  readonly tamanho: number;
  /** SHA-256 do conteúdo (o arquivo baixado confere com ele). */
  readonly hash: string;
  readonly substituta: boolean;
  readonly geradoPor: string;
  readonly geradoEm: string;
  readonly recibo: string | null;
  readonly transmitidoEm: string | null;
  readonly motivo: string | null;
}

export interface ArquivosSped {
  readonly empresa: number;
  readonly itens: readonly ArquivoSpedListado[];
}

export interface ResultadoSped {
  readonly ok: true;
  readonly id: number;
  readonly numero: number;
  readonly hash: string;
  readonly linhas: number;
  readonly mensagem: string;
}

export interface ArquivoSpedBaixado {
  readonly id: number;
  readonly nomeArquivo: string;
  readonly hash: string;
  /** O texto do arquivo (ISO-8859-1 no programa oficial; aqui em UTF-8, convertido na tela ao salvar). */
  readonly conteudo: string;
}

export interface ApoioSped {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly empresas: readonly number[];
  readonly hoje: string;
  readonly podeGerar: boolean;
  /** Sem a chave de cifra, a geração fica desligada (o arquivo traz o CPF dos signatários). */
  readonly cifraDisponivel: boolean;
  readonly leiautes: { readonly ecd: string; readonly ecf: string };
  readonly formasTributacao: readonly {
    readonly codigo: FormaTributacaoEcf;
    readonly rotulo: string;
    readonly gerada: boolean;
  }[];
  readonly qualificacoes: readonly { readonly codigo: QualificacaoSignatario; readonly rotulo: string }[];
}

/** Os signatários vigentes no cadastro da empresa. */
export interface SignatariosSped {
  readonly empresa: number;
  readonly itens: SignatarioSped[];
  /** O que falta para a escrituração: contador, responsavel. */
  readonly faltas: string[];
}
