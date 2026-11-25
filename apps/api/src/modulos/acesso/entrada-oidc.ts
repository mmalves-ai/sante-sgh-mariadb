// LOGIN ÚNICO CORPORATIVO pelo OpenID Connect (01-ADM L61): fluxo de código com PKCE (S256), estado e nonce de uso
// único. A API descobre os endereços do provedor (/.well-known/openid-configuration), troca o código pelo token no
// servidor (o segredo do cliente, quando há, é lido do cofre pela referência; nunca vai ao navegador), confere a
// assinatura do token de identidade com a chave publicada (JWKS; RS256, PS256 ou ES256) e as reivindicações pela
// regra do domínio (emissor, público, validade, nonce). Sem rede nos testes: o buscador é injetado.
// O estado pendente fica na memória do processo por 10 minutos; a identidade conferida fica guardada pelo mesmo
// estado por 5 minutos, para a conta que precisa do segundo fator mandar o código sem voltar ao provedor.
import { createHash, createPublicKey, type JsonWebKey, randomBytes, verify, constants } from 'node:crypto';
import { conferirReivindicacoesOidc, gruposDaReivindicacao } from '@sgh/dominio-acesso';
import type { ProvedorDeEntrada } from './provedor-identidade-propria.js';

export type Buscador = (url: string, init?: RequestInit) => Promise<Response>;
export type LerSegredo = (referencia: string) => Promise<string | null>;

export class ErroEntradaOidc extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface IdentidadeExterna {
  readonly sujeito: string;
  readonly email: string | null;
  readonly emailConfirmado: boolean;
  readonly grupos: readonly string[];
}

interface Pendente {
  readonly provedor: string;
  readonly estabelecimento: string;
  readonly nonce: string;
  readonly verificador: string;
  readonly retorno: string;
  readonly expiraMs: number;
}

interface Conferida {
  readonly provedor: string;
  readonly estabelecimento: string;
  readonly identidade: IdentidadeExterna;
  readonly expiraMs: number;
}

const PENDENTE_MS = 10 * 60_000;
const CONFERIDA_MS = 5 * 60_000;
const MAX_PENDENTES = 5_000;
const b64url = (b: Buffer) => b.toString('base64url');

interface Descoberta {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

export class EntradaOidc {
  private readonly pendentes = new Map<string, Pendente>();
  private readonly conferidas = new Map<string, Conferida>();
  agora: () => number = () => Date.now();

  constructor(
    private readonly buscar: Buscador = (u, i) => fetch(u, i),
    private readonly lerSegredo: LerSegredo | null = null,
  ) {}

  private limpar(): void {
    const t = this.agora();
    for (const [k, v] of this.pendentes) if (v.expiraMs < t) this.pendentes.delete(k);
    for (const [k, v] of this.conferidas) if (v.expiraMs < t) this.conferidas.delete(k);
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    let r: Response;
    try {
      r = await this.buscar(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new ErroEntradaOidc('provedor-indisponivel', 'O provedor de identidade não respondeu.');
    }
    if (!r.ok)
      throw new ErroEntradaOidc('provedor-recusou', `O provedor de identidade respondeu ${r.status}.`);
    return (await r.json()) as T;
  }

  private async descobrir(p: ProvedorDeEntrada): Promise<Descoberta> {
    const base = p.emissor.replace(/\/+$/, '');
    const d = await this.json<Partial<Descoberta>>(`${base}/.well-known/openid-configuration`);
    const https = (u: unknown) => typeof u === 'string' && u.startsWith('https://');
    if (!https(d.authorization_endpoint) || !https(d.token_endpoint) || !https(d.jwks_uri))
      throw new ErroEntradaOidc(
        'provedor-mal-configurado',
        'A descoberta do provedor não traz endereços https.',
      );
    return d as Descoberta;
  }

  /** O endereço do provedor para onde o navegador vai (com estado, nonce e o desafio PKCE). */
  async iniciar(p: ProvedorDeEntrada, estabelecimento: string, retorno: string): Promise<{ url: string }> {
    this.limpar();
    if (this.pendentes.size >= MAX_PENDENTES)
      throw new ErroEntradaOidc('muitas-entradas', 'Muitas entradas em andamento; tente em instantes.');
    const d = await this.descobrir(p);
    const estado = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const verificador = b64url(randomBytes(32));
    this.pendentes.set(estado, {
      provedor: p.codigo,
      estabelecimento,
      nonce,
      verificador,
      retorno,
      expiraMs: this.agora() + PENDENTE_MS,
    });
    const u = new URL(d.authorization_endpoint);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', p.clienteIdentificador);
    u.searchParams.set('redirect_uri', retorno);
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', estado);
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('code_challenge', b64url(createHash('sha256').update(verificador).digest()));
    u.searchParams.set('code_challenge_method', 'S256');
    return { url: u.toString() };
  }

  /** O estado pendente (sem consumir): o provedor e o estabelecimento desta entrada. */
  pendente(estado: string): { provedor: string; estabelecimento: string } | null {
    this.limpar();
    const p = this.pendentes.get(estado) ?? this.conferidas.get(estado);
    return p ? { provedor: p.provedor, estabelecimento: p.estabelecimento } : null;
  }

  /**
   * Troca o código pelo token e confere o token de identidade. O estado é de uso único: consumido aqui, mesmo na falha.
   * Com o estado já conferido (a segunda volta, com o código do segundo fator), devolve a identidade guardada.
   */
  async concluir(p: ProvedorDeEntrada, estado: string, codigo: string | null): Promise<IdentidadeExterna> {
    this.limpar();
    const guardada = this.conferidas.get(estado);
    if (guardada && guardada.provedor === p.codigo) return guardada.identidade;
    const pend = this.pendentes.get(estado);
    this.pendentes.delete(estado);
    if (!pend || pend.provedor !== p.codigo || !codigo)
      throw new ErroEntradaOidc('estado-invalido', 'A entrada expirou ou já foi usada. Comece de novo.');
    const d = await this.descobrir(p);
    const corpo = new URLSearchParams({
      grant_type: 'authorization_code',
      code: codigo,
      redirect_uri: pend.retorno,
      client_id: p.clienteIdentificador,
      code_verifier: pend.verificador,
    });
    if (p.referenciaCofre) {
      const segredo = this.lerSegredo ? await this.lerSegredo(p.referenciaCofre) : null;
      if (!segredo)
        throw new ErroEntradaOidc(
          'segredo-indisponivel',
          'A credencial do provedor não está no cofre de segredos.',
        );
      corpo.set('client_secret', segredo);
    }
    const token = await this.json<{ id_token?: unknown }>(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: corpo.toString(),
    });
    if (typeof token.id_token !== 'string')
      throw new ErroEntradaOidc('token-ausente', 'O provedor não devolveu o token de identidade.');
    const reivindicacoes = await this.conferirAssinatura(token.id_token, d.jwks_uri);
    const falhas = conferirReivindicacoesOidc(reivindicacoes, {
      emissor: p.emissor,
      cliente: p.clienteIdentificador,
      nonce: pend.nonce,
      agoraMs: this.agora(),
    });
    if (falhas.length)
      throw new ErroEntradaOidc('token-recusado', `Token de identidade recusado: ${falhas.join(', ')}.`);
    const email = reivindicacoes[p.atributoEmail];
    const identidade: IdentidadeExterna = {
      sujeito: String(reivindicacoes['sub']),
      email: typeof email === 'string' && email.length <= 254 ? email.toLowerCase() : null,
      emailConfirmado: reivindicacoes['email_verified'] === true,
      grupos: gruposDaReivindicacao(reivindicacoes[p.atributoGrupo]),
    };
    this.conferidas.set(estado, {
      provedor: p.codigo,
      estabelecimento: pend.estabelecimento,
      identidade,
      expiraMs: this.agora() + CONFERIDA_MS,
    });
    return identidade;
  }

  /** A sessão abriu (ou a entrada foi recusada de vez): a identidade guardada sai. */
  encerrar(estado: string): void {
    this.conferidas.delete(estado);
    this.pendentes.delete(estado);
  }

  private async conferirAssinatura(jwt: string, jwksUri: string): Promise<Record<string, unknown>> {
    const partes = jwt.split('.');
    if (partes.length !== 3) throw new ErroEntradaOidc('token-recusado', 'Token de identidade malformado.');
    const [h, c, s] = partes as [string, string, string];
    let cabecalho: { alg?: unknown; kid?: unknown };
    let corpo: Record<string, unknown>;
    try {
      cabecalho = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as typeof cabecalho;
      corpo = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new ErroEntradaOidc('token-recusado', 'Token de identidade malformado.');
    }
    const alg = cabecalho.alg;
    if (alg !== 'RS256' && alg !== 'PS256' && alg !== 'ES256')
      throw new ErroEntradaOidc('token-recusado', 'Algoritmo de assinatura não aceito.');
    const { keys } = await this.json<{ keys?: (JsonWebKey & { kid?: string; use?: string })[] }>(jwksUri);
    const candidatas = (keys ?? []).filter(
      (k) =>
        (cabecalho.kid === undefined || k.kid === cabecalho.kid) && (k.use === undefined || k.use === 'sig'),
    );
    const dados = Buffer.from(`${h}.${c}`);
    const assinatura = Buffer.from(s, 'base64url');
    const confere = candidatas.some((jwk) => {
      try {
        const chave = createPublicKey({ key: jwk, format: 'jwk' });
        if (alg === 'ES256')
          return verify('sha256', dados, { key: chave, dsaEncoding: 'ieee-p1363' }, assinatura);
        if (alg === 'PS256')
          return verify(
            'sha256',
            dados,
            { key: chave, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
            assinatura,
          );
        return verify('sha256', dados, chave, assinatura);
      } catch {
        return false;
      }
    });
    if (!confere)
      throw new ErroEntradaOidc('token-recusado', 'A assinatura do token de identidade não confere.');
    return corpo;
  }
}
