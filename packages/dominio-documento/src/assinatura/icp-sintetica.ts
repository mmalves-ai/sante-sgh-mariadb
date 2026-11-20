// ICP SINTÉTICA do simulador (M49, etapa 1; ficha, seção 10: "integração com simulador de PSC e de ACT"): uma AC raiz
// de teste, certificados de titular com chave RSA de verdade (o CPF no OID 2.16.76.1.3.1, KeyUsage, políticas e o
// ponto de distribuição da LCR), a LCR assinada pela raiz, a assinatura PKCS#1 v1.5 de um hash e o carimbo do tempo
// (TimeStampResp RFC 3161 com SignedData e atributos assinados). Tudo montado com o codificador DER do motor e o
// node:crypto, sem biblioteca nova. NUNCA vale fora de dev/ci: a raiz se chama "AC RAIZ SINTETICA SANTE" e o
// validador de produção só confia nas raízes ICP-Brasil configuradas (cadeia.ts), então nada daqui passa por válido
// em produção. Usado pelo simulador do provedor e da ACT da API (dev/ci) e pelos testes.
import {
  constants,
  createHash,
  generateKeyPairSync,
  type KeyObject,
  privateEncrypt,
  randomBytes,
  sign,
} from 'node:crypto';
import {
  booleano,
  concatenar,
  contexto,
  inteiroPequeno,
  inteiroSemSinal,
  MARCA,
  nulo,
  octetos,
  oid,
  sequencia,
  texto,
  tlv,
} from './der.js';
import {
  OID_EXT_KEY_USAGE,
  OID_EXT_POLITICAS_CERTIFICADO,
  OID_EXT_SUBJECT_ALT_NAME,
  OID_PF_DADOS_TITULAR,
  OID_SHA256,
  RAIZ_POLITICA_POR_TIPO,
} from './oids.js';

export const OID_RSA_SHA256 = '1.2.840.113549.1.1.11';
export const OID_RSA = '1.2.840.113549.1.1.1';
export const OID_EXT_RESTRICOES_BASICAS = '2.5.29.19';
export const OID_EXT_DISTRIBUICAO_LCR = '2.5.29.31';
export const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
export const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4';
export const OID_ATR_TIPO_CONTEUDO = '1.2.840.113549.1.9.3';
export const OID_ATR_RESUMO = '1.2.840.113549.1.9.4';
/** Política de carimbo da ACT sintética (fora do arco 2.16.76 da ICP-Brasil de propósito). */
export const POLITICA_CARIMBO_SINTETICA = '1.3.6.1.4.1.99999.49.1';

export const NOME_RAIZ_SINTETICA = 'AC RAIZ SINTETICA SANTE';

/** DigestInfo do SHA-256 (RFC 8017 §9.2): o que a assinatura PKCS#1 v1.5 cifra com a chave privada. */
export function digestInfoSha256(hash: Uint8Array): Uint8Array {
  if (hash.length !== 32) throw new Error('Hash SHA-256 de 32 bytes.');
  return sequencia(sequencia(oid(OID_SHA256), nulo()), octetos(hash));
}

const algoritmoRsaSha256 = () => sequencia(oid(OID_RSA_SHA256), nulo());

const tempoUtc = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return texto(
    0x17,
    `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`,
  );
};

const tempoGeneralizado = (d: Date) => texto(0x18, `${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`);

export const nomeX500 = (cn: string) =>
  sequencia(tlv(MARCA.conjunto, sequencia(oid('2.5.4.3'), texto(MARCA.utf8, cn))));

const extensao = (id: string, valor: Uint8Array, critica = false) =>
  sequencia(oid(id), ...(critica ? [booleano(true)] : []), octetos(valor));

const spki = (k: KeyObject) => Uint8Array.from(k.export({ type: 'spki', format: 'der' }));

/** A chave e o certificado de uma entidade da ICP sintética. */
export interface EntidadeSintetica {
  readonly nome: string;
  readonly chave: KeyObject;
  readonly publica: KeyObject;
  readonly certificado: Uint8Array;
  /** Número de série (bytes) do certificado. */
  readonly serie: Uint8Array;
}

function assinarCertificado(tbs: Uint8Array, emissor: KeyObject): Uint8Array {
  const assinatura = sign('sha256', tbs, emissor);
  return sequencia(tbs, algoritmoRsaSha256(), tlv(MARCA.bitString, concatenar(Uint8Array.of(0), assinatura)));
}

/** Série positiva e sem zero à esquerda (o bit alto desligado: o INTEGER não ganha byte de sinal). */
function serieBytes(b: Uint8Array): Uint8Array {
  const c = Uint8Array.from(b);
  c[0] = (c[0]! & 0x7f) | 0x01;
  return c;
}

function parDeChaves(): { chave: KeyObject; publica: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { chave: privateKey, publica: publicKey };
}

/** A raiz sintética (autoassinada, CA, assina certificados e LCR). */
export function criarRaizSintetica(agora: Date, nome = NOME_RAIZ_SINTETICA): EntidadeSintetica {
  const { chave, publica } = parDeChaves();
  const serie = serieBytes(randomBytes(8));
  const tbs = sequencia(
    contexto(0, inteiroPequeno(2)),
    inteiroSemSinal(serie),
    algoritmoRsaSha256(),
    nomeX500(nome),
    sequencia(
      tempoUtc(new Date(agora.getTime() - 86_400_000)),
      tempoUtc(new Date(agora.getTime() + 10 * 365 * 86_400_000)),
    ),
    nomeX500(nome),
    spki(publica),
    contexto(
      3,
      sequencia(
        extensao(OID_EXT_RESTRICOES_BASICAS, sequencia(booleano(true)), true),
        // keyCertSign (bit 5) e cRLSign (bit 6): 0x06, com 1 bit de sobra.
        extensao(OID_EXT_KEY_USAGE, tlv(MARCA.bitString, Uint8Array.of(1, 0x06)), true),
      ),
    ),
  );
  return { nome, chave, publica, serie, certificado: assinarCertificado(tbs, chave) };
}

export interface OpcoesTitularSintetico {
  readonly cpf: string | null;
  readonly nome?: string;
  readonly validoDe?: Date;
  readonly validoAte?: Date;
  /** Bits do KeyUsage (0x80 assinatura digital, 0x40 não repúdio); padrão 0xc0. */
  readonly usoDaChave?: number;
  /** Políticas do certificado; padrão A3 da ICP-Brasil. */
  readonly politicas?: readonly string[];
  /** Endereço da LCR (ponto de distribuição); null: sem a extensão. */
  readonly lcr?: string | null;
  readonly serie?: Uint8Array;
  /** Certificado de carimbo do tempo (extKeyUsage timeStamping, sem CPF). */
  readonly carimbo?: boolean;
}

function pontoDistribuicao(uri: string): Uint8Array {
  // DistributionPoint { distributionPoint [0] { fullName [0] { uniformResourceIdentifier [6] } } }
  return sequencia(sequencia(contexto(0, contexto(0, tlv(0x86, new TextEncoder().encode(uri))))));
}

/** Certificado de titular (ou da ACT) emitido pela raiz sintética, com chave RSA própria. */
export function emitirSintetico(
  raiz: EntidadeSintetica,
  o: OpcoesTitularSintetico,
  agora: Date,
): EntidadeSintetica {
  const { chave, publica } = parDeChaves();
  const serie = serieBytes(o.serie ?? randomBytes(10));
  const nome = o.nome ?? (o.carimbo ? 'ACT SINTETICA SANTE' : 'TITULAR SINTETICO');
  const exts: Uint8Array[] = [
    extensao(OID_EXT_KEY_USAGE, tlv(MARCA.bitString, Uint8Array.of(6, o.usoDaChave ?? 0xc0)), true),
  ];
  if (o.carimbo) {
    // extKeyUsage id-kp-timeStamping, crítica (RFC 3161 §2.3).
    exts.push(extensao('2.5.29.37', sequencia(oid('1.3.6.1.5.5.7.3.8')), true));
  } else {
    exts.push(
      extensao(
        OID_EXT_POLITICAS_CERTIFICADO,
        sequencia(...(o.politicas ?? [`${RAIZ_POLITICA_POR_TIPO.A3}.49`]).map((p) => sequencia(oid(p)))),
      ),
    );
  }
  if (o.cpf) {
    const valor = `01011990${o.cpf}${'0'.repeat(11)}${'0'.repeat(15)}${'0'.repeat(6)}`;
    exts.push(
      extensao(
        OID_EXT_SUBJECT_ALT_NAME,
        sequencia(
          contexto(
            0,
            concatenar(oid(OID_PF_DADOS_TITULAR), contexto(0, octetos(new TextEncoder().encode(valor)))),
          ),
        ),
      ),
    );
  }
  if (o.lcr) exts.push(extensao(OID_EXT_DISTRIBUICAO_LCR, pontoDistribuicao(o.lcr)));
  const tbs = sequencia(
    contexto(0, inteiroPequeno(2)),
    inteiroSemSinal(serie),
    algoritmoRsaSha256(),
    nomeX500(raiz.nome),
    sequencia(
      tempoUtc(o.validoDe ?? new Date(agora.getTime() - 86_400_000)),
      tempoUtc(o.validoAte ?? new Date(agora.getTime() + 365 * 86_400_000)),
    ),
    nomeX500(nome),
    spki(publica),
    contexto(3, sequencia(...exts)),
  );
  return { nome, chave, publica, serie, certificado: assinarCertificado(tbs, raiz.chave) };
}

/** Assinatura PKCS#1 v1.5 do HASH (não do documento): o que o provedor devolve como assinatura crua. */
export function assinarHashRsa(chave: KeyObject, hash: Uint8Array): Uint8Array {
  return Uint8Array.from(
    privateEncrypt({ key: chave, padding: constants.RSA_PKCS1_PADDING }, digestInfoSha256(hash)),
  );
}

/** LCR v2 assinada pela raiz, com os números de série revogados (hex). */
export function emitirLcrSintetica(
  raiz: EntidadeSintetica,
  revogados: readonly string[],
  agora: Date,
  validadeH = 24,
): Uint8Array {
  const lista = revogados.map((s) =>
    sequencia(
      inteiroSemSinal(Uint8Array.from(Buffer.from(s.length % 2 ? `0${s}` : s, 'hex'))),
      tempoUtc(agora),
    ),
  );
  const tbs = sequencia(
    inteiroPequeno(1),
    algoritmoRsaSha256(),
    nomeX500(raiz.nome),
    tempoUtc(new Date(agora.getTime() - 60_000)),
    tempoUtc(new Date(agora.getTime() + validadeH * 3_600_000)),
    ...(lista.length ? [sequencia(...lista)] : []),
  );
  return assinarCertificado(tbs, raiz.chave);
}

/** Lê o TimeStampReq que o serviço manda (o hash e o nonce), para a ACT sintética responder. */
export interface PedidoCarimboLido {
  readonly hash: Uint8Array;
  readonly nonce: Uint8Array | null;
}

/**
 * Resposta da ACT sintética (RFC 3161): TimeStampResp concedido, com o token SignedData (TSTInfo, o certificado da
 * ACT e o SignerInfo com os atributos assinados contentType e messageDigest).
 */
export function carimbarSintetico(
  act: EntidadeSintetica,
  raizNome: string,
  pedido: PedidoCarimboLido,
  agora: Date,
): Uint8Array {
  const tst = sequencia(
    inteiroPequeno(1),
    oid(POLITICA_CARIMBO_SINTETICA),
    sequencia(sequencia(oid(OID_SHA256), nulo()), octetos(pedido.hash)),
    inteiroSemSinal(randomBytes(8)),
    tempoGeneralizado(agora),
    ...(pedido.nonce ? [inteiroSemSinal(pedido.nonce)] : []),
  );
  const resumo = Uint8Array.from(createHash('sha256').update(tst).digest());
  const atributos = concatenar(
    sequencia(oid(OID_ATR_TIPO_CONTEUDO), tlv(MARCA.conjunto, oid(OID_TST_INFO))),
    sequencia(oid(OID_ATR_RESUMO), tlv(MARCA.conjunto, octetos(resumo))),
  );
  // A assinatura cobre o SET OF dos atributos (marca 0x31), não a forma implícita [0] (RFC 5652 §5.4).
  const assinatura = sign('sha256', tlv(MARCA.conjunto, atributos), act.chave);
  const signerInfo = sequencia(
    inteiroPequeno(1),
    sequencia(nomeX500(raizNome), inteiroSemSinal(act.serie)),
    sequencia(oid(OID_SHA256), nulo()),
    contexto(0, atributos),
    sequencia(oid(OID_RSA), nulo()),
    octetos(Uint8Array.from(assinatura)),
  );
  const signed = sequencia(
    inteiroPequeno(3),
    tlv(MARCA.conjunto, sequencia(oid(OID_SHA256), nulo())),
    sequencia(oid(OID_TST_INFO), contexto(0, octetos(tst))),
    contexto(0, act.certificado),
    tlv(MARCA.conjunto, signerInfo),
  );
  return sequencia(sequencia(inteiroPequeno(0)), sequencia(oid(OID_SIGNED_DATA), contexto(0, signed)));
}

/** Resposta de recusa da ACT (status 2, rejection). */
export const carimboRecusadoSintetico = () => sequencia(sequencia(inteiroPequeno(2)));

/** CPF SINTÉTICO com dígitos verificadores válidos a partir de 9 dígitos de base (nunca de pessoa real). */
export function cpfSinteticoDe(base9: string): string {
  if (!/^\d{9}$/.test(base9)) throw new Error('Base do CPF sintético com 9 dígitos.');
  const d = base9.split('').map(Number);
  for (const n of [9, 10]) {
    let s = 0;
    for (let k = 0; k < n; k++) s += d[k]! * (n + 1 - k);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}

/** O CPF sintético do usuário da sessão sintética de dev/ci (o mesmo para todo login) e um outro, para a recusa. */
export const CPF_SINTETICO_SESSAO = cpfSinteticoDe('900000001');
export const CPF_SINTETICO_OUTRO = cpfSinteticoDe('900000002');
