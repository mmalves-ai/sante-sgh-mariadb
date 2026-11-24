// Cliente do cadastro do texto padrão da descrição cirúrgica (F3.4-3, 04-CC linha 91): /api/cirurgia/textos-padrao.
// Lista, inclusão, alteração com versão, tirar de uso e voltar (nada se apaga) e a prévia do preenchimento.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const T = '/api/cirurgia/textos-padrao';

export const esquemaTextoPadrao = z.object({
  id: z.number(),
  titulo: z.string(),
  procedimento: z.number().nullable(),
  cirurgiao: z.number().nullable(),
  textoDescricao: z.string(),
  textoRisco: z.string().nullable(),
  textoIntercorrencia: z.string().nullable(),
  ativo: z.boolean(),
  versao: z.number(),
  procedimentoDescricao: z.string().nullable(),
  cirurgiaoNome: z.string().nullable(),
  campos: z.array(z.string()),
});
export type TextoPadrao = z.infer<typeof esquemaTextoPadrao>;
export interface EntradaTexto {
  titulo: string;
  procedimento: number | null;
  cirurgiao: number | null;
  textoDescricao: string;
  textoRisco: string | null;
  textoIntercorrencia: string | null;
}

const comId = z.object({ id: z.number().nullable() }).passthrough();
const lista = z.object({ itens: z.array(esquemaTextoPadrao) });

export const lerTextosPadrao = () => ler(T, lista);
export const lerTextosParaDescricao = (procedimento: number | null, cirurgiao: number | null) => {
  const q = new URLSearchParams();
  if (procedimento) q.set('procedimento', String(procedimento));
  if (cirurgiao) q.set('cirurgiao', String(cirurgiao));
  return ler(`${T}/descricao?${q.toString()}`, lista);
};
export const incluirTextoPadrao = (corpo: EntradaTexto) => enviar(T, corpo, comId, novaChave('texto-padrao'));
export async function alterarTextoPadrao(id: number, corpo: EntradaTexto & { versao: number }) {
  const r = await fetch(`${T}/${id}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('texto-padrao-alt'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return comId.parse(await r.json());
}
export const usoTextoPadrao = (id: number, ativo: boolean, versao: number) =>
  enviar(`${T}/${id}/uso`, { ativo, versao }, comId, novaChave('texto-padrao-uso'));
export const preencherTextoPadrao = (id: number, valores: Record<string, string>) =>
  enviar(
    `${T}/${id}/preencher`,
    { valores },
    z
      .object({
        textoDescricao: z.string(),
        textoRisco: z.string().nullable(),
        textoIntercorrencia: z.string().nullable(),
      })
      .passthrough(),
    novaChave('texto-padrao-previa'),
  );
