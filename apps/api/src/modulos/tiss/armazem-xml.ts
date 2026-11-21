// Guarda do XML TISS (M31; ficha, regra 4): o XML enviado e recebido vai ao S3 do projeto com Object Lock (retenção
// COMPLIANCE em homologação e produção, GOVERNANCE curta no dev), numa chave única por lote e hash: a sobrescrita é
// recusada antes de gravar (a chave existente nunca é reescrita) e o S3 recusa apagar a versão travada. No banco fica
// só a chave, a versão e os hashes (arquivo ligado ao lote_tiss e ao demonstrativo_analise_conta). Em memória na sessão sintética.
import type { GuardarXml } from '@sgh/dominio-faturamento';
import { guardaXmlMemoria } from '@sgh/dominio-faturamento';
import type { ClienteS3 } from '../documento/public-api.js';

export interface ArmazemXmlTiss {
  readonly guardar: GuardarXml;
  ler(chave: string): Promise<Uint8Array | null>;
}

export class ErroSobrescritaXml extends Error {
  override readonly name = 'ErroSobrescritaXml';
}

export function armazemXmlMemoria(): ArmazemXmlTiss & { objetos: Map<string, Uint8Array> } {
  const g = guardaXmlMemoria();
  return {
    guardar: g,
    objetos: g.objetos,
    ler: async (chave) => g.objetos.get(chave) ?? null,
  };
}

/** Anos de retenção do XML TISS (prazo de guarda dos documentos de faturamento: 5 anos; dev: 1 dia). */
export function retencaoXml(
  ambiente: string,
  agora = new Date(),
): { modo: 'GOVERNANCE' | 'COMPLIANCE'; ate: Date } {
  const ate = new Date(agora);
  if (ambiente === 'producao' || ambiente === 'homologacao') {
    ate.setUTCFullYear(ate.getUTCFullYear() + 5);
    return { modo: 'COMPLIANCE', ate };
  }
  ate.setUTCDate(ate.getUTCDate() + 1);
  return { modo: 'GOVERNANCE', ate };
}

export function armazemXmlS3(s3: ClienteS3, bucket: string, ambiente: string): ArmazemXmlTiss {
  let criado = false;
  const garantir = async () => {
    if (!criado) {
      await s3.criarBucketComTrava(bucket);
      criado = true;
    }
  };
  return {
    async guardar(chave, bytes) {
      await garantir();
      if (await s3.existe(bucket, chave))
        throw new ErroSobrescritaXml(`O XML ${chave} já está guardado: o arquivo guardado é imutável.`);
      const r = retencaoXml(ambiente);
      const { versao } = await s3.gravarComRetencao(bucket, chave, bytes, 'application/xml', r.modo, r.ate);
      return { versao };
    },
    async ler(chave) {
      await garantir();
      try {
        return await s3.ler(bucket, chave);
      } catch {
        return null;
      }
    },
  };
}
