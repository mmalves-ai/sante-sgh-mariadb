// Cliente da API do posto de coleta e da reimpressão da etiqueta da amostra (F3.5, 05-SADT linha 7).
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const S = '/api/sadt';
const n = z.number();
const txt = z.string();

export const TIPOS_DE_POSTO = ['interno', 'externo', 'domiciliar'] as const;
export type TipoDePosto = (typeof TIPOS_DE_POSTO)[number];

const esquemaPosto = z.object({
  id: n,
  versao: n,
  codigo: txt,
  descricao: txt,
  tipo: z.enum(TIPOS_DE_POSTO),
  setorLaboratorio: n,
  setorNome: txt,
  horarioInicio: txt.nullable(),
  horarioFim: txt.nullable(),
  funcionaFimDeSemana: z.boolean(),
  telefone: txt.nullable(),
  ativo: z.boolean(),
});
export type PostoDeColeta = z.infer<typeof esquemaPosto>;

export interface CorpoPosto {
  id: number | null;
  versao: number | null;
  codigo: string;
  descricao: string;
  tipo: TipoDePosto;
  setorLaboratorio: number | null;
  horarioInicio: string | null;
  horarioFim: string | null;
  funcionaFimDeSemana: boolean;
  telefone: string | null;
}

/** O que impede gravar o posto, conferido na hora na tela (a regra completa é do servidor); null: pode gravar. */
export function problemaDoPosto(
  p: CorpoPosto,
): 'codigo' | 'descricao' | 'setor' | 'horarioIncompleto' | 'horarioInvertido' | null {
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(p.codigo.trim())) return 'codigo';
  if (p.descricao.trim().length < 3) return 'descricao';
  if (p.setorLaboratorio === null) return 'setor';
  if (!!p.horarioInicio !== !!p.horarioFim) return 'horarioIncompleto';
  if (p.horarioInicio && p.horarioFim && p.horarioFim <= p.horarioInicio) return 'horarioInvertido';
  return null;
}

export const listarPostos = (todos = false) =>
  ler(`${S}/postos-coleta${qs(todos ? { todos: 'sim' } : {})}`, z.object({ itens: z.array(esquemaPosto) }));
export const salvarPosto = (p: CorpoPosto, chave: string) =>
  enviar(`${S}/postos-coleta`, p, z.object({ id: n, versao: n }), chave);
export const situarPosto = (id: number, ativo: boolean, chave: string) =>
  enviar(`${S}/postos-coleta/${id}/situacao`, { ativo }, z.object({ id: n, ativo: z.boolean() }), chave);
/** Reimprime a etiqueta da amostra na impressora da estação (via numerada, registrada na passagem da amostra). */
export const reimprimirEtiqueta = (amostra: number, chave: string) =>
  enviar(`${S}/amostras/${amostra}/etiqueta`, {}, z.object({ naFila: n, via: n.nullable() }), chave);
