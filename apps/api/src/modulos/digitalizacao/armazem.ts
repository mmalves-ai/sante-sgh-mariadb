// Arquivos da digitalização certificada (M50, etapa 6; ficha, seção 6: "arquivo no S3 com Object Lock"; Lei 13.787/2018,
// art. 6: guarda de 20 anos): o PDF do escâner vai ao armazenamento de objetos LOCAL do ambiente (o S3 em loopback fora
// de produção; a trava de saídas recusa endereço externo), num bucket próprio com Object Lock: GOVERNANCE de 1 dia até o
// COMMIT e, depois dele, COMPLIANCE pelo prazo de guarda (no dev, a curta continua). A chave sai do SHA-256 do arquivo;
// o banco guarda a chave e o resumo. Nunca vai a log. Sem S3 configurado (testes e a sessão sintética), em memória.
import { ANOS_GUARDA_DIGITALIZACAO } from '@sgh/contratos';
import { ClienteS3 } from '../documento/infra/s3.js';

export interface ArmazemDigitalizacao {
  readonly destino: 's3' | 'memoria';
  /**
   * Guarda o PDF na chave do próprio resumo (o mesmo arquivo nunca vira duas cópias; se o objeto já existe, de uma
   * tentativa recusada, é reaproveitado) com uma retenção GOVERNANCE curta: até o COMMIT, nada fica preso por 20 anos.
   */
  guardar(hospital: string, bytes: Uint8Array, hash: string): Promise<string>;
  /** Depois do COMMIT: a retenção da guarda legal (COMPLIANCE, 20 anos; no dev e no CI, a curta continua). */
  fixar(hospital: string, chave: string): Promise<void>;
  ler(hospital: string, chave: string): Promise<Uint8Array | null>;
}

export const ARMAZEM_DIGITALIZACAO = Symbol('ARMAZEM_DIGITALIZACAO');

/** `same/digitalizacao/<sha-256>.pdf`: a chave sai do resumo do arquivo. */
export const chaveDigitalizacao = (hash: string) => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('resumo SHA-256 inválido para a chave do arquivo');
  return `same/digitalizacao/${hash}.pdf`;
};
/** O formato que a leitura aceita: o resumo (64) ou o identificador aleatório das primeiras capturas (32). */
export const CHAVE_DIGITALIZACAO = /^same\/digitalizacao\/(?:[a-f0-9]{32}|[a-f0-9]{64})\.pdf$/;
const DIA_MS = 86_400_000;

export class ArmazemDigitalizacaoMemoria implements ArmazemDigitalizacao {
  readonly destino = 'memoria' as const;
  private readonly arquivos = new Map<string, Uint8Array>();
  /** As chaves com a retenção da guarda legal (fixada depois do COMMIT). */
  readonly fixadas = new Set<string>();
  /** Quantas vezes um objeto novo foi gravado (o reaproveitamento não conta). */
  gravacoes = 0;
  async guardar(hospital: string, bytes: Uint8Array, hash: string): Promise<string> {
    const chave = chaveDigitalizacao(hash);
    if (this.arquivos.has(`${hospital}/${chave}`)) return chave;
    if (this.arquivos.size > 200) this.arquivos.delete(this.arquivos.keys().next().value as string);
    this.arquivos.set(`${hospital}/${chave}`, bytes);
    this.gravacoes++;
    return chave;
  }
  async fixar(hospital: string, chave: string): Promise<void> {
    if (this.arquivos.has(`${hospital}/${chave}`)) this.fixadas.add(`${hospital}/${chave}`);
  }
  async ler(hospital: string, chave: string) {
    return this.arquivos.get(`${hospital}/${chave}`) ?? null;
  }
}

export function criarArmazemDigitalizacao(
  rede: string | null,
  env: NodeJS.ProcessEnv = process.env,
): ArmazemDigitalizacao {
  const endpoint = env['S3_ENDPOINT']?.trim();
  if (!endpoint) return new ArmazemDigitalizacaoMemoria();
  const segredo = env['S3_SEGREDO']?.trim();
  const s3 = new ClienteS3({
    endpoint,
    regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
    acesso: segredo ? env['S3_ACESSO']?.trim() : undefined,
    segredo: segredo || undefined,
  });
  const bucket = env['S3_BUCKET_SAME']?.trim() || `sgh-${rede ?? 'rede'}-same`;
  const ambiente = (env['AMBIENTE'] ?? 'dev').trim() || 'dev';
  const curto = ambiente === 'dev' || ambiente === 'ci';
  let pronto: Promise<void> | null = null;
  return {
    destino: 's3',
    async guardar(hospital, bytes, hash) {
      pronto ??= s3.criarBucketComTrava(bucket);
      await pronto;
      const chave = chaveDigitalizacao(hash);
      // Uma tentativa anterior recusada (lote disputado, falha da transação) já deixou este mesmo arquivo: reaproveita.
      if (await s3.existe(bucket, `${hospital}/${chave}`)) return chave;
      await s3.gravarComRetencao(
        bucket,
        `${hospital}/${chave}`,
        bytes,
        'application/pdf',
        'GOVERNANCE',
        new Date(Date.now() + DIA_MS),
      );
      return chave;
    },
    async fixar(hospital, chave) {
      if (curto || !CHAVE_DIGITALIZACAO.test(chave)) return;
      await s3.fixarRetencao(
        bucket,
        `${hospital}/${chave}`,
        'COMPLIANCE',
        new Date(Date.now() + ANOS_GUARDA_DIGITALIZACAO * 365.25 * DIA_MS),
      );
    },
    async ler(hospital, chave) {
      if (!CHAVE_DIGITALIZACAO.test(chave)) return null;
      try {
        return await s3.ler(bucket, `${hospital}/${chave}`);
      } catch {
        return null;
      }
    },
  };
}
