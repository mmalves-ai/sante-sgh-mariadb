// F7, 07-FIN linha 114: a assinatura da NF-e de saída e o certificado que assina. Leiaute nacional 4.00 (Manual de
// Orientação do Contribuinte, assinatura digital): XMLDSig envelopada, `Reference URI="#NFe<chave>"` sobre `infNFe`,
// transformações `enveloped-signature` e C14N 1.0, resumo SHA-1, assinatura RSA-SHA1 e o certificado A1 do
// estabelecimento em `KeyInfo/X509Data`. A forma canônica é a do transmissor do eSocial (mesmo motor, node:crypto).
//
// O certificado A1 fica no cofre do servidor, fora do repositório, da tabela, do log e da tela: dois arquivos PEM
// (NFE_CERTIFICADO_ARQUIVO, NFE_CHAVE_ARQUIVO e a senha em NFE_CHAVE_SENHA), convertidos do .pfx na implantação.
// Fora de produção, sem A1 no cofre, o simulador da Sefaz recebe a nota assinada por um certificado SINTÉTICO de
// teste (ICP sintética do motor de assinatura), gerado em memória e marcado no nome: nunca vale fora do simulador.
import { createHash, createPrivateKey, sign, verify, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { criarRaizSintetica, emitirSintetico } from '@sgh/dominio-documento';
import { cnpjDoCertificado } from '../pessoas/esocial/transmissor/certificado-esocial.js';
import { ErroXml, lerXml, type NoLido, nomeLocal } from '../pessoas/esocial/transmissor/xml-leitura.js';
import { canonizar, type CertificadoAssinatura, DS } from '../pessoas/esocial/transmissor/xmldsig.js';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA1 = `${DS}rsa-sha1`;
const SHA1 = `${DS}sha1`;
const ENVELOPADA = `${DS}enveloped-signature`;

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
const resumo = (t: string) => createHash('sha1').update(t, 'utf8').digest('base64');
const escopoDe = (n: NoLido): Map<string, string> => {
  const m = new Map<string, string>();
  for (const [k, v] of n.atributos)
    if (k === 'xmlns' || k.startsWith('xmlns:')) m.set(k === 'xmlns' ? '' : k.slice(6), v);
  return m;
};

function signedInfo(id: string, valorResumo: string): NoLido {
  return ramo('SignedInfo', [
    folha('CanonicalizationMethod', '', [['Algorithm', C14N]]),
    folha('SignatureMethod', '', [['Algorithm', RSA_SHA1]]),
    ramo(
      'Reference',
      [
        ramo('Transforms', [
          folha('Transform', '', [['Algorithm', ENVELOPADA]]),
          folha('Transform', '', [['Algorithm', C14N]]),
        ]),
        folha('DigestMethod', '', [['Algorithm', SHA1]]),
        folha('DigestValue', valorResumo),
      ],
      [['URI', `#${id}`]],
    ),
  ]);
}

/** Assina a NF-e (o XML de `xmlNfeSaida`) e devolve o documento assinado na forma canônica. */
export function assinarNfe(xml: string, cert: CertificadoAssinatura): string {
  const raiz = lerXml(xml);
  if (nomeLocal(raiz.nome) !== 'NFe') throw new ErroXml('O documento não começa por NFe.');
  const inf = raiz.filhos.find((f) => nomeLocal(f.nome) === 'infNFe');
  const id = inf?.atributos.find(([k]) => k === 'Id')?.[1];
  if (!inf || !id) throw new ErroXml('A NF-e está sem infNFe com Id.');
  if (raiz.filhos.some((f) => nomeLocal(f.nome) === 'Signature'))
    throw new ErroXml('A NF-e já está assinada.');
  const si = signedInfo(id, resumo(canonizar(inf, escopoDe(raiz))));
  const valor = sign('sha1', Buffer.from(canonizar(si, new Map([['', DS]])), 'utf8'), cert.chave).toString(
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

export type ConferenciaAssinaturaNfe =
  { readonly ok: true; readonly cnpj: string | null } | { readonly ok: false; readonly motivo: string };

/** Confere a assinatura: o resumo de `infNFe` e a assinatura do SignedInfo com o certificado do KeyInfo. */
export function conferirAssinaturaNfe(xmlAssinado: string): ConferenciaAssinaturaNfe {
  let raiz: NoLido;
  try {
    raiz = lerXml(xmlAssinado);
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
  const inf = raiz.filhos.find((f) => nomeLocal(f.nome) === 'infNFe');
  const sig = raiz.filhos.find((f) => nomeLocal(f.nome) === 'Signature');
  if (!inf || !sig) return { ok: false, motivo: 'NF-e sem infNFe ou sem assinatura.' };
  const si = sig.filhos.find((f) => nomeLocal(f.nome) === 'SignedInfo');
  const sv = sig.filhos.find((f) => nomeLocal(f.nome) === 'SignatureValue')?.texto.trim();
  const certB64 = sig.filhos
    .find((f) => nomeLocal(f.nome) === 'KeyInfo')
    ?.filhos.find((f) => nomeLocal(f.nome) === 'X509Data')
    ?.filhos.find((f) => nomeLocal(f.nome) === 'X509Certificate')
    ?.texto.replace(/\s+/g, '');
  if (!si || !sv || !certB64) return { ok: false, motivo: 'Assinatura incompleta.' };
  const ref = si.filhos.find((f) => nomeLocal(f.nome) === 'Reference');
  const id = inf.atributos.find(([k]) => k === 'Id')?.[1];
  if (ref?.atributos.find(([k]) => k === 'URI')?.[1] !== `#${id}`)
    return { ok: false, motivo: 'A assinatura não referencia esta NF-e.' };
  const dv = ref.filhos.find((f) => nomeLocal(f.nome) === 'DigestValue')?.texto.trim();
  if (dv !== resumo(canonizar(inf, escopoDe(raiz))))
    return { ok: false, motivo: 'O resumo da NF-e não confere.' };
  let certificado: X509Certificate;
  try {
    certificado = new X509Certificate(Buffer.from(certB64, 'base64'));
  } catch {
    return { ok: false, motivo: 'Certificado ilegível na assinatura.' };
  }
  const escopo = escopoDe(raiz);
  for (const [k, v] of escopoDe(sig)) escopo.set(k, v);
  const ok = verify(
    'sha1',
    Buffer.from(canonizar(si, escopo), 'utf8'),
    certificado.publicKey,
    Buffer.from(sv, 'base64'),
  );
  return ok
    ? { ok: true, cnpj: cnpjDoCertificado(certificado) }
    : { ok: false, motivo: 'A assinatura não confere com o certificado.' };
}

export type CertificadoNfe =
  | { readonly ok: true; readonly cert: CertificadoAssinatura; readonly sintetico: boolean }
  | { readonly ok: false; readonly codigo: string; readonly motivo: string };

const sinteticos = new Map<string, CertificadoAssinatura>();

/**
 * O certificado que assina a NF-e: o A1 do cofre (arquivos PEM) quando configurado, conferido (chave do próprio
 * certificado, validade e o CNPJ do emitente); sem A1 e com destino simulador, o sintético de teste.
 */
export function certificadoNfe(
  env: NodeJS.ProcessEnv,
  cnpjEmitente: string,
  destino: 'simulador' | 'sefaz',
  agora: Date,
): CertificadoNfe {
  const arqCert = env['NFE_CERTIFICADO_ARQUIVO']?.trim();
  const arqChave = env['NFE_CHAVE_ARQUIVO']?.trim();
  if (!arqCert || !arqChave) {
    if (destino !== 'simulador')
      return {
        ok: false,
        codigo: 'certificado-ausente',
        motivo: 'O certificado A1 do estabelecimento não está no cofre: a NF-e não pode ser transmitida.',
      };
    let c = sinteticos.get(cnpjEmitente);
    if (!c) {
      const raiz = criarRaizSintetica(agora, 'AC SINTETICA SIMULADOR NFE');
      const t = emitirSintetico(raiz, { cpf: null, nome: `SIMULADOR NFE SEM VALOR:${cnpjEmitente}` }, agora);
      c = { chave: t.chave, certificadoDer: t.certificado };
      sinteticos.set(cnpjEmitente, c);
    }
    return { ok: true, cert: c, sintetico: true };
  }
  try {
    const certificado = new X509Certificate(readFileSync(arqCert));
    const senha = env['NFE_CHAVE_SENHA'];
    const pem = readFileSync(arqChave, 'utf8');
    const chave = createPrivateKey(senha ? { key: pem, format: 'pem', passphrase: senha } : pem);
    if (!certificado.checkPrivateKey(chave))
      return {
        ok: false,
        codigo: 'chave-de-outro-certificado',
        motivo: 'A chave não pertence ao certificado A1.',
      };
    if (agora > new Date(certificado.validTo) || agora < new Date(certificado.validFrom))
      return {
        ok: false,
        codigo: 'certificado-fora-validade',
        motivo: 'O certificado A1 está fora da validade.',
      };
    if (cnpjDoCertificado(certificado)?.slice(0, 8) !== cnpjEmitente.slice(0, 8))
      return {
        ok: false,
        codigo: 'certificado-outro-cnpj',
        motivo: 'O certificado A1 é de outra empresa (a raiz do CNPJ não confere com a do emitente).',
      };
    return { ok: true, cert: { chave, certificadoDer: new Uint8Array(certificado.raw) }, sintetico: false };
  } catch {
    return {
      ok: false,
      codigo: 'certificado-ilegivel',
      motivo: 'O certificado A1 do cofre não pôde ser lido.',
    };
  }
}
