// Contratos da estrutura de custos e da coleta de estatísticas (M54, etapa 4: fatia F4; ficha, seções 4, 6, 7 e 8,
// regra 7 em preparação): cada centro de custo (TBCENCUS, lido onde está) classificado em produtivo, auxiliar ou
// administrativo, com a ordem do rateio sequencial e o critério (a estatística que reparte o custo do centro), e as
// estatísticas por centro e competência (paciente-dia, horas de sala, exames, requisições, colaboradores, leitos, m², kg
// de roupa, refeições), coletadas das fontes do banco (agregadas no banco, nunca linha de paciente) ou lançadas à mão.
// O custeio por absorção (F5) usa esta estrutura; aqui nada é rateado. Nenhum dado pessoal sai daqui.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

/** Classes do centro de custo no custeio por absorção (cap-07 §7.2; PNGC). */
export const CLASSES_CENTRO_CUSTO = ['produtivo', 'auxiliar', 'administrativo'] as const;
export type ClasseCentroCusto = (typeof CLASSES_CENTRO_CUSTO)[number];

export const ROTULOS_CLASSE_CENTRO: Readonly<Record<ClasseCentroCusto, string>> = {
  produtivo: 'Produtivo',
  auxiliar: 'Auxiliar',
  administrativo: 'Administrativo',
};

export const DESCRICOES_CLASSE_CENTRO: Readonly<Record<ClasseCentroCusto, string>> = {
  produtivo: 'Atende o paciente e gera receita (internação, UTI, centro cirúrgico, exames, ambulatório).',
  auxiliar:
    'Apoia os produtivos (lavanderia, nutrição, farmácia, manutenção); o custo é rateado pelo critério.',
  administrativo:
    'Administra o hospital (diretoria, financeiro, faturamento); o custo é rateado pelo critério.',
};

/** De onde vem a estatística coletada (cada fonte é uma consulta agregada por centro de custo e competência). */
export const FONTES_ESTATISTICA = [
  'censo',
  'internacoes',
  'cirurgias',
  'exames',
  'requisicoes',
  'colaboradores',
  'leitos',
  'manual',
] as const;
export type FonteEstatistica = (typeof FONTES_ESTATISTICA)[number];

export const ROTULOS_FONTE_ESTATISTICA: Readonly<Record<FonteEstatistica, string>> = {
  censo: 'Censo diário fechado',
  internacoes: 'Internações do período (estimativa)',
  cirurgias: 'Cirurgias registradas',
  exames: 'Exames lançados',
  requisicoes: 'Saídas de estoque por requisição',
  colaboradores: 'Colaboradores com vínculo no período',
  leitos: 'Leitos das acomodações',
  manual: 'Lançamento manual',
};

/**
 * Tipo de dado da estatística, pelos códigos do domínio de custos do banco (CTTIPODADO): 1 Lançamento (vale só na
 * competência), 2 Referência (vale da competência em diante, até ser trocada; por exemplo a área em m²).
 */
export const TIPOS_DADO_ESTATISTICA = { lancamento: 1, referencia: 2 } as const;
export type TipoDadoEstatistica = (typeof TIPOS_DADO_ESTATISTICA)[keyof typeof TIPOS_DADO_ESTATISTICA];

export interface DefinicaoEstatistica {
  readonly codigo: string;
  readonly rotulo: string;
  readonly unidade: string;
  /** A fonte da coleta automática; `manual` quando o banco não tem o dado (lançado pelo analista). */
  readonly fonte: FonteEstatistica;
  readonly tipoDado: TipoDadoEstatistica;
  /** Casas decimais mostradas (a quantidade é guardada em centésimos). */
  readonly casas: 0 | 2;
  readonly descricao: string;
}

/** Catálogo das estatísticas de custeio (ficha, seção 6: paciente-dia, m², kg de roupa, refeições, exames, horas de sala). */
export const ESTATISTICAS_CUSTO = [
  {
    codigo: 'pacienteDia',
    rotulo: 'Paciente-dia',
    unidade: 'paciente-dia',
    fonte: 'censo',
    tipoDado: 1,
    casas: 0,
    descricao:
      'Soma dos internados do censo diário fechado no mês, por acomodação; sem o censo do mês inteiro, estimada pelas internações do período.',
  },
  {
    codigo: 'horasSala',
    rotulo: 'Horas de sala cirúrgica',
    unidade: 'hora',
    fonte: 'cirurgias',
    tipoDado: 1,
    casas: 2,
    descricao: 'Duração das cirurgias do mês, pelo centro de custo da sala.',
  },
  {
    codigo: 'cirurgias',
    rotulo: 'Cirurgias',
    unidade: 'cirurgia',
    fonte: 'cirurgias',
    tipoDado: 1,
    casas: 0,
    descricao: 'Cirurgias do mês, pelo centro de custo da sala.',
  },
  {
    codigo: 'exames',
    rotulo: 'Exames realizados',
    unidade: 'exame',
    fonte: 'exames',
    tipoDado: 1,
    casas: 0,
    descricao: 'Exames lançados no mês e não suspensos, pelo centro de custo do lançamento.',
  },
  {
    codigo: 'requisicoes',
    rotulo: 'Requisições de material',
    unidade: 'requisição',
    fonte: 'requisicoes',
    tipoDado: 1,
    casas: 0,
    descricao: 'Saídas de estoque do mês, pelo centro de custo de destino.',
  },
  {
    codigo: 'colaboradores',
    rotulo: 'Colaboradores',
    unidade: 'colaborador',
    fonte: 'colaboradores',
    tipoDado: 1,
    casas: 0,
    descricao: 'Colaboradores com vínculo em algum dia do mês, pela lotação no centro de custo.',
  },
  {
    codigo: 'horasContratadas',
    rotulo: 'Horas semanais contratadas',
    unidade: 'hora',
    fonte: 'colaboradores',
    tipoDado: 1,
    casas: 0,
    descricao: 'Soma da carga semanal dos colaboradores com vínculo no mês, pela lotação.',
  },
  {
    codigo: 'leitos',
    rotulo: 'Leitos',
    unidade: 'leito',
    fonte: 'leitos',
    tipoDado: 2,
    casas: 0,
    descricao: 'Leitos das acomodações, pelo centro de custo da acomodação.',
  },
  {
    codigo: 'areaM2',
    rotulo: 'Área',
    unidade: 'm²',
    fonte: 'manual',
    tipoDado: 2,
    casas: 2,
    descricao: 'Área ocupada pelo centro; vale nas competências seguintes até ser trocada.',
  },
  {
    codigo: 'kgRoupa',
    rotulo: 'Roupa processada',
    unidade: 'kg',
    fonte: 'manual',
    tipoDado: 1,
    casas: 2,
    descricao: 'Quilos de roupa processados para o centro no mês (lançados pela rouparia).',
  },
  {
    codigo: 'refeicoes',
    rotulo: 'Refeições servidas',
    unidade: 'refeição',
    fonte: 'manual',
    tipoDado: 1,
    casas: 0,
    descricao: 'Refeições servidas ao centro no mês (lançadas pela nutrição).',
  },
] as const satisfies readonly DefinicaoEstatistica[];

export type CodigoEstatistica = (typeof ESTATISTICAS_CUSTO)[number]['codigo'];
export const CODIGOS_ESTATISTICA = ESTATISTICAS_CUSTO.map((e) => e.codigo) as unknown as readonly [
  CodigoEstatistica,
  ...CodigoEstatistica[],
];

export function definicaoEstatistica(codigo: string): DefinicaoEstatistica | undefined {
  return (ESTATISTICAS_CUSTO as readonly DefinicaoEstatistica[]).find((e) => e.codigo === codigo);
}

/** Competência no formato AAAA-MM. */
export const FORMATO_COMPETENCIA_CUSTOS = /^20\d{2}-(0[1-9]|1[0-2])$/;
export const esquemaCompetenciaCustos = z
  .string()
  .regex(FORMATO_COMPETENCIA_CUSTOS, 'Competência no formato AAAA-MM.');

const observacao = textoCp1252(400).pipe(z.string().trim());

// ── Estrutura ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ClassificacaoCentro {
  readonly classe: ClasseCentroCusto;
  readonly ordemRateio: number | null;
  readonly criterio: CodigoEstatistica | null;
  /** Unidade de mensuração da produção (código do cadastro de unidades de mensuração). */
  readonly unidadeMensuracao: number | null;
  readonly observacao: string | null;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface CentroCustoEstrutura {
  /** TBCENCUS.ID (a chave que o SGH_ guarda). */
  readonly id: number;
  /** TBCENCUS.COD (o código que os movimentos usam). */
  readonly codigo: number;
  readonly nome: string;
  readonly sigla: string | null;
  readonly ativo: boolean;
  /** A marca de produtivo do cadastro do centro (T/F; null quando não preenchida). */
  readonly produtivoCadastro: boolean | null;
  readonly classificacao: ClassificacaoCentro | null;
  /** A classe sugerida enquanto o centro não foi classificado (pela marca de produtivo do cadastro). */
  readonly sugestao: ClasseCentroCusto | null;
}

export const TIPOS_PENDENCIA_ESTRUTURA = [
  'sem-classe',
  'sem-produtivo',
  'ordem-repetida',
  'criterio-desconhecido',
  'unidade-desconhecida',
  'inativo-classificado',
] as const;
export type TipoPendenciaEstrutura = (typeof TIPOS_PENDENCIA_ESTRUTURA)[number];

export interface PendenciaEstrutura {
  readonly tipo: TipoPendenciaEstrutura;
  /** Bloqueia a apuração do mês (F5) enquanto não resolvida. */
  readonly bloqueia: boolean;
  readonly centros: readonly number[];
  readonly mensagem: string;
}

export interface ListaEstruturaCustos {
  readonly centros: readonly CentroCustoEstrutura[];
  readonly pendencias: readonly PendenciaEstrutura[];
  /** Ativos por classe (e os sem classe), com o total impresso. */
  readonly contagem: Readonly<Record<ClasseCentroCusto | 'semClasse', number>> & { readonly total: number };
  /** A sequência do rateio: auxiliares e administrativos pela ordem, depois os produtivos (que só recebem). */
  readonly sequencia: readonly { readonly id: number; readonly ordem: number; readonly criterio: string }[];
}

export const esquemaClassificarCentro = z
  .object({
    classe: z.enum(CLASSES_CENTRO_CUSTO),
    ordemRateio: z.number().int().min(1).max(999).nullable().default(null),
    criterio: z.enum(CODIGOS_ESTATISTICA).nullable().default(null),
    unidadeMensuracao: z.number().int().min(0).max(99_999).nullable().default(null),
    observacao: observacao.nullable().default(null),
    /** Versão lida (null: o centro ainda não tinha classificação). */
    versao: z.number().int().min(0).nullable(),
  })
  .strict()
  .superRefine((x, ctx) => {
    if (x.classe === 'produtivo') {
      if (x.ordemRateio !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['ordemRateio'],
          message: 'Centro produtivo não tem ordem de rateio.',
        });
      if (x.criterio !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['criterio'],
          message: 'Centro produtivo não tem critério de rateio.',
        });
    } else {
      if (x.ordemRateio === null)
        ctx.addIssue({
          code: 'custom',
          path: ['ordemRateio'],
          message: 'Informe a ordem do centro no rateio sequencial.',
        });
      if (x.criterio === null)
        ctx.addIssue({
          code: 'custom',
          path: ['criterio'],
          message: 'Informe a estatística que reparte o custo deste centro.',
        });
    }
  });
export type ClassificarCentro = z.infer<typeof esquemaClassificarCentro>;

// ── Estatísticas ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const ORIGENS_ESTATISTICA = ['coletada', 'manual'] as const;
export type OrigemEstatistica = (typeof ORIGENS_ESTATISTICA)[number];

export interface ValorEstatistica {
  readonly id: number;
  /** Quantidade com até 2 casas (guardada em centésimos). */
  readonly quantidade: number;
  readonly origem: OrigemEstatistica;
  readonly fonte: FonteEstatistica;
  readonly estimada: boolean;
  /** Competência de onde a referência veio (tipo 2 herdado de uma competência anterior); null quando é da própria. */
  readonly herdadaDe: string | null;
  readonly observacao: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface LinhaMatrizEstatisticas {
  readonly centro: number;
  readonly valores: Readonly<Partial<Record<CodigoEstatistica, ValorEstatistica>>>;
}

export interface ResumoFonteColeta {
  readonly fonte: FonteEstatistica;
  /** Grupos lidos (um por centro de custo do movimento). */
  readonly grupos: number;
  /** Centros que receberam valor. */
  readonly centros: number;
  /** Grupos cujo centro de custo não existe no cadastro (entram na conta como "sem centro"). */
  readonly semCentro: number;
  readonly estimada: boolean;
  readonly aviso: string | null;
}

export interface ColetaEstatisticas {
  readonly id: number;
  readonly competencia: string;
  readonly fontes: readonly ResumoFonteColeta[];
  /** Linhas gravadas e coletadas anteriores substituídas. */
  readonly gravadas: number;
  readonly substituidas: number;
  readonly duracaoMs: number;
  readonly coletadaPor: string;
  readonly coletadaEm: string;
}

export interface MatrizEstatisticas {
  readonly competencia: string;
  readonly linhas: readonly LinhaMatrizEstatisticas[];
  /** Total de cada estatística, com as parcelas por centro na própria matriz. */
  readonly totais: Readonly<Partial<Record<CodigoEstatistica, number>>>;
  readonly ultimaColeta: ColetaEstatisticas | null;
  readonly avisos: readonly string[];
}

export const esquemaConsultaEstatisticas = z.object({ competencia: esquemaCompetenciaCustos }).strict();
export type ConsultaEstatisticas = z.infer<typeof esquemaConsultaEstatisticas>;

export const esquemaColetarEstatisticas = z.object({ competencia: esquemaCompetenciaCustos }).strict();
export type ColetarEstatisticas = z.infer<typeof esquemaColetarEstatisticas>;

export const esquemaLancarEstatistica = z
  .object({
    competencia: esquemaCompetenciaCustos,
    /** TBCENCUS.ID. */
    centro: z.number().int().positive(),
    codigo: z.enum(CODIGOS_ESTATISTICA),
    quantidade: z
      .number()
      .min(0)
      .max(9_999_999_999)
      .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Até duas casas decimais.'),
    observacao: observacao.nullable().default(null),
  })
  .strict();
export type LancarEstatistica = z.infer<typeof esquemaLancarEstatistica>;

// ── Apoio da tela ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ApoioCustos {
  readonly classes: readonly {
    readonly valor: ClasseCentroCusto;
    readonly rotulo: string;
    readonly descricao: string;
  }[];
  readonly estatisticas: readonly DefinicaoEstatistica[];
  readonly fontes: readonly { readonly valor: FonteEstatistica; readonly rotulo: string }[];
  /** Domínios do banco: tipos de dado, unidades de mensuração e destinos de exportação. */
  readonly tiposDado: readonly { readonly id: number; readonly nome: string }[];
  readonly unidades: readonly { readonly codigo: number; readonly nome: string }[];
  readonly gruposExportacao: readonly {
    readonly id: number;
    readonly nome: string;
    readonly ativo: boolean;
  }[];
  readonly acoes: { readonly editar: boolean; readonly registrarEstatistica: boolean };
  readonly liberacao: { readonly ligada: boolean };
}
