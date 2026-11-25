// Impressora por estação e reimpressão controlada (01-ADM L79): catálogo das telas de cadastro, situação da
// identificação do paciente (pulseira e etiqueta) e as gravações do vínculo da estação e do padrão.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const item = z.object({ id: z.number(), codigo: z.string() });
export const esquemaMotivoReimpressao = item.extend({ descricao: z.string(), exigeComplemento: z.boolean() });
export type MotivoReimpressao = z.infer<typeof esquemaMotivoReimpressao>;

export const esquemaCatalogoImpressao = z.object({
  eu: z.number().nullable(),
  estacaoAtual: z.number().nullable(),
  estacoes: z.array(item.extend({ nome: z.string(), tipo: z.string(), unidade: z.number().nullable() })),
  finalidades: z.array(item.extend({ descricao: z.string(), midia: z.string() })),
  impressoras: z.array(item.extend({ nome: z.string(), tipo: z.string(), ativa: z.boolean() })),
  motivos: z.array(esquemaMotivoReimpressao),
  unidades: z.array(z.object({ id: z.number(), nome: z.string() })),
  padroes: z.array(
    z.object({
      id: z.number(),
      finalidade: z.number(),
      unidade: z.number().nullable(),
      impressora: z.number(),
      copias: z.number(),
      ativo: z.boolean(),
    }),
  ),
  vinculos: z.array(
    z.object({
      id: z.number(),
      estacao: z.number(),
      finalidade: z.number(),
      impressora: z.number(),
      usuario: z.number().nullable(),
      padrao: z.boolean(),
    }),
  ),
});
export type CatalogoImpressao = z.infer<typeof esquemaCatalogoImpressao>;

const impressora = z.object({ id: z.number(), nome: z.string(), nivel: z.string() }).nullable();
export const esquemaIdentificacoes = z.object({
  atendimento: z.number(),
  estacao: z.number().nullable(),
  identificacoes: z.array(
    z.object({
      tipo: z.enum(['pulseira', 'etiqueta']),
      vias: z.number(),
      ultimaEm: z.string().nullable(),
      finalidade: z.number().nullable(),
      impressora,
    }),
  ),
  motivos: z.array(esquemaMotivoReimpressao),
  reimpressoes: z.array(
    z.object({
      id: z.number(),
      tipo: z.enum(['pulseira', 'etiqueta']),
      via: z.number(),
      em: z.string().nullable(),
      motivo: z.string(),
      complemento: z.string().nullable(),
      usuario: z.string().nullable(),
      impressora: z.string().nullable(),
      estacao: z.string().nullable(),
    }),
  ),
});
export type Identificacoes = z.infer<typeof esquemaIdentificacoes>;

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}
const ler = async <T>(url: string, e: z.ZodType<T>) =>
  json(await fetch(url, { headers: { accept: 'application/json' } }), e);
const postar = async (url: string, corpo: unknown) =>
  json(
    await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf': tokenCsrf(),
        'idempotency-key': `l79.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`,
      },
      body: JSON.stringify(corpo),
    }),
    z.object({ id: z.number() }),
  );

export const lerCatalogoImpressao = () =>
  ler('/api/administracao/impressao/catalogo', esquemaCatalogoImpressao);
export const lerIdentificacoes = (alvo: 'atendimento' | 'internacao', id: number) =>
  ler(`/api/documento/identificacoes/${alvo}/${id}`, esquemaIdentificacoes);
export const vincularEstacaoImpressora = (corpo: {
  estacao: number;
  finalidade: number;
  impressora: number;
  usuario?: number;
}) => postar('/api/administracao/impressao/estacoes/vinculos', corpo);
export const definirPadraoImpressora = (corpo: {
  finalidade: number;
  impressora: number;
  unidade?: number;
  copias: number;
}) => postar('/api/administracao/impressao/padroes', corpo);

/** O complemento que o motivo pede tem no mínimo 5 caracteres (a mesma regra do servidor, conferida na hora). */
export const COMPLEMENTO_MINIMO = 5;
export function reimpressaoPronta(motivo: MotivoReimpressao | null, complemento: string): boolean {
  if (!motivo) return false;
  return !motivo.exigeComplemento || complemento.trim().length >= COMPLEMENTO_MINIMO;
}
