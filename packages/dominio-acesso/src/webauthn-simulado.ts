// Autenticador WebAuthn SIMULADO, só para testes (unitário do domínio e contrato de efeito da API): gera um par de
// chaves no processo e monta as respostas de navigator.credentials.create() e .get() como um dispositivo faria,
// sem biometria real nem dado de pessoa. Nunca é usado pelo fluxo de produção.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { RespostaCadastro, RespostaValidacao } from './webauthn.js';

type Cbor = number | string | Buffer | Cbor[] | Map<number | string, Cbor>;

function cabecalho(maior: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(maior << 5) | n]);
  if (n < 256) return Buffer.from([(maior << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(maior << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (maior << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

export function codificarCbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? cabecalho(0, v) : cabecalho(1, -1 - v);
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8');
    return Buffer.concat([cabecalho(3, b.length), b]);
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([cabecalho(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([cabecalho(4, v.length), ...v.map(codificarCbor)]);
  const partes: Buffer[] = [cabecalho(5, v.size)];
  for (const [k, x] of v) partes.push(codificarCbor(k), codificarCbor(x));
  return Buffer.concat(partes);
}

const b64 = (b: Buffer): string => b.toString('base64url');

export class AutenticadorWebAuthnSimulado {
  readonly id: Buffer = randomBytes(32);
  private readonly privada: KeyObject;
  private readonly cose: Buffer;
  contador: number;
  /** Desligue para simular um dispositivo que não conferiu a biometria/PIN. */
  verificaUsuario = true;

  readonly algoritmo: -7 | -8;
  constructor(algoritmo: -7 | -8 = -7, contadorInicial = 0) {
    this.algoritmo = algoritmo;
    this.contador = contadorInicial;
    if (algoritmo === -7) {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const j = publicKey.export({ format: 'jwk' });
      this.privada = privateKey;
      this.cose = codificarCbor(
        new Map<number, Cbor>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(j.x!, 'base64url')],
          [-3, Buffer.from(j.y!, 'base64url')],
        ]),
      );
    } else {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const j = publicKey.export({ format: 'jwk' });
      this.privada = privateKey;
      this.cose = codificarCbor(
        new Map<number, Cbor>([
          [1, 1],
          [3, -8],
          [-1, 6],
          [-2, Buffer.from(j.x!, 'base64url')],
        ]),
      );
    }
  }

  get idCredencial(): string {
    return b64(this.id);
  }

  private dados(servidor: string, comCredencial: boolean): Buffer {
    const flags = 0x01 | (this.verificaUsuario ? 0x04 : 0) | (comCredencial ? 0x40 : 0);
    const cont = Buffer.alloc(4);
    cont.writeUInt32BE(this.contador >>> 0);
    const base = Buffer.concat([createHash('sha256').update(servidor).digest(), Buffer.from([flags]), cont]);
    if (!comCredencial) return base;
    const tam = Buffer.alloc(2);
    tam.writeUInt16BE(this.id.length);
    return Buffer.concat([base, Buffer.alloc(16), tam, this.id, this.cose]);
  }

  private cliente(tipo: string, desafio: string, origem: string): Buffer {
    return Buffer.from(
      JSON.stringify({ type: tipo, challenge: desafio, origin: origem, crossOrigin: false }),
    );
  }

  cadastrar(desafio: string, origem: string, servidor: string): RespostaCadastro {
    const atestado = codificarCbor(
      new Map<string, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', this.dados(servidor, true)],
      ]),
    );
    return {
      idCredencial: this.idCredencial,
      dadosCliente: b64(this.cliente('webauthn.create', desafio, origem)),
      objetoAtestado: b64(atestado),
    };
  }

  /** Assina o desafio (o contador anda 1 antes, como num dispositivo que conta). */
  validar(desafio: string, origem: string, servidor: string, avancar = true): RespostaValidacao {
    if (avancar) this.contador += 1;
    const dados = this.dados(servidor, false);
    const cliente = this.cliente('webauthn.get', desafio, origem);
    const assinado = Buffer.concat([dados, createHash('sha256').update(cliente).digest()]);
    const assinatura = sign(this.algoritmo === -8 ? null : 'sha256', assinado, this.privada);
    return {
      idCredencial: this.idCredencial,
      dadosCliente: b64(cliente),
      dadosAutenticador: b64(dados),
      assinatura: b64(assinatura),
    };
  }
}
