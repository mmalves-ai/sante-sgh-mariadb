// Conteúdo bruto das mensagens das integrações (M34; ficha, seção 6; cap-14 §14.2.8): a mensagem recebida ou enviada
// vai à porta de arquivos do núcleo (ADR 0004: disco local do cliente, origem `integracao`), nunca ao log; na tabela
// da mensagem fica só o resumo SHA-256 e a referência do arquivo (o id). Em memória na sessão sintética.
import { createHash, randomUUID } from 'node:crypto';
import { type ArmazemArquivos, ErroConfiguracao } from '@sgh/nucleo';
import { idDoArquivo, type ResolverEstabelecimento } from '../../documento/public-api.js';

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

/**
 * Sobre a porta de arquivos do cliente: a referência devolvida é o id do arquivo (texto), que a mensagem guarda. O
 * mesmo conteúdo no mesmo mês reaproveita o arquivo. Referência que não é id (de antes do ADR 0004) lê como ausente.
 */
export class ArmazemConteudoArquivos implements ArmazemConteudo {
  constructor(
    private readonly armazem: ArmazemArquivos,
    private readonly cliente: string,
    /** Id do estabelecimento pelo código (1º segmento da chave); sem ele, o arquivo fica sem estabelecimento. */
    private readonly idEstabelecimento?: ResolverEstabelecimento,
  ) {}

  private ctx(correlacao: string) {
    return {
      cliente: this.cliente,
      estabelecimento: null,
      usuario: null,
      correlacao: correlacao.slice(0, 64),
    };
  }

  async gravar(_rede: string, chave: string, conteudo: string): Promise<string> {
    const bytes = new TextEncoder().encode(conteudo);
    const resumo = resumoSha256(conteudo);
    // Chave nova por gravação: o mesmo conteúdo cai no mesmo arquivo pela porta (reaproveitado), não pela chave.
    const chaveIdempotencia = `integracao-${randomUUID()}`;
    const hospital = chave.split('/')[0] ?? '';
    const estabelecimento = this.idEstabelecimento ? await this.idEstabelecimento(hospital) : null;
    const g = await this.armazem.guardar(
      {
        conteudo: bytes,
        nomeOriginal: (chave.split('/').pop() || `${resumo}.txt`).slice(0, 255),
        tipoMime: 'text/plain',
        finalidade: 'conteudo_integracao',
        origem: 'integracao',
      },
      { ...this.ctx(chaveIdempotencia), estabelecimento, chaveIdempotencia },
    );
    return String(g.id);
  }

  async ler(_rede: string, referencia: string): Promise<string | null> {
    const id = idDoArquivo(referencia);
    if (id === null) return null;
    const ctx = this.ctx(`integracao-leitura-${id}`);
    if (!(await this.armazem.existe(ctx, id))) return null;
    return new TextDecoder().decode((await this.armazem.ler(ctx, id)).conteudo);
  }
}

/** Sem o banco próprio do cliente fora da sessão sintética: falha fechada. */
export function armazemConteudoIndisponivel(): ArmazemConteudo {
  const recusar = async (): Promise<never> => {
    throw new ErroConfiguracao(
      'Armazém do conteúdo das integrações indisponível: sem o banco próprio do cliente.',
    );
  };
  return { gravar: recusar, ler: recusar };
}
