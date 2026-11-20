// Cookies da sessão (ficha do M05, regra 8): só cookie HttpOnly, Secure, SameSite=Strict; nenhum token no
// corpo nem no navegador. Proteção CSRF por token duplo (um cookie legível + o mesmo valor no cabeçalho
// X-CSRF, conferido contra o token guardado na sessão nas rotas que mudam estado). O cookie é preso ao
// endereço da rede (Path=/, sem Domain: host-only).
//
// `Secure` sai SEMPRE, inclusive em dev: os navegadores aceitam cookie Secure em http://localhost e
// http://127.0.0.1 (contexto confiável). Só o NOME muda: o prefixo __Host- fica fora de dev/ci.
export const COOKIE_SESSAO = '__Host-sgh_sessao';
export const COOKIE_SESSAO_DEV = 'sgh_sessao';
export const COOKIE_CSRF = 'sgh_csrf';
export const CABECALHO_CSRF = 'x-csrf';

export interface OpcoesCookie {
  readonly maxIdadeSegundos: number;
  /** Fora de dev/ci: nome com o prefixo __Host- (exige https). Em dev/ci, nome simples (ainda Secure). */
  readonly prefixoHost: boolean;
}

function nomeSessao(prefixoHost: boolean): string {
  return prefixoHost ? COOKIE_SESSAO : COOKIE_SESSAO_DEV;
}

/** Set-Cookie da sessão: HttpOnly, Secure, SameSite=Strict, Path=/. */
export function cookieSessao(valor: string, o: OpcoesCookie): string {
  return [
    `${nomeSessao(o.prefixoHost)}=${valor}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${o.maxIdadeSegundos}`,
  ].join('; ');
}

/** Cookie CSRF: legível pela tela (sem HttpOnly), mesmo escopo; a tela o repete no cabeçalho X-CSRF. */
export function cookieCsrf(valor: string, o: OpcoesCookie): string {
  return [
    `${COOKIE_CSRF}=${valor}`,
    'Path=/',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${o.maxIdadeSegundos}`,
  ].join('; ');
}

/** Set-Cookie que apaga a sessão e o CSRF (sair). */
export function cookiesApagados(prefixoHost: boolean): string[] {
  const zera = (nome: string, extra: string[]) =>
    [`${nome}=`, 'Path=/', 'Max-Age=0', ...extra, 'Secure'].join('; ');
  return [
    zera(nomeSessao(prefixoHost), ['HttpOnly', 'SameSite=Strict']),
    zera(COOKIE_CSRF, ['SameSite=Strict']),
  ];
}

/** Lê um cookie do cabeçalho Cookie. */
export function lerCookie(cabecalho: string | undefined, nome: string): string | null {
  if (!cabecalho) return null;
  for (const par of cabecalho.split(';')) {
    const i = par.indexOf('=');
    if (i === -1) continue;
    if (par.slice(0, i).trim() === nome) return par.slice(i + 1).trim();
  }
  return null;
}

export function lerCookieSessao(cabecalho: string | undefined, prefixoHost: boolean): string | null {
  return lerCookie(cabecalho, nomeSessao(prefixoHost));
}

// ── Conta da plataforma (ADR 0021): cookie e CSRF próprios, separados da sessão do SPDATA ──────────
export const COOKIE_PLATAFORMA = '__Host-sgh_plataforma';
export const COOKIE_PLATAFORMA_DEV = 'sgh_plataforma';
export const COOKIE_CSRF_PLATAFORMA = 'sgh_pcsrf';
export const CABECALHO_CSRF_PLATAFORMA = 'x-csrf-plataforma';

function nomePlataforma(prefixoHost: boolean): string {
  return prefixoHost ? COOKIE_PLATAFORMA : COOKIE_PLATAFORMA_DEV;
}

export function cookiesPlataforma(id: string, csrf: string, o: OpcoesCookie): string[] {
  return [
    [
      `${nomePlataforma(o.prefixoHost)}=${id}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      `Max-Age=${o.maxIdadeSegundos}`,
    ].join('; '),
    [
      `${COOKIE_CSRF_PLATAFORMA}=${csrf}`,
      'Path=/',
      'Secure',
      'SameSite=Strict',
      `Max-Age=${o.maxIdadeSegundos}`,
    ].join('; '),
  ];
}

export function cookiesPlataformaApagados(prefixoHost: boolean): string[] {
  return [
    [`${nomePlataforma(prefixoHost)}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict', 'Secure'].join(
      '; ',
    ),
    [`${COOKIE_CSRF_PLATAFORMA}=`, 'Path=/', 'Max-Age=0', 'SameSite=Strict', 'Secure'].join('; '),
  ];
}

export function lerCookiePlataforma(cabecalho: string | undefined, prefixoHost: boolean): string | null {
  return lerCookie(cabecalho, nomePlataforma(prefixoHost));
}

// ── W1-01 (revisão, achado da estação): cookie do POSTO de trabalho para a troca rápida ─────────────────────────
// O IP visto pela API não identifica a máquina (NAT, proxy, API fora do hospital). No login forte o navegador recebe
// um identificador aleatório de 256 bits, HttpOnly, de longa duração e preso ao endereço; o servidor guarda só o
// resumo SHA-256 dele (nunca o valor). A troca rápida exige esse cookie e a sessão anterior aberta no mesmo posto.
export const COOKIE_POSTO = '__Host-sgh_posto';
export const COOKIE_POSTO_DEV = 'sgh_posto';
/** 400 dias (teto do navegador para Max-Age). */
export const POSTO_MAX_IDADE_SEGUNDOS = 400 * 24 * 3600;
const FORMATO_POSTO = /^[A-Za-z0-9_-]{43}$/;

function nomePosto(prefixoHost: boolean): string {
  return prefixoHost ? COOKIE_POSTO : COOKIE_POSTO_DEV;
}

/** Set-Cookie do posto: HttpOnly, Secure, SameSite=Strict, Path=/, longa duração. */
export function cookiePosto(valor: string, prefixoHost: boolean): string {
  return [
    `${nomePosto(prefixoHost)}=${valor}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${POSTO_MAX_IDADE_SEGUNDOS}`,
  ].join('; ');
}

/** O identificador do posto, só quando tem o formato emitido (32 bytes em base64url); outro texto vale ausente. */
export function lerCookiePosto(cabecalho: string | undefined, prefixoHost: boolean): string | null {
  const v = lerCookie(cabecalho, nomePosto(prefixoHost));
  return v && FORMATO_POSTO.test(v) ? v : null;
}
