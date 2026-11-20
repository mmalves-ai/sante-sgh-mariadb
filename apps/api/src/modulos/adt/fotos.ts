// Fotos da higienização (M21; ficha, seções 5 e 10): a imagem vai ao armazenamento de objetos LOCAL (o S3 do
// ambiente, em loopback; nunca um destino real: a trava do ambiente do M01 recusa endpoint externo) e o banco guarda
// só a chave (`higienizacao/<id>.<ext>`). Sem S3 configurado (testes e a sessão sintética), as fotos ficam em memória.
import { randomUUID } from 'node:crypto';
import type { Configuracao } from '../../configuracao.js';
import { ClienteS3 } from '../documento/infra/s3.js';

export const ARMAZEM_FOTOS = Symbol('ARMAZEM_FOTOS');

export interface ArmazemFotos {
  readonly destino: 's3' | 'memoria';
  guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string>;
  ler(hospital: string, chave: string): Promise<{ tipo: string; bytes: Uint8Array } | null>;
}

const EXTENSOES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const TIPOS: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const novaChaveFoto = (tipo: string) => `higienizacao/${randomUUID()}.${EXTENSOES[tipo] ?? 'jpg'}`;
export const CHAVE_FOTO = /^higienizacao\/[a-z0-9-]{8,80}\.(jpg|jpeg|png|webp)$/;

export class ArmazemFotosMemoria implements ArmazemFotos {
  readonly destino = 'memoria' as const;
  private readonly fotos = new Map<string, { tipo: string; bytes: Uint8Array }>();
  async guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string> {
    const chave = novaChaveFoto(tipo);
    if (this.fotos.size > 500) this.fotos.delete(this.fotos.keys().next().value as string);
    this.fotos.set(`${hospital}/${chave}`, { tipo, bytes });
    return chave;
  }
  async ler(hospital: string, chave: string) {
    return this.fotos.get(`${hospital}/${chave}`) ?? null;
  }
}

/** O armazém pelo ambiente: S3 local quando configurado; senão, em memória. */
export function criarArmazemFotos(cfg: Configuracao, env: NodeJS.ProcessEnv = process.env): ArmazemFotos {
  const endpoint = env['S3_ENDPOINT']?.trim();
  if (!endpoint) return new ArmazemFotosMemoria();
  const segredo = env['S3_SEGREDO']?.trim();
  const s3 = new ClienteS3({
    endpoint,
    regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
    acesso: segredo ? env['S3_ACESSO']?.trim() : undefined,
    segredo: segredo || undefined,
  });
  const bucket = env['S3_BUCKET_HIGIENIZACAO']?.trim() || `sgh-${cfg.rede ?? 'rede'}-higienizacao`;
  let pronto: Promise<void> | null = null;
  return {
    destino: 's3',
    async guardar(hospital, tipo, bytes) {
      pronto ??= s3.criarBucketComTrava(bucket);
      await pronto;
      const chave = novaChaveFoto(tipo);
      await s3.gravarSemRetencao(bucket, `${hospital}/${chave}`, bytes);
      return chave;
    },
    async ler(hospital, chave) {
      try {
        const bytes = await s3.ler(bucket, `${hospital}/${chave}`);
        return { tipo: TIPOS[chave.split('.').at(-1) ?? 'jpg'] ?? 'image/jpeg', bytes };
      } catch {
        return null;
      }
    },
  };
}
