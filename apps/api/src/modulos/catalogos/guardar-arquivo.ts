// Arquivo original da carga de catálogo (ficha do M13, seção 5): vai ao S3 com Object Lock (retenção pela
// política do ambiente, a mesma dos documentos do M09) e fica ligado à carga (carga_catalogo.arquivo_guardado). A edição
// anterior, quando o banco não a guarda, continua recuperável pelo arquivo e pelas linhas da preparação. Sem S3
// configurado, a carga segue sem o arquivo guardado (a tela mostra "arquivo não guardado").
import type { Configuracao } from '../../configuracao.js';
import { politicaRetencao } from '../documento/aplicacao/emissao.service.js';
import { ClienteS3 } from '../documento/infra/s3.js';

export function guardarArquivoCatalogo(
  cfg: Configuracao,
  env: NodeJS.ProcessEnv,
):
  ((hospital: string, sha256: string, nome: string, conteudo: string) => Promise<string | null>) | undefined {
  const segredo = env['S3_SEGREDO']?.trim();
  const endpoint = env['S3_ENDPOINT']?.trim();
  if (!endpoint) return undefined;
  const s3 = new ClienteS3({
    endpoint,
    regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
    acesso: segredo ? env['S3_ACESSO']?.trim() : undefined,
    segredo: segredo || undefined,
  });
  const bucket = env['S3_BUCKET_CATALOGOS']?.trim() || `sgh-${cfg.rede ?? 'rede'}-catalogos`;
  const retencao = politicaRetencao(cfg.ambiente, env);
  let pronto: Promise<void> | null = null;
  return async (hospital, sha256, _nome, conteudo) => {
    pronto ??= s3.criarBucketComTrava(bucket);
    await pronto;
    const chave = `${hospital}/${sha256}`;
    if (!(await s3.existe(bucket, chave)))
      await s3.gravarComRetencao(
        bucket,
        chave,
        Buffer.from(conteudo, 'utf8'),
        'text/plain; charset=utf-8',
        retencao.modo,
        new Date(Date.now() + retencao.duracaoMs),
      );
    return `${bucket}/${chave}`.slice(0, 200);
  };
}
