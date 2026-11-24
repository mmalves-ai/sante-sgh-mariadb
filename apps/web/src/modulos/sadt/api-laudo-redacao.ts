// Cliente da API da redação do laudo e do laudo estruturado (F3.5, 05-SADT linhas 16 e 17).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const S = '/api/sadt/laudos';
const n = z.number();
const txt = z.string();

const esquemaValor = z.object({
  grandeza: n,
  sequencia: n,
  numero: n.nullable(),
  texto: txt.nullable(),
  foraReferencia: z.boolean(),
  faixa: z.object({ minima: n.nullable(), maxima: n.nullable(), indexada: z.boolean() }).nullable(),
});
export const esquemaLaudoEmRedacao = z.object({
  exame: z.object({ item: n, exame: n, nome: txt, setor: n, tipoSetor: txt }),
  paciente: z.object({ id: n, sexo: z.enum(['feminino', 'masculino']).nullable(), idadeDias: n.nullable() }),
  laudo: z
    .object({
      id: n,
      situacao: txt,
      titulo: txt.nullable(),
      texto: txt,
      resultado: txt.nullable(),
      achadoCritico: z.boolean(),
      achadoCriticoDescricao: txt.nullable(),
      modelo: n.nullable(),
      versaoAtual: n,
    })
    .nullable(),
  versoes: z.array(
    z.object({ numero: n, situacao: txt, em: txt, motivo: txt.nullable(), hash: txt.nullable() }),
  ),
  secoes: z.array(z.object({ id: n, nome: txt, ordem: n })),
  grandezas: z.array(
    z.object({
      id: n,
      codigo: txt,
      sigla: txt,
      descricao: txt,
      casasDecimais: n.nullable(),
      obrigatoria: z.boolean(),
      secao: n.nullable(),
    }),
  ),
  valores: z.array(esquemaValor),
  modelos: z.array(
    z.object({ id: n, nome: txt, tipo: txt, atalho: txt.nullable(), texto: txt, campos: z.array(txt) }),
  ),
  pode: z.object({ salvar: z.boolean(), assinar: z.boolean(), retificar: z.boolean() }),
});
export type LaudoEmRedacao = z.infer<typeof esquemaLaudoEmRedacao>;

const esquemaGravado = z.object({ id: n, situacao: txt, versaoAtual: n, valores: n, foraReferencia: n });
export type LaudoGravado = z.infer<typeof esquemaGravado>;

export interface CorpoLaudo {
  modelo: number | null;
  titulo: string | null;
  texto: string;
  resultado: 'normal' | 'alterado' | 'inconclusivo' | null;
  achadoCritico: boolean;
  achadoCriticoDescricao: string | null;
  pesoKg: number | null;
  alturaCm: number | null;
  valores: { grandeza: number; numero: number | null; texto: string | null }[];
}

export const abrirLaudo = (item: number) => ler(`${S}/redacao/${item}`, esquemaLaudoEmRedacao);
export const lerMotivosRetificacao = () =>
  ler(
    `${S}/motivos-retificacao`,
    z.object({ itens: z.array(z.object({ id: n, codigo: txt, descricao: txt })) }),
  );
export const salvarLaudo = (item: number, corpo: CorpoLaudo & { revisao: boolean }, chave: string) =>
  enviar(`${S}/redacao/${item}`, corpo, esquemaGravado, chave);
export const assinarLaudo = (item: number, corpo: CorpoLaudo, chave: string) =>
  enviar(`${S}/redacao/${item}/assinar`, corpo, esquemaGravado, chave);
export const retificarLaudo = (
  item: number,
  corpo: CorpoLaudo & { motivo: number | null; motivoTexto: string | null },
  chave: string,
) => enviar(`${S}/redacao/${item}/retificar`, corpo, esquemaGravado, chave);
export const previaDoModelo = (
  item: number,
  corpo: { modelo: number; pesoKg: number | null; alturaCm: number | null; valores: CorpoLaudo['valores'] },
  chave: string,
) => enviar(`${S}/redacao/${item}/previa`, corpo, z.object({ texto: txt, faltam: z.array(txt) }), chave);
