// Arquivos da prova de vínculo do responsável legal (M50, etapa 1; ficha, regra 5; R7 do preparo): a foto ou o PDF vai
// ao armazenamento de objetos LOCAL do ambiente (o S3 em loopback fora de produção; a trava de saídas recusa endereço
// externo), num bucket próprio com Object Lock e retenção; o banco guarda só a chave e o SHA-256. Nunca vai a log. Sem
// S3 configurado (testes e a sessão sintética), em memória.
import { randomUUID } from 'node:crypto';
import { ClienteS3 } from '../../documento/infra/s3.js';

export interface ArmazemProvas {
  readonly destino: 's3' | 'memoria';
  guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string>;
  ler(hospital: string, chave: string): Promise<{ tipo: string; bytes: Uint8Array } | null>;
}

const EXTENSOES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};
const TIPOS: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};

/** `portal/provas/<uuid sem hífen>-<ext>` (o formato que a entrada do pedido aceita). */
export const novaChaveProva = (tipo: string) =>
  `portal/provas/${randomUUID().replace(/-/g, '')}-${EXTENSOES[tipo] ?? 'pdf'}`;
export const CHAVE_PROVA = /^portal\/provas\/[a-f0-9]{32}-(jpg|png|pdf)$/;
const tipoDaChave = (chave: string) => TIPOS[chave.split('-').at(-1) ?? 'pdf'] ?? 'application/pdf';

export class ArmazemProvasMemoria implements ArmazemProvas {
  readonly destino = 'memoria' as const;
  private readonly arquivos = new Map<string, Uint8Array>();
  async guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string> {
    const chave = novaChaveProva(tipo);
    if (this.arquivos.size > 500) this.arquivos.delete(this.arquivos.keys().next().value as string);
    this.arquivos.set(`${hospital}/${chave}`, bytes);
    return chave;
  }
  async ler(hospital: string, chave: string) {
    const b = this.arquivos.get(`${hospital}/${chave}`);
    return b ? { tipo: tipoDaChave(chave), bytes: b } : null;
  }
}

/** Retenção da prova (D-PROVA-50, o DPO ajusta): 5 anos fora de dev/ci; 1 dia em GOVERNANCE no dev. */
const ANOS_RETENCAO = 5;

export function criarArmazemProvas(rede: string | null, env: NodeJS.ProcessEnv = process.env): ArmazemProvas {
  const endpoint = env['S3_ENDPOINT']?.trim();
  if (!endpoint) return new ArmazemProvasMemoria();
  const segredo = env['S3_SEGREDO']?.trim();
  const s3 = new ClienteS3({
    endpoint,
    regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
    acesso: segredo ? env['S3_ACESSO']?.trim() : undefined,
    segredo: segredo || undefined,
  });
  const bucket = env['S3_BUCKET_PORTAL']?.trim() || `sgh-${rede ?? 'rede'}-portal`;
  const ambiente = (env['AMBIENTE'] ?? 'dev').trim() || 'dev';
  const curto = ambiente === 'dev' || ambiente === 'ci';
  let pronto: Promise<void> | null = null;
  return {
    destino: 's3',
    async guardar(hospital, tipo, bytes) {
      pronto ??= s3.criarBucketComTrava(bucket);
      await pronto;
      const chave = novaChaveProva(tipo);
      const ate = new Date(Date.now() + (curto ? 86_400_000 : ANOS_RETENCAO * 365 * 86_400_000));
      await s3.gravarComRetencao(
        bucket,
        `${hospital}/${chave}`,
        bytes,
        tipo,
        curto ? 'GOVERNANCE' : 'COMPLIANCE',
        ate,
      );
      return chave;
    },
    async ler(hospital, chave) {
      if (!CHAVE_PROVA.test(chave)) return null;
      try {
        return { tipo: tipoDaChave(chave), bytes: await s3.ler(bucket, `${hospital}/${chave}`) };
      } catch {
        return null;
      }
    },
  };
}
