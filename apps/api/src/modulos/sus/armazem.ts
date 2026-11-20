// Guarda do arquivo exportado ao SUS (M51; ficha, seção 12: "os arquivos gerados ficam guardados com o hash"): o
// conteúdo tem dado pessoal (nome, endereço, CNS e nascimento no leiaute do CIHA01) e vai ao S3 do projeto com Object
// Lock: GOVERNANCE de 1 dia até o COMMIT (a transação recusada remove a versão, com o desvio da GOVERNANCE) e, depois
// dele, a guarda do XML TISS do M31 (COMPLIANCE de 5 anos em homologação e produção; no dev, a curta continua). A chave
// tem o ID e o hash; a sobrescrita é recusada antes de gravar. No banco fica só a chave, a versão e o SHA-256. Em
// memória na sessão sintética.
import type { ClienteS3 } from '../documento/public-api.js';
import { retencaoXml } from '../tiss/armazem-xml.js';
import type { ArmazemArquivoSus } from './servico.js';

export class ErroSobrescritaArquivoSus extends Error {
  override readonly name = 'ErroSobrescritaArquivoSus';
}

const DIA_MS = 86_400_000;

export function armazemSusMemoria(): ArmazemArquivoSus & {
  objetos: Map<string, Uint8Array>;
  fixados: Set<string>;
} {
  const objetos = new Map<string, Uint8Array>();
  const fixados = new Set<string>();
  return {
    objetos,
    fixados,
    async guardar(chave, bytes) {
      if (objetos.has(chave)) throw new ErroSobrescritaArquivoSus(`O arquivo ${chave} já está guardado.`);
      objetos.set(chave, bytes);
      return { versao: null };
    },
    async fixar(chave) {
      if (objetos.has(chave)) fixados.add(chave);
    },
    async remover(chave) {
      if (!fixados.has(chave)) objetos.delete(chave);
    },
    ler: async (chave) => objetos.get(chave) ?? null,
  };
}

export function armazemSusS3(s3: ClienteS3, bucket: string, ambiente: string): ArmazemArquivoSus {
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
        throw new ErroSobrescritaArquivoSus(
          `O arquivo ${chave} já está guardado: o arquivo guardado é imutável.`,
        );
      const { versao } = await s3.gravarComRetencao(
        bucket,
        chave,
        bytes,
        'text/plain',
        'GOVERNANCE',
        new Date(Date.now() + DIA_MS),
      );
      return { versao: versao ?? null };
    },
    async fixar(chave) {
      const r = retencaoXml(ambiente);
      if (r.modo !== 'COMPLIANCE') return;
      await s3.fixarRetencao(bucket, chave, r.modo, r.ate);
    },
    async remover(chave, versao) {
      if (versao) {
        await s3.apagarVersao(bucket, chave, versao, true);
        return;
      }
      for (const v of await s3.versoes(bucket, chave)) await s3.apagarVersao(bucket, chave, v.versao, true);
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
