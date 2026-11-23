// Rouparia e lavanderia (ficha do M55, fatia F2; seções 4, 6, 7 e 8; regra 4; cap-06a §6.3 "Rouparia"; cap-07 §7.2
// "Coleta de estatísticas"): o enxoval (peças e kits, com o peso e o custo de reposição), a cota por setor, a coleta da
// roupa suja pesada por setor, o envio à lavanderia (própria ou terceirizada) e o retorno conferido em quilos e peças
// (diferença acima da tolerância vira ocorrência para o fornecedor), a entrega da roupa limpa ao setor, as perdas e o
// inventário. O peso coletado por setor e por dia é a estatística "kg de roupa" do custeio (M54). Recurso só do novo:
// o sistema anterior não tem tabela de rouparia (tudo em SGH_HOT_ROUPA_*). Nasce desligado (chave `rouparia`, POL-3).
// Vocabulário do produto. Validadas na tela, na API e na gravação (o mesmo Zod).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco, idBancoTexto } from '../validacao/id-banco.js';

export const CHAVE_LIBERACAO_ROUPARIA = 'rouparia';
/** Teto de linhas das listas da rouparia (paginadas pela chave). */
export const TETO_ROUPARIA = 200;
/** Período máximo da lista de movimentos, em dias. */
export const PERIODO_MAXIMO_MOVIMENTOS_DIAS = 62;
/** Período máximo da estatística e dos indicadores, em dias. */
export const PERIODO_MAXIMO_INDICADORES_DIAS = 366;

// ── Vocabulário ─────────────────────────────────────────────────────────────────────────────────

/** Os movimentos (SGH_HOT_ROUPA_MOVIMENTO.TIPO). */
export const TIPOS_MOVIMENTO_ROUPA = [
  { codigo: 'coleta', rotulo: 'Coleta de roupa suja no setor (pesada)' },
  { codigo: 'envio', rotulo: 'Envio à lavanderia' },
  { codigo: 'retorno', rotulo: 'Retorno da lavanderia (conferido com o envio)' },
  { codigo: 'entrega', rotulo: 'Entrega de roupa limpa ao setor' },
  { codigo: 'perda', rotulo: 'Perda ou baixa de peças' },
  { codigo: 'inventario', rotulo: 'Inventário (contagem das peças)' },
] as const;
export type TipoMovimentoRoupa = (typeof TIPOS_MOVIMENTO_ROUPA)[number]['codigo'];
export const CODIGOS_TIPO_MOVIMENTO_ROUPA = TIPOS_MOVIMENTO_ROUPA.map((t) => t.codigo) as [
  TipoMovimentoRoupa,
  ...TipoMovimentoRoupa[],
];

/** Situações do movimento: o envio fica "registrado" até o retorno ("retornado"). */
export const SITUACOES_MOVIMENTO_ROUPA = [
  { codigo: 'registrado', rotulo: 'Registrado' },
  { codigo: 'retornado', rotulo: 'Retornou da lavanderia' },
  { codigo: 'cancelado', rotulo: 'Cancelado' },
] as const;
export type SituacaoMovimentoRoupa = (typeof SITUACOES_MOVIMENTO_ROUPA)[number]['codigo'];

export const CATEGORIAS_PECA_ROUPA = [
  { codigo: 'lencol', rotulo: 'Lençol' },
  { codigo: 'fronha', rotulo: 'Fronha' },
  { codigo: 'cobertor', rotulo: 'Cobertor ou manta' },
  { codigo: 'camisola', rotulo: 'Camisola ou pijama de paciente' },
  { codigo: 'toalha', rotulo: 'Toalha' },
  { codigo: 'campo-cirurgico', rotulo: 'Campo cirúrgico' },
  { codigo: 'avental-cirurgico', rotulo: 'Avental cirúrgico' },
  { codigo: 'compressa', rotulo: 'Compressa' },
  { codigo: 'uniforme', rotulo: 'Uniforme privativo' },
  { codigo: 'kit', rotulo: 'Kit (conjunto de peças)' },
  { codigo: 'outro', rotulo: 'Outra peça' },
] as const;
export type CategoriaPecaRoupa = (typeof CATEGORIAS_PECA_ROUPA)[number]['codigo'];
const CODIGOS_CATEGORIA = CATEGORIAS_PECA_ROUPA.map((c) => c.codigo) as [
  CategoriaPecaRoupa,
  ...CategoriaPecaRoupa[],
];

export const MOTIVOS_PERDA_ROUPA = [
  { codigo: 'extravio', rotulo: 'Extravio (não voltou)' },
  { codigo: 'dano', rotulo: 'Dano (rasgo, furo)' },
  { codigo: 'mancha', rotulo: 'Mancha que não sai (condenada)' },
  { codigo: 'desgaste', rotulo: 'Fim da vida útil' },
  { codigo: 'evasao', rotulo: 'Levada pelo paciente ou acompanhante' },
  { codigo: 'outro', rotulo: 'Outro motivo' },
] as const;
export type MotivoPerdaRoupa = (typeof MOTIVOS_PERDA_ROUPA)[number]['codigo'];
const CODIGOS_MOTIVO_PERDA = MOTIVOS_PERDA_ROUPA.map((m) => m.codigo) as [
  MotivoPerdaRoupa,
  ...MotivoPerdaRoupa[],
];

export const LAVANDERIAS = [
  { codigo: 'propria', rotulo: 'Lavanderia própria' },
  { codigo: 'terceirizada', rotulo: 'Lavanderia terceirizada' },
] as const;
export type Lavanderia = (typeof LAVANDERIAS)[number]['codigo'];
const CODIGOS_LAVANDERIA = LAVANDERIAS.map((l) => l.codigo) as [Lavanderia, ...Lavanderia[]];

/** O que cada movimento pede (a regra pura e a tela usam a mesma tabela). */
export const EXIGENCIAS_MOVIMENTO_ROUPA: Readonly<
  Record<
    TipoMovimentoRoupa,
    {
      readonly setor: 'obrigatorio' | 'opcional' | 'proibido';
      readonly peso: 'obrigatorio' | 'opcional';
      readonly pecas: 'obrigatorio' | 'opcional';
      readonly remessa: boolean;
      readonly lavanderia: boolean;
      readonly motivo: boolean;
    }
  >
> = {
  coleta: {
    setor: 'obrigatorio',
    peso: 'obrigatorio',
    pecas: 'opcional',
    remessa: false,
    lavanderia: false,
    motivo: false,
  },
  envio: {
    setor: 'proibido',
    peso: 'obrigatorio',
    pecas: 'opcional',
    remessa: false,
    lavanderia: true,
    motivo: false,
  },
  retorno: {
    setor: 'proibido',
    peso: 'obrigatorio',
    pecas: 'opcional',
    remessa: true,
    lavanderia: false,
    motivo: false,
  },
  entrega: {
    setor: 'obrigatorio',
    peso: 'opcional',
    pecas: 'obrigatorio',
    remessa: false,
    lavanderia: false,
    motivo: false,
  },
  perda: {
    setor: 'opcional',
    peso: 'opcional',
    pecas: 'obrigatorio',
    remessa: false,
    lavanderia: false,
    motivo: true,
  },
  inventario: {
    setor: 'opcional',
    peso: 'opcional',
    pecas: 'obrigatorio',
    remessa: false,
    lavanderia: false,
    motivo: false,
  },
};

// ── Recusas (o texto que a tela mostra) ───────────────────────────────────────────────────────────

export const MENSAGENS_ROUPARIA = {
  desligado:
    'A rouparia ainda não foi liberada neste estabelecimento: as telas ficam em consulta. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.',
  'setor-obrigatorio': 'Escolha o setor do movimento.',
  'setor-nao-se-aplica': 'O envio e o retorno da lavanderia são da rouparia central: não escolha setor.',
  'setor-inativo': 'O setor escolhido não existe ou está inativo.',
  'peso-obrigatorio': 'Informe o peso, em quilos.',
  'pecas-obrigatorias': 'Informe as peças e as quantidades.',
  'peca-inexistente': 'Uma das peças não está no cadastro do enxoval ou está inativa.',
  'peca-repetida': 'A mesma peça aparece duas vezes: some as quantidades numa linha só.',
  'quantidade-zero': 'Só o inventário aceita quantidade zero.',
  'remessa-obrigatoria': 'Escolha o envio à lavanderia que está retornando.',
  'remessa-inexistente': 'O envio escolhido não existe neste estabelecimento.',
  'remessa-ja-retornada': 'Este envio já tem o retorno registrado.',
  'remessa-cancelada': 'Este envio foi cancelado.',
  'retorno-antes-do-envio': 'O retorno não pode ter data anterior à do envio.',
  'lavanderia-obrigatoria': 'Escolha a lavanderia (própria ou terceirizada).',
  'fornecedor-obrigatorio': 'A lavanderia terceirizada pede o fornecedor.',
  'fornecedor-inexistente': 'O fornecedor escolhido não existe no cadastro.',
  'motivo-obrigatorio': 'Informe o motivo da perda.',
  'data-futura': 'A data do movimento não pode ser futura.',
  'data-antiga': 'O movimento só pode ser registrado com data dos últimos 31 dias.',
  'chave-de-outro-movimento': 'A chave do pedido já foi usada em outro movimento.',
  'movimento-inexistente': 'O movimento não existe neste estabelecimento.',
  'movimento-cancelado': 'O movimento já está cancelado.',
  'envio-com-retorno': 'O envio tem o retorno registrado: cancele o retorno antes.',
  'fora-do-prazo-de-cancelamento':
    'O prazo para cancelar este movimento já passou: registre um movimento de correção.',
  'versao-desatualizada': 'O registro mudou desde que foi aberto: atualize a tela e confira.',
  'nome-duplicado': 'Já existe uma peça ativa com este nome.',
  'kit-sem-composicao': 'O kit precisa de pelo menos uma peça na composição.',
  'kit-dentro-de-kit': 'A composição de um kit só leva peças, não outros kits.',
  'composicao-so-de-kit': 'Só a categoria kit tem composição.',
} as const;
export type CodigoRecusaRouparia = Exclude<keyof typeof MENSAGENS_ROUPARIA, 'desligado'>;

// ── Entradas ─────────────────────────────────────────────────────────────────────────────────────

const id = idBanco;
const idSgh = idBanco;
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const opcional = (max: number) =>
  livre(max)
    .nullable()
    .default(null)
    .transform((t) => (t ? t : null));
const chave = z.string().regex(/^[A-Za-z0-9._:-]{8,80}$/, 'Chave do pedido inválida.');
/** Quilos com até 3 casas decimais (a balança da rouparia). */
export const esquemaPesoKg = z
  .number()
  .positive('O peso tem de ser maior que zero.')
  .max(99_999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, {
    message: 'No máximo 3 casas decimais.',
  });

export const esquemaItemRoupa = z
  .object({ peca: idSgh, quantidade: z.number().int().min(0).max(99_999) })
  .strict();
export type ItemRoupaEntrada = z.infer<typeof esquemaItemRoupa>;

/** POST /api/hotelaria/rouparia/movimentos: um movimento da rouparia. */
export const esquemaRegistrarMovimentoRoupa = z
  .object({
    chave,
    tipo: z.enum(CODIGOS_TIPO_MOVIMENTO_ROUPA),
    data: dataIso,
    centroCusto: id.nullable().default(null),
    remessa: idSgh.nullable().default(null),
    pesoKg: esquemaPesoKg.nullable().default(null),
    itens: z.array(esquemaItemRoupa).max(60).default([]),
    lavanderia: z.enum(CODIGOS_LAVANDERIA).nullable().default(null),
    fornecedor: id.nullable().default(null),
    motivoPerda: z.enum(CODIGOS_MOTIVO_PERDA).nullable().default(null),
    observacao: opcional(200),
  })
  .strict();
export type RegistrarMovimentoRoupaEntrada = z.infer<typeof esquemaRegistrarMovimentoRoupa>;

/** POST /api/hotelaria/rouparia/movimentos/:id/cancelamento. */
export const esquemaCancelarMovimentoRoupa = z
  .object({
    versaoVista: z.number().int().positive(),
    motivo: livre(200).pipe(z.string().min(5, 'Explique o motivo do cancelamento.')),
  })
  .strict();
export type CancelarMovimentoRoupaEntrada = z.infer<typeof esquemaCancelarMovimentoRoupa>;

/** POST/PUT /api/hotelaria/rouparia/pecas: a peça ou o kit do enxoval. */
export const esquemaPecaRoupa = z
  .object({
    nome: livre(60).pipe(z.string().min(3, 'Informe o nome da peça.')),
    categoria: z.enum(CODIGOS_CATEGORIA),
    pesoGramas: z.number().int().min(10).max(20_000),
    /** Custo de reposição, em centavos (o índice de perda em reais). */
    custoReposicaoCentavos: z.number().int().min(0).max(10_000_000).nullable().default(null),
    composicao: z
      .array(z.object({ peca: idSgh, quantidade: z.number().int().min(1).max(99) }).strict())
      .max(20)
      .default([]),
    ativa: z.boolean().default(true),
    versaoVista: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type PecaRoupaEntrada = z.infer<typeof esquemaPecaRoupa>;

/** PUT /api/hotelaria/rouparia/cotas: a cota (o par) de cada peça no setor; zero tira a cota. */
export const esquemaCotasSetor = z
  .object({
    centroCusto: id,
    cotas: z
      .array(z.object({ peca: idSgh, quantidade: z.number().int().min(0).max(9_999) }).strict())
      .min(1)
      .max(60),
  })
  .strict();
export type CotasSetorEntrada = z.infer<typeof esquemaCotasSetor>;

/** GET /api/hotelaria/rouparia/movimentos?de=&ate=&tipo=&centroCusto=&antesDe= */
export const esquemaFiltroMovimentosRoupa = z
  .object({
    de: dataIso,
    ate: dataIso,
    tipo: z.enum(CODIGOS_TIPO_MOVIMENTO_ROUPA).nullable().default(null),
    centroCusto: idBancoTexto.nullable().default(null),
    antesDe: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
  })
  .strict()
  .refine((f) => f.ate >= f.de && diasEntre(f.de, f.ate) <= PERIODO_MAXIMO_MOVIMENTOS_DIAS, {
    message: `Consulte no máximo ${PERIODO_MAXIMO_MOVIMENTOS_DIAS} dias, com o fim depois do início.`,
    path: ['ate'],
  });
export type FiltroMovimentosRoupa = z.infer<typeof esquemaFiltroMovimentosRoupa>;

/** GET /api/hotelaria/rouparia/indicadores?de=&ate= (também a estatística de kg por setor e dia). */
export const esquemaPeriodoRouparia = z
  .object({ de: dataIso, ate: dataIso })
  .strict()
  .refine((f) => f.ate >= f.de && diasEntre(f.de, f.ate) <= PERIODO_MAXIMO_INDICADORES_DIAS, {
    message: `Consulte no máximo ${PERIODO_MAXIMO_INDICADORES_DIAS} dias, com o fim depois do início.`,
    path: ['ate'],
  });
export type PeriodoRouparia = z.infer<typeof esquemaPeriodoRouparia>;

export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────

export interface PecaRoupa {
  readonly id: number;
  readonly nome: string;
  readonly categoria: CategoriaPecaRoupa;
  readonly pesoGramas: number;
  readonly custoReposicaoCentavos: number | null;
  readonly composicao: readonly { readonly peca: number; readonly quantidade: number }[];
  readonly ativa: boolean;
  readonly versao: number;
}

export interface CotaRoupa {
  readonly centroCusto: number;
  readonly peca: number;
  readonly quantidade: number;
  readonly versao: number;
}

export interface ItemMovimentoRoupa {
  readonly peca: number;
  readonly quantidade: number;
}

export interface MovimentoRoupa {
  readonly id: number;
  readonly tipo: TipoMovimentoRoupa;
  readonly data: string;
  readonly em: string;
  readonly centroCusto: number | null;
  readonly remessa: number | null;
  readonly pesoKg: number | null;
  readonly pecas: number;
  readonly itens: readonly ItemMovimentoRoupa[];
  readonly lavanderia: Lavanderia | null;
  readonly fornecedor: number | null;
  readonly motivoPerda: MotivoPerdaRoupa | null;
  /** Retorno: a diferença para o envio (kg e %), e se passou da tolerância (ocorrência para o fornecedor). */
  readonly diferencaKg: number | null;
  readonly diferencaPct: number | null;
  readonly ocorrencia: boolean;
  readonly observacao: string | null;
  readonly situacao: SituacaoMovimentoRoupa;
  readonly por: string;
  readonly canceladoPor: string | null;
  readonly canceladoEm: string | null;
  readonly motivoCancelamento: string | null;
  readonly versao: number;
}

/** A conferência do retorno com o envio (regra do manual: diferença acima da tolerância vira ocorrência). */
export interface ConferenciaRetornoRoupa {
  readonly pesoEnviadoKg: number;
  readonly pesoRetornadoKg: number;
  readonly diferencaKg: number;
  readonly diferencaPct: number;
  readonly toleranciaPct: number;
  readonly pecasFaltando: readonly {
    readonly peca: number;
    readonly enviadas: number;
    readonly retornadas: number;
    readonly faltam: number;
  }[];
  readonly ocorrencia: boolean;
  readonly motivos: readonly string[];
}

/** Uma linha da estatística de custeio: kg coletados por setor e por dia (regra 4). */
export interface KgSetorDia {
  readonly data: string;
  readonly centroCusto: number;
  readonly kg: number;
  readonly coletas: number;
}

/** O total de kg do setor no período, com as parcelas por dia (a conta impressa). */
export interface KgSetorPeriodo {
  readonly centroCusto: number;
  readonly kg: number;
  readonly coletas: number;
  readonly dias: readonly { readonly data: string; readonly kg: number }[];
}

export interface IndicadorComParcelas {
  /** null quando o denominador é zero (sem dado no período). */
  readonly valor: number | null;
  readonly numerador: number;
  readonly denominador: number;
  readonly conta: string;
}

export interface IndicadoresRouparia {
  readonly de: string;
  readonly ate: string;
  readonly kgColetados: number;
  readonly kgEnviados: number;
  readonly kgRetornados: number;
  readonly pacientesDia: number;
  /** kg de roupa por paciente-dia = kg coletados ÷ pacientes-dia. */
  readonly kgPorPacienteDia: IndicadorComParcelas;
  /** Índice de perda (%) = peças perdidas ÷ peças em circulação (último inventário de cada local) × 100. */
  readonly indicePerda: IndicadorComParcelas;
  /** Custo da lavanderia por paciente-dia (R$) = kg enviados × preço do kg ÷ pacientes-dia. */
  readonly custoPorPacienteDia: IndicadorComParcelas & { readonly precoKgCentavos: number };
  /** Retornos com diferença acima da tolerância (ocorrências para o fornecedor). */
  readonly ocorrencias: number;
  readonly retornos: number;
}

/** A situação do setor diante da cota: o estimado no setor e a reposição sugerida, por peça. */
export interface SituacaoCotaSetor {
  readonly centroCusto: number;
  readonly inventarioEm: string | null;
  readonly itens: readonly {
    readonly peca: number;
    readonly cota: number;
    readonly estimado: number;
    readonly reposicao: number;
    readonly conta: string;
  }[];
}

/** Envio aberto: aguardando o retorno, com o atraso pelo prazo do parâmetro. */
export interface EnvioAberto {
  readonly id: number;
  readonly data: string;
  readonly em: string;
  readonly pesoKg: number;
  readonly pecas: number;
  readonly lavanderia: Lavanderia | null;
  readonly fornecedor: number | null;
  readonly horasDesdeEnvio: number;
  readonly atrasado: boolean;
}
