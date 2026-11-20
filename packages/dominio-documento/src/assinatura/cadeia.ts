// Validação criptográfica no servidor (M49, etapa 1; regra 3; SBIS-32 a SBIS-34; ICP-04): a cadeia do certificado até
// uma raiz configurada (repositório de raízes ICP-Brasil do deploy; o simulador usa a raiz sintética, que nunca está
// no repositório de produção), a vigência de cada elo, a LCR do emissor (assinatura, validade e números revogados),
// a assinatura crua de um HASH pela chave pública do certificado (PKCS#1 v1.5 com DigestInfo SHA-256) e o token do
// carimbo do tempo (SignedData do RFC 3161: atributos assinados, resumo do TSTInfo, assinatura da ACT e a cadeia dela).
// Só node:crypto e o leitor DER do motor; a rede (LCR) é do serviço que chama, que passa os bytes.
import { constants, createHash, publicDecrypt, verify, X509Certificate } from 'node:crypto';
import {
  digestInfoSha256,
  OID_ATR_RESUMO,
  OID_EXT_DISTRIBUICAO_LCR,
  OID_SIGNED_DATA,
} from './icp-sintetica.js';
import { ErroDer, lerDer, MARCA, type NoDer, oidDeBytes, textoDe, tlv } from './der.js';

/** O DER exato de um nó lido (o conteúdo de novo envolvido na marca: DER é canônico). */
export const derDoNo = (n: NoDer) => tlv(n.marca, n.conteudo);

const x509 = (der: Uint8Array): X509Certificate | null => {
  try {
    return new X509Certificate(Buffer.from(der));
  } catch {
    return null;
  }
};

const vigente = (c: X509Certificate, agora: Date) =>
  new Date(c.validFrom).getTime() <= agora.getTime() && agora.getTime() <= new Date(c.validTo).getTime();

const emitidoPor = (c: X509Certificate, emissor: X509Certificate) => {
  try {
    return c.checkIssued(emissor) && c.verify(emissor.publicKey);
  } catch {
    return false;
  }
};

export type ResultadoCadeia =
  | { readonly situacao: 'ok'; readonly emissor: Uint8Array; readonly raiz: Uint8Array }
  | { readonly situacao: 'invalida'; readonly motivo: 'malformado' | 'sem-raiz' | 'elo-fora-da-vigencia' };

/**
 * Sobe do certificado até uma das raízes confiáveis, pelos intermediários dados (no máximo 6 elos). Cada elo é
 * conferido pela assinatura do emissor (verify) e pelo casamento do nome (checkIssued), e tem de estar vigente.
 */
export function verificarCadeia(
  certificado: Uint8Array,
  intermediarios: readonly Uint8Array[],
  raizes: readonly Uint8Array[],
  agora: Date,
): ResultadoCadeia {
  const folha = x509(certificado);
  if (!folha) return { situacao: 'invalida', motivo: 'malformado' };
  const confiaveis = raizes.map((r) => x509(r)).filter((r): r is X509Certificate => r !== null);
  const meio = intermediarios.map((r) => x509(r)).filter((r): r is X509Certificate => r !== null);
  let atual = folha;
  let emissorDaFolha: X509Certificate | null = null;
  for (let elo = 0; elo < 6; elo++) {
    const raiz = confiaveis.find((r) => emitidoPor(atual, r));
    if (raiz) {
      if (!vigente(raiz, agora)) return { situacao: 'invalida', motivo: 'elo-fora-da-vigencia' };
      return {
        situacao: 'ok',
        emissor: Uint8Array.from((emissorDaFolha ?? raiz).raw),
        raiz: Uint8Array.from(raiz.raw),
      };
    }
    const proximo = meio.find((m) => m.ca && emitidoPor(atual, m));
    if (!proximo) return { situacao: 'invalida', motivo: 'sem-raiz' };
    if (!vigente(proximo, agora)) return { situacao: 'invalida', motivo: 'elo-fora-da-vigencia' };
    emissorDaFolha ??= proximo;
    atual = proximo;
  }
  return { situacao: 'invalida', motivo: 'sem-raiz' };
}

const filhos = (n: NoDer | undefined, o: string): readonly NoDer[] => {
  if (!n?.filhos) throw new ErroDer(`Estrutura malformada: ${o}.`);
  return n.filhos;
};

function tempo(n: NoDer): Date {
  const s = textoDe(n);
  let m: RegExpMatchArray | null;
  if (n.marca === 0x17 && (m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    const a = Number(m[1]);
    return new Date(Date.UTC(a < 50 ? 2000 + a : 1900 + a, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  }
  if (n.marca === 0x18 && (m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/)))
    return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  throw new ErroDer('Data fora do formato.');
}

const hexSerie = (b: Uint8Array) =>
  Buffer.from(b)
    .toString('hex')
    .replace(/^(00)+(?=..)/, '');

/** Endereços (http) das LCR no ponto de distribuição do certificado (extensão 2.5.29.31). */
export function enderecosLcr(certificado: Uint8Array): string[] {
  const tbs = filhos(filhos(lerDer(certificado), 'Certificate')[0], 'TBSCertificate');
  const exts = tbs.find((c) => c.marca === 0xa3);
  if (!exts) return [];
  const r: string[] = [];
  for (const ext of filhos(filhos(exts, 'Extensions')[0], 'Extensions')) {
    const partes = filhos(ext, 'Extension');
    if (oidDeBytes(partes[0]!.conteudo) !== OID_EXT_DISTRIBUICAO_LCR) continue;
    const valor = lerDer(partes[partes.length - 1]!.conteudo);
    for (const ponto of filhos(valor, 'CRLDistributionPoints'))
      for (const nomePonto of ponto.filhos ?? [])
        for (const completo of nomePonto.marca === 0xa0 ? (nomePonto.filhos ?? []) : [])
          for (const g of completo.marca === 0xa0 ? (completo.filhos ?? []) : [])
            if (g.marca === 0x86) {
              const uri = new TextDecoder().decode(g.conteudo);
              if (/^https?:\/\//.test(uri)) r.push(uri);
            }
  }
  return r;
}

export interface LcrLida {
  readonly estaAtualizacao: Date;
  readonly proximaAtualizacao: Date | null;
  readonly revogados: ReadonlySet<string>;
}

export type ConferenciaLcr =
  | { readonly ok: true; readonly lcr: LcrLida }
  | { readonly ok: false; readonly motivo: 'malformada' | 'assinatura' | 'vencida' };

/** Lê a LCR, confere a assinatura do emissor e a validade (próxima atualização no futuro). */
export function conferirLcr(der: Uint8Array, emissor: Uint8Array, agora: Date): ConferenciaLcr {
  let tbsNo: NoDer;
  let assinatura: Uint8Array;
  let lcr: LcrLida;
  try {
    const [t, , sig] = filhos(lerDer(der), 'CertificateList');
    tbsNo = t!;
    if (sig?.marca !== MARCA.bitString) throw new ErroDer('LCR sem assinatura.');
    assinatura = sig.conteudo.subarray(1);
    const campos = filhos(tbsNo, 'TBSCertList');
    let i = campos[0]?.marca === MARCA.inteiro ? 1 : 0;
    i += 2; // algoritmo e emissor
    const esta = tempo(campos[i++]!);
    const prox =
      campos[i] && (campos[i]!.marca === 0x17 || campos[i]!.marca === 0x18) ? tempo(campos[i++]!) : null;
    const revogados = new Set<string>();
    const lista = campos[i];
    if (lista?.marca === MARCA.sequencia)
      for (const item of lista.filhos ?? [])
        revogados.add(hexSerie(filhos(item, 'revokedCertificate')[0]!.conteudo));
    lcr = { estaAtualizacao: esta, proximaAtualizacao: prox, revogados };
  } catch {
    return { ok: false, motivo: 'malformada' };
  }
  const chave = x509(emissor)?.publicKey;
  let confere: boolean;
  try {
    confere = !!chave && verify('sha256', derDoNo(tbsNo), chave, assinatura);
  } catch {
    confere = false;
  }
  if (!confere) return { ok: false, motivo: 'assinatura' };
  if (lcr.proximaAtualizacao && lcr.proximaAtualizacao.getTime() < agora.getTime())
    return { ok: false, motivo: 'vencida' };
  return { ok: true, lcr };
}

/** Número de série do certificado em hex (o mesmo formato da LCR e do leitor do certificado). */
export function serieDoCertificado(certificado: Uint8Array): string {
  const tbs = filhos(filhos(lerDer(certificado), 'Certificate')[0], 'TBSCertificate');
  const serial = tbs[0]?.marca === 0xa0 ? tbs[1] : tbs[0];
  if (serial?.marca !== MARCA.inteiro) throw new ErroDer('Certificado sem série.');
  return hexSerie(serial.conteudo);
}

/**
 * A assinatura crua (PKCS#1 v1.5) é do HASH dado, pela chave do certificado: decifra com a chave pública e compara o
 * DigestInfo SHA-256 byte a byte. Qualquer erro (chave não RSA, tamanho, padding) é "não confere".
 */
export function conferirAssinaturaHash(
  certificado: Uint8Array,
  hash: Uint8Array,
  assinatura: Uint8Array,
): boolean {
  const c = x509(certificado);
  if (!c || hash.length !== 32) return false;
  try {
    const claro = publicDecrypt(
      { key: c.publicKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(assinatura),
    );
    return Buffer.compare(claro, Buffer.from(digestInfoSha256(hash))) === 0;
  } catch {
    return false;
  }
}

export type ConferenciaTokenCarimbo =
  | { readonly ok: true; readonly certificadoAct: Uint8Array }
  | {
      readonly ok: false;
      readonly motivo: 'malformado' | 'sem-certificado' | 'resumo-divergente' | 'assinatura' | 'cadeia-act';
    };

/**
 * Confere o token do carimbo (SignedData): o certificado da ACT veio no token, o atributo messageDigest é o SHA-256
 * do TSTInfo, a ACT assinou os atributos (ou o TSTInfo, sem atributos) e a cadeia dela chega a uma raiz confiável.
 */
export function conferirTokenCarimbo(
  resposta: Uint8Array,
  raizes: readonly Uint8Array[],
  intermediarios: readonly Uint8Array[],
  agora: Date,
): ConferenciaTokenCarimbo {
  let certificadoAct: Uint8Array;
  let assinado: Uint8Array;
  let assinatura: Uint8Array;
  try {
    const [, token] = filhos(lerDer(resposta), 'TimeStampResp');
    const [tipo, conteudo] = filhos(token, 'ContentInfo');
    if (oidDeBytes(tipo!.conteudo) !== OID_SIGNED_DATA) return { ok: false, motivo: 'malformado' };
    const signed = filhos(filhos(conteudo, 'content')[0], 'SignedData');
    const encap = filhos(signed[2], 'EncapsulatedContentInfo');
    const tst = filhos(encap[1], 'eContent')[0]!.conteudo;
    const certs = signed.find((n, i) => i > 2 && n.marca === 0xa0);
    const primeiro = certs?.filhos?.[0];
    if (!primeiro) return { ok: false, motivo: 'sem-certificado' };
    certificadoAct = derDoNo(primeiro);
    const signers = signed[signed.length - 1]!;
    const si = filhos(filhos(signers, 'SignerInfos')[0], 'SignerInfo');
    const attrs = si.find((n) => n.marca === 0xa0);
    const sig = si[si.length - 1]!;
    assinatura = sig.conteudo;
    const resumoTst = createHash('sha256').update(tst).digest();
    if (attrs) {
      const md = (attrs.filhos ?? []).find((a) => oidDeBytes(a.filhos![0]!.conteudo) === OID_ATR_RESUMO);
      const valor = md?.filhos?.[1]?.filhos?.[0]?.conteudo;
      if (!valor || Buffer.compare(Buffer.from(valor), resumoTst) !== 0)
        return { ok: false, motivo: 'resumo-divergente' };
      assinado = tlv(MARCA.conjunto, attrs.conteudo);
    } else assinado = tst;
  } catch {
    return { ok: false, motivo: 'malformado' };
  }
  const c = x509(certificadoAct);
  let confere: boolean;
  try {
    confere = !!c && verify('sha256', Buffer.from(assinado), c.publicKey, Buffer.from(assinatura));
  } catch {
    confere = false;
  }
  if (!confere) return { ok: false, motivo: 'assinatura' };
  if (verificarCadeia(certificadoAct, intermediarios, raizes, agora).situacao !== 'ok')
    return { ok: false, motivo: 'cadeia-act' };
  return { ok: true, certificadoAct };
}

/** Lê o TimeStampReq (o hash e o nonce): o lado da ACT do simulador. */
export function lerPedidoCarimbo(der: Uint8Array): { hash: Uint8Array; nonce: Uint8Array | null } {
  const campos = filhos(lerDer(der), 'TimeStampReq');
  const imprint = filhos(campos[1], 'MessageImprint');
  const nonce = campos.slice(2).find((n) => n.marca === MARCA.inteiro);
  return {
    hash: Uint8Array.from(imprint[1]!.conteudo),
    nonce: nonce ? Uint8Array.from(nonce.conteudo) : null,
  };
}
