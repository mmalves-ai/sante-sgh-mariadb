// Cliente da configuração dos documentos da internação (F3.4, 04-INT linha 69): modelos e regras por convênio,
// especialidade e modalidade, e os documentos que saem para uma internação.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const D = '/api/documentos-internacao';
const idNulo = z.number().nullable();

export const esquemaModeloDoc = z.object({
  id: z.number(),
  codigo: z.string(),
  titulo: z.string(),
  conteudo: z.string(),
  momento: z.string(),
  copias: z.number(),
  especialidade: idNulo,
  idadeMinima: idNulo,
  idadeMaxima: idNulo,
  ativo: z.boolean(),
  todosEstabelecimentos: z.boolean(),
  versao: z.number(),
});
export const esquemaRegraDoc = z.object({
  id: z.number(),
  modelo: z.number(),
  momento: z.string(),
  convenio: idNulo,
  especialidade: idNulo,
  modalidade: idNulo,
  obrigatorio: z.boolean(),
  selecionadoPorPadrao: z.boolean(),
  copias: z.number(),
  ordem: z.number(),
  ativo: z.boolean(),
  versao: z.number(),
});
const esquemaConfiguracao = z.object({
  modelos: z.array(esquemaModeloDoc),
  regras: z.array(esquemaRegraDoc),
  modalidades: z.array(z.object({ codigo: z.number(), nome: z.string() })),
});
const esquemaGravado = z.object({ id: z.number(), versao: z.number() });
const esquemaDocumentos = z.object({
  momento: z.string(),
  documentos: z.array(
    z.object({
      modelo: z.number(),
      titulo: z.string(),
      regra: z.number(),
      copias: z.number(),
      obrigatorio: z.boolean(),
      selecionado: z.boolean(),
      texto: z.string(),
    }),
  ),
});

export type ModeloDoc = z.infer<typeof esquemaModeloDoc>;
export type RegraDoc = z.infer<typeof esquemaRegraDoc>;
export type ConfiguracaoDocumentos = z.infer<typeof esquemaConfiguracao>;

export const lerConfiguracaoDocumentos = () => ler(D, esquemaConfiguracao);
export const lerDocumentosDaInternacao = (reg: number, momento = 'admissao') =>
  ler(`${D}/internacao/${reg}?momento=${encodeURIComponent(momento)}`, esquemaDocumentos);
export const salvarModeloDoc = (corpo: unknown, chave: string) =>
  enviar(`${D}/modelos`, corpo, esquemaGravado, chave);
export const salvarRegraDoc = (corpo: unknown, chave: string) =>
  enviar(`${D}/regras`, corpo, esquemaGravado, chave);
