// Cliente do cadastro complementar da operadora (F7, 08-SGO linha 93; C1-071): os responsáveis perante a ANS, os
// setores internos e os parâmetros gerais de cada operadora da instalação, sobre as rotas
// `operadora/complementar/empresas/:op/*`. Respostas validadas aqui (zod); recusas viram ErroApi com o texto do domínio.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/operadora/complementar';
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const esquemaResponsavelOperadora = z.object({
  id: z.number().int(),
  sequencia: z.number().int(),
  tipo: z.string(),
  natureza: z.string(),
  pessoa: z.number().int(),
  nome: z.string().nullable(),
  numeroRegistro: z.string().nullable(),
  inicio: z.string(),
  fim: data.nullable(),
  vigente: z.boolean(),
});
export type ResponsavelOperadora = z.infer<typeof esquemaResponsavelOperadora>;

export const esquemaDepartamentoOperadora = z.object({
  id: z.number().int(),
  versao: z.number().int(),
  codigo: z.string(),
  descricao: z.string(),
  tipo: z.string(),
  email: z.string().nullable(),
  emailsCopia: z.array(z.string()),
  superior: z.number().int().nullable(),
  visivelPortal: z.boolean(),
  ativo: z.boolean(),
});
export type DepartamentoOperadora = z.infer<typeof esquemaDepartamentoOperadora>;

export const esquemaParametroOperadora = z.object({
  chave: z.string(),
  descricao: z.string(),
  valor: z.union([z.number(), z.boolean()]),
  padrao: z.boolean(),
  desde: data.nullable(),
});
export type ParametroOperadora = z.infer<typeof esquemaParametroOperadora>;

const esquemaPessoa = z.object({
  pessoa: z
    .object({ id: z.number().int(), natureza: z.enum(['fisica', 'juridica']), nome: z.string() })
    .nullable(),
});
export type PessoaResponsavelOperadora = NonNullable<z.infer<typeof esquemaPessoa>['pessoa']>;
const esquemaGravado = z.object({ id: z.number().int() }).passthrough();

const E = (op: number) => `${C}/empresas/${op}`;

export const lerResponsaveisOperadora = (op: number) =>
  ler(`${E(op)}/responsaveis`, z.array(esquemaResponsavelOperadora));
export const lerDepartamentosOperadora = (op: number) =>
  ler(`${E(op)}/departamentos`, z.array(esquemaDepartamentoOperadora));
export const lerParametrosOperadora = (op: number) =>
  ler(`${E(op)}/parametros`, z.array(esquemaParametroOperadora));

export const buscarPessoaResponsavel = async (documento: string) =>
  (await ler(`${C}/pessoas?documento=${encodeURIComponent(documento)}`, esquemaPessoa)).pessoa;

export const incluirResponsavelOperadora = (
  op: number,
  corpo: {
    tipo: string;
    natureza: 'fisica' | 'juridica';
    pessoa: number;
    numeroRegistro: string | null;
    inicio: string;
    fim: string | null;
  },
) => enviar(`${E(op)}/responsaveis`, corpo, esquemaGravado, novaChave('ope-resp'));

export const gravarDepartamentoOperadora = (
  op: number,
  corpo: {
    id: number | null;
    versao: number | null;
    codigo: string;
    descricao: string;
    tipo: string;
    email: string | null;
    emailsCopia: string[];
    superior: number | null;
    visivelPortal: boolean;
    ativo: boolean;
  },
) => enviar(`${E(op)}/departamentos`, corpo, esquemaGravado, novaChave('ope-dep'));

export const definirParametroOperadora = (
  op: number,
  corpo: {
    chave: string;
    valor: number | boolean | string;
    inicio: string | null;
    justificativa: string | null;
  },
) => enviar(`${E(op)}/parametros`, corpo, esquemaGravado, novaChave('ope-par'));
