// Arquivos dos laudos do patrimônio (W0-08, achado 6 da revisão; CPC 01 e CPC 27; RDC 509 arts. 8º e 15: guarda de pelo
// menos 5 anos): o PDF do laudo vai ao armazenamento de objetos LOCAL do ambiente (o S3 em loopback fora de produção),
// num bucket próprio com Object Lock (COMPLIANCE de 5 anos em homologação e produção, GOVERNANCE de 1 dia no dev e no
// CI). A chave sai do SHA-256 do arquivo: o mesmo PDF nunca vira duas cópias e nada se sobrescreve. O banco guarda só a
// chave e o resumo (SGH_PAT_LAUDO). Sem S3 configurado (testes e a sessão sintética), em memória.
import type { ClienteS3 } from '../documento/public-api.js';
import { retencaoXml } from '../tiss/armazem-xml.js';

export interface ArmazemLaudoPatrimonio {
  readonly destino: 's3' | 'memoria';
  /** Guarda o PDF na chave do resumo (se já existe, é o mesmo arquivo: reaproveita) e devolve a chave. */
  guardar(hospital: string, bytes: Uint8Array, hash: string): Promise<string>;
  ler(hospital: string, chave: string): Promise<Uint8Array | null>;
}

export const ARMAZEM_LAUDO_PATRIMONIO = Symbol('ARMAZEM_LAUDO_PATRIMONIO');

/** `patrimonio/laudos/<sha-256>.pdf`: a chave sai do resumo do arquivo. */
export const chaveLaudo = (hash: string): string => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('resumo SHA-256 inválido para a chave do laudo');
  return `patrimonio/laudos/${hash}.pdf`;
};
export const CHAVE_LAUDO = /^patrimonio\/laudos\/[a-f0-9]{64}\.pdf$/;

export class ArmazemLaudoMemoria implements ArmazemLaudoPatrimonio {
  readonly destino = 'memoria' as const;
  readonly arquivos = new Map<string, Uint8Array>();
  /** Quantas vezes um objeto novo foi gravado (o reaproveitamento não conta). */
  gravacoes = 0;
  async guardar(hospital: string, bytes: Uint8Array, hash: string): Promise<string> {
    const chave = chaveLaudo(hash);
    if (this.arquivos.has(`${hospital}/${chave}`)) return chave;
    if (this.arquivos.size > 200) this.arquivos.delete(this.arquivos.keys().next().value as string);
    this.arquivos.set(`${hospital}/${chave}`, bytes);
    this.gravacoes++;
    return chave;
  }
  async ler(hospital: string, chave: string): Promise<Uint8Array | null> {
    return this.arquivos.get(`${hospital}/${chave}`) ?? null;
  }
}

export function armazemLaudoS3(s3: ClienteS3, bucket: string, ambiente: string): ArmazemLaudoPatrimonio {
  let pronto: Promise<void> | null = null;
  const garantir = async () => {
    pronto ??= s3.criarBucketComTrava(bucket);
    await pronto;
  };
  return {
    destino: 's3',
    async guardar(hospital, bytes, hash) {
      await garantir();
      const chave = chaveLaudo(hash);
      // O mesmo arquivo já anexado (a outro ajuste ou numa tentativa recusada): o objeto travado é reaproveitado.
      if (await s3.existe(bucket, `${hospital}/${chave}`)) return chave;
      const r = retencaoXml(ambiente);
      await s3.gravarComRetencao(bucket, `${hospital}/${chave}`, bytes, 'application/pdf', r.modo, r.ate);
      return chave;
    },
    async ler(hospital, chave) {
      if (!CHAVE_LAUDO.test(chave)) return null;
      await garantir();
      try {
        return await s3.ler(bucket, `${hospital}/${chave}`);
      } catch {
        return null;
      }
    },
  };
}
