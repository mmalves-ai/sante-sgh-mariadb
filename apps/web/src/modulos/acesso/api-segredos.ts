// Cliente das telas do M59-F3 (segredos de parceiros, senhas secundárias e imutabilidade clínica), validado pelos
// contratos. As gravações levam o CSRF da sessão, a Idempotency-Key (uma por pedido) e a senha digitada na hora
// (reautenticação; nunca guardada). Nenhuma resposta traz o valor de segredo nenhum: a credencial que o gestor
// guarda no cofre vai só na ida.
import {
  esquemaImutabilidadeResposta,
  esquemaSegredosLegadoResposta,
  esquemaSenhasSecundariasResposta,
  type GuardarSegredoPedido,
  type ImutabilidadeResposta,
  type SegredosLegadoResposta,
  type SenhasSecundariasResposta,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
export const BASE_SEGREDOS = '/api/administracao/integracao/segredos-legado';
export const BASE_SENHAS_SECUNDARIAS = '/api/administracao/acesso/senhas-secundarias';
export const ROTA_IMUTABILIDADE = '/api/administracao/acesso/contas-banco/imutabilidade';

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
  url: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  buscar: typeof fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

// ── segredos de parceiros ─────────────────────────────────────────────────────────────────────

export const buscarSegredosParceiros = (buscar: typeof fetch = fetch): Promise<SegredosLegadoResposta> =>
  ler(BASE_SEGREDOS, esquemaSegredosLegadoResposta, buscar);

const esquemaGuardado = z.object({ guardado: z.literal(true), novo: z.boolean() });

/** Guarda no cofre a credencial que o Sante passa a usar (de preferência a nova, combinada com o parceiro). */
export const guardarSegredoNoCofre = (
  pedido: GuardarSegredoPedido,
  buscar: typeof fetch = fetch,
): Promise<z.infer<typeof esquemaGuardado>> =>
  enviar(`${BASE_SEGREDOS}/guardar`, pedido, esquemaGuardado, buscar);

/** Retira da linha o segredo antigo (todas as colunas juntas), pelo executor. */
export const retirarSegredoAntigo = (
  tabela: string,
  chave: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<{ retirado: true }> =>
  enviar(
    `${BASE_SEGREDOS}/retirar`,
    { tabela, chave, senha },
    z.object({ retirado: z.literal(true) }),
    buscar,
  );

// ── senhas secundárias ────────────────────────────────────────────────────────────────────────

export function consultaSenhasSecundarias(f: { busca?: string; pagina?: number }): string {
  const q = new URLSearchParams();
  if (f.busca?.trim()) q.set('busca', f.busca.trim());
  if (f.pagina && f.pagina > 1) q.set('pagina', String(f.pagina));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const listarSenhasSecundarias = (
  f: { busca?: string; pagina?: number },
  buscar: typeof fetch = fetch,
): Promise<SenhasSecundariasResposta> =>
  ler(`${BASE_SENHAS_SECUNDARIAS}${consultaSenhasSecundarias(f)}`, esquemaSenhasSecundariasResposta, buscar);

export const retirarSenhasSecundarias = (
  login: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<{ retirada: true }> =>
  enviar(
    `${BASE_SENHAS_SECUNDARIAS}/${encodeURIComponent(login)}/retirar`,
    { senha },
    z.object({ retirada: z.literal(true) }),
    buscar,
  );

// ── imutabilidade clínica (painel de contas do banco) ─────────────────────────────────────────

export const buscarImutabilidade = (buscar: typeof fetch = fetch): Promise<ImutabilidadeResposta> =>
  ler(ROTA_IMUTABILIDADE, esquemaImutabilidadeResposta, buscar);
