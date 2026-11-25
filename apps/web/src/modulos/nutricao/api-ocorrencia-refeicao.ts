// Ocorrências na entrega da refeição (F8, 04-HOT linha 143): os tipos, a lista do mapa da refeição e do dia, o registro
// sobre a bandeja do mapa fechado e a resolução com a providência. A recusa do servidor vem em `problema` (ErroNutricao).
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const O = '/api/nutricao/mapa/ocorrencias';

const esquemaTipo = z.object({
  id: z.number().int(),
  codigo: z.string(),
  descricao: z.string(),
  geraReposicao: z.boolean(),
  exigeJustificativa: z.boolean(),
  ativo: z.boolean(),
});
export type TipoOcorrenciaRefeicao = z.infer<typeof esquemaTipo>;

const esquemaOcorrencia = z.object({
  id: z.number().int(),
  internacao: z.number().int().nullable(),
  linhaMapa: z.number().int().nullable(),
  tipo: z.number().int(),
  tipoCodigo: z.string(),
  tipoDescricao: z.string(),
  reposicao: z.boolean(),
  ocorridoEm: z.string(),
  descricao: z.string(),
  registradaPor: z.string().nullable(),
  resolvida: z.boolean(),
  resolvidaEm: z.string().nullable(),
  resolvidaPor: z.string().nullable(),
  providencia: z.string().nullable(),
  versao: z.number().int(),
});
export type OcorrenciaRefeicao = z.infer<typeof esquemaOcorrencia>;

const esquemaRegistrada = z.object({ id: z.number().int(), reposicao: z.boolean(), mensagem: z.string() });
export type OcorrenciaRegistrada = z.infer<typeof esquemaRegistrada>;

export interface NovaOcorrenciaRefeicao {
  readonly unidade: string;
  readonly refeicao: number;
  readonly data: string;
  readonly internacao: number;
  readonly tipo: number;
  readonly descricao: string | null;
  readonly ocorridoEm: string | null;
}

export const lerTiposOcorrencia = (): Promise<TipoOcorrenciaRefeicao[]> =>
  ler(`${O}/tipos`, z.object({ itens: z.array(esquemaTipo) })).then((r) => r.itens);
export const lerOcorrencias = (
  unidade: string,
  refeicao: number,
  data: string,
): Promise<OcorrenciaRefeicao[]> =>
  ler(`${O}${qs({ unidade, refeicao, data })}`, z.object({ itens: z.array(esquemaOcorrencia) })).then(
    (r) => r.itens,
  );
export const registrarOcorrencia = (
  corpo: NovaOcorrenciaRefeicao,
  chave: string,
): Promise<OcorrenciaRegistrada> => enviar(O, corpo, esquemaRegistrada, chave);
export const resolverOcorrencia = (
  id: number,
  corpo: { providencia: string; versao: number },
  chave: string,
): Promise<{ id: number }> => enviar(`${O}/${id}/resolver`, corpo, z.object({ id: z.number().int() }), chave);
