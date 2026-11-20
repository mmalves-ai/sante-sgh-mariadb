// O certificado digital do transmissor do eSocial (M53.6, achado do corretor; recurso `pessoas.esocial`, pré-requisito
// "Certificado digital do empregador (e-CNPJ)"). D-CERT-536 (POL-5): o A1 fica no cofre do servidor, FORA do
// repositório, da tabela, do log e da tela, em dois arquivos PEM (o certificado, com a cadeia se houver, e a chave
// privada, cifrada com senha ou não): ESOCIAL_CERTIFICADO_ARQUIVO, ESOCIAL_CHAVE_ARQUIVO e ESOCIAL_CHAVE_SENHA. O
// arquivo .pfx do e-CNPJ se converte na implantação (o node:crypto não lê PKCS#12 para assinar). A conferência é o
// pré-requisito verificável: legível, chave do próprio certificado, dentro da validade, uso de assinatura digital e o
// CNPJ do titular (ICP-Brasil: OID 2.16.76.1.3.3 ou o `NOME:CNPJ` do CN). Mensagens nunca citam a senha nem o conteúdo.
import { createPrivateKey, type KeyObject, X509Certificate } from 'node:crypto';
import { lerCertificado } from '@sgh/dominio-documento';

export const OID_CNPJ_ICP = '2.16.76.1.3.3';

export interface CertificadoEsocial {
  readonly chave: KeyObject;
  readonly certificado: X509Certificate;
  readonly certificadoDer: Uint8Array;
  /** O certificado e a cadeia em PEM, para o TLS mútuo com o serviço do eSocial. */
  readonly certificadoPem: string;
  readonly chavePem: string;
  readonly cnpj: string;
  readonly validoAte: Date;
}

export type LeituraCertificadoEsocial =
  | { readonly ok: true; readonly certificado: CertificadoEsocial }
  | { readonly ok: false; readonly codigo: string; readonly motivo: string };

const falha = (codigo: string, motivo: string): LeituraCertificadoEsocial => ({ ok: false, codigo, motivo });

/** O CNPJ do titular: o otherName ICP-Brasil ou o fim do CN (`RAZAO SOCIAL:CNPJ`). */
export function cnpjDoCertificado(c: X509Certificate): string | null {
  try {
    const lido = lerCertificado(new Uint8Array(c.raw));
    const v = lido.outrosNomes[OID_CNPJ_ICP]?.replace(/\D/g, '');
    if (v && v.length === 14) return v;
  } catch {
    // Certificado sem as extensões que o leitor do motor entende: vale o CN.
  }
  const cn = /(?:^|\n)CN=([^\n]*)/.exec(c.subject)?.[1] ?? '';
  const m = /:(\d{14})\s*$/.exec(cn);
  return m ? m[1]! : null;
}

/** Lê e confere o certificado do transmissor (pré-requisito da chave `pessoas.esocial`). */
export function lerCertificadoEsocial(
  x: { readonly certificadoPem: string; readonly chavePem: string; readonly senha?: string | null },
  agora: Date,
): LeituraCertificadoEsocial {
  let certificado: X509Certificate;
  try {
    certificado = new X509Certificate(x.certificadoPem);
  } catch {
    return falha('certificado-ilegivel', 'O certificado digital do eSocial não pôde ser lido.');
  }
  let chave: KeyObject;
  try {
    chave = createPrivateKey(
      x.senha ? { key: x.chavePem, format: 'pem', passphrase: x.senha } : { key: x.chavePem, format: 'pem' },
    );
  } catch {
    return falha(
      'chave-ilegivel',
      'A chave do certificado digital do eSocial não pôde ser lida (confira a senha).',
    );
  }
  if (!certificado.checkPrivateKey(chave))
    return falha('chave-de-outro-certificado', 'A chave não pertence ao certificado digital do eSocial.');
  const de = new Date(certificado.validFrom);
  const ate = new Date(certificado.validTo);
  if (agora < de)
    return falha('certificado-futuro', 'O certificado digital do eSocial ainda não está válido.');
  if (agora > ate)
    return falha(
      'certificado-vencido',
      `O certificado digital do eSocial venceu em ${ate.toISOString().slice(0, 10)}.`,
    );
  try {
    const uso = lerCertificado(new Uint8Array(certificado.raw)).usoDaChave;
    if (uso && !uso.assinaturaDigital)
      return falha(
        'certificado-sem-assinatura',
        'O certificado digital do eSocial não permite assinatura digital.',
      );
  } catch {
    // Sem KeyUsage legível: o serviço do eSocial confere.
  }
  const cnpj = cnpjDoCertificado(certificado);
  if (!cnpj) return falha('certificado-sem-cnpj', 'O certificado digital do eSocial não é um e-CNPJ.');
  return {
    ok: true,
    certificado: {
      chave,
      certificado,
      certificadoDer: new Uint8Array(certificado.raw),
      certificadoPem: x.certificadoPem,
      chavePem: chave.export({ type: 'pkcs8', format: 'pem' }).toString(),
      cnpj,
      validoAte: ate,
    },
  };
}
