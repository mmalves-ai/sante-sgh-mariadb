// Família acesso-ligacao (modulos-proprios-3): a entrada por e-mail na web. "Esqueci a senha" do administrador da
// plataforma (pedido pelo e-mail e o link de uso único) e a escolha do segundo fator da própria conta (aplicativo ou
// código no e-mail). O token, a senha e o código nunca são guardados no navegador.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const COM_CORPO = { ...JSON_ACEITO, 'content-type': 'application/json' };

export const esquemaMetodoSegundoFator = z.object({
  metodo: z.enum(['aplicativo', 'email', 'dispositivo']),
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

// ── Chave do dispositivo (WebAuthn com biometria local; 01-ADM L62) ──

export const esquemaDispositivo = z.object({
  id: z.number(),
  nome: z.string(),
  criadoEm: z.string(),
  ultimoUsoEm: z.string().nullable(),
});
export type DispositivoTela = z.infer<typeof esquemaDispositivo>;
const esquemaListaDispositivos = z.object({ dispositivos: z.array(esquemaDispositivo) });
const esquemaDescritor = z.object({ type: z.literal('public-key'), id: z.string() });
const esquemaOpcoesCadastro = z.object({
  challenge: z.string(),
  rp: z.object({ id: z.string(), name: z.string() }),
  user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.object({ type: z.literal('public-key'), alg: z.number() })),
  timeout: z.number(),
  attestation: z.literal('none'),
  authenticatorSelection: z.object({
    userVerification: z.literal('required'),
    residentKey: z.literal('discouraged'),
  }),
  excludeCredentials: z.array(esquemaDescritor),
});
const esquemaOpcoesValidacao = z.object({
  challenge: z.string(),
  rpId: z.string(),
  timeout: z.number(),
  userVerification: z.literal('required'),
  allowCredentials: z.array(esquemaDescritor),
});

const deB64 = (t: string): ArrayBuffer => {
  const b = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (t.length % 4)) % 4));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
};
const paraB64 = (buf: ArrayBuffer): string => {
  let s = '';
  for (const x of new Uint8Array(buf)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const dispositivoSuportado = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential === 'function' &&
  !!navigator.credentials;

async function postar(caminho: string, corpo: unknown, buscar: typeof fetch): Promise<unknown> {
  const r = await buscar(`/api/sessao/segundo-fator/dispositivos${caminho}`, {
    method: 'POST',
    headers: { ...COM_CORPO, 'x-csrf': tokenCsrf() },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return r.json();
}

export async function listarDispositivos(buscar: typeof fetch = fetch): Promise<DispositivoTela[]> {
  const r = await buscar('/api/sessao/segundo-fator/dispositivos', { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaListaDispositivos.parse(await r.json()).dispositivos;
}

/** Cadastra o aparelho: pede o desafio, o navegador chama a biometria do dispositivo, o servidor confere. */
export async function cadastrarDispositivo(nome: string, buscar: typeof fetch = fetch): Promise<void> {
  const o = esquemaOpcoesCadastro.parse(await postar('/opcoes-cadastro', {}, buscar));
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: deB64(o.challenge),
      user: { ...o.user, id: deB64(o.user.id) },
      excludeCredentials: o.excludeCredentials.map((c) => ({ ...c, id: deB64(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('cancelado', 'NotAllowedError');
  const resp = cred.response as AuthenticatorAttestationResponse;
  await postar(
    '',
    {
      nome,
      resposta: {
        idCredencial: paraB64(cred.rawId),
        dadosCliente: paraB64(resp.clientDataJSON),
        objetoAtestado: paraB64(resp.attestationObject),
      },
    },
    buscar,
  );
}

/** A assinatura do desafio pelo aparelho (biometria ou PIN local), pronta para o servidor conferir. */
export interface RespostaDispositivo {
  readonly idCredencial: string;
  readonly dadosCliente: string;
  readonly dadosAutenticador: string;
  readonly assinatura: string;
}

/** 01-ADM L62: assina o desafio da entrada (vem na recusa 401, extensão opcoesDispositivo). */
export async function assinarComDispositivo(opcoes: unknown): Promise<RespostaDispositivo> {
  return assinar(esquemaOpcoesValidacao.parse(opcoes));
}

/** Confere o aparelho (assinatura do desafio com a biometria local). */
export async function validarDispositivo(buscar: typeof fetch = fetch): Promise<void> {
  const o = esquemaOpcoesValidacao.parse(await postar('/opcoes-validacao', {}, buscar));
  await postar('/validar', { resposta: await assinar(o) }, buscar);
}

async function assinar(o: z.infer<typeof esquemaOpcoesValidacao>): Promise<RespostaDispositivo> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      ...o,
      challenge: deB64(o.challenge),
      allowCredentials: o.allowCredentials.map((c) => ({ ...c, id: deB64(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('cancelado', 'NotAllowedError');
  const resp = cred.response as AuthenticatorAssertionResponse;
  return {
    idCredencial: paraB64(cred.rawId),
    dadosCliente: paraB64(resp.clientDataJSON),
    dadosAutenticador: paraB64(resp.authenticatorData),
    assinatura: paraB64(resp.signature),
  };
}

export async function revogarDispositivo(
  id: number,
  buscar: typeof fetch = fetch,
): Promise<DispositivoTela[]> {
  return esquemaListaDispositivos.parse(await postar(`/${id}/revogar`, {}, buscar)).dispositivos;
}
