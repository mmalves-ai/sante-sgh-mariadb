// Montagem da etapa 2 da assinatura ICP a partir do ambiente (M49): a base do verificador público do QR (o portal;
// DP-49: domínio por parâmetro), a política de assinatura ICP-Brasil (OID e hash da LPA do ITI, quando o deploy
// configura) e o armazém do PDF pelo serviço de emissão do M09 (Gotenberg + S3 com Object Lock).
import type { PoliticaAssinaturaIcp } from '@sgh/contratos';
import type { PoliticaAssinaturaIdentificada } from '@sgh/dominio-documento';
import type { FonteDocumento } from '../../documento/fonte.js';
import type { ArmazemPdfIcp, ClienteSncr, ConfigDocumentosIcp } from '../aplicacao/documentos.js';

/** "<oid>:<sha256 em hex>" → a política; vazio ou malformado → null (o atributo sigPolicyId fica de fora). */
export function politicaDoAmbiente(v: string | undefined): PoliticaAssinaturaIdentificada | null {
  const m = /^([0-2](?:\.\d+)+):([0-9a-f]{64})$/.exec((v ?? '').trim());
  return m ? { oid: m[1]!, hashSha256: m[2]! } : null;
}

export function configDocumentosIcpDoAmbiente(
  env: NodeJS.ProcessEnv,
  sncr: ClienteSncr | null,
): ConfigDocumentosIcp {
  const politicas: Partial<Record<PoliticaAssinaturaIcp, PoliticaAssinaturaIdentificada>> = {};
  const rb = politicaDoAmbiente(env['ASSINATURA_POLITICA_AD_RB']);
  const rt = politicaDoAmbiente(env['ASSINATURA_POLITICA_AD_RT']);
  if (rb) politicas['AD-RB'] = rb;
  if (rt) politicas['AD-RT'] = rt;
  const base =
    env['PORTAL_ENDERECO']?.trim() ||
    env['WEB_ENDERECO']?.trim() ||
    env['DOCUMENTO_URL_VALIDACAO']?.trim() ||
    `http://127.0.0.1:${env['WEB_PORTA']?.trim() || '5300'}`;
  return { urlVerificador: base, politicas, sncr };
}

export function armazemPdfIcp(fonte: FonteDocumento): ArmazemPdfIcp {
  return {
    async emitirPrevia(p) {
      await fonte.emissao.garantirBucket();
      const r = await fonte.emissao.emitir({
        rede: p.rede,
        estabelecimento: p.estabelecimento,
        modelo: p.modelo,
        versaoModelo: '1',
        titulo: p.titulo,
        origem: { tipo: 'pep-documento', idLegado: p.documento },
        campos: p.campos,
        autor: p.autor,
        marcaSuporte: p.marcaSuporte,
        qr: p.qr,
      });
      return { chave: r.emissao.chaveObjeto, versao: r.versaoS3, pdf: r.pdf };
    },
    ler: (chave, versao) => fonte.emissao.lerObjeto(chave, versao),
    gravarAssinado: (rede, estab, assinatura, pdf) =>
      fonte.emissao.gravarAssinado(rede, estab, assinatura, pdf),
  };
}
