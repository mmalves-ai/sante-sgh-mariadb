// Perfis de marcação (02-AGE linha 46): leitura, opções dos recortes e manutenção (perfil, recortes e usuários).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/agenda/perfis-marcacao';

export const DIMENSOES = [
  'fonte_pagadora',
  'especialidade',
  'setor',
  'agenda',
  'profissional',
  'estabelecimento',
] as const;
export type Dimensao = (typeof DIMENSOES)[number];
export const TIPOS = ['geral', 'central', 'ambulatorio', 'exame', 'portal'] as const;

const esquemaRecorte = z.object({
  dimensao: z.enum(DIMENSOES),
  alvo: z.number(),
  permitido: z.boolean(),
  nome: z.string(),
});
export const esquemaPerfil = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  tipoPerfil: z.string(),
  permiteEncaixe: z.boolean(),
  ativo: z.boolean(),
  versao: z.number(),
  recortes: z.array(esquemaRecorte),
  usuarios: z.array(
    z.object({
      usuario: z.number(),
      login: z.string(),
      nome: z.string(),
      vigenciaInicio: z.string().nullable(),
      vigenciaFim: z.string().nullable(),
    }),
  ),
});
export type PerfilMarcacao = z.infer<typeof esquemaPerfil>;
export type RecorteMarcacao = z.infer<typeof esquemaRecorte>;

const opcao = z.array(z.object({ id: z.number(), nome: z.string() }));
export const esquemaOpcoes = z.object(
  Object.fromEntries(DIMENSOES.map((d) => [d, opcao])) as Record<Dimensao, typeof opcao>,
);
export type OpcoesRecorte = z.infer<typeof esquemaOpcoes>;

const esquemaGravacao = z
  .object({ ok: z.boolean(), mensagem: z.string().optional(), resultado: z.record(z.string(), z.number()) })
  .passthrough();

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}
const ler = <T>(url: string, e: z.ZodType<T>) =>
  fetch(url, { headers: { accept: 'application/json' } }).then((r) => json(r, e));
const enviar = (url: string, corpo: unknown, chave: string) =>
  fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  }).then((r) => json(r, esquemaGravacao));

export const lerPerfisMarcacao = () => ler(P, z.array(esquemaPerfil));
export const lerOpcoesRecorte = () => ler(`${P}/opcoes`, esquemaOpcoes);

export interface EntradaPerfil {
  /** Versão lida (obrigatória na alteração): o servidor recusa com 409 se outro gestor gravou antes. */
  versao?: number;
  codigo: string;
  descricao: string;
  tipoPerfil: (typeof TIPOS)[number];
  permiteEncaixe: boolean;
  ativo: boolean;
  recortes: { dimensao: Dimensao; alvo: number; permitido: boolean }[];
}
export const salvarPerfilMarcacao = (id: number | null, e: EntradaPerfil, chave: string) =>
  enviar(id ? `${P}/${id}` : P, e, chave);

export type MudancaUsuarioPerfil =
  | { acao: 'incluir'; usuario: number; vigenciaInicio: string | null; vigenciaFim: string | null }
  | { acao: 'remover'; usuario: number };
export const definirUsuarioPerfil = (perfil: number, m: MudancaUsuarioPerfil, chave: string) =>
  enviar(`${P}/${perfil}/usuarios`, m, chave);
