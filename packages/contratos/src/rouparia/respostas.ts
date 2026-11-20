// Respostas da API da rouparia e lavanderia (M55, fatia F2) em Zod, para a tela validar o que recebe. Os tipos seguem as
// interfaces de `rouparia.ts` (o servidor monta as respostas com elas); o `satisfies` abaixo prende os dois.
import { z } from 'zod';
import { esquemaGravacaoAgenda } from '../agenda/respostas.js';
import {
  CATEGORIAS_PECA_ROUPA,
  type CotaRoupa,
  type EnvioAberto,
  type IndicadoresRouparia,
  type KgSetorDia,
  type KgSetorPeriodo,
  LAVANDERIAS,
  MOTIVOS_PERDA_ROUPA,
  type MovimentoRoupa,
  type PecaRoupa,
  SITUACOES_MOVIMENTO_ROUPA,
  type SituacaoCotaSetor,
  TIPOS_MOVIMENTO_ROUPA,
} from './rouparia.js';

const n = z.number();
const txt = z.string();
const nul = <T extends z.ZodTypeAny>(t: T) => t.nullable();
const codigos = <T extends readonly { codigo: string }[]>(l: T) =>
  z.enum(l.map((x) => x.codigo) as [T[number]['codigo'], ...T[number]['codigo'][]]);

const item = z.object({ peca: n, quantidade: n });

export const esquemaPecaRoupaResposta = z.object({
  id: n,
  nome: txt,
  categoria: codigos(CATEGORIAS_PECA_ROUPA),
  pesoGramas: n,
  custoReposicaoCentavos: nul(n),
  composicao: z.array(item),
  ativa: z.boolean(),
  versao: n,
}) satisfies z.ZodType<PecaRoupa>;

export const esquemaCotaRoupaResposta = z.object({
  centroCusto: n,
  peca: n,
  quantidade: n,
  versao: n,
}) satisfies z.ZodType<CotaRoupa>;

export const esquemaMovimentoRoupaResposta = z.object({
  id: n,
  tipo: codigos(TIPOS_MOVIMENTO_ROUPA),
  data: txt,
  em: txt,
  centroCusto: nul(n),
  remessa: nul(n),
  pesoKg: nul(n),
  pecas: n,
  itens: z.array(item),
  lavanderia: nul(codigos(LAVANDERIAS)),
  fornecedor: nul(n),
  motivoPerda: nul(codigos(MOTIVOS_PERDA_ROUPA)),
  diferencaKg: nul(n),
  diferencaPct: nul(n),
  ocorrencia: z.boolean(),
  observacao: nul(txt),
  situacao: codigos(SITUACOES_MOVIMENTO_ROUPA),
  por: txt,
  canceladoPor: nul(txt),
  canceladoEm: nul(txt),
  motivoCancelamento: nul(txt),
  versao: n,
}) satisfies z.ZodType<MovimentoRoupa>;

export const esquemaEnvioAbertoResposta = z.object({
  id: n,
  data: txt,
  em: txt,
  pesoKg: n,
  pecas: n,
  lavanderia: nul(codigos(LAVANDERIAS)),
  fornecedor: nul(n),
  horasDesdeEnvio: n,
  atrasado: z.boolean(),
}) satisfies z.ZodType<EnvioAberto>;

export const esquemaParametrosRouparia = z.object({
  toleranciaPct: n,
  prazoRetornoHoras: n,
  precoKgCentavos: n,
  cancelamentoHoras: n,
});
export type ParametrosRoupariaResposta = z.infer<typeof esquemaParametrosRouparia>;

export const esquemaSetorRouparia = z.object({ codigo: n, nome: txt, ativo: z.boolean() });
export type SetorRoupariaResposta = z.infer<typeof esquemaSetorRouparia>;

/** GET /api/hotelaria/rouparia: o painel. */
export const esquemaPainelRouparia = z.object({
  hoje: txt,
  agora: txt,
  pecas: z.array(esquemaPecaRoupaResposta),
  setores: z.array(esquemaSetorRouparia),
  cotas: z.array(esquemaCotaRoupaResposta),
  enviosAbertos: z.array(esquemaEnvioAbertoResposta),
  movimentosDeHoje: z.array(esquemaMovimentoRoupaResposta),
  cortada: z.boolean(),
  parametros: esquemaParametrosRouparia,
  gravacao: esquemaGravacaoAgenda,
});
export type PainelRouparia = z.infer<typeof esquemaPainelRouparia>;

/** GET /api/hotelaria/rouparia/movimentos. */
export const esquemaListaMovimentosRoupa = z.object({
  itens: z.array(esquemaMovimentoRoupaResposta),
  cortada: z.boolean(),
  proximo: nul(n),
});
export type ListaMovimentosRoupa = z.infer<typeof esquemaListaMovimentosRoupa>;

/** GET /api/hotelaria/rouparia/movimentos/:id. */
export const esquemaDetalheMovimentoRoupa = z.object({
  movimento: esquemaMovimentoRoupaResposta,
  remessa: nul(esquemaMovimentoRoupaResposta),
});
export type DetalheMovimentoRoupa = z.infer<typeof esquemaDetalheMovimentoRoupa>;

export const esquemaConferenciaRetornoRoupa = z.object({
  pesoEnviadoKg: n,
  pesoRetornadoKg: n,
  diferencaKg: n,
  diferencaPct: n,
  toleranciaPct: n,
  pecasFaltando: z.array(z.object({ peca: n, enviadas: n, retornadas: n, faltam: n })),
  ocorrencia: z.boolean(),
  motivos: z.array(txt),
});

/** O resultado de uma gravação da rouparia (movimento, cancelamento, peça). */
export const esquemaResultadoRouparia = z.object({
  ok: z.literal(true),
  id: n,
  versao: n,
  repetida: z.boolean().optional(),
  mensagem: txt,
  conferencia: nul(esquemaConferenciaRetornoRoupa).optional(),
});
export type ResultadoRoupariaResposta = z.infer<typeof esquemaResultadoRouparia>;

/** PUT /api/hotelaria/rouparia/cotas. */
export const esquemaResultadoCotasRoupa = z
  .object({ ok: z.literal(true), mensagem: txt, alteradas: n.optional() })
  .passthrough();

/** GET /api/hotelaria/rouparia/cotas/:centroCusto. */
export const esquemaSituacaoCotaSetor = z.object({
  centroCusto: n,
  inventarioEm: nul(txt),
  itens: z.array(z.object({ peca: n, cota: n, estimado: n, reposicao: n, conta: txt })),
}) satisfies z.ZodType<SituacaoCotaSetor>;

const kgSetorDia = z.object({ data: txt, centroCusto: n, kg: n, coletas: n }) satisfies z.ZodType<KgSetorDia>;
const kgSetorPeriodo = z.object({
  centroCusto: n,
  kg: n,
  coletas: n,
  dias: z.array(z.object({ data: txt, kg: n })),
}) satisfies z.ZodType<KgSetorPeriodo>;

/** GET /api/hotelaria/rouparia/estatistica (regra 4). */
export const esquemaEstatisticaRouparia = z.object({
  de: txt,
  ate: txt,
  linhas: z.array(kgSetorDia),
  porSetor: z.array(kgSetorPeriodo),
  totalKg: n,
  conta: txt,
});
export type EstatisticaRouparia = z.infer<typeof esquemaEstatisticaRouparia>;

const indicador = z.object({ valor: nul(n), numerador: n, denominador: n, conta: txt });

/** GET /api/hotelaria/rouparia/indicadores. */
export const esquemaIndicadoresRouparia = z.object({
  de: txt,
  ate: txt,
  kgColetados: n,
  kgEnviados: n,
  kgRetornados: n,
  pacientesDia: n,
  kgPorPacienteDia: indicador,
  indicePerda: indicador,
  custoPorPacienteDia: indicador.extend({ precoKgCentavos: n }),
  ocorrencias: n,
  retornos: n,
}) satisfies z.ZodType<IndicadoresRouparia>;

/** GET /api/hotelaria/rouparia/fornecedores. */
export const esquemaFornecedoresRouparia = z.object({ itens: z.array(z.object({ codigo: n, nome: txt })) });
