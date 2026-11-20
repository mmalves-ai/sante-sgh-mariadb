// Contratos do patrimônio (M54, etapa 6: fatia F6; ficha, seções 4, 6, 7 e 8, regras 11 a 13): o bem patrimonial a
// partir da nota fiscal de entrada (ou, sem nota, só a doação com o termo registrado), a plaqueta e o QR, a localização
// pelo centro de custo, o responsável, a transferência com o aceite de quem recebe, o empréstimo e o comodato, a baixa,
// a depreciação mensal linear com o coeficiente por turno (integrada à contabilidade como fato de origem 7, Patrimônio)
// e o inventário pela leitura do QR no celular, que registra a divergência sem corrigir nada sozinho. Tudo em SGH_PAT_*
// (script 0548); os domínios do patrimônio (origem, tipo de responsável, coeficiente por turno, parâmetros) são lidos
// onde estão. Valores em centavos (inteiros). Nenhum dado de paciente.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

// ── Vocabulário ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * SEMENTE INICIAL do grupo do bem (W0-08): os 8 grupos com a vida útil padrão em meses (taxas da Receita Federal, IN RFB
 * 1.700/2017, Anexo III). Desde o script 1102 o grupo é cadastro do Sante (SGH_PAT_GRUPO, por estabelecimento, com
 * inclusão, alteração, inativação e exclusão do nunca usado); esta lista só é gravada na primeira gravação do
 * estabelecimento e serve de rótulo quando o cadastro não responde. A vida útil do bem pode ser outra (laudo); o grupo
 * só sugere.
 */
export const GRUPOS_BEM = {
  equipamentoMedico: { rotulo: 'Equipamentos médico-hospitalares', vidaUtilMeses: 120 },
  maquinas: { rotulo: 'Máquinas e equipamentos', vidaUtilMeses: 120 },
  moveis: { rotulo: 'Móveis e utensílios', vidaUtilMeses: 120 },
  informatica: { rotulo: 'Equipamentos de informática', vidaUtilMeses: 60 },
  veiculos: { rotulo: 'Veículos', vidaUtilMeses: 60 },
  instalacoes: { rotulo: 'Instalações', vidaUtilMeses: 120 },
  edificacoes: { rotulo: 'Edificações e benfeitorias', vidaUtilMeses: 300 },
  outros: { rotulo: 'Outros bens', vidaUtilMeses: 120 },
} as const satisfies Record<string, { rotulo: string; vidaUtilMeses: number }>;
/** Um dos grupos da semente. */
export type GrupoSemente = keyof typeof GRUPOS_BEM;
/** Os códigos da semente (não é mais a lista dos grupos válidos: o cadastro pode ter outros). */
export const CODIGOS_GRUPO_BEM = Object.keys(GRUPOS_BEM) as [GrupoSemente, ...GrupoSemente[]];
/** Código do grupo do bem (cadastro SGH_PAT_GRUPO): letras e números, começando por letra, de 2 a 20. */
export type GrupoBem = string;
export const esquemaCodigoGrupoBem = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9-]{1,19}$/, 'Código do grupo: de 2 a 20 letras e números, começando por letra.');
/** O rótulo do grupo da semente (ou o próprio código, quando não é da semente). */
export const rotuloGrupoSemente = (codigo: string): string =>
  codigo in GRUPOS_BEM ? GRUPOS_BEM[codigo as GrupoSemente].rotulo : codigo;

export const SITUACOES_BEM = ['ativo', 'emprestado', 'baixado'] as const;
export type SituacaoBem = (typeof SITUACOES_BEM)[number];
export const ROTULOS_SITUACAO_BEM: Readonly<Record<SituacaoBem, string>> = {
  ativo: 'Em uso',
  emprestado: 'Emprestado ou em comodato',
  baixado: 'Baixado',
};

/** Documento de origem do bem (regra 11): a nota fiscal de entrada; sem ela, só a doação com o termo. */
export const DOCUMENTOS_ORIGEM_BEM = ['nota', 'termo'] as const;
export type DocumentoOrigemBem = (typeof DOCUMENTOS_ORIGEM_BEM)[number];

/** Origem "Doação" no domínio de origens do patrimônio do banco (GPORIGEM; 5 linhas no pc em 24/10/2026). */
export const ORIGEM_BEM_DOACAO = 2;

export const TIPOS_MOVIMENTO_BEM = ['transferencia', 'emprestimo', 'comodato', 'devolucao', 'baixa'] as const;
export type TipoMovimentoBem = (typeof TIPOS_MOVIMENTO_BEM)[number];
export const ROTULOS_MOVIMENTO_BEM: Readonly<Record<TipoMovimentoBem, string>> = {
  transferencia: 'Transferência entre setores',
  emprestimo: 'Empréstimo a terceiro',
  comodato: 'Comodato a terceiro',
  devolucao: 'Devolução do empréstimo ou comodato',
  baixa: 'Baixa do bem',
};

export const SITUACOES_MOVIMENTO_BEM = ['pendente', 'aceito', 'recusado', 'cancelado', 'concluido'] as const;
export type SituacaoMovimentoBem = (typeof SITUACOES_MOVIMENTO_BEM)[number];
export const ROTULOS_SITUACAO_MOVIMENTO: Readonly<Record<SituacaoMovimentoBem, string>> = {
  pendente: 'Aguardando o aceite de quem recebe',
  aceito: 'Aceito',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
  concluido: 'Registrado',
};

export const RESULTADOS_LEITURA_INVENTARIO = [
  'conforme',
  'outro-local',
  'nao-cadastrado',
  'baixado',
  'emprestado',
  'repetida',
] as const;
export type ResultadoLeituraInventario = (typeof RESULTADOS_LEITURA_INVENTARIO)[number];
export const ROTULOS_RESULTADO_LEITURA: Readonly<Record<ResultadoLeituraInventario, string>> = {
  conforme: 'Encontrado no lugar',
  'outro-local': 'Encontrado em outro setor',
  'nao-cadastrado': 'Código sem bem cadastrado',
  baixado: 'Bem baixado encontrado',
  emprestado: 'Bem emprestado encontrado',
  repetida: 'Leitura repetida',
};

export const SITUACOES_INVENTARIO = ['aberto', 'encerrado', 'cancelado'] as const;
export type SituacaoInventario = (typeof SITUACOES_INVENTARIO)[number];

/** Tetos: bens por cadastro (uma nota com várias unidades), página da lista, leituras por inventário. */
export const TETO_BENS_POR_CADASTRO = 100;
export const TAMANHO_PAGINA_BENS = 50;
export const TETO_PAGINA_BENS = 200;
export const TETO_BENS_CALCULO = 20_000;
export const TETO_LEITURAS_INVENTARIO = 20_000;

// ── Entradas ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const FORMATO_COMPETENCIA_PATRIMONIO = /^(19[5-9]\d|20\d\d)-(0[1-9]|1[0-2])$/;
export const esquemaCompetenciaPatrimonio = z
  .string()
  .regex(FORMATO_COMPETENCIA_PATRIMONIO, 'Competência no formato AAAA-MM.');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const texto = (max: number) => textoCp1252(max).pipe(z.string().trim());
const textoObrigatorio = (max: number, msg: string) => textoCp1252(max).pipe(z.string().trim().min(1, msg));
const opcional = (max: number) =>
  texto(max)
    .nullable()
    .default(null)
    .transform((v) => (v === '' ? null : v));
const centavos = z.number().int().min(0).max(99_999_999_999);
const id = z.number().int().positive();

/** Campos comuns do cadastro (o resto vem do documento de origem). */
const camposCadastro = {
  descricao: textoObrigatorio(120, 'Descreva o bem.'),
  grupo: esquemaCodigoGrupoBem,
  /** GPORIGEM.ID. */
  origem: id,
  /** TBCENCUS.ID (onde o bem fica). */
  centro: id,
  localDetalhe: opcional(80),
  /** GPTP_RESPONSAVEL.ID. */
  tipoResponsavel: id.nullable().default(null),
  responsavel: opcional(80),
  marca: opcional(40),
  modelo: opcional(40),
  /** Só com uma unidade (cada bem tem o seu). */
  numeroSerie: opcional(40),
  /** Só com uma unidade; sem ela, o Sante numera. Letras, números e hífen. */
  plaqueta: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/, 'A plaqueta tem até 20 letras, números ou hífen.')
    .nullable()
    .default(null),
  /** Sem ela, a vida útil padrão do grupo. */
  vidaUtilMeses: z.number().int().min(1).max(1200).nullable().default(null),
  residualCent: centavos.default(0),
  /** GPCOEFICIENTE_DEPREC.ID (turnos de uso); null: um turno. */
  coeficiente: id.nullable().default(null),
  /** Sem ela, o mês seguinte ao da aquisição. */
  inicioDepreciacao: esquemaCompetenciaPatrimonio.nullable().default(null),
  /** Sem ela, a marca da origem (GPORIGEM.DEPRECIAR). */
  depreciavel: z.boolean().nullable().default(null),
  /** Unidades a cadastrar (uma plaqueta por unidade). */
  quantidade: z.number().int().min(1).max(TETO_BENS_POR_CADASTRO).default(1),
};

export const esquemaCadastrarBem = z
  .discriminatedUnion('documento', [
    z
      .object({
        documento: z.literal('nota'),
        /** GECADNFS.ID e GELANNFS.ID_GELANNFS. */
        nota: id,
        itemNota: id,
        ...camposCadastro,
      })
      .strict(),
    z
      .object({
        documento: z.literal('termo'),
        termoNumero: textoObrigatorio(40, 'Informe o número do termo de doação.'),
        termoData: data,
        doador: textoObrigatorio(120, 'Informe quem doou.'),
        /** Empresa (TBEMPHOS) que recebe a doação. */
        empresa: id,
        dataAquisicao: data,
        /** Valor de cada unidade (o do termo ou do laudo de avaliação). */
        valorCent: centavos.min(1, 'Informe o valor do bem.'),
        ...camposCadastro,
      })
      .strict(),
  ])
  .superRefine((x, ctx) => {
    if (x.quantidade > 1 && x.numeroSerie !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['numeroSerie'],
        message: 'Número de série só com uma unidade: cadastre uma de cada vez.',
      });
    if (x.quantidade > 1 && x.plaqueta !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['plaqueta'],
        message: 'Com mais de uma unidade, o Sante numera as plaquetas.',
      });
    if (x.responsavel !== null && x.tipoResponsavel === null)
      ctx.addIssue({
        code: 'custom',
        path: ['tipoResponsavel'],
        message: 'Informe o tipo do responsável.',
      });
  });
export type CadastrarBem = z.infer<typeof esquemaCadastrarBem>;

export const esquemaAlterarBem = z
  .object({
    descricao: textoObrigatorio(120, 'Descreva o bem.'),
    grupo: esquemaCodigoGrupoBem,
    localDetalhe: opcional(80),
    tipoResponsavel: id.nullable().default(null),
    responsavel: opcional(80),
    marca: opcional(40),
    modelo: opcional(40),
    numeroSerie: opcional(40),
    /** Os campos da depreciação só mudam antes da primeira cota (depois, a correção é outra decisão contábil). */
    vidaUtilMeses: z.number().int().min(1).max(1200),
    residualCent: centavos,
    coeficiente: id.nullable(),
    inicioDepreciacao: esquemaCompetenciaPatrimonio,
    depreciavel: z.boolean(),
    versao: z.number().int().min(0),
  })
  .strict();
export type AlterarBem = z.infer<typeof esquemaAlterarBem>;

export const esquemaConsultaBens = z
  .object({
    busca: texto(60).optional(),
    centro: z.coerce.number().int().positive().optional(),
    situacao: z.enum(SITUACOES_BEM).optional(),
    grupo: esquemaCodigoGrupoBem.optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
    tamanho: z.coerce.number().int().min(1).max(TETO_PAGINA_BENS).default(TAMANHO_PAGINA_BENS),
  })
  .strict();
export type ConsultaBens = z.infer<typeof esquemaConsultaBens>;

export const esquemaConsultaNotas = z
  .object({
    competencia: esquemaCompetenciaPatrimonio,
    busca: texto(40).optional(),
  })
  .strict();
export type ConsultaNotas = z.infer<typeof esquemaConsultaNotas>;

export const esquemaConsultaDepreciacao = z
  .object({ empresa: z.coerce.number().int().positive(), competencia: esquemaCompetenciaPatrimonio })
  .strict();
export type ConsultaDepreciacao = z.infer<typeof esquemaConsultaDepreciacao>;

export const esquemaCalcularDepreciacao = z
  .object({ empresa: id, competencia: esquemaCompetenciaPatrimonio })
  .strict();
export type CalcularDepreciacao = z.infer<typeof esquemaCalcularDepreciacao>;

const motivo = textoObrigatorio(400, 'Informe o motivo.');

/** W0-08: cancelar o inventário aberto, com o motivo (mínimo de 5 caracteres). */
export const esquemaCancelarInventario = z
  .object({
    motivo: textoObrigatorio(400, 'Informe o motivo do cancelamento.').refine(
      (v) => v.trim().length >= 5,
      'Descreva o motivo (pelo menos 5 caracteres).',
    ),
  })
  .strict();
export type CancelarInventario = z.infer<typeof esquemaCancelarInventario>;

/** W0-08: estornar o último cálculo da depreciação da competência, com o motivo (mínimo de 5 caracteres). */
export const esquemaEstornarDepreciacao = z
  .object({
    empresa: id,
    competencia: esquemaCompetenciaPatrimonio,
    motivo: textoObrigatorio(400, 'Informe o motivo do estorno.').refine(
      (v) => v.trim().length >= 5,
      'Descreva o motivo (pelo menos 5 caracteres).',
    ),
  })
  .strict();
export type EstornarDepreciacao = z.infer<typeof esquemaEstornarDepreciacao>;

const baseMovimento = { bem: id, versao: z.number().int().min(0), data, motivo };

export const esquemaRegistrarMovimento = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('transferencia'),
      ...baseMovimento,
      destino: id,
      destinoResponsavel: opcional(80),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('emprestimo'),
      ...baseMovimento,
      terceiro: textoObrigatorio(120, 'Informe com quem o bem fica.'),
      retornoPrevisto: data.nullable().default(null),
      termoNumero: opcional(40),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('comodato'),
      ...baseMovimento,
      terceiro: textoObrigatorio(120, 'Informe com quem o bem fica.'),
      retornoPrevisto: data.nullable().default(null),
      termoNumero: textoObrigatorio(40, 'O comodato exige o número do contrato ou termo.'),
    })
    .strict(),
  z.object({ tipo: z.literal('devolucao'), ...baseMovimento }).strict(),
  z
    .object({
      tipo: z.literal('baixa'),
      ...baseMovimento,
      termoNumero: textoObrigatorio(40, 'A baixa exige o número do termo ou laudo de baixa.'),
      valorVendaCent: centavos.nullable().default(null),
    })
    .strict(),
]);
export type RegistrarMovimento = z.infer<typeof esquemaRegistrarMovimento>;

export const esquemaDecidirMovimento = z
  .object({ aceitar: z.boolean(), motivo: opcional(400), versao: z.number().int().min(0) })
  .strict()
  .superRefine((x, ctx) => {
    if (!x.aceitar && x.motivo === null)
      ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Informe por que recusa.' });
  });
export type DecidirMovimento = z.infer<typeof esquemaDecidirMovimento>;

export const esquemaCancelarMovimento = z.object({ motivo, versao: z.number().int().min(0) }).strict();
export type CancelarMovimento = z.infer<typeof esquemaCancelarMovimento>;

export const esquemaConsultaMovimentos = z
  .object({
    situacao: z.enum(SITUACOES_MOVIMENTO_BEM).optional(),
    bem: z.coerce.number().int().positive().optional(),
  })
  .strict();
export type ConsultaMovimentos = z.infer<typeof esquemaConsultaMovimentos>;

export const esquemaAbrirInventarioBens = z
  .object({
    descricao: textoObrigatorio(120, 'Dê um nome ao inventário.'),
    /** TBCENCUS.ID; null: o estabelecimento inteiro. */
    centro: id.nullable().default(null),
  })
  .strict();
export type AbrirInventarioBens = z.infer<typeof esquemaAbrirInventarioBens>;

export const esquemaLeituraInventario = z
  .object({
    /** O texto do QR ou a plaqueta digitada. */
    codigo: z.string().trim().min(1, 'Leia o QR ou digite a plaqueta.').max(80),
    /** TBCENCUS.ID do setor onde a leitura é feita. */
    centro: id,
    observacao: opcional(400),
  })
  .strict();
export type LeituraInventario = z.infer<typeof esquemaLeituraInventario>;

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RefCentro {
  readonly id: number;
  readonly codigo: number | null;
  readonly nome: string;
}

export interface NotaDoBem {
  readonly id: number;
  readonly idItem: number;
  readonly numero: string | null;
  readonly serie: string | null;
  readonly data: string | null;
  readonly fornecedor: string | null;
  readonly item: number | null;
  readonly itemNome: string | null;
}

export interface BemPatrimonial {
  readonly id: number;
  readonly plaqueta: string;
  /** O texto que vai no QR da etiqueta. */
  readonly qr: string;
  readonly descricao: string;
  readonly grupo: GrupoBem;
  readonly origem: { readonly id: number; readonly nome: string };
  readonly documento: DocumentoOrigemBem;
  readonly nota: NotaDoBem | null;
  readonly termo: { readonly numero: string; readonly data: string; readonly doador: string } | null;
  readonly empresa: number;
  readonly dataAquisicao: string;
  readonly valorCent: number;
  readonly residualCent: number;
  readonly vidaUtilMeses: number;
  readonly coeficiente: {
    readonly id: number;
    readonly descricao: string;
    readonly percentual: number;
  } | null;
  readonly inicioDepreciacao: string;
  readonly depreciavel: boolean;
  readonly centro: RefCentro;
  readonly localDetalhe: string | null;
  readonly tipoResponsavel: { readonly id: number; readonly nome: string } | null;
  readonly responsavel: string | null;
  readonly marca: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly situacao: SituacaoBem;
  readonly baixadoEm: string | null;
  /** Depreciação acumulada e valor contábil (valor − acumulada), com as parcelas impressas. */
  readonly acumuladaCent: number;
  readonly contabilCent: number;
  readonly ultimaCompetencia: string | null;
  readonly cotas: number;
  readonly movimentoPendente: { readonly id: number; readonly tipo: TipoMovimentoBem } | null;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface ListaBens {
  readonly bens: readonly BemPatrimonial[];
  readonly total: number;
  readonly pagina: number;
  readonly tamanho: number;
  /** Totais da página, com a conta: contábil = valor − acumulada. */
  readonly totaisPagina: {
    readonly valorCent: number;
    readonly acumuladaCent: number;
    readonly contabilCent: number;
  };
}

export interface NotaEntradaParaBem {
  readonly id: number;
  readonly ano: number;
  readonly mes: number;
  readonly doc: number;
  readonly numero: string | null;
  readonly serie: string | null;
  readonly data: string | null;
  readonly fornecedor: string | null;
  readonly empresa: number | null;
  readonly totalCent: number;
  readonly itens: number;
}

export interface ItemNotaParaBem {
  readonly id: number;
  readonly seq: number | null;
  readonly item: number;
  readonly nome: string;
  readonly quantidade: number;
  readonly valorTotalCent: number;
  /** Valor de cada unidade (total ÷ quantidade, em centavos; a sobra do arredondamento vai na primeira). */
  readonly valorUnitarioCent: number;
  readonly jaCadastrados: number;
  readonly disponiveis: number;
}

export interface CotaDepreciacao {
  readonly bem: number;
  readonly plaqueta: string;
  readonly descricao: string;
  readonly grupo: GrupoBem;
  readonly centro: number;
  readonly baseCent: number;
  readonly residualCent: number;
  readonly vidaUtilMeses: number;
  readonly coeficiente: number;
  readonly acumuladaAntesCent: number;
  /** Meses desde o início da depreciação até a competência (inclusive); a acumulada esperada é a deles. */
  readonly mesesDecorridos: number;
  readonly valorCent: number;
  readonly acumuladaDepoisCent: number;
  /** A cota recupera meses sem cálculo (bem cadastrado depois do início da depreciação). */
  readonly recuperaMeses: boolean;
  /** A cota fecha o valor depreciável (a última). */
  readonly ultima: boolean;
}

export const MOTIVOS_SEM_COTA = [
  'nao-depreciavel',
  'baixado',
  'ainda-nao-iniciou',
  'depreciado',
  'ja-calculado',
] as const;
export type MotivoSemCota = (typeof MOTIVOS_SEM_COTA)[number];
export const ROTULOS_MOTIVO_SEM_COTA: Readonly<Record<MotivoSemCota, string>> = {
  'nao-depreciavel': 'Não deprecia (origem ou cadastro)',
  baixado: 'Baixado antes da competência',
  'ainda-nao-iniciou': 'A depreciação começa depois',
  depreciado: 'Totalmente depreciado',
  'ja-calculado': 'Cota da competência já gravada',
};

export interface CalculoDepreciacao {
  readonly id: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly bens: number;
  readonly ignorados: number;
  readonly totalCent: number;
  readonly calculadoPor: string;
  readonly calculadoEm: string;
  /** 1 no primeiro cálculo da competência; N + 1 depois de N estornos (W0-08). */
  readonly rodada: number;
}

/** W0-08: o estorno de um cálculo (fato novo; o cálculo e as cotas ficam gravados, sem valer). */
export interface EstornoDepreciacao {
  readonly id: number;
  readonly calculo: number;
  readonly competencia: string;
  readonly bens: number;
  readonly totalCent: number;
  readonly motivo: string;
  readonly origem: string;
  readonly estornadoPor: string;
  readonly estornadoEm: string;
}

export interface ParcelaDepreciacao {
  readonly chave: string;
  readonly rotulo: string;
  readonly bens: number;
  readonly valorCent: number;
}

export interface DepreciacaoCompetencia {
  readonly empresa: number;
  readonly competencia: string;
  readonly calculo: CalculoDepreciacao | null;
  /** As cotas gravadas (calculada) ou a prévia (não calculada). */
  readonly cotas: readonly CotaDepreciacao[];
  readonly semCota: readonly {
    readonly bem: number;
    readonly plaqueta: string;
    readonly motivo: MotivoSemCota;
  }[];
  /** Total = soma das cotas; com as parcelas por grupo e por centro de custo. */
  readonly totalCent: number;
  readonly porGrupo: readonly ParcelaDepreciacao[];
  readonly porCentro: readonly ParcelaDepreciacao[];
  /** O que impede calcular (vazio: pode calcular). */
  readonly impedimentos: readonly string[];
  readonly parametros: ParametrosDepreciacao;
  /** W0-08: os estornos da competência, do mais novo ao mais antigo (motivo, data, quem e origem). */
  readonly estornos: readonly EstornoDepreciacao[];
  /** W0-08: o cálculo vigente é o último da empresa (só ele se estorna; o servidor confere o resto na gravação). */
  readonly estornavel: boolean;
}

export interface ParametrosDepreciacao {
  readonly empresa: number;
  /** GPPARAMG.DEPRECIAR: a empresa deprecia os bens. */
  readonly depreciar: boolean;
  /** GPPARAMG.APLICAR_COEFICIENTE: aplica o coeficiente por turno. */
  readonly aplicarCoeficiente: boolean;
  /** GPPARAMG.CONSIDERA_VALOR_RESIDUAL: desconta o valor residual da base. */
  readonly considerarResidual: boolean;
}

export interface MovimentoBem {
  readonly id: number;
  readonly bem: { readonly id: number; readonly plaqueta: string; readonly descricao: string };
  readonly tipo: TipoMovimentoBem;
  readonly situacao: SituacaoMovimentoBem;
  readonly data: string;
  readonly origem: RefCentro;
  readonly destino: RefCentro | null;
  readonly destinoResponsavel: string | null;
  readonly terceiro: string | null;
  readonly retornoPrevisto: string | null;
  readonly termoNumero: string | null;
  readonly motivo: string;
  readonly valorVendaCent: number | null;
  readonly referencia: number | null;
  readonly solicitadoPor: string;
  readonly solicitadoEm: string;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
  readonly decisaoMotivo: string | null;
  readonly versao: number;
}

export interface LeituraInventarioRegistrada {
  readonly id: number;
  readonly codigo: string;
  readonly bem: {
    readonly id: number;
    readonly plaqueta: string;
    readonly descricao: string;
    readonly centro: number;
  } | null;
  readonly centroLido: number;
  readonly resultado: ResultadoLeituraInventario;
  readonly observacao: string | null;
  readonly lidoPor: string;
  readonly lidoEm: string;
}

export interface ResumoInventario {
  /** Bens esperados (ativos no escopo), lidos (leituras não repetidas de bens do escopo) e cada resultado. */
  readonly esperados: number;
  readonly leituras: number;
  readonly porResultado: Readonly<Record<ResultadoLeituraInventario, number>>;
  /** Esperados sem leitura (a divergência que o encerramento registra; nada é baixado sozinho). */
  readonly naoEncontrados: readonly {
    readonly bem: number;
    readonly plaqueta: string;
    readonly descricao: string;
    readonly centro: number;
  }[];
  /** Quantos não foram encontrados (a lista guardada no encerramento pode ser cortada: `listaCompleta`). */
  readonly naoEncontradosTotal: number;
  readonly listaCompleta: boolean;
}

export interface Inventario {
  readonly id: number;
  readonly descricao: string;
  readonly centro: RefCentro | null;
  readonly situacao: SituacaoInventario;
  readonly abertoPor: string;
  readonly abertoEm: string;
  readonly encerradoPor: string | null;
  readonly encerradoEm: string | null;
  /** W0-08: o cancelamento com motivo (as leituras feitas ficam visíveis). */
  readonly canceladoPor: string | null;
  readonly canceladoEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly resumo: ResumoInventario | null;
}

export interface DetalheInventario extends Inventario {
  readonly leituras: readonly LeituraInventarioRegistrada[];
  readonly resumo: ResumoInventario;
}

export interface ApoioPatrimonio {
  /**
   * Revisão W0-08: TODOS os grupos do cadastro, com `ativo` (o nome do bem de grupo inativo sai do cadastro); o combo
   * de escolha mostra só os ativos, mais o inativo que o bem já tem.
   */
  readonly grupos: readonly {
    readonly valor: GrupoBem;
    readonly rotulo: string;
    readonly vidaUtilMeses: number;
    readonly ativo: boolean;
  }[];
  readonly origens: readonly { readonly id: number; readonly nome: string; readonly depreciar: boolean }[];
  readonly tiposResponsavel: readonly { readonly id: number; readonly nome: string }[];
  readonly coeficientes: readonly {
    readonly id: number;
    readonly descricao: string;
    readonly percentual: number;
  }[];
  readonly centros: readonly (RefCentro & { readonly ativo: boolean })[];
  readonly empresas: readonly { readonly id: number; readonly nome: string }[];
  readonly parametros: readonly ParametrosDepreciacao[];
  readonly acoes: {
    readonly cadastrar: boolean;
    readonly calcular: boolean;
    readonly registrar: boolean;
    readonly aceitar: boolean;
    readonly baixar: boolean;
    readonly contar: boolean;
  };
  readonly liberacao: { readonly ligada: boolean };
  /** Cadastros genéricos do patrimônio (`patrimonio.<recurso>`) que o perfil consulta (`.ler`). */
  readonly cadastros: readonly string[];
}

/**
 * Cadastros genéricos do patrimônio (CRUD do M08, declarados no M54.1): os da ficha do bem (tela dos bens, aba
 * Cadastros) e os parâmetros (item Parâmetros do patrimônio).
 */
export const CADASTROS_PATRIMONIO_BENS = [
  'patrimonio.origemBem',
  'patrimonio.tipoResponsavelBem',
  'patrimonio.coeficienteDepreciacao',
] as const;
export const CADASTROS_PATRIMONIO_PARAMETROS = [
  'patrimonio.parametroPatrimonio',
  'patrimonio.parametroUsuarioPatrimonio',
] as const;

// ── Grupo do bem (W0-08, parte 4: cadastro SGH_PAT_GRUPO) ─────────────────────────────────────────────────────────────

/** O grupo do bem como está no cadastro do estabelecimento, com a contagem de bens que o usam. */
export interface GrupoBemCadastro {
  readonly codigo: GrupoBem;
  readonly nome: string;
  readonly vidaUtilMeses: number;
  /** Conta contábil do imobilizado do grupo (opcional, para a regra contábil). */
  readonly conta: string | null;
  readonly ativo: boolean;
  /** Veio da semente da IN RFB (GRUPOS_BEM). */
  readonly semente: boolean;
  readonly inativadoEm: string | null;
  readonly motivoInativacao: string | null;
  readonly versao: number;
  /** Bens cadastrados no grupo (com eles o grupo não se exclui: inativa). */
  readonly bens: number;
}

/** A versão anterior do grupo (retrato da linha substituída, só inclusão). */
export interface VersaoGrupoBem {
  readonly versao: number;
  readonly operacao: 'alteracao' | 'inativacao' | 'reativacao';
  readonly nome: string;
  readonly vidaUtilMeses: number;
  readonly conta: string | null;
  readonly ativo: boolean;
  readonly motivo: string;
  readonly por: string;
  readonly em: string;
}

/** Revisão W0-08: uma conta analítica e ativa do plano de contas, que o grupo do bem pode indicar. */
export interface ContaDoGrupoBem {
  readonly codigo: string;
  readonly nome: string;
}

/** A lista do cadastro de grupos, com as contas analíticas do plano para o combo da conta. */
export interface ListaGruposBem {
  readonly grupos: readonly GrupoBemCadastro[];
  readonly contas: readonly ContaDoGrupoBem[];
}

export interface GrupoBemDetalhe extends GrupoBemCadastro {
  readonly versoes: readonly VersaoGrupoBem[];
}

const motivoGrupo = textoObrigatorio(400, 'Informe o motivo.').pipe(
  z.string().min(5, 'O motivo precisa de ao menos 5 caracteres.'),
);
const camposGrupo = {
  nome: textoObrigatorio(80, 'Informe o nome do grupo.').pipe(z.string().min(2, 'Nome curto demais.')),
  vidaUtilMeses: z
    .number()
    .int()
    .min(1, 'Vida útil de 1 a 1.200 meses.')
    .max(1200, 'Vida útil de 1 a 1.200 meses.'),
  conta: opcional(30),
};

/** Incluir um grupo (o código não muda depois: os bens e as cotas o guardam). */
export const esquemaIncluirGrupoBem = z.object({ codigo: esquemaCodigoGrupoBem, ...camposGrupo }).strict();
export type IncluirGrupoBemEntrada = z.infer<typeof esquemaIncluirGrupoBem>;

/** Alterar pela versão lida, com motivo; a vida útil nova vale só para os bens e as cotas seguintes. */
export const esquemaAlterarGrupoBem = z
  .object({ versao: z.number().int().min(0), ...camposGrupo, motivo: motivoGrupo })
  .strict();
export type AlterarGrupoBemEntrada = z.infer<typeof esquemaAlterarGrupoBem>;

/** Inativar, reativar ou excluir (o nunca usado) pela versão lida, com motivo. */
export const esquemaMotivoGrupoBem = z
  .object({ versao: z.number().int().min(0), motivo: motivoGrupo })
  .strict();
export type MotivoGrupoBemEntrada = z.infer<typeof esquemaMotivoGrupoBem>;
