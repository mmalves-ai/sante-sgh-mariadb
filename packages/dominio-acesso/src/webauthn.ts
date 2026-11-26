// Segundo fator pela chave do dispositivo (WebAuthn/FIDO2 com biometria local; 01-ADM L62, DP-45 decidida em
// 26/11: opcional ao lado do aplicativo autenticador e do código no e-mail). A biometria NUNCA sai do dispositivo:
// o autenticador confere a digital ou o rosto e só assina o desafio; o servidor guarda apenas a chave pública da
// credencial (nenhum dado biométrico é tratado, LGPD art. 5 II e art. 11). Regra pura: só node:crypto, sem rede
// nem banco. Aqui ficam as opções da cerimônia, a conferência do cadastro (atestado "none": não se pede a marca do
// aparelho) e a conferência da assinatura na validação (desafio, origem, servidor, presença e verificação do
// usuário, contador contra clonagem).
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

/** Algoritmos COSE aceitos: ES256 (P-256), EdDSA (Ed25519) e RS256 (RSA PKCS#1 v1.5). */
export const ALGORITMOS_CREDENCIAL = [-7, -8, -257] as const;
export type AlgoritmoCredencial = (typeof ALGORITMOS_CREDENCIAL)[number];

/** Máximo de dispositivos ativos por conta (celular, notebook, chave de segurança e reserva). */
export const MAXIMO_DISPOSITIVOS_POR_CONTA = 10;
/** Validade do desafio de uma cerimônia (cadastro ou validação), em segundos. */
export const VALIDADE_DESAFIO_SEGUNDOS = 300;

export type CodigoRecusaWebAuthn =
  | 'resposta-malformada'
  | 'tipo-incorreto'
  | 'desafio-incorreto'
  | 'origem-incorreta'
  | 'servidor-incorreto'
  | 'sem-presenca'
  | 'sem-verificacao-usuario'
  | 'sem-credencial'
  | 'algoritmo-nao-aceito'
  | 'assinatura-invalida'
  | 'contador-regrediu'
  | 'nome-invalido'
  | 'limite-dispositivos';

export class ErroWebAuthn extends Error {
  constructor(
    readonly codigo: CodigoRecusaWebAuthn,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroWebAuthn';
  }
}

const recusar = (codigo: CodigoRecusaWebAuthn, mensagem: string): never => {
  throw new ErroWebAuthn(codigo, mensagem);
};

// ── base64url ──
export const paraBase64Url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
export function deBase64Url(texto: string): Buffer {
  if (typeof texto !== 'string' || !/^[A-Za-z0-9_-]*$/.test(texto))
    recusar('resposta-malformada', 'Campo da credencial fora do formato base64url.');
  return Buffer.from(texto, 'base64url');
}

/** Desafio aleatório de 32 bytes (base64url), de uso único. */
export const gerarDesafioWebAuthn = (): string => paraBase64Url(randomBytes(32));

// ── CBOR mínimo (RFC 8949): o que o atestado e a chave COSE usam ──
type ValorCbor =
  number | bigint | string | Buffer | boolean | null | undefined | ValorCbor[] | Map<unknown, ValorCbor>;

export function lerCbor(buf: Buffer, inicio = 0): { valor: ValorCbor; fim: number } {
  let p = inicio;
  const byte = (): number => {
    if (p >= buf.length) recusar('resposta-malformada', 'CBOR truncado.');
    return buf[p++]!;
  };
  const comprimento = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return byte();
    if (info === 25) return (byte() << 8) | byte();
    if (info === 26) return ((byte() << 24) >>> 0) + (byte() << 16) + (byte() << 8) + byte();
    if (info === 27) {
      let v = 0;
      for (let i = 0; i < 8; i++) v = v * 256 + byte();
      if (!Number.isSafeInteger(v)) recusar('resposta-malformada', 'CBOR: inteiro grande demais.');
      return v;
    }
    return recusar('resposta-malformada', 'CBOR: comprimento indefinido não aceito.');
  };
  const fatia = (n: number): Buffer => {
    if (p + n > buf.length) recusar('resposta-malformada', 'CBOR truncado.');
    const s = buf.subarray(p, p + n);
    p += n;
    return s;
  };
  const item = (profundidade: number): ValorCbor => {
    if (profundidade > 16) recusar('resposta-malformada', 'CBOR aninhado demais.');
    const inicial = byte();
    const maior = inicial >> 5;
    const info = inicial & 0x1f;
    switch (maior) {
      case 0:
        return comprimento(info);
      case 1:
        return -1 - comprimento(info);
      case 2:
        return Buffer.from(fatia(comprimento(info)));
      case 3:
        return fatia(comprimento(info)).toString('utf8');
      case 4: {
        const n = comprimento(info);
        const lista: ValorCbor[] = [];
        for (let i = 0; i < n; i++) lista.push(item(profundidade + 1));
        return lista;
      }
      case 5: {
        const n = comprimento(info);
        const mapa = new Map<unknown, ValorCbor>();
        for (let i = 0; i < n; i++) {
          const k = item(profundidade + 1);
          mapa.set(Buffer.isBuffer(k) ? k.toString('hex') : k, item(profundidade + 1));
        }
        return mapa;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        return recusar('resposta-malformada', 'CBOR: valor simples não aceito.');
      default:
        return recusar('resposta-malformada', 'CBOR: tipo não aceito.');
    }
  };
  const valor = item(0);
  return { valor, fim: p };
}

// ── Dados do autenticador ──
const FLAG_PRESENCA = 0x01;
const FLAG_VERIFICACAO = 0x04;
const FLAG_CREDENCIAL = 0x40;

export interface DadosAutenticador {
  readonly resumoServidor: Buffer;
  readonly presenca: boolean;
  readonly verificacaoUsuario: boolean;
  readonly contador: number;
  readonly credencial: { readonly id: Buffer; readonly chaveCose: Buffer } | null;
}

export function lerDadosAutenticador(d: Buffer): DadosAutenticador {
  if (d.length < 37) recusar('resposta-malformada', 'Dados do autenticador curtos demais.');
  const flags = d[32]!;
  const contador = d.readUInt32BE(33);
  let credencial: DadosAutenticador['credencial'] = null;
  if (flags & FLAG_CREDENCIAL) {
    if (d.length < 55) recusar('resposta-malformada', 'Credencial truncada.');
    const n = d.readUInt16BE(53);
    if (n < 16 || n > 1023 || d.length < 55 + n)
      recusar('resposta-malformada', 'Identificador da credencial inválido.');
    const id = Buffer.from(d.subarray(55, 55 + n));
    const { fim } = lerCbor(d, 55 + n);
    credencial = { id, chaveCose: Buffer.from(d.subarray(55 + n, fim)) };
  }
  return {
    resumoServidor: Buffer.from(d.subarray(0, 32)),
    presenca: (flags & FLAG_PRESENCA) !== 0,
    verificacaoUsuario: (flags & FLAG_VERIFICACAO) !== 0,
    contador,
    credencial,
  };
}

// ── Chave COSE → chave pública do node:crypto ──
export function algoritmoDaChave(chaveCose: Buffer): AlgoritmoCredencial {
  const { valor } = lerCbor(chaveCose);
  const alg = valor instanceof Map ? valor.get(3) : undefined;
  if (!ALGORITMOS_CREDENCIAL.includes(alg as AlgoritmoCredencial))
    recusar('algoritmo-nao-aceito', 'Algoritmo da credencial não aceito (use ES256, EdDSA ou RS256).');
  return alg as AlgoritmoCredencial;
}

function chavePublica(chaveCose: Buffer) {
  const { valor } = lerCbor(chaveCose);
  if (!(valor instanceof Map)) return recusar('resposta-malformada', 'Chave COSE inválida.');
  const alg = algoritmoDaChave(chaveCose);
  const b = (k: number): string => {
    const v = valor.get(k);
    if (!Buffer.isBuffer(v)) recusar('resposta-malformada', 'Chave COSE incompleta.');
    return (v as Buffer).toString('base64url');
  };
  try {
    if (alg === -7) {
      if (valor.get(1) !== 2 || valor.get(-1) !== 1)
        recusar('algoritmo-nao-aceito', 'ES256 exige curva P-256.');
      return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b(-2), y: b(-3) }, format: 'jwk' });
    }
    if (alg === -8) {
      if (valor.get(1) !== 1 || valor.get(-1) !== 6) recusar('algoritmo-nao-aceito', 'EdDSA exige Ed25519.');
      return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b(-2) }, format: 'jwk' });
    }
    if (valor.get(1) !== 3) recusar('algoritmo-nao-aceito', 'RS256 exige chave RSA.');
    return createPublicKey({ key: { kty: 'RSA', n: b(-1), e: b(-2) }, format: 'jwk' });
  } catch (e) {
    if (e instanceof ErroWebAuthn) throw e;
    return recusar('resposta-malformada', 'Chave pública da credencial inválida.');
  }
}

// ── Dados do cliente (clientDataJSON) ──
export interface ExpectativaCerimonia {
  /** Desafio emitido pelo servidor (base64url). */
  readonly desafio: string;
  /** Origens aceitas (ex.: https://hospital.exemplo). */
  readonly origens: readonly string[];
  /** Identificador do servidor (o domínio, sem porta). */
  readonly servidor: string;
  /** Biometria/PIN do dispositivo exigido (padrão: sim; é o que faz da chave um fator forte). */
  readonly exigirVerificacaoUsuario?: boolean;
}

function conferirDadosCliente(
  json: Buffer,
  tipo: 'webauthn.create' | 'webauthn.get',
  e: ExpectativaCerimonia,
): void {
  let c: { type?: unknown; challenge?: unknown; origin?: unknown };
  try {
    c = JSON.parse(json.toString('utf8')) as typeof c;
  } catch {
    return recusar('resposta-malformada', 'Dados do cliente ilegíveis.');
  }
  if (c.type !== tipo) recusar('tipo-incorreto', 'A resposta não é desta cerimônia.');
  const recebido = Buffer.from(String(c.challenge ?? ''));
  const esperado = Buffer.from(e.desafio);
  if (!e.desafio || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado))
    recusar('desafio-incorreto', 'O desafio não confere (expirado ou de outra tentativa).');
  if (typeof c.origin !== 'string' || !e.origens.includes(c.origin))
    recusar('origem-incorreta', 'A resposta veio de outra origem.');
}

function conferirAutenticador(d: DadosAutenticador, e: ExpectativaCerimonia): void {
  const esperado = createHash('sha256').update(e.servidor).digest();
  if (!timingSafeEqual(d.resumoServidor, esperado))
    recusar('servidor-incorreto', 'A credencial é de outro servidor.');
  if (!d.presenca) recusar('sem-presenca', 'O dispositivo não confirmou a presença do usuário.');
  if ((e.exigirVerificacaoUsuario ?? true) && !d.verificacaoUsuario)
    recusar('sem-verificacao-usuario', 'O dispositivo não conferiu a biometria nem o PIN do usuário.');
}

// ── Cerimônias ──
export interface RespostaCadastro {
  readonly idCredencial: string;
  readonly dadosCliente: string;
  readonly objetoAtestado: string;
}

export interface CredencialCadastrada {
  readonly idCredencial: string;
  /** Chave pública COSE (base64url): a única coisa da credencial que o servidor guarda. */
  readonly chavePublica: string;
  readonly algoritmo: AlgoritmoCredencial;
  readonly contador: number;
  readonly verificacaoUsuario: boolean;
  readonly formatoAtestado: string;
}

/** Confere a resposta de navigator.credentials.create() e devolve o que se grava. */
export function conferirCadastroCredencial(
  r: RespostaCadastro,
  e: ExpectativaCerimonia,
): CredencialCadastrada {
  conferirDadosCliente(deBase64Url(r.dadosCliente), 'webauthn.create', e);
  const { valor } = lerCbor(deBase64Url(r.objetoAtestado));
  if (!(valor instanceof Map)) return recusar('resposta-malformada', 'Atestado ilegível.');
  const fmt = valor.get('fmt');
  const dados = valor.get('authData');
  if (typeof fmt !== 'string' || !Buffer.isBuffer(dados))
    return recusar('resposta-malformada', 'Atestado incompleto.');
  const d = lerDadosAutenticador(dados);
  conferirAutenticador(d, e);
  if (!d.credencial) return recusar('sem-credencial', 'O dispositivo não devolveu a credencial.');
  if (paraBase64Url(d.credencial.id) !== r.idCredencial)
    recusar('resposta-malformada', 'O identificador da credencial não confere.');
  const algoritmo = algoritmoDaChave(d.credencial.chaveCose);
  chavePublica(d.credencial.chaveCose);
  return {
    idCredencial: r.idCredencial,
    chavePublica: paraBase64Url(d.credencial.chaveCose),
    algoritmo,
    contador: d.contador,
    verificacaoUsuario: d.verificacaoUsuario,
    formatoAtestado: fmt.slice(0, 32),
  };
}

export interface RespostaValidacao {
  readonly idCredencial: string;
  readonly dadosCliente: string;
  readonly dadosAutenticador: string;
  readonly assinatura: string;
}

/** Confere a resposta de navigator.credentials.get() contra a chave guardada. Devolve o novo contador. */
export function conferirValidacaoCredencial(
  r: RespostaValidacao,
  e: ExpectativaCerimonia,
  guardada: { readonly chavePublica: string; readonly contador: number },
): { contador: number } {
  const cliente = deBase64Url(r.dadosCliente);
  conferirDadosCliente(cliente, 'webauthn.get', e);
  const bruto = deBase64Url(r.dadosAutenticador);
  const d = lerDadosAutenticador(bruto);
  conferirAutenticador(d, e);
  const cose = deBase64Url(guardada.chavePublica);
  const alg = algoritmoDaChave(cose);
  const assinado = Buffer.concat([bruto, createHash('sha256').update(cliente).digest()]);
  let ok: boolean;
  try {
    ok = verify(alg === -8 ? null : 'sha256', assinado, chavePublica(cose), deBase64Url(r.assinatura));
  } catch (err) {
    if (err instanceof ErroWebAuthn) throw err;
    ok = false;
  }
  if (!ok) recusar('assinatura-invalida', 'A assinatura do dispositivo não confere.');
  // Contador (W3C §6.1.1): quem conta (diferente de zero) só anda para frente; regressão indica cópia da chave.
  if ((d.contador !== 0 || guardada.contador !== 0) && d.contador <= guardada.contador)
    recusar('contador-regrediu', 'O contador do dispositivo regrediu: a credencial pode ter sido copiada.');
  return { contador: d.contador };
}

/** Nome que o usuário dá ao dispositivo (ex.: "Celular", "Notebook do posto"). */
export function normalizarNomeDispositivo(nome: unknown): string {
  const n = typeof nome === 'string' ? nome.trim().replace(/\s+/g, ' ') : '';
  if (n.length < 1 || n.length > 60)
    recusar('nome-invalido', 'Dê ao dispositivo um nome de 1 a 60 caracteres.');
  return n;
}

export function conferirLimiteDispositivos(ativos: number): void {
  if (ativos >= MAXIMO_DISPOSITIVOS_POR_CONTA)
    recusar(
      'limite-dispositivos',
      `A conta já tem ${MAXIMO_DISPOSITIVOS_POR_CONTA} dispositivos: remova um antes.`,
    );
}

/** Opções de navigator.credentials.create() (JSON; o navegador converte os base64url). */
export function opcoesCadastroCredencial(p: {
  readonly desafio: string;
  readonly servidor: string;
  readonly nomeServidor: string;
  /** Identificador opaco da conta (base64url, sem dado pessoal). */
  readonly idUsuario: string;
  readonly login: string;
  readonly nomeExibicao: string;
  readonly existentes: readonly string[];
}) {
  return {
    challenge: p.desafio,
    rp: { id: p.servidor, name: p.nomeServidor },
    user: { id: p.idUsuario, name: p.login, displayName: p.nomeExibicao },
    pubKeyCredParams: ALGORITMOS_CREDENCIAL.map((alg) => ({ type: 'public-key' as const, alg })),
    timeout: VALIDADE_DESAFIO_SEGUNDOS * 1000,
    attestation: 'none' as const,
    authenticatorSelection: { userVerification: 'required' as const, residentKey: 'discouraged' as const },
    excludeCredentials: p.existentes.map((id) => ({ type: 'public-key' as const, id })),
  };
}

/** Opções de navigator.credentials.get(). */
export function opcoesValidacaoCredencial(p: {
  readonly desafio: string;
  readonly servidor: string;
  readonly credenciais: readonly string[];
}) {
  return {
    challenge: p.desafio,
    rpId: p.servidor,
    timeout: VALIDADE_DESAFIO_SEGUNDOS * 1000,
    userVerification: 'required' as const,
    allowCredentials: p.credenciais.map((id) => ({ type: 'public-key' as const, id })),
  };
}

/** Servidor (domínio) e origem a partir da URL pública do sistema. */
export function servidorDaUrlPublica(url: string): { servidor: string; origem: string } {
  const u = new URL(url);
  return { servidor: u.hostname, origem: u.origin };
}
