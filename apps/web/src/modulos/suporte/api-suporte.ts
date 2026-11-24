// Cliente da conta da plataforma e do "login como" (ADR 0021). A sessão da plataforma é um cookie HttpOnly
// próprio; nas escritas, o CSRF próprio (cookie sgh_pcsrf repetido no cabeçalho x-csrf-plataforma). Nenhum
// token vai ao navegador além desses cookies; nada é guardado em localStorage.
import {
  esquemaSessao,
  type AuditoriaContaTela,
  type ContaPlataformaTela,
  type ConviteTela,
  type CruzamentoTrilhaTela,
  type DetalheSessaoComoTela,
  type EstabelecimentoComo,
  type EuPlataforma,
  type GrupoComo,
  type PedidoCorrecao,
  type PreviaCorrecaoTela,
  type ResultadoCorrecaoTela,
  type SegundoFatorPlataforma,
  type Sessao,
  type SessaoComoTela,
  type UsuarioComo,
} from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

export function csrfPlataforma(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === 'sgh_pcsrf') return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie */
  }
  return '';
}

function escrita(): Record<string, string> {
  return { ...JSON_ACEITO, 'content-type': 'application/json', 'x-csrf-plataforma': csrfPlataforma() };
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function vazio(r: Response): Promise<void> {
  if (!r.ok) throw await erroDaResposta(r);
}

const esquemaEu = z.object({
  conta: z.object({
    id: z.string(),
    email: z.string(),
    nome: z.string().nullable(),
    papel: z.enum(['PLATAFORMA', 'SUPORTE']),
  }),
  podeEntrarComo: z.boolean(),
  podeDesignar: z.boolean(),
  podeAcessoTotal: z.boolean().default(false),
  expiraEm: z.string(),
  segundoFatorObrigatorio: z.boolean(),
});

export async function buscarEu(buscar: typeof fetch = fetch): Promise<EuPlataforma> {
  const r = await buscar('/api/plataforma/eu', { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaEu.parse(await r.json());
}

/** A conta da plataforma ainda vale? (para o 401 da casca voltar à conta de origem) */
export async function temContaPlataforma(buscar: typeof fetch = fetch): Promise<boolean> {
  try {
    await buscarEu(buscar);
    return true;
  } catch {
    return false;
  }
}

export async function entrarPlataforma(
  p: { email: string; senha: string; codigo?: string },
  buscar: typeof fetch = fetch,
): Promise<EuPlataforma | SegundoFatorPlataforma> {
  const r = await buscar('/api/plataforma/sessao', {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json' },
    body: JSON.stringify(p),
  });
  return json(r);
}

export async function sairPlataforma(buscar: typeof fetch = fetch): Promise<void> {
  await vazio(
    await buscar('/api/plataforma/sessao', {
      method: 'DELETE',
      headers: { ...JSON_ACEITO, 'x-csrf-plataforma': csrfPlataforma() },
    }),
  );
}

export async function aceitarConvite(
  token: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await vazio(
    await buscar('/api/plataforma/convite', {
      method: 'POST',
      headers: { ...JSON_ACEITO, 'content-type': 'application/json' },
      body: JSON.stringify({ token, senha }),
    }),
  );
}

// ── "Login como" ─────────────────────────────────────────────────────────────────────────────

export async function estabelecimentosComo(buscar: typeof fetch = fetch): Promise<EstabelecimentoComo[]> {
  return json(await buscar('/api/plataforma/como/estabelecimentos', { headers: JSON_ACEITO }));
}

export async function gruposComo(
  estabelecimento: string,
  buscar: typeof fetch = fetch,
): Promise<GrupoComo[]> {
  const q = new URLSearchParams({ estabelecimento });
  return json(await buscar(`/api/plataforma/como/grupos?${q.toString()}`, { headers: JSON_ACEITO }));
}

export async function usuariosComo(
  estabelecimento: string,
  grupo: string,
  buscar: typeof fetch = fetch,
): Promise<UsuarioComo[]> {
  const q = new URLSearchParams({ estabelecimento, grupo });
  return json(await buscar(`/api/plataforma/como/usuarios?${q.toString()}`, { headers: JSON_ACEITO }));
}

/** ADR 0022: padrão de "em nome de quem gravar" do acesso total no estabelecimento. */
export async function emNomeDeComo(
  estabelecimento: string,
  buscar: typeof fetch = fetch,
): Promise<{ estabelecimento: string; login: string | null }> {
  const q = new URLSearchParams({ estabelecimento });
  return json(await buscar(`/api/plataforma/como/em-nome-de?${q.toString()}`, { headers: JSON_ACEITO }));
}

export async function entrarComo(
  p: { estabelecimento: string; login: string; motivo?: string; modo?: 'como' | 'acesso-total' },
  buscar: typeof fetch = fetch,
): Promise<Sessao> {
  const r = await buscar('/api/plataforma/como', {
    method: 'POST',
    headers: escrita(),
    body: JSON.stringify(p),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaSessao.parse(await r.json());
}

/** CSRF da sessão do SPDATA (a do "como"), para a volta valer mesmo com a sessão da plataforma vencida. */
function csrfSessao(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === 'sgh_csrf') return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie */
  }
  return '';
}

/**
 * "Voltar à minha conta": encerra a sessão "como". Se a volta for recusada (ex.: a sessão da plataforma
 * venceu e o servidor não confirmou), encerra pela própria sessão do SPDATA (DELETE /api/sessao): a sessão
 * "como" nunca fica viva no navegador depois de a tela sair dela. Só falha se as duas falharem.
 */
export async function voltarDoComo(buscar: typeof fetch = fetch): Promise<void> {
  const csrf = csrfSessao();
  try {
    await vazio(
      await buscar('/api/plataforma/como', {
        method: 'DELETE',
        headers: { ...JSON_ACEITO, 'x-csrf-plataforma': csrfPlataforma(), 'x-csrf': csrf },
      }),
    );
  } catch (e) {
    const r = await buscar('/api/sessao', { method: 'DELETE', headers: { ...JSON_ACEITO, 'x-csrf': csrf } });
    if (!r.ok) throw e;
  }
}

// ── Designação ───────────────────────────────────────────────────────────────────────────────

export async function listarSuportes(buscar: typeof fetch = fetch): Promise<ContaPlataformaTela[]> {
  return json(await buscar('/api/plataforma/suportes', { headers: JSON_ACEITO }));
}

export async function criarSuporte(
  p: { email: string; nome?: string },
  buscar: typeof fetch = fetch,
): Promise<{ id: string; convite: ConviteTela }> {
  return json(
    await buscar('/api/plataforma/suportes', { method: 'POST', headers: escrita(), body: JSON.stringify(p) }),
  );
}

export async function definirFuncao(id: string, ativo: boolean, buscar: typeof fetch = fetch): Promise<void> {
  await vazio(
    await buscar(`/api/plataforma/suportes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: escrita(),
      body: JSON.stringify({ ativo }),
    }),
  );
}

export async function definirAtribuicoes(
  id: string,
  estabelecimentos: string[],
  buscar: typeof fetch = fetch,
): Promise<{ ligados: string[]; desligados: string[] }> {
  return json(
    await buscar(`/api/plataforma/suportes/${encodeURIComponent(id)}/atribuicoes`, {
      method: 'PUT',
      headers: escrita(),
      body: JSON.stringify({ estabelecimentos }),
    }),
  );
}

/** Muda o e-mail de entrada de uma conta da plataforma ou do suporte (a própria inclusive). */
export async function alterarEmailConta(
  id: string,
  email: string,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await vazio(
    await buscar(`/api/plataforma/contas/${encodeURIComponent(id)}/email`, {
      method: 'PUT',
      headers: escrita(),
      body: JSON.stringify({ email }),
    }),
  );
}

export async function gerarConvite(id: string, buscar: typeof fetch = fetch): Promise<ConviteTela> {
  return json(
    await buscar(`/api/plataforma/suportes/${encodeURIComponent(id)}/convite`, {
      method: 'POST',
      headers: escrita(),
      body: '{}',
    }),
  );
}

// ── Auditoria ────────────────────────────────────────────────────────────────────────────────

export async function listarSessoes(
  estabelecimento: string,
  buscar: typeof fetch = fetch,
): Promise<SessaoComoTela[]> {
  const q = estabelecimento ? `?${new URLSearchParams({ estabelecimento }).toString()}` : '';
  return json(await buscar(`/api/plataforma/auditoria/sessoes${q}`, { headers: JSON_ACEITO }));
}

export async function detalheSessao(
  id: string,
  buscar: typeof fetch = fetch,
): Promise<DetalheSessaoComoTela> {
  return json(
    await buscar(`/api/plataforma/auditoria/sessoes/${encodeURIComponent(id)}`, { headers: JSON_ACEITO }),
  );
}

export async function trilhaLegado(
  id: string,
  buscar: typeof fetch = fetch,
): Promise<CruzamentoTrilhaTela[]> {
  return json(
    await buscar(`/api/plataforma/auditoria/sessoes/${encodeURIComponent(id)}/trilha-legado`, {
      headers: JSON_ACEITO,
    }),
  );
}

export async function encerrarSessao(id: string, buscar: typeof fetch = fetch): Promise<void> {
  await vazio(
    await buscar(`/api/plataforma/auditoria/sessoes/${encodeURIComponent(id)}/encerrar`, {
      method: 'POST',
      headers: escrita(),
      body: '{}',
    }),
  );
}

export async function corrigir(
  p: PedidoCorrecao,
  buscar: typeof fetch = fetch,
): Promise<PreviaCorrecaoTela | ResultadoCorrecaoTela> {
  return json(
    await buscar('/api/plataforma/auditoria/correcoes', {
      method: 'POST',
      headers: escrita(),
      body: JSON.stringify(p),
    }),
  );
}

export async function eventosContas(buscar: typeof fetch = fetch): Promise<AuditoriaContaTela[]> {
  return json(await buscar('/api/plataforma/auditoria/contas', { headers: JSON_ACEITO }));
}
