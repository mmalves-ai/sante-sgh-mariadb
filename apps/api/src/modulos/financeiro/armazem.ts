// Guarda dos arquivos do financeiro (M32; ficha, seção 6): o extrato importado, a remessa e o retorno bancário, o XML da
// NFS-e, a DMED, a EFD-REINF e o lote contábil vão ao S3 do projeto com Object Lock (retenção COMPLIANCE de 5 anos em
// homologação e produção, GOVERNANCE de 1 dia no dev), numa chave única por tipo e SHA-256: a sobrescrita é recusada
// antes de gravar. No banco fica só a chave e o hash. Em memória na sessão sintética.
import type { ClienteS3 } from '../documento/public-api.js';
import { retencaoXml } from '../tiss/armazem-xml.js';

export interface ArmazemFinanceiro {
  guardar(chave: string, bytes: Uint8Array, tipo: string): Promise<{ versao: string | null }>;
  ler(chave: string): Promise<Uint8Array | null>;
}

export class ErroSobrescritaArquivo extends Error {
  override readonly name = 'ErroSobrescritaArquivo';
}

export function armazemFinanceiroMemoria(): ArmazemFinanceiro & { objetos: Map<string, Uint8Array> } {
  const objetos = new Map<string, Uint8Array>();
  return {
    objetos,
    async guardar(chave, bytes) {
      if (objetos.has(chave))
        throw new ErroSobrescritaArquivo(`O arquivo ${chave} já está guardado: é imutável.`);
      objetos.set(chave, bytes);
      return { versao: null };
    },
    ler: async (chave) => objetos.get(chave) ?? null,
  };
}

export function armazemFinanceiroS3(s3: ClienteS3, bucket: string, ambiente: string): ArmazemFinanceiro {
  let criado = false;
  const garantir = async () => {
    if (!criado) {
      await s3.criarBucketComTrava(bucket);
      criado = true;
    }
  };
  return {
    async guardar(chave, bytes, tipo) {
      await garantir();
      if (await s3.existe(bucket, chave))
        throw new ErroSobrescritaArquivo(`O arquivo ${chave} já está guardado: é imutável.`);
      const r = retencaoXml(ambiente);
      return s3.gravarComRetencao(bucket, chave, bytes, tipo, r.modo, r.ate);
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
