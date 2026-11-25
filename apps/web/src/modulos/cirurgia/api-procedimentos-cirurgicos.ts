// Cliente do cadastro do procedimento cirúrgico (F3.4, 04-CC linha 91): /api/cirurgia/procedimentos-cirurgicos.
// Lista com busca, opções dos combos, inclusão, alteração com versão, tirar de uso e voltar (nada se apaga).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const T = '/api/cirurgia/procedimentos-cirurgicos';

export const esquemaProcedimentoCirurgico = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  mnemonico: z.string().nullable(),
  natureza: z.string(),
  grupo: z.number().nullable(),
  grupoDescricao: z.string().nullable(),
  porte: z.number().nullable(),
  porteDescricao: z.string().nullable(),
  especialidade: z.number().nullable(),
  especialidadeDescricao: z.string().nullable(),
  carater: z.number().nullable(),
  caraterDescricao: z.string().nullable(),
  tipoAnestesia: z.number().nullable(),
  duracaoMediaMinutos: z.number().nullable(),
  tempoPreparoSalaMinutos: z.number().nullable(),
  exigeLateralidade: z.boolean(),
  obstetrico: z.boolean(),
  hemodinamica: z.boolean(),
  exigeExameImagem: z.boolean(),
  exigePlano: z.boolean(),
  orientacaoPaciente: z.string().nullable(),
  preparo: z.string().nullable(),
  ativo: z.boolean(),
  origem: z.string(),
  textosPadrao: z.number(),
  versao: z.number(),
});
export type ProcedimentoCirurgico = z.infer<typeof esquemaProcedimentoCirurgico>;

const opcao = z.object({ id: z.number(), descricao: z.string() });
export const esquemaApoioProcedimento = z.object({
  grupos: z.array(opcao),
  portes: z.array(opcao.extend({ duracaoReferenciaMinutos: z.number().nullable() })),
  especialidades: z.array(opcao),
  carateres: z.array(opcao),
  anestesias: z.array(opcao),
});
export type ApoioProcedimento = z.infer<typeof esquemaApoioProcedimento>;

export interface EntradaProcedimento {
  codigo: string;
  descricao: string;
  mnemonico: string | null;
  natureza: string;
  grupo: number | null;
  porte: number | null;
  especialidade: number | null;
  carater: number | null;
  tipoAnestesia: number | null;
  duracaoMediaMinutos: number | null;
  tempoPreparoSalaMinutos: number | null;
  exigeLateralidade: boolean;
  obstetrico: boolean;
  hemodinamica: boolean;
  exigeExameImagem: boolean;
  exigePlano: boolean;
  orientacaoPaciente: string | null;
  preparo: string | null;
}

const comId = z.object({ id: z.number().nullable() }).passthrough();
const lista = z.object({ itens: z.array(esquemaProcedimentoCirurgico), truncado: z.boolean() });

export const lerProcedimentosCirurgicos = (q: string, todos: boolean) => {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (todos) p.set('todos', '1');
  return ler(`${T}?${p.toString()}`, lista);
};
export const lerApoioProcedimento = () => ler(`${T}/apoio`, esquemaApoioProcedimento);
export const incluirProcedimento = (corpo: EntradaProcedimento) =>
  enviar(T, corpo, comId, novaChave('procedimento-cirurgico'));
export async function alterarProcedimento(id: number, corpo: EntradaProcedimento & { versao: number }) {
  const r = await fetch(`${T}/${id}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('procedimento-cirurgico-alt'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return comId.parse(await r.json());
}
export const usoProcedimento = (id: number, ativo: boolean, versao: number) =>
  enviar(`${T}/${id}/uso`, { ativo, versao }, comId, novaChave('procedimento-cirurgico-uso'));
