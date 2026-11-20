// Cliente do portal de resultados (M26; regra 9): outro domínio de identidade, com a sessão própria do portal (cookie
// HttpOnly) e o CSRF por token duplo próprio (o cookie sgh_portal_csrf repetido no cabeçalho x-csrf-portal).
import {
  esquemaLaudoPortalAberto,
  esquemaListaPortal,
  esquemaSessaoPortal,
  esquemaValidacaoLaudo,
  type LaudoPortalAberto,
  type ListaPortal,
  type SessaoPortal,
  type ValidacaoLaudo,
} from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/portal';
const JSON_ACEITO = { accept: 'application/json' };

function csrfPortal(): string {
  for (const par of document.cookie.split(';')) {
    const [k, v] = par.trim().split('=');
    if (k === 'sgh_portal_csrf') return v ?? '';
  }
  return '';
}

async function json<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}
const postar = <T>(url: string, corpo: unknown, esquema: z.ZodType<T>) =>
  fetch(url, {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json', 'x-csrf-portal': csrfPortal() },
    body: JSON.stringify(corpo ?? {}),
  }).then((r) => json(r, esquema));

export const estabelecimentoPadrao = () =>
  fetch(`${P}/estabelecimento`, { headers: JSON_ACEITO }).then((r) =>
    json(r, z.object({ estabelecimento: z.string().nullable() })),
  );
export const entrarPaciente = (
  h: string,
  corpo: { protocolo: string; nascimento: string },
): Promise<SessaoPortal> => postar(`${P}/${h}/paciente`, corpo, esquemaSessaoPortal);
export const entrarMedico = (h: string, corpo: unknown): Promise<SessaoPortal> =>
  postar(`${P}/${h}/medico`, corpo, esquemaSessaoPortal);
export const autocadastro = (h: string, corpo: unknown) =>
  postar(`${P}/${h}/autocadastro`, corpo, z.object({ otpauth: z.string(), mensagem: z.string() }));
export const euPortal = (): Promise<SessaoPortal> =>
  fetch(`${P}/eu`, { headers: JSON_ACEITO }).then((r) => json(r, esquemaSessaoPortal));
export const laudosPortal = (): Promise<ListaPortal> =>
  fetch(`${P}/laudos`, { headers: JSON_ACEITO }).then((r) => json(r, esquemaListaPortal));
export const abrirLaudoPortal = (liberacao: number): Promise<LaudoPortalAberto> =>
  postar(`${P}/laudos/${liberacao}`, { acao: 'visualizacao' }, esquemaLaudoPortalAberto);
export const sairPortal = () =>
  fetch(`${P}/sessao`, { method: 'DELETE', headers: { 'x-csrf-portal': csrfPortal() } });
export const validarLaudo = (h: string, codigo: string): Promise<ValidacaoLaudo> =>
  fetch(`${P}/${h}/validar/${encodeURIComponent(codigo)}`, { headers: JSON_ACEITO }).then((r) =>
    json(r, esquemaValidacaoLaudo),
  );
