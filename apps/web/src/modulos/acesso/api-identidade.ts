// Cliente das telas do M59-F2 (senhas, segundo fator e identidade), validado pelos contratos. As gravações levam o
// CSRF da sessão, a Idempotency-Key (uma por pedido) e, nas críticas, a senha digitada na hora (reautenticação;
// nunca guardada). Nenhuma resposta traz senha, hash ou segredo, exceto o início do cadastro do próprio segundo
// fator (o segredo e o URI aparecem uma vez, só à própria pessoa).
import {
  type AlterarPolitica2fa,
  type EncerrarPolitica2fa,
  esquemaMeuSegundoFator,
  esquemaPaginaUsuariosIdentidade,
  esquemaPolitica2fa,
  esquemaResumoIdentidade,
  esquemaSegundoFatorInicio,
  type FiltroUsuariosIdentidade,
  type MeuSegundoFator,
  type MinhaSessaoTela,
  type NovaPolitica2fa,
  type PaginaUsuariosIdentidade,
  type Politica2fa,
  type ResumoIdentidade,
  type SegundoFatorInicio,
  type SituacaoPinTela,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const BASE = '/api/acesso/identidade';

function chaveIdempotencia(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function ler<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

async function enviar<T>(
  metodo: 'POST' | 'DELETE',
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  buscar: typeof fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: metodo,
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const consulta = (f: Partial<FiltroUsuariosIdentidade>): string => {
  const q = new URLSearchParams();
  if (f.busca) q.set('busca', f.busca);
  if (f.senha) q.set('senha', f.senha);
  if (f.pagina && f.pagina > 1) q.set('pagina', String(f.pagina));
  const s = q.toString();
  return s ? `?${s}` : '';
};

// ── gestão (Usuários e Política do segundo fator) ────────────────────────────────────────────────

export const buscarResumoIdentidade = (buscar: typeof fetch = fetch): Promise<ResumoIdentidade> =>
  ler(`${BASE}/resumo`, esquemaResumoIdentidade, buscar);

export const listarUsuariosIdentidade = (
  f: Partial<FiltroUsuariosIdentidade>,
  buscar: typeof fetch = fetch,
): Promise<PaginaUsuariosIdentidade> =>
  ler(`${BASE}/usuarios${consulta(f)}`, esquemaPaginaUsuariosIdentidade, buscar);

export const listarPoliticas2fa = (buscar: typeof fetch = fetch): Promise<Politica2fa[]> =>
  ler(`${BASE}/politica-2fa`, z.array(esquemaPolitica2fa), buscar);

export const incluirPolitica2fa = (
  dados: NovaPolitica2fa,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<Politica2fa> =>
  enviar('POST', `${BASE}/politica-2fa`, { dados, senha }, esquemaPolitica2fa, buscar);

export const esquemaOnda1Aberta = z.object({ incluidas: z.number().int(), jaExistiam: z.number().int() });
export type Onda1Aberta = z.infer<typeof esquemaOnda1Aberta>;

export const abrirOnda1 = (
  dados: { inicio: string; prazoAdesaoDias: number; motivo: string },
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<Onda1Aberta> =>
  enviar('POST', `${BASE}/politica-2fa/onda-1`, { dados, senha }, esquemaOnda1Aberta, buscar);

export const encerrarPolitica2fa = (
  id: string,
  dados: EncerrarPolitica2fa,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<{ encerrada: true }> =>
  enviar(
    'POST',
    `${BASE}/politica-2fa/${encodeURIComponent(id)}/encerrar`,
    { dados, senha },
    z.object({ encerrada: z.literal(true) }),
    buscar,
  );

/** W0-09: o prazo e o alvo da linha vigente, com motivo (a linha atual é encerrada e nasce outra). */
export const alterarPolitica2fa = (
  id: string,
  dados: AlterarPolitica2fa,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<Politica2fa> =>
  enviar(
    'POST',
    `${BASE}/politica-2fa/${encodeURIComponent(id)}/alteracao`,
    { dados, senha },
    esquemaPolitica2fa,
    buscar,
  );

/**
 * O gestor revoga o segundo fator de outra conta (troca ou perda de aparelho): o aplicativo e, 01-ADM L62, as chaves do
 * dispositivo (sem isso, quem escolheu o dispositivo e o perdeu ficaria sem entrada).
 */
export const revogarSegundoFatorDe = async (
  login: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<{ revogado: true; dispositivos: number }> => {
  const r = await enviar(
    'POST',
    `${BASE}/usuarios/${encodeURIComponent(login)}/segundo-fator/revogar`,
    { senha },
    z.object({ revogado: z.literal(true) }),
    buscar,
  );
  const d = await enviar(
    'POST',
    `${BASE}/usuarios/${encodeURIComponent(login)}/dispositivos/revogar`,
    { senha },
    z.object({ revogados: z.number().int().min(0) }),
    buscar,
  );
  return { ...r, dispositivos: d.revogados };
};

export const retirarSenhaAntiga = (
  login: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<{ retirada: true }> =>
  enviar(
    'POST',
    `${BASE}/usuarios/${encodeURIComponent(login)}/retirar-senha-antiga`,
    { senha },
    z.object({ retirada: z.literal(true) }),
    buscar,
  );

// ── o próprio segundo fator (/preferencias/seguranca) ───────────────────────────────────────────

export const buscarMeuSegundoFator = (buscar: typeof fetch = fetch): Promise<MeuSegundoFator> =>
  ler('/api/sessao/segundo-fator', esquemaMeuSegundoFator, buscar);

/** Inicia o cadastro: vale a janela recente de reautenticação; fora dela, a senha digitada na hora. */
export const iniciarSegundoFator = (
  senha?: string,
  buscar: typeof fetch = fetch,
): Promise<SegundoFatorInicio> =>
  enviar('POST', '/api/sessao/segundo-fator', senha ? { senha } : {}, esquemaSegundoFatorInicio, buscar);

export const confirmarSegundoFator = (
  codigo: string,
  buscar: typeof fetch = fetch,
): Promise<{ confirmado: true }> =>
  enviar('POST', '/api/sessao/segundo-fator', { codigo }, z.object({ confirmado: z.literal(true) }), buscar);

export const removerSegundoFator = (
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<{ removido: true }> =>
  enviar('DELETE', '/api/sessao/segundo-fator', { senha }, z.object({ removido: z.literal(true) }), buscar);

/** Código da recusa no Problem Details (extensão `codigo`), para a tela escolher o texto. */
export function codigoDoErro(e: unknown): string | null {
  const p = (e as { problema?: { codigo?: unknown } | null } | null)?.problema;
  return typeof p?.codigo === 'string' ? p.codigo : null;
}

// ── W1-01 (parte 8b): "Minhas sessões" (/preferencias/seguranca) ───────────────────────────────

const esquemaMinhaSessao = z.object({
  ref: z.string(),
  inicio: z.string(),
  ultimoUso: z.string(),
  dispositivo: z.string().nullable(),
  atual: z.boolean(),
  bloqueada: z.boolean(),
}) satisfies z.ZodType<MinhaSessaoTela>;

/** As sessões da própria pessoa no estabelecimento (a atual marcada). */
export const buscarMinhasSessoes = (buscar: typeof fetch = fetch): Promise<MinhaSessaoTela[]> =>
  ler('/api/sessao/sessoes', z.array(esquemaMinhaSessao), buscar);

/** Sem `ref`, encerra todas as outras; com `ref`, só aquela. A atual nunca (é o Sair). */
export const encerrarMinhasSessoes = (
  ref?: string,
  buscar: typeof fetch = fetch,
): Promise<{ encerradas: number }> =>
  enviar(
    'POST',
    '/api/sessao/sessoes/encerrar',
    ref ? { ref } : {},
    z.object({ encerradas: z.number().int().nonnegative() }),
    buscar,
  );

// ── W1-01 (parte 11b3a): o próprio PIN da troca rápida (/preferencias/seguranca) ─────────────────

const esquemaSituacaoPin = z.object({
  ligada: z.boolean(),
  digitosPin: z.number().int().positive(),
  definido: z.boolean(),
  bloqueado: z.boolean(),
  criadoEm: z.string().nullable(),
}) satisfies z.ZodType<SituacaoPinTela>;

/** A situação do próprio PIN (nunca o PIN nem o hash). */
export const buscarMeuPin = (buscar: typeof fetch = fetch): Promise<SituacaoPinTela> =>
  ler('/api/sessao/pin', esquemaSituacaoPin, buscar);

/** Define ou troca o próprio PIN; a senha confere antes (reautenticação). Nada disso fica guardado no navegador. */
export const definirMeuPin = (
  pin: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<SituacaoPinTela> => enviar('POST', '/api/sessao/pin', { pin, senha }, esquemaSituacaoPin, buscar);

/** Retira o próprio PIN, com a senha. */
export const retirarMeuPin = (senha: string, buscar: typeof fetch = fetch): Promise<SituacaoPinTela> =>
  enviar('POST', '/api/sessao/pin/retirar', { senha }, esquemaSituacaoPin, buscar);
