// Conteúdo bruto das mensagens das integrações (M34; ficha, seção 6: "conteúdo bruto no S3"; cap-14 §14.2.8): a
// mensagem recebida ou enviada vai ao S3 do projeto (o bucket da rede para as integrações), nunca ao banco nem ao log;
// no banco fica só o resumo SHA-256 e a chave do objeto. Em memória na sessão sintética.
import { createHash } from 'node:crypto';
import { ClienteS3 } from '../../documento/public-api.js';

export interface ArmazemConteudo {
  gravar(rede: string, chave: string, conteudo: string): Promise<string>;
  ler(rede: string, chave: string): Promise<string | null>;
}

export const resumoSha256 = (conteudo: string) => createHash('sha256').update(conteudo, 'utf8').digest('hex');

/** Chave do objeto: estabelecimento, parceiro, dia e o resumo (o mesmo conteúdo cai na mesma chave). */
export function chaveDoConteudo(
  hospital: string,
  parceiro: string,
  direcao: 'entrada' | 'saida',
  resumo: string,
) {
  const dia = new Date().toISOString().slice(0, 10);
  return `${hospital}/${parceiro}/${direcao}/${dia}/${resumo}.txt`;
}

/** Em memória (sessão sintética, um processo = uma rede): a chave já leva o estabelecimento e o parceiro. */
export class ArmazemConteudoMemoria implements ArmazemConteudo {
  readonly objetos = new Map<string, string>();
  async gravar(_rede: string, chave: string, conteudo: string): Promise<string> {
    this.objetos.set(chave, conteudo);
    return chave;
  }
  async ler(_rede: string, chave: string): Promise<string | null> {
    return this.objetos.get(chave) ?? null;
  }
}

export class ArmazemConteudoS3 implements ArmazemConteudo {
  private readonly criados = new Set<string>();
  constructor(
    private readonly s3: ClienteS3,
    private readonly bucketDaRede: (rede: string) => string = (r) => `sgh-${r}-integracoes`,
  ) {}

  private async bucket(rede: string): Promise<string> {
    const b = this.bucketDaRede(rede);
    if (!this.criados.has(b)) {
      await this.s3.criarBucketComTrava(b).catch(() => undefined);
      this.criados.add(b);
    }
    return b;
  }

  async gravar(rede: string, chave: string, conteudo: string): Promise<string> {
    await this.s3.gravarSemRetencao(await this.bucket(rede), chave, new TextEncoder().encode(conteudo));
    return chave;
  }

  async ler(rede: string, chave: string): Promise<string | null> {
    try {
      return new TextDecoder().decode(await this.s3.ler(await this.bucket(rede), chave));
    } catch {
      return null;
    }
  }
}
