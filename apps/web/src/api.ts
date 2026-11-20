import {
  esquemaEstabelecimentosEntrada,
  esquemaMarcaPublica,
  esquemaSessao,
  esquemaVersao,
  type EstabelecimentosEntrada,
  type MarcaPublica,
  type PedirRecuperacaoSenha,
  RESPOSTA_RECUPERACAO_SENHA,
  type ResultadoRecuperacaoSenha,
  type Sessao,
  type Versao,
} from '@sgh/contratos';
import type { z } from 'zod';
import { erroDaResposta } from './casca/erros/problem-details.js';

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const JSON_ACEITO = { accept: 'application/json' };

/** Lê o cookie CSRF (token duplo): a tela o repete no cabeçalho X-CSRF nas rotas que mudam estado. */
export function tokenCsrf(): string {
  try {
    for (const par of document.cookie.split(';')) {
      const i = par.indexOf('=');
      if (i !== -1 && par.slice(0, i).trim() === 'sgh_csrf') return par.slice(i + 1).trim();
    }
  } catch {
    /* sem document.cookie (SSR/testes) */
  }
  return '';
}

function cabecalhosEscrita(): Record<string, string> {
  return { ...JSON_ACEITO, 'content-type': 'application/json', 'x-csrf': tokenCsrf() };
}

/** Lê GET /api/versao e valida com o contrato compartilhado. */
export async function buscarVersao(buscar: typeof fetch = fetch): Promise<Versao> {
  return lerJson(await buscar('/api/versao', { headers: JSON_ACEITO }), esquemaVersao);
}

export async function buscarMarca(buscar: typeof fetch = fetch): Promise<MarcaPublica> {
  return lerJson(await buscar('/api/marca', { headers: JSON_ACEITO }), esquemaMarcaPublica);
}

export async function buscarSessao(buscar: typeof fetch = fetch): Promise<Sessao> {
  return lerJson(await buscar('/api/sessao', { headers: JSON_ACEITO }), esquemaSessao);
}

/** Seletor da tela de entrada (ARQ-1/ARQ-2): só os estabelecimentos da rede do endereço. */
export async function buscarEstabelecimentos(buscar: typeof fetch = fetch): Promise<EstabelecimentosEntrada> {
  return lerJson(
    await buscar('/api/estabelecimentos', { headers: JSON_ACEITO }),
    esquemaEstabelecimentosEntrada,
  );
}

export interface CredenciaisEntrada {
  estabelecimento: string;
  login: string;
  senha: string;
  codigoSegundoFator?: string;
}

/** POST /api/sessao: entrar. A sessão volta no cookie HttpOnly; o corpo é só a sessão (sem token). */
export async function entrar(c: CredenciaisEntrada, buscar: typeof fetch = fetch): Promise<Sessao> {
  const r = await buscar('/api/sessao', {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json' },
    body: JSON.stringify(c),
  });
  return lerJson(r, esquemaSessao);
}

// ── W1-01 (parte 7): "Esqueci a senha" (chave acesso.recuperacaoSenha e o servidor de e-mail institucional) ──

/** O "Esqueci a senha" está liberado no estabelecimento? (o link só aparece com ele) */
export async function disponibilidadeRecuperacao(
  estabelecimento: string,
  buscar: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const r = await buscar(
      `/api/sessao/recuperacao/disponivel?estabelecimento=${encodeURIComponent(estabelecimento)}`,
      { headers: JSON_ACEITO },
    );
    if (!r.ok) return false;
    return ((await r.json()) as { disponivel?: unknown }).disponivel === true;
  } catch {
    return false;
  }
}

/** POST /api/sessao/recuperacao: a resposta é a mesma para qualquer login (a mensagem genérica). */
export async function pedirRecuperacao(
  p: PedirRecuperacaoSenha,
  buscar: typeof fetch = fetch,
): Promise<string> {
  const r = await buscar('/api/sessao/recuperacao', {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json' },
    body: JSON.stringify(p),
  });
  if (!r.ok) throw await erroDaResposta(r);
  const j = (await r.json()) as { mensagem?: unknown };
  return typeof j.mensagem === 'string' ? j.mensagem : RESPOSTA_RECUPERACAO_SENHA;
}

/** POST /api/sessao/recuperacao/usar: o token do e-mail vira a senha provisória (mostrada uma vez). */
export async function usarRecuperacao(
  token: string,
  buscar: typeof fetch = fetch,
): Promise<ResultadoRecuperacaoSenha> {
  const r = await buscar('/api/sessao/recuperacao/usar', {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  const j = (await r.json()) as { senhaProvisoria?: unknown; trocaObrigatoria?: unknown };
  return {
    senhaProvisoria: typeof j.senhaProvisoria === 'string' ? j.senhaProvisoria : '',
    trocaObrigatoria: j.trocaObrigatoria === true,
  };
}

// ── M49 (etapa 3): entrada com certificado ICP-Brasil A1/A3 (agente local; chave acesso.loginCertificado) ──

/** A entrada com certificado está liberada no estabelecimento? (o botão só aparece com ela) */
export async function disponibilidadeCertificado(
  estabelecimento: string,
  buscar: typeof fetch = fetch,
): Promise<{ disponivel: boolean; agenteLocal: string | null }> {
  const r = await buscar(
    `/api/sessao/certificado/disponivel?estabelecimento=${encodeURIComponent(estabelecimento)}`,
    { headers: JSON_ACEITO },
  );
  if (!r.ok) return { disponivel: false, agenteLocal: null };
  const j = (await r.json()) as { disponivel?: unknown; agenteLocal?: unknown };
  return {
    disponivel: j.disponivel === true,
    agenteLocal: typeof j.agenteLocal === 'string' ? j.agenteLocal : null,
  };
}

/** O desafio de uso único que o agente local assina (o hash; nunca a senha). */
export async function desafioCertificado(
  e: { estabelecimento: string; login: string },
  buscar: typeof fetch = fetch,
): Promise<{ desafio: string; hashes: string[]; algoritmo: 'sha256'; agenteLocal: string }> {
  const r = await buscar('/api/sessao/certificado/desafio', {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json' },
    body: JSON.stringify(e),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as { desafio: string; hashes: string[]; algoritmo: 'sha256'; agenteLocal: string };
}

/** A resposta do agente local: o servidor confere e abre a sessão (cookie HttpOnly, como a entrada com senha). */
export async function entrarComCertificado(
  resposta: { desafio: string; assinaturas: { hash: string; assinatura: string }[]; certificado: string },
  buscar: typeof fetch = fetch,
): Promise<Sessao> {
  const r = await buscar('/api/sessao/certificado', {
    method: 'POST',
    headers: { ...JSON_ACEITO, 'content-type': 'application/json' },
    body: JSON.stringify(resposta),
  });
  return lerJson(r, esquemaSessao);
}

/** DELETE /api/sessao: sair. */
export async function sair(buscar: typeof fetch = fetch): Promise<void> {
  // Sem corpo: sem content-type JSON (o Fastify recusa corpo JSON vazio com 400).
  const r = await buscar('/api/sessao', {
    method: 'DELETE',
    headers: { ...JSON_ACEITO, 'x-csrf': tokenCsrf() },
  });
  if (!r.ok && r.status !== 204) throw await erroDaResposta(r);
}

/** POST /api/sessao/reautenticar: confirma a senha (desbloqueio e operações críticas). */
export async function reautenticar(senha: string, buscar: typeof fetch = fetch): Promise<Sessao> {
  const r = await buscar('/api/sessao/reautenticar', {
    method: 'POST',
    headers: cabecalhosEscrita(),
    body: JSON.stringify({ senha }),
  });
  return lerJson(r, esquemaSessao);
}

/**
 * W1-01 (parte 11b3b): troca rápida de usuário na tela bloqueada (POST /api/sessao/troca-rapida) com o login e o PIN;
 * o servidor confere o cookie do posto e a sessão bloqueada deste navegador (CSRF dela). A sessão nova volta; a
 * anterior fica bloqueada no servidor. Recusa sempre genérica (401).
 */
export async function trocarUsuarioPorPin(
  corpo: { login: string; pin: string },
  buscar: typeof fetch = fetch,
): Promise<Sessao> {
  const r = await buscar('/api/sessao/troca-rapida', {
    method: 'POST',
    headers: cabecalhosEscrita(),
    body: JSON.stringify(corpo),
  });
  return lerJson(r, esquemaSessao);
}

/** W1-01: troca da própria senha (POST /api/sessao/senha); a sessão nova (sem troca pendente) volta. */
export async function trocarSenha(
  corpo: { senhaAtual: string; senhaNova: string; confirmacao: string },
  buscar: typeof fetch = fetch,
): Promise<Sessao> {
  const r = await buscar('/api/sessao/senha', {
    method: 'POST',
    headers: cabecalhosEscrita(),
    body: JSON.stringify(corpo),
  });
  return lerJson(r, esquemaSessao);
}

export async function escolherUnidade(codigo: number, buscar: typeof fetch = fetch): Promise<Sessao> {
  const r = await buscar('/api/sessao/unidade', {
    method: 'POST',
    headers: cabecalhosEscrita(),
    body: JSON.stringify({ codigo }),
  });
  return lerJson(r, esquemaSessao);
}

export async function trocarEstabelecimento(codigo: string, buscar: typeof fetch = fetch): Promise<Sessao> {
  const r = await buscar('/api/sessao/estabelecimento', {
    method: 'POST',
    headers: cabecalhosEscrita(),
    body: JSON.stringify({ codigo }),
  });
  return lerJson(r, esquemaSessao);
}
