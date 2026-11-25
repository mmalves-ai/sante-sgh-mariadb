// Cliente da análise das culturas positivas pela CCIH (F7, 09-AREA linha 68), validado na chegada. A fila vem por
// cultura com as pendências recalculadas pelo servidor a cada leitura (ficha de IRAS a abrir, precaução a aplicar, laudo
// retificado depois da análise); a gravação vai com o CSRF e a Idempotency-Key (uma por intenção de gravar).
import { CLASSIFICACOES_CULTURA } from '@sgh/dominio-qualidade';
import { z } from 'zod';
import { enviar, ler, qs } from '../../exames/api-exames.js';

const C = '/api/qualidade/ccih/culturas';

const classificacao = z.enum(CLASSIFICACOES_CULTURA);
const pendencia = z.enum(['abrir-ficha-iras', 'aplicar-precaucao', 'rever-laudo-retificado']);

const esquemaCultura = z.object({
  id: z.number(),
  paciente: z.number(),
  nome: z.string(),
  atendimento: z.number().nullable(),
  exame: z.string(),
  material: z.string(),
  resultadoEm: z.string(),
  situacao: z.enum(['parcial', 'final', 'retificado']),
  germes: z.array(
    z.object({
      id: z.number(),
      microrganismo: z.string(),
      multirresistente: z.boolean(),
      analisado: z.boolean(),
    }),
  ),
  faltaAnalisar: z.boolean(),
  pendencias: z.array(pendencia),
  pendente: z.boolean(),
});
export type CulturaDaFila = z.infer<typeof esquemaCultura>;

const esquemaConduta = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  ativo: z.boolean(),
  classificacaoAplicavel: classificacao.nullable(),
  abreCaso: z.boolean(),
  indicaPrecaucao: z.boolean(),
  exigeResposta: z.boolean(),
});
export type CondutaDaCultura = z.infer<typeof esquemaConduta>;

const esquemaAnalise = z.object({
  id: z.number(),
  cultura: z.number(),
  isolado: z.number().nullable(),
  paciente: z.number(),
  classificacao,
  conduta: z.number().nullable(),
  condutaDescricao: z.string().nullable(),
  precaucaoIndicada: z.boolean(),
  prescritorOrientado: z.boolean(),
  laudoRetificado: z.boolean(),
  casoInfeccao: z.number().nullable(),
  analisadaEm: z.string(),
  analista: z.string(),
  versao: z.number(),
  pendencias: z.array(pendencia),
});
export type AnaliseDaCultura = z.infer<typeof esquemaAnalise>;

const esquemaGravada = z.object({ id: z.number(), paciente: z.number(), pendencias: z.array(pendencia) });

export interface EntradaAnalise {
  readonly classificacao: (typeof CLASSIFICACOES_CULTURA)[number];
  readonly isolado: number | null;
  readonly conduta: number | null;
  readonly condutaDescricao: string | null;
  readonly precaucaoIndicada: boolean;
  readonly prescritorOrientado: boolean;
  readonly casoInfeccao: number | null;
}

export const lerCulturas = (desde?: string, paciente?: number) =>
  ler(`${C}${qs({ desde, paciente })}`, z.array(esquemaCultura));
export const lerCondutas = () => ler(`${C}/condutas`, z.array(esquemaConduta));
export const lerAnalisesDoPaciente = (paciente: number) =>
  ler(`${C}/analises${qs({ paciente })}`, z.array(esquemaAnalise));
export const gravarAnalise = (cultura: number, e: EntradaAnalise, chave: string) =>
  enviar(`${C}/${String(cultura)}/analise`, e, esquemaGravada, chave);
