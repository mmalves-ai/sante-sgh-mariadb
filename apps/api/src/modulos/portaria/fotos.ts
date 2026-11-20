// Fotos dos visitantes (M50, etapa 5; regra 10: sem a biometria, o documento e a foto): a imagem da webcam ou do arquivo
// vai ao armazenamento de objetos LOCAL (o S3 do ambiente, em loopback; nunca um destino real: a trava do ambiente do
// M01 recusa endpoint externo) e o banco guarda só a chave (`visitante/<uuid>.<ext>`). Vencido o prazo de retenção, a
// foto é apagada (todas as versões). Sem S3 configurado (testes e a sessão sintética), em memória.
import { randomUUID } from 'node:crypto';
import type { Configuracao } from '../../configuracao.js';
import { ClienteS3 } from '../documento/infra/s3.js';

export const ARMAZEM_FOTOS_PORTARIA = Symbol('ARMAZEM_FOTOS_PORTARIA');

export interface ArmazemFotosPortaria {
  readonly destino: 's3' | 'memoria';
  guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string>;
  ler(hospital: string, chave: string): Promise<{ tipo: string; bytes: Uint8Array } | null>;
  remover(hospital: string, chave: string): Promise<void>;
}

const EXTENSOES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const TIPOS: Readonly<Record<string, string>> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export const CHAVE_FOTO_VISITANTE = /^visitante\/[a-f0-9-]{36}\.(jpg|png|webp)$/;
export const novaChaveFotoVisitante = (tipo: string) =>
  `visitante/${randomUUID()}.${EXTENSOES[tipo] ?? 'jpg'}`;

/** Confere o começo do arquivo (JPEG, PNG ou WebP) contra o tipo declarado. */
export function imagemConfere(tipo: string, b: Uint8Array): boolean {
  if (b.length < 12) return false;
  if (tipo === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (tipo === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (tipo === 'image/webp')
    return (
      String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === 'RIFF' &&
      String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'WEBP'
    );
  return false;
}

export class ArmazemFotosPortariaMemoria implements ArmazemFotosPortaria {
  readonly destino = 'memoria' as const;
  readonly fotos = new Map<string, { tipo: string; bytes: Uint8Array }>();
  async guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string> {
    const chave = novaChaveFotoVisitante(tipo);
    if (this.fotos.size > 500) this.fotos.delete(this.fotos.keys().next().value as string);
    this.fotos.set(`${hospital}/${chave}`, { tipo, bytes });
    return chave;
  }
  async ler(hospital: string, chave: string) {
    return this.fotos.get(`${hospital}/${chave}`) ?? null;
  }
  async remover(hospital: string, chave: string) {
    this.fotos.delete(`${hospital}/${chave}`);
  }
}

/** O armazém pelo ambiente: S3 local quando configurado; senão, em memória. */
export function criarArmazemFotosPortaria(
  cfg: Configuracao,
  env: NodeJS.ProcessEnv = process.env,
): ArmazemFotosPortaria {
  const endpoint = env['S3_ENDPOINT']?.trim();
  if (!endpoint) return new ArmazemFotosPortariaMemoria();
  const segredo = env['S3_SEGREDO']?.trim();
  const s3 = new ClienteS3({
    endpoint,
    regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
    acesso: segredo ? env['S3_ACESSO']?.trim() : undefined,
    segredo: segredo || undefined,
  });
  const bucket = env['S3_BUCKET_PORTARIA']?.trim() || `sgh-${cfg.rede ?? 'rede'}-portaria`;
  let pronto: Promise<void> | null = null;
  return {
    destino: 's3',
    async guardar(hospital, tipo, bytes) {
      pronto ??= s3.criarBucketComTrava(bucket);
      await pronto;
      const chave = novaChaveFotoVisitante(tipo);
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
    async remover(hospital, chave) {
      const k = `${hospital}/${chave}`;
      for (const v of await s3.versoes(bucket, k)) await s3.apagarVersao(bucket, k, v.versao);
    },
  };
}
