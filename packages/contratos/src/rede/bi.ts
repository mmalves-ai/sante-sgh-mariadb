// Contratos do BI consolidado da Rede e do registro de serviços compartilhados (M57, etapa 3; ficha, seções 7 e 8,
// regras 8 a 12; cap-07 §7.7.4). O consolidado é a soma dos numeradores sobre a soma dos denominadores, com a MESMA
// ficha técnica em todos os estabelecimentos e as parcelas de cada um à vista (regra 8); nada de pessoa sai daqui (só
// contagens agregadas por mês e estabelecimento). A diretoria da Rede vê o consolidado sem nenhuma permissão do
// prontuário (regra 10). Os serviços compartilhados são um registro sem compromisso de escopo (regra 11; DP-14).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_INDICADOR,
  POLARIDADES_INDICADOR,
  REGUAS_RECEITA,
  UNIDADES_INDICADOR,
} from '../relatorio/indicadores.js';

/** Chave de liberação do BI consolidado da Rede em SGH_CFG_LIBERACAO (ficha, seção 12). */
export const CHAVE_LIBERACAO_BI_REDE = 'rede.bi';
/**
 * Chave do pseudônimo comum entre os estabelecimentos no data mart (regra 9): só com a DP-42 registrada, e ligada em
 * TODOS os estabelecimentos da rede; senão, pseudônimo por estabelecimento.
 */
export const CHAVE_PSEUDONIMO_COMUM_REDE = 'rede.pseudonimoComum';

/** Código de estabelecimento (ARQ-1): minúsculas e dígitos, 2 a 10. */
const codigoEstabelecimento = z.string().regex(/^[a-z][a-z0-9]{1,9}$/);
/** Mês "AAAA-MM" (01 a 12). */
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export const esquemaConsultaBiRede = z
  .object({
    de: z.string().regex(MES).optional(),
    ate: z.string().regex(MES).optional(),
  })
  .strict();
export type ConsultaBiRede = z.infer<typeof esquemaConsultaBiRede>;

export const PAINEIS_BI_REDE = ['indicadores', 'operacional', 'financeiro'] as const;
export type PainelBiRede = (typeof PAINEIS_BI_REDE)[number];

export const MOTIVOS_RECUSA_BI_REDE = [
  'media-de-taxas',
  'ficha-diferente',
  'periodo-diferente',
  'sem-parcelas',
] as const;

/** Um estabelecimento da rede no consolidado: incluído, ou fora com o motivo (chave desligada, banco fora). */
export const esquemaEstabelecimentoBiRede = z.object({
  codigo: codigoEstabelecimento,
  nome: z.string(),
  situacao: z.enum(['incluido', 'desligado', 'indisponivel']),
  motivo: z.string().nullable(),
  dadosAte: z.string().nullable(),
  /** Último dia com movimento (AAAA-MM-DD) do estabelecimento; null: sem movimento ou fora. */
  ultimoMovimento: z.string().nullable(),
});
export type EstabelecimentoBiRede = z.infer<typeof esquemaEstabelecimentoBiRede>;

/** A parcela de um estabelecimento (o que ele mediu). */
export const esquemaParcelaBiRede = z.object({
  estabelecimento: codigoEstabelecimento,
  numerador: z.number(),
  denominador: z.number().nullable(),
  valor: z.number().nullable(),
  parcial: z.boolean(),
});

/** Um valor consolidado da Rede, com as parcelas e a conta impressa. */
export const esquemaValorConsolidadoRede = z.object({
  periodo: z.string(),
  numerador: z.number(),
  denominador: z.number().nullable(),
  valor: z.number().nullable(),
  parcial: z.boolean(),
  parcelas: z.array(esquemaParcelaBiRede),
  /** A conta à vista: "(2 + 10) ÷ (10 + 1.000) × 100 = 1,19". */
  conta: z.string(),
});
export type ValorConsolidadoRede = z.infer<typeof esquemaValorConsolidadoRede>;

export const esquemaRecusaBiRede = z.object({
  motivo: z.enum(MOTIVOS_RECUSA_BI_REDE),
  mensagem: z.string(),
});
export type RecusaBiRede = z.infer<typeof esquemaRecusaBiRede>;

export const esquemaFichaBiRede = z.object({
  codigo: z.enum(CODIGOS_INDICADOR),
  nome: z.string(),
  formula: z.string(),
  numerador: z.string(),
  denominador: z.string().nullable(),
  unidade: z.enum(UNIDADES_INDICADOR),
  polaridade: z.enum(POLARIDADES_INDICADOR),
  versao: z.number().int().positive(),
  limitacoes: z.array(z.string()),
});

export const esquemaIndicadorBiRede = z.object({
  ficha: esquemaFichaBiRede,
  /** O último mês fechado consolidado (null sem valor ou com a recusa). */
  ultimo: esquemaValorConsolidadoRede.nullable(),
  recusa: esquemaRecusaBiRede.nullable(),
});
export type IndicadorBiRede = z.infer<typeof esquemaIndicadorBiRede>;

export const MODOS_PSEUDONIMO_REDE = ['por-estabelecimento', 'comum'] as const;
export type ModoPseudonimoRede = (typeof MODOS_PSEUDONIMO_REDE)[number];

export const esquemaBiRede = z.object({
  periodo: z.object({ de: z.string(), ate: z.string() }),
  estabelecimentos: z.array(esquemaEstabelecimentoBiRede),
  indicadores: z.array(esquemaIndicadorBiRede),
  /** O modo do pseudônimo do paciente no data mart da Rede (regra 9; DP-42). */
  pseudonimo: z.enum(MODOS_PSEUDONIMO_REDE),
  notas: z.array(z.string()),
  geradoEm: z.string(),
});
export type BiRede = z.infer<typeof esquemaBiRede>;

export const esquemaSerieIndicadorBiRede = z.object({
  ficha: esquemaFichaBiRede,
  periodo: z.object({ de: z.string(), ate: z.string() }),
  estabelecimentos: z.array(esquemaEstabelecimentoBiRede),
  valores: z.array(esquemaValorConsolidadoRede),
  recusa: esquemaRecusaBiRede.nullable(),
  notas: z.array(z.string()),
});
export type SerieIndicadorBiRede = z.infer<typeof esquemaSerieIndicadorBiRede>;

const valorSerie = z.object({
  periodo: z.string(),
  valor: z.number().nullable(),
  numerador: z.number().nullable(),
  denominador: z.number().nullable(),
});

export const esquemaSeriePainelBiRede = z.object({
  codigo: z.string(),
  rotulo: z.string(),
  unidade: z.enum(['percentual', 'dias', 'razao', 'quantidade', 'reais']),
  regua: z.enum(REGUAS_RECEITA).nullable(),
  valores: z.array(valorSerie.extend({ parcial: z.boolean() })),
  parcelas: z.array(z.object({ estabelecimento: codigoEstabelecimento, valores: z.array(valorSerie) })),
  recusa: esquemaRecusaBiRede.nullable(),
});
export type SeriePainelBiRede = z.infer<typeof esquemaSeriePainelBiRede>;

export const esquemaPainelBiRede = z.object({
  painel: z.enum(['operacional', 'financeiro']),
  periodo: z.object({ de: z.string(), ate: z.string() }),
  estabelecimentos: z.array(esquemaEstabelecimentoBiRede),
  series: z.array(esquemaSeriePainelBiRede),
  notas: z.array(z.string()),
});
export type PainelConsolidadoRede = z.infer<typeof esquemaPainelBiRede>;

// ── Serviços compartilhados (regra 11; DP-14) ────────────────────────────────────────────────────────────────────

export const AREAS_SERVICO_COMPARTILHADO = [
  'catalogo',
  'fornecedores',
  'compras',
  'laudos',
  'outro',
] as const;
export type AreaServicoCompartilhado = (typeof AREAS_SERVICO_COMPARTILHADO)[number];
export const SITUACOES_SERVICO_COMPARTILHADO = ['registrada', 'em_estudo', 'adotada', 'descartada'] as const;
export type SituacaoServicoCompartilhado = (typeof SITUACOES_SERVICO_COMPARTILHADO)[number];

/** Teto da página da lista de serviços compartilhados. */
export const TETO_PAGINA_SERVICOS_REDE = 50;
/**
 * Quantos dos registros mais recentes a lista da Rede consegue paginar (o teto de leitura por banco do repositório,
 * TETO_SERVICOS_POR_BANCO: a junção dos N mais recentes de cada banco só é exata até N). Passou disso, a lista avisa
 * que mostra só os mais recentes e pede para refinar pelos filtros ou pela busca.
 */
export const TETO_LISTA_SERVICOS_REDE = 500;

const titulo = textoCp1252(120).pipe(z.string().trim().min(3, 'Escreva o título (3 a 120 letras).'));
const descricao = textoCp1252(1000).pipe(z.string().trim());
const envolvidos = z
  .array(codigoEstabelecimento)
  .min(1, 'Escolha ao menos um estabelecimento.')
  .max(10)
  .refine((xs) => new Set(xs).size === xs.length, 'Estabelecimento repetido.')
  // A coluna guarda os códigos separados por vírgula (120 bytes).
  .refine((xs) => xs.join(',').length <= 120, 'Estabelecimentos demais.');

export const esquemaNovoServicoCompartilhado = z
  .object({
    area: z.enum(AREAS_SERVICO_COMPARTILHADO),
    titulo,
    descricao: descricao.optional(),
    estabelecimentos: envolvidos,
  })
  .strict();
export type NovoServicoCompartilhado = z.infer<typeof esquemaNovoServicoCompartilhado>;

export const esquemaAlterarServicoCompartilhado = z
  .object({
    area: z.enum(AREAS_SERVICO_COMPARTILHADO).optional(),
    titulo: titulo.optional(),
    descricao: descricao.optional(),
    estabelecimentos: envolvidos.optional(),
    situacao: z.enum(SITUACOES_SERVICO_COMPARTILHADO).optional(),
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0, 'Nada a alterar.');
export type AlterarServicoCompartilhado = z.infer<typeof esquemaAlterarServicoCompartilhado>;

export const esquemaConsultaServicosRede = z
  .object({
    area: z.enum(AREAS_SERVICO_COMPARTILHADO).optional(),
    situacao: z.enum(SITUACOES_SERVICO_COMPARTILHADO).optional(),
    /** Parte do título ou da descrição (sem diferença de maiúsculas). */
    busca: textoCp1252(60).pipe(z.string().trim()).optional(),
    pagina: z.coerce.number().int().min(1).max(TETO_LISTA_SERVICOS_REDE).default(1),
    porPagina: z.coerce.number().int().min(1).max(TETO_PAGINA_SERVICOS_REDE).default(20),
  })
  .strict()
  .refine((x) => (x.pagina - 1) * x.porPagina < TETO_LISTA_SERVICOS_REDE, {
    message: `A lista mostra só os ${TETO_LISTA_SERVICOS_REDE} registros mais recentes; refine pelos filtros ou pela busca.`,
    path: ['pagina'],
  });
export type ConsultaServicosRede = z.infer<typeof esquemaConsultaServicosRede>;

export const esquemaServicoCompartilhado = z.object({
  /** Onde o registro mora (o banco do estabelecimento de quem registrou; cada um no seu banco, DP-14). */
  estabelecimento: codigoEstabelecimento,
  id: z.number().int().positive(),
  area: z.enum(AREAS_SERVICO_COMPARTILHADO),
  titulo: z.string(),
  descricao: z.string().nullable(),
  /** Os estabelecimentos envolvidos na oportunidade. */
  estabelecimentos: z.array(z.string()),
  situacao: z.enum(SITUACOES_SERVICO_COMPARTILHADO),
  registradoPor: z.string(),
  registradoEm: z.string(),
  atualizadoPor: z.string().nullable(),
  atualizadoEm: z.string().nullable(),
});
export type ServicoCompartilhado = z.infer<typeof esquemaServicoCompartilhado>;

export const esquemaListaServicosRede = z.object({
  itens: z.array(esquemaServicoCompartilhado),
  /** O total que a lista consegue paginar (no máximo TETO_LISTA_SERVICOS_REDE). */
  total: z.number().int().nonnegative(),
  /** Havia mais registros do que o teto: a lista mostra só os mais recentes (refinar pelos filtros ou pela busca). */
  truncado: z.boolean(),
  /** Os estabelecimentos da rede (para os envolvidos) e os que não responderam (a lista vem sem eles). */
  estabelecimentos: z.array(z.object({ codigo: codigoEstabelecimento, nome: z.string() })),
  foraDoAr: z.array(codigoEstabelecimento),
});
export type ListaServicosRede = z.infer<typeof esquemaListaServicosRede>;
