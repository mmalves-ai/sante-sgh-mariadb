// Família acesso-ligacao (modulos-proprios-3): a entrada por e-mail na web. "Esqueci a senha" do administrador da
// plataforma (pedido pelo e-mail e o link de uso único) e a escolha do segundo fator da própria conta (aplicativo ou
// código no e-mail). O token, a senha e o código nunca são guardados no navegador.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const COM_CORPO = { ...JSON_ACEITO, 'content-type': 'application/json' };

export const esquemaMetodoSegundoFator = z.object({
  metodo: z.enum(['aplicativo', 'email']),
  emailDisponivel: z.boolean(),
});
export type MetodoSegundoFatorTela = z.infer<typeof esquemaMetodoSegundoFator>;

const esquemaMensagem = z.object({ mensagem: z.string() });
const esquemaProvisoria = z.object({
  senhaProvisoria: z.string(),
  trocaObrigatoria: z.literal(true),
  login: z.string(),
});

export async function recuperacaoPlataformaDisponivel(buscar: typeof fetch = fetch): Promise<boolean> {
  const r = await buscar('/api/sessao/plataforma/recuperacao/disponivel', { headers: JSON_ACEITO });
  if (!r.ok) return false;
  return z.object({ disponivel: z.boolean() }).parse(await r.json()).disponivel;
}

/** Pede o link pelo e-mail da conta da plataforma (a resposta é sempre a mesma). */
export async function pedirRecuperacaoPlataforma(
  email: string,
  buscar: typeof fetch = fetch,
): Promise<string> {
  const r = await buscar('/api/sessao/plataforma/recuperacao', {
    method: 'POST',
    headers: COM_CORPO,
    body: JSON.stringify({ email }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaMensagem.parse(await r.json()).mensagem;
}

/** Usa o link (uso único): devolve a senha provisória, que exige a troca no próximo acesso. */
export async function usarRecuperacaoPlataforma(
  token: string,
  buscar: typeof fetch = fetch,
): Promise<z.infer<typeof esquemaProvisoria>> {
  const r = await buscar('/api/sessao/plataforma/recuperacao/usar', {
    method: 'POST',
    headers: COM_CORPO,
    body: JSON.stringify({ token }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaProvisoria.parse(await r.json());
}

export async function lerMetodoSegundoFator(buscar: typeof fetch = fetch): Promise<MetodoSegundoFatorTela> {
  const r = await buscar('/api/sessao/segundo-fator/metodo', { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaMetodoSegundoFator.parse(await r.json());
}

/** Troca o método (o servidor pede a senha confirmada há pouco: 401 reautenticacao-necessaria). */
export async function escolherMetodoSegundoFator(
  metodo: MetodoSegundoFatorTela['metodo'],
  buscar: typeof fetch = fetch,
): Promise<MetodoSegundoFatorTela> {
  const r = await buscar('/api/sessao/segundo-fator/metodo', {
    method: 'POST',
    headers: { ...COM_CORPO, 'x-csrf': tokenCsrf() },
    body: JSON.stringify({ metodo }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaMetodoSegundoFator.parse(await r.json());
}
