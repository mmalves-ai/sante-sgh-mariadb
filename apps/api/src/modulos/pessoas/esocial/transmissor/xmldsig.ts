// Assinatura XMLDSig do evento do eSocial (M53.6, achado do corretor; leiaute S-1.3, "Manual de Orientação do
// Desenvolvedor", assinatura digital): assinatura envelopada no fim do elemento `eSocial`, `Reference URI=""`, as
// transformações `enveloped-signature` e C14N 1.0 (sem comentários), resumo SHA-256, assinatura RSA-SHA256 e o
// certificado do empregador (ou do procurador) em `KeyInfo/X509Data/X509Certificate`. Feita com o node:crypto, sem
// biblioteca nova.
//
// A forma canônica (C14N 1.0 inclusiva) é implementada para os documentos do próprio Sante SGH: sem conteúdo misto
// (texto e elemento no mesmo pai), sem DTD e sem comentários (D-C14N-536). É o que o gerador do evento produz; o
// `conferirAssinaturaEvento` refaz a conta e serve de prova antes do envio e nos testes de contrato.
import { createHash, createPublicKey, type KeyObject, sign, verify, X509Certificate } from 'node:crypto';
import { ErroXml, lerXml, type NoLido, nomeLocal } from './xml-leitura.js';

export const DS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ENVELOPADA = `${DS}enveloped-signature`;

const escTexto = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const escAtributo = (t: string) =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');

const ehDeclaracao = (k: string) => k === 'xmlns' || k.startsWith('xmlns:');
const prefixoDaDeclaracao = (k: string) => (k === 'xmlns' ? '' : k.slice(6));

/**
 * A forma canônica C14N 1.0 (inclusiva, sem comentários) do elemento como ápice do conjunto: as declarações de
 * namespace herdadas dos ancestrais (`emEscopo`) saem no ápice, como a especificação pede para um subconjunto.
 */
export function canonizar(no: NoLido, emEscopo: ReadonlyMap<string, string> = new Map()): string {
  return canonizarNo(no, new Map(emEscopo), new Map());
}

function canonizarNo(
  no: NoLido,
  escopo: Map<string, string>,
  renderizado: ReadonlyMap<string, string>,
): string {
  const meu = new Map(escopo);
  for (const [k, v] of no.atributos) if (ehDeclaracao(k)) meu.set(prefixoDaDeclaracao(k), v);
  const ns: [string, string][] = [];
  for (const [p, uri] of [...meu.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const antes = renderizado.get(p) ?? '';
    if (uri === antes) continue;
    ns.push([p, uri]);
  }
  const proximo = new Map(renderizado);
  for (const [p, uri] of ns) proximo.set(p, uri);
  const attrs = no.atributos
    .filter(([k]) => !ehDeclaracao(k))
    .map(([k, v]) => {
      const i = k.indexOf(':');
      const uri = i < 0 ? '' : (meu.get(k.slice(0, i)) ?? '');
      return { k, v, uri, local: i < 0 ? k : k.slice(i + 1) };
    })
    .sort((a, b) =>
      a.uri !== b.uri ? (a.uri < b.uri ? -1 : 1) : a.local < b.local ? -1 : a.local > b.local ? 1 : 0,
    );
  const abre =
    `<${no.nome}` +
    ns.map(([p, uri]) => ` ${p === '' ? 'xmlns' : `xmlns:${p}`}="${escAtributo(uri)}"`).join('') +
    attrs.map((a) => ` ${a.k}="${escAtributo(a.v)}"`).join('') +
    '>';
  const corpo = no.filhos.length
    ? no.filhos.map((f) => canonizarNo(f, meu, proximo)).join('')
    : escTexto(no.texto);
  return `${abre}${corpo}</${no.nome}>`;
}

const folha = (nome: string, texto: string, atributos: [string, string][] = []): NoLido => ({
  nome,
  atributos,
  filhos: [],
  texto,
});
const ramo = (nome: string, filhos: NoLido[], atributos: [string, string][] = []): NoLido => ({
  nome,
  atributos,
  filhos,
  texto: '',
});

export interface CertificadoAssinatura {
  readonly chave: KeyObject;
  /** O certificado do titular em DER. */
  readonly certificadoDer: Uint8Array;
}

const digest = (t: string) => createHash('sha256').update(t, 'utf8').digest('base64');

function signedInfo(valorResumo: string): NoLido {
  return ramo('SignedInfo', [
    folha('CanonicalizationMethod', '', [['Algorithm', C14N]]),
    folha('SignatureMethod', '', [['Algorithm', RSA_SHA256]]),
    ramo(
      'Reference',
      [
        ramo('Transforms', [
          folha('Transform', '', [['Algorithm', ENVELOPADA]]),
          folha('Transform', '', [['Algorithm', C14N]]),
        ]),
        folha('DigestMethod', '', [['Algorithm', SHA256]]),
        folha('DigestValue', valorResumo),
      ],
      [['URI', '']],
    ),
  ]);
}

const escopoDaAssinatura: ReadonlyMap<string, string> = new Map([['', DS]]);

/**
 * Assina o evento gerado (o XML gravado, sem assinatura) e devolve o documento assinado na forma canônica, sem a
 * declaração XML (é assim que ele entra no lote). Recusa evento que já traga assinatura.
 */
export function assinarEventoEsocial(xml: string, cert: CertificadoAssinatura): string {
  const raiz = lerXml(xml);
  if (nomeLocal(raiz.nome) !== 'eSocial') throw new ErroXml('O evento não começa por eSocial.');
  if (raiz.filhos.some((f) => nomeLocal(f.nome) === 'Signature'))
    throw new ErroXml('O evento já está assinado.');
  const resumo = digest(canonizar(raiz));
  const si = signedInfo(resumo);
  const valor = sign('sha256', Buffer.from(canonizar(si, escopoDaAssinatura), 'utf8'), cert.chave).toString(
    'base64',
  );
  const assinatura = ramo(
    'Signature',
    [
      si,
      folha('SignatureValue', valor),
      ramo('KeyInfo', [
        ramo('X509Data', [folha('X509Certificate', Buffer.from(cert.certificadoDer).toString('base64'))]),
      ]),
    ],
    [['xmlns', DS]],
  );
  return canonizar({ ...raiz, filhos: [...raiz.filhos, assinatura] });
}

export type ConferenciaAssinatura =
  | { readonly ok: true; readonly certificado: X509Certificate }
  | { readonly ok: false; readonly motivo: string };

/** Confere a assinatura do evento: o resumo do documento sem a assinatura e a assinatura do SignedInfo. */
export function conferirAssinaturaEvento(xmlAssinado: string): ConferenciaAssinatura {
  let raiz: NoLido;
  try {
    raiz = lerXml(xmlAssinado);
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
  const ult = raiz.filhos[raiz.filhos.length - 1];
  if (!ult || nomeLocal(ult.nome) !== 'Signature')
    return { ok: false, motivo: 'Sem assinatura no fim do evento.' };
  const si = ult.filhos.find((f) => nomeLocal(f.nome) === 'SignedInfo');
  const sv = ult.filhos.find((f) => nomeLocal(f.nome) === 'SignatureValue')?.texto.trim();
  const certB64 = (function achar(n: NoLido): string | null {
    if (nomeLocal(n.nome) === 'X509Certificate') return n.texto.replace(/\s+/g, '');
    for (const f of n.filhos) {
      const r = achar(f);
      if (r) return r;
    }
    return null;
  })(ult);
  if (!si || !sv || !certB64) return { ok: false, motivo: 'Assinatura incompleta.' };
  const ref = si.filhos.find((f) => nomeLocal(f.nome) === 'Reference');
  const dv = ref?.filhos.find((f) => nomeLocal(f.nome) === 'DigestValue')?.texto.trim();
  const semAssinatura: NoLido = { ...raiz, filhos: raiz.filhos.slice(0, -1) };
  if (dv !== digest(canonizar(semAssinatura)))
    return { ok: false, motivo: 'O resumo do evento não confere.' };
  const escopo = new Map<string, string>();
  for (const [k, v] of raiz.atributos) if (ehDeclaracao(k)) escopo.set(prefixoDaDeclaracao(k), v);
  for (const [k, v] of ult.atributos) if (ehDeclaracao(k)) escopo.set(prefixoDaDeclaracao(k), v);
  let certificado: X509Certificate;
  try {
    certificado = new X509Certificate(Buffer.from(certB64, 'base64'));
  } catch {
    return { ok: false, motivo: 'Certificado ilegível na assinatura.' };
  }
  const ok = verify(
    'sha256',
    Buffer.from(canonizar(si, escopo), 'utf8'),
    createPublicKey(certificado.publicKey.export({ type: 'spki', format: 'pem' })),
    Buffer.from(sv, 'base64'),
  );
  return ok
    ? { ok: true, certificado }
    : { ok: false, motivo: 'A assinatura não confere com o certificado.' };
}
