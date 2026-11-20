// Cálculo mensal da folha (M53-F2; ficha do M53, seções 1, 6 a 8, regras 7 e 8): o salário contratual do vínculo com
// vigência, os parâmetros da folha por empresa com vigência (percentuais legais e de convenção, alíquotas patronais e o
// papel de cada rubrica no cálculo), o processamento da competência (cabeçalho com os totais) e o cálculo por
// colaborador e rubrica com a memória. Valores em centavos; percentuais em centésimos de ponto (50% = 5000), como as
// rubricas e as tabelas legais do M53-F1. Nenhuma resposta traz CPF ou nome: só vínculo (ID), matrícula e valores.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

/** Chave de liberação da folha do Sante SGH (SGH_CFG_LIBERACAO; nasce desligada, POL-3). */
export const CHAVE_PESSOAS_FOLHA = 'pessoas.folha';

const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const id = z.coerce.number().int().positive();
const smallint = z.coerce.number().int().min(0).max(32_767);
const centavos = z.number().int().min(0).max(99_999_999_999);
/** Percentual em centésimos de ponto, até 1.000% (hora extra de convenção acima de 100%). */
const percentual = z.number().int().min(0).max(100_000);

// ── Papéis das rubricas no cálculo ────────────────────────────────────────────────────────────────────────────

/**
 * O papel de cada linha do cálculo. Cada papel que gera valor aponta para uma rubrica da empresa (`FPEVENTO`) nos
 * parâmetros da folha: a rubrica dá o código do holerite, o código do eSocial e as incidências (INSS, IRRF, FGTS).
 */
export const PAPEIS_CALCULO_FOLHA = [
  'salario',
  'horaExtra50',
  'horaExtra100',
  'adicionalNoturno',
  'dsrVariaveis',
  'sobreaviso',
  'insalubridade',
  'periculosidade',
  'salarioFamilia',
  'faltas',
  'atrasos',
  'inss',
  'irrf',
  'fgts',
  // M53-F3 (M53.4): férias (CLT arts. 129 a 145) e 13º salário (Leis 4.090/1962 e 4.749/1965). Os papéis novos ficam
  // null nos parâmetros já gravados (o JSON das rubricas aceita papel ausente) até o DP escolher a rubrica.
  'feriasGozo',
  'feriasMedias',
  'feriasTerco',
  'abonoPecuniario',
  'abonoTerco',
  'feriasDobra',
  'inssFerias',
  'irrfFerias',
  'decimoAdiantamento',
  'decimoPrimeira',
  'decimoTerceiro',
  'decimoMedias',
  'decimoDesconto',
  'inssDecimo',
  'irrfDecimo',
  // M53-F4 (M53.5): rescisão (CLT arts. 477 a 487; Lei 12.506/2011; Lei 4.090/1962). O saldo de salário, as variáveis do
  // mês, o INSS e o IRRF do mês usam os papéis da folha mensal; o 13º proporcional retém em `inssDecimo`/`irrfDecimo`.
  'avisoIndenizado',
  'avisoDescontado',
  'indenizacao479',
  'feriasVencidas',
  'feriasVencidasDobra',
  'feriasProporcionais',
  'feriasAviso',
  'feriasRescisaoTerco',
  'decimoProporcional',
  'decimoAviso',
] as const;
export type PapelCalculoFolha = (typeof PAPEIS_CALCULO_FOLHA)[number];

/** Linhas sem rubrica: as bases e os encargos da empresa (só para a conferência e o custo de pessoal). */
export const PAPEIS_INFORMATIVOS_FOLHA = [
  'baseInss',
  'baseIrrf',
  'baseFgts',
  'inssPatronal',
  'rat',
  'terceiros',
  // M53-F4: a multa do FGTS na rescisão (depositada na conta vinculada pela guia; não entra no líquido).
  'multaFgts',
] as const;
export type PapelInformativoFolha = (typeof PAPEIS_INFORMATIVOS_FOLHA)[number];

export type PapelLinhaFolha = PapelCalculoFolha | PapelInformativoFolha;
export const PAPEIS_LINHA_FOLHA: readonly PapelLinhaFolha[] = [
  ...PAPEIS_CALCULO_FOLHA,
  ...PAPEIS_INFORMATIVOS_FOLHA,
];

export const TIPOS_LINHA_FOLHA = ['provento', 'desconto', 'base', 'informativa'] as const;
export type TipoLinhaFolha = (typeof TIPOS_LINHA_FOLHA)[number];

/** O tipo fixo de cada papel (a rubrica mapeada precisa ser do mesmo tipo: provento ou desconto). */
export const TIPO_DO_PAPEL: Readonly<Record<PapelLinhaFolha, TipoLinhaFolha>> = {
  salario: 'provento',
  horaExtra50: 'provento',
  horaExtra100: 'provento',
  adicionalNoturno: 'provento',
  dsrVariaveis: 'provento',
  sobreaviso: 'provento',
  insalubridade: 'provento',
  periculosidade: 'provento',
  salarioFamilia: 'provento',
  faltas: 'desconto',
  atrasos: 'desconto',
  inss: 'desconto',
  irrf: 'desconto',
  fgts: 'informativa',
  feriasGozo: 'provento',
  feriasMedias: 'provento',
  feriasTerco: 'provento',
  abonoPecuniario: 'provento',
  abonoTerco: 'provento',
  feriasDobra: 'provento',
  inssFerias: 'desconto',
  irrfFerias: 'desconto',
  decimoAdiantamento: 'provento',
  decimoPrimeira: 'provento',
  decimoTerceiro: 'provento',
  decimoMedias: 'provento',
  decimoDesconto: 'desconto',
  inssDecimo: 'desconto',
  irrfDecimo: 'desconto',
  avisoIndenizado: 'provento',
  avisoDescontado: 'desconto',
  indenizacao479: 'provento',
  feriasVencidas: 'provento',
  feriasVencidasDobra: 'provento',
  feriasProporcionais: 'provento',
  feriasAviso: 'provento',
  feriasRescisaoTerco: 'provento',
  decimoProporcional: 'provento',
  decimoAviso: 'provento',
  baseInss: 'base',
  baseIrrf: 'base',
  baseFgts: 'base',
  inssPatronal: 'informativa',
  rat: 'informativa',
  terceiros: 'informativa',
  multaFgts: 'informativa',
};

/** Unidade da quantidade da linha. */
export const UNIDADES_LINHA_FOLHA = ['dias', 'minutos', 'dependentes', 'percentual', 'valor'] as const;
export type UnidadeLinhaFolha = (typeof UNIDADES_LINHA_FOLHA)[number];

/** Graus de insalubridade (percentual do salário mínimo, NR-15): nenhum, mínimo, médio e máximo. */
export const GRAUS_INSALUBRIDADE = [0, 1000, 2000, 4000] as const;

// ── Salário contratual do vínculo ─────────────────────────────────────────────────────────────────────────────

/**
 * Uma vigência do salário contratual (SGH_PES_SALARIO): vale do início até a vigência seguinte. Os dependentes do IRRF e
 * do salário-família são as marcas do cadastro de dependentes do colaborador (M52; D-DEP-533).
 */
export const esquemaSalarioVinculo = z
  .object({
    id: z.number().int().positive(),
    vinculo: z.number().int().positive(),
    inicio: data,
    salario: centavos,
    /** Grau de insalubridade em centésimos de ponto do salário mínimo (0, 1000, 2000 ou 4000). */
    insalubridade: z.number().int(),
    periculosidade: z.boolean(),
    motivo: z.string(),
    registradoPor: z.string(),
    registradoEm: z.string(),
  })
  .strict();
export type SalarioVinculo = z.infer<typeof esquemaSalarioVinculo>;

export const esquemaFiltroSalarios = z.object({ vinculo: id }).strict();
export type FiltroSalarios = z.infer<typeof esquemaFiltroSalarios>;

/** Registrar uma nova vigência do salário (`pessoas.salario.editar`). */
export const esquemaRegistrarSalario = z
  .object({
    vinculo: id,
    inicio: data,
    salario: z.number().int().positive().max(99_999_999_999),
    insalubridade: z
      .number()
      .int()
      .refine(
        (n) => (GRAUS_INSALUBRIDADE as readonly number[]).includes(n),
        'Grau de insalubridade inválido.',
      ),
    periculosidade: z.boolean(),
    motivo: textoCp1252(200).trim().min(3),
  })
  .strict()
  .refine((x) => !(x.periculosidade && x.insalubridade > 0), {
    message: 'Insalubridade e periculosidade não se acumulam: escolha um dos adicionais.',
    path: ['periculosidade'],
  });
export type RegistrarSalarioEntrada = z.infer<typeof esquemaRegistrarSalario>;

export interface ListaSalarios {
  readonly vinculo: number;
  readonly matricula: string | null;
  readonly itens: readonly SalarioVinculo[];
}

// ── Parâmetros da folha por empresa ───────────────────────────────────────────────────────────────────────────

export const esquemaPercentuaisFolha = z
  .object({
    /** Hora extra em dia útil (CLT art. 59: no mínimo 50%). */
    horaExtra50: percentual,
    /** Hora extra em descanso e feriado (Lei 605/1949: 100%). */
    horaExtra100: percentual,
    /** Adicional noturno (CLT art. 73: no mínimo 20%). */
    adicionalNoturno: percentual,
    /** Sobreaviso (CLT art. 244 §2: um terço da hora). */
    sobreaviso: percentual,
    /** Periculosidade sobre o salário-base (CLT art. 193 §1: 30%). */
    periculosidade: percentual,
  })
  .strict();
export type PercentuaisFolha = z.infer<typeof esquemaPercentuaisFolha>;

export const esquemaEncargosFolha = z
  .object({
    /** Contribuição patronal sobre a folha (20% na regra geral). */
    inssPatronal: percentual,
    /** RAT ajustado pelo FAP (RAT × FAP), em centésimos de ponto. */
    ratAjustado: percentual,
    /** Outras entidades e fundos (terceiros), soma das alíquotas do FPAS. */
    terceiros: percentual,
    /** Depósito do FGTS (8% na regra geral). */
    fgts: percentual,
  })
  .strict();
export type EncargosFolha = z.infer<typeof esquemaEncargosFolha>;

/** O papel de cada rubrica no cálculo: o ID da rubrica da empresa (o mesmo do cadastro `pessoas.rubrica`). */
export const esquemaRubricasDoCalculo = z
  .object(
    Object.fromEntries(
      PAPEIS_CALCULO_FOLHA.map((p) => [p, z.number().int().positive().nullable()]),
    ) as Record<PapelCalculoFolha, z.ZodNullable<z.ZodNumber>>,
  )
  .strict();
export type RubricasDoCalculo = z.infer<typeof esquemaRubricasDoCalculo>;

export const esquemaParametrosFolha = z
  .object({
    empresa: z.number().int().min(0).max(32_767),
    inicio: data,
    percentuais: esquemaPercentuaisFolha,
    encargos: esquemaEncargosFolha,
    /** Divisor de horas do mês (220 para 44 h); null: a carga semanal do vínculo × 5. */
    divisorHoras: z.number().int().min(1).max(400).nullable(),
    rubricas: esquemaRubricasDoCalculo,
  })
  .strict();
export type ParametrosFolha = z.infer<typeof esquemaParametrosFolha>;

export const esquemaParametrosFolhaLidos = esquemaParametrosFolha
  .extend({ id: z.number().int().positive(), registradoPor: z.string(), registradoEm: z.string() })
  .strict();
export type ParametrosFolhaLidos = z.infer<typeof esquemaParametrosFolhaLidos>;

export const esquemaFiltroParametrosFolha = z.object({ empresa: smallint }).strict();

/** Registrar uma nova vigência dos parâmetros (`pessoas.parametroFolha.editar`). */
export const esquemaRegistrarParametrosFolha = esquemaParametrosFolha;
export type RegistrarParametrosFolhaEntrada = z.infer<typeof esquemaRegistrarParametrosFolha>;

export interface ListaParametrosFolha {
  readonly empresa: number;
  readonly itens: readonly ParametrosFolhaLidos[];
}

// ── Processamento da competência ──────────────────────────────────────────────────────────────────────────────

/**
 * Situação do processamento (SGH_PES_FOLHA_PROCESSO.SITUACAO): `calculada` (a que vale, uma só por empresa e
 * competência), `substituida` (um cálculo novo a trocou) e `descartada` (retirada à mão, com motivo). O fechamento da
 * competência é da etapa dos periódicos (M53-F6).
 */
export const SITUACOES_PROCESSO_FOLHA = ['calculada', 'substituida', 'descartada'] as const;
export type SituacaoProcessoFolha = (typeof SITUACOES_PROCESSO_FOLHA)[number];

/**
 * O tipo do processamento (SGH_PES_FOLHA_PROCESSO.TIPO, M53-F3): a folha mensal (`mensal`), o recibo de férias de um
 * colaborador (`ferias`, um por concessão, ligado a SGH_PES_FERIAS) e as duas parcelas do 13º salário (`decimo1`, o
 * adiantamento entre fevereiro e novembro, e `decimo2`, a parcela final de dezembro). `mensal` e as parcelas do 13º têm
 * um só processamento `calculada` por empresa e competência (a 1ª parcela, por empresa e ano); férias, um por concessão.
 * M53-F4: a rescisão (`rescisao`, um por desligamento, ligada a SGH_PES_RESCISAO), na competência do desligamento.
 */
export const TIPOS_PROCESSO_FOLHA = ['mensal', 'ferias', 'decimo1', 'decimo2', 'rescisao'] as const;
export type TipoProcessoFolha = (typeof TIPOS_PROCESSO_FOLHA)[number];

/**
 * Pendências que barram o cálculo (a tela traduz por `folha.calculo.pendencia.<codigo>`):
 * - ponto-nao-fechado: vínculo da folha ativo na competência sem o período de ponto fechado;
 * - sem-salario: vínculo sem salário contratual em vigor na competência;
 * - sem-tabela-legal: nenhuma tabela legal (IRRF, INSS) em vigor no primeiro dia da competência;
 * - tabela-legal-divergente: a tabela em vigor não passa na conferência (faixas fora de ordem, buraco, sem faixa);
 * - sem-parametros: a empresa não tem parâmetros da folha em vigor na competência;
 * - papel-sem-rubrica: um papel com valor na competência sem rubrica nos parâmetros (valor = índice do papel);
 * - rubrica-invalida: a rubrica do papel não existe na empresa, não está em vigor ou não é do tipo do papel;
 * - liquido-negativo: os descontos do vínculo passam dos proventos;
 * - sem-colaboradores: nenhum vínculo da folha na competência;
 * - competencia-futura: a competência ainda não terminou;
 * - na-folha-mensal: o colaborador desligado está na folha mensal calculada da competência do desligamento (o mês
 *   inteiro já foi pago): recalcule ou descarte a folha mensal antes da rescisão (M53-F4).
 */
export const CODIGOS_PENDENCIA_CALCULO = [
  'ponto-nao-fechado',
  'sem-salario',
  'sem-tabela-legal',
  'tabela-legal-divergente',
  'sem-parametros',
  'papel-sem-rubrica',
  'rubrica-invalida',
  'liquido-negativo',
  'sem-colaboradores',
  'competencia-futura',
  'na-folha-mensal',
] as const;
export type CodigoPendenciaCalculo = (typeof CODIGOS_PENDENCIA_CALCULO)[number];

export const esquemaPendenciaCalculo = z
  .object({
    codigo: z.enum(CODIGOS_PENDENCIA_CALCULO),
    vinculos: z.array(z.number().int().positive()),
    /** O papel em falta (papel-sem-rubrica, rubrica-invalida); null quando não se aplica. */
    papel: z.enum(PAPEIS_CALCULO_FOLHA).nullable(),
  })
  .strict();
export type PendenciaCalculo = z.infer<typeof esquemaPendenciaCalculo>;

/** Uma linha do cálculo do vínculo, com a memória (o texto do cálculo, sem dado pessoal). */
export const esquemaLinhaCalculoFolha = z
  .object({
    papel: z.enum(PAPEIS_LINHA_FOLHA as [PapelLinhaFolha, ...PapelLinhaFolha[]]),
    tipo: z.enum(TIPOS_LINHA_FOLHA),
    /** A rubrica da empresa (ID e código do holerite); null nas bases e encargos. */
    rubrica: z.number().int().positive().nullable(),
    codigoRubrica: z.number().int().nonnegative().nullable(),
    quantidade: z.number().int().min(0),
    unidade: z.enum(UNIDADES_LINHA_FOLHA),
    valor: centavos,
    memoria: z.string().max(400),
  })
  .strict();
export type LinhaCalculoFolha = z.infer<typeof esquemaLinhaCalculoFolha>;

/** O resumo de um vínculo no cálculo (somas das linhas; nenhum nome nem CPF). */
export const esquemaColaboradorCalculado = z
  .object({
    vinculo: z.number().int().positive(),
    matricula: z.string().nullable(),
    centroCusto: z.number().int().positive(),
    diasPagos: z.number().int().min(0).max(30),
    proventos: centavos,
    descontos: centavos,
    liquido: centavos,
    baseInss: centavos,
    baseIrrf: centavos,
    baseFgts: centavos,
    inss: centavos,
    irrf: centavos,
    fgts: centavos,
    /** Encargos da empresa: patronal + RAT + terceiros (o FGTS fica à parte). */
    encargos: centavos,
  })
  .strict();
export type ColaboradorCalculado = z.infer<typeof esquemaColaboradorCalculado>;

export const esquemaTotaisCalculoFolha = z
  .object({
    colaboradores: z.number().int().min(0),
    proventos: centavos,
    descontos: centavos,
    liquido: centavos,
    inss: centavos,
    irrf: centavos,
    fgts: centavos,
    inssPatronal: centavos,
    rat: centavos,
    terceiros: centavos,
  })
  .strict();
export type TotaisCalculoFolha = z.infer<typeof esquemaTotaisCalculoFolha>;

/** O cabeçalho do processamento, como a lista mostra. */
export const esquemaResumoProcessoFolha = z
  .object({
    id: z.number().int().positive(),
    empresa: z.number().int().min(0),
    competencia,
    tipo: z.enum(TIPOS_PROCESSO_FOLHA),
    numero: z.number().int().positive(),
    situacao: z.enum(SITUACOES_PROCESSO_FOLHA),
    /** Data de pagamento (13º e férias); null na folha mensal. */
    pagamento: data.nullable(),
    totais: esquemaTotaisCalculoFolha,
    /** Início da vigência da tabela legal e dos parâmetros usados. */
    tabelaLegal: data,
    parametros: data,
    /**
     * Vínculos que não entram nesta folha (outro tipo de vínculo ou desligados na competência, que vão à rescisão; na 1ª
     * parcela do 13º, também os que já receberam o adiantamento com as férias).
     */
    foraDaFolha: z.number().int().min(0),
    resumo: z.string().regex(/^[0-9a-f]{64}$/),
    calculadoPor: z.string(),
    calculadoEm: z.string(),
    situacaoPor: z.string().nullable(),
    situacaoEm: z.string().nullable(),
    motivo: z.string().nullable(),
    versao: z.number().int().min(0),
  })
  .strict();
export type ResumoProcessoFolha = z.infer<typeof esquemaResumoProcessoFolha>;
/**
 * O cabeçalho do processamento sem os valores: o recibo de férias tem um colaborador só, então os totais e o resumo
 * (que é a soma de verificação das linhas) revelam o salário dele; sem `pessoas.salario.ler` saem só a identificação, a
 * situação e quem calculou (D-PERM-SAL-533).
 */
export type CabecalhoProcessoFolha = Omit<ResumoProcessoFolha, 'totais' | 'resumo'> &
  Partial<Pick<ResumoProcessoFolha, 'totais' | 'resumo'>>;

export const esquemaFiltroProcessosFolha = z
  .object({
    empresa: smallint.optional(),
    competencia: competencia.optional(),
    tipo: z.enum(TIPOS_PROCESSO_FOLHA).optional(),
  })
  .strict();
export type FiltroProcessosFolha = z.infer<typeof esquemaFiltroProcessosFolha>;

export interface ListaProcessosFolha {
  readonly itens: readonly ResumoProcessoFolha[];
  readonly limitado: boolean;
}

/** Calcular a folha da competência (`pessoas.folha.calcular`); `simular` devolve a prévia sem gravar. */
export const esquemaCalcularFolha = z
  .object({
    empresa: z.number().int().min(0).max(32_767),
    competencia,
    simular: z.boolean().default(false),
  })
  .strict();
export type CalcularFolhaEntrada = z.infer<typeof esquemaCalcularFolha>;

/** Prova da soma do cálculo (regra 8; convencoes.md: toda conta agregada com as parcelas). */
export interface ConferenciaCalculoFolha {
  readonly ok: boolean;
  /** Parcelas impressas: proventos − descontos = líquido, por total e a soma dos vínculos. */
  readonly parcelas: readonly { readonly rotulo: string; readonly valor: number }[];
  readonly divergencias: readonly string[];
}

export interface ResultadoCalculoFolha {
  readonly calculado: boolean;
  readonly simulado: boolean;
  readonly processo: ResumoProcessoFolha | null;
  readonly pendencias: readonly PendenciaCalculo[];
  readonly totais: TotaisCalculoFolha | null;
  readonly colaboradores: readonly ColaboradorCalculado[];
  readonly conferencia: ConferenciaCalculoFolha | null;
  /** O processamento anterior que este substituiu (null: nenhum). */
  readonly substituido: number | null;
}

export interface DetalheProcessoFolha {
  readonly processo: ResumoProcessoFolha;
  /** Vazia quando a sessão não tem `pessoas.salario.ler` (D-PERM-SAL-533): os valores por colaborador revelam o salário. */
  readonly colaboradores: readonly ColaboradorCalculado[];
  /** true: a lista por colaborador foi omitida por falta de `pessoas.salario.ler` (a prova da soma segue com os totais). */
  readonly colaboradoresOcultos: boolean;
  readonly conferencia: ConferenciaCalculoFolha;
}

export interface LinhasDoVinculoFolha {
  readonly processo: number;
  readonly vinculo: number;
  readonly matricula: string | null;
  readonly linhas: readonly LinhaCalculoFolha[];
}

/** Descartar o processamento em vigor (`pessoas.folha.calcular`), com motivo. */
export const esquemaDescartarProcessoFolha = z
  .object({
    versao: z.number().int().min(0),
    motivo: textoCp1252(200).trim().min(3),
  })
  .strict();
export type DescartarProcessoFolhaEntrada = z.infer<typeof esquemaDescartarProcessoFolha>;

/** O apoio da tela do cálculo: o que a sessão pode fazer e os rótulos dos papéis. */
export interface ApoioCalculoFolha {
  readonly hoje: string;
  readonly competenciaSugerida: string;
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: {
    readonly calcular: boolean;
    readonly salario: boolean;
    readonly verSalario: boolean;
    readonly parametros: boolean;
    readonly motivo: string | null;
  };
  readonly empresas: readonly { readonly codigo: number; readonly rotulo: string }[];
  readonly papeis: readonly { readonly papel: PapelCalculoFolha; readonly tipo: TipoLinhaFolha }[];
}

// ── Holerite do autosserviço ──────────────────────────────────────────────────────────────────────────────────

/** O holerite do próprio colaborador (`pessoas.autoatendimento.ler`, só o próprio; leitura auditada). */
export const esquemaFiltroMeuHolerite = z
  .object({ competencia: competencia.optional(), vinculo: id.optional() })
  .strict();
export type FiltroMeuHolerite = z.infer<typeof esquemaFiltroMeuHolerite>;

/** Os encargos da empresa não saem no holerite do colaborador (são custo da empresa, não do empregado). */
export const PAPEIS_FORA_DO_HOLERITE: readonly PapelLinhaFolha[] = ['inssPatronal', 'rat', 'terceiros'];

export interface MeuHolerite {
  readonly hoje: string;
  readonly competencia: string;
  /** A folha está no Sante SGH (chave `pessoas.folha` ligada); senão, `mensagem` diz onde consultar. */
  readonly disponivel: boolean;
  readonly mensagem: string | null;
  readonly vinculo: number | null;
  readonly matricula: string | null;
  /** O cálculo em vigor da competência tem o vínculo (false: ainda não calculada). */
  readonly calculado: boolean;
  readonly calculadoEm: string | null;
  readonly linhas: readonly LinhaCalculoFolha[];
  readonly proventos: number;
  readonly descontos: number;
  readonly liquido: number;
}
