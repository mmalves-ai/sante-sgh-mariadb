// Arquivos da digitalização certificada (M50, etapa 6; Lei 13.787/2018, art. 6: guarda de 20 anos): o PDF do escâner
// vai ao disco local pela porta de arquivos do núcleo (ADR 0004: ARQUIVOS_RAIZ, uma pasta por banco de cliente, gravação
// uma vez em somente leitura, metadado na tabela `arquivo` com trilha). A guarda legal (`retencao_ate`) só é fixada
// depois do COMMIT do documento (`fixar`): a tentativa recusada não deixa arquivo preso por 20 anos. A chave do
// módulo leva o id do arquivo (`same/digitalizacao/arquivo-<id>.pdf`); o banco guarda a chave e o resumo. Nunca vai a
// log. Sem núcleo (testes de unidade e a sessão sintética), em memória.
import { ANOS_GUARDA_DIGITALIZACAO } from '@sgh/contratos';
import { type NucleoArmazem, sha256 } from '@sgh/nucleo';
import {
  ambienteCurto,
  type ArquivosDoModulo,
  arquivosDoAmbiente,
  dataDaqui,
  idNaChave,
} from '../arquivos-locais.js';

export interface ArmazemDigitalizacao {
  readonly destino: 'local' | 'memoria';
  /**
   * Guarda o PDF (o mesmo conteúdo nunca vira duas cópias: o arquivo de uma tentativa recusada é reaproveitado) e
   * devolve a chave do módulo.
   */
  guardar(hospital: string, bytes: Uint8Array, hash: string): Promise<string>;
  /** Depois do COMMIT: a guarda legal no registro do arquivo (`retencao_ate`, 20 anos; em dev/ci, nada). */
  fixar(hospital: string, chave: string): Promise<void>;
  ler(hospital: string, chave: string): Promise<Uint8Array | null>;
}

export const ARMAZEM_DIGITALIZACAO = Symbol('ARMAZEM_DIGITALIZACAO');

/** `same/digitalizacao/<sha-256>.pdf`: a chave sai do resumo do arquivo. */
export const chaveDigitalizacao = (hash: string) => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('resumo SHA-256 inválido para a chave do arquivo');
  return `same/digitalizacao/${hash}.pdf`;
};
/** A chave do módulo para o arquivo guardado na porta do núcleo. */
export const chaveDigitalizacaoDoArquivo = (id: number) => `same/digitalizacao/arquivo-${id}.pdf`;
/** O formato que a leitura aceita: o id do arquivo; na memória, o resumo (64) ou o identificador das primeiras (32). */
export const CHAVE_DIGITALIZACAO =
  /^same\/digitalizacao\/(?:[a-f0-9]{32}|[a-f0-9]{64}|arquivo-[1-9]\d{0,14})\.pdf$/;

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

/** O PDF sobre a porta de arquivos do núcleo (disco local), com a guarda legal fora de dev/ci. */
export function armazemDigitalizacaoLocal(
  arquivos: ArquivosDoModulo,
  env: NodeJS.ProcessEnv = process.env,
): ArmazemDigitalizacao {
  const curto = ambienteCurto(env);
  return {
    destino: 'local',
    async guardar(hospital, bytes, hash) {
      chaveDigitalizacao(hash);
      if (sha256(bytes) !== hash) throw new Error('o resumo SHA-256 não confere com o arquivo');
      const g = await arquivos.guardar(hospital, {
        conteudo: bytes,
        nomeOriginal: `digitalizacao-${hash.slice(0, 16)}.pdf`,
        tipoMime: 'application/pdf',
        finalidade: 'documento_digitalizado',
        entidade: 'documento_digitalizado',
        // Sem guarda até o COMMIT: o `fixar` a aplica no documento confirmado.
        retencaoAte: null,
      });
      return chaveDigitalizacaoDoArquivo(g.id);
    },
    async fixar(hospital, chave) {
      if (curto) return;
      const id = CHAVE_DIGITALIZACAO.test(chave) ? idNaChave(chave) : null;
      if (id === null) throw new Error('chave de digitalização sem o id do arquivo');
      await arquivos.fixarRetencao(hospital, id, dataDaqui(ANOS_GUARDA_DIGITALIZACAO));
    },
    async ler(hospital, chave) {
      const id = CHAVE_DIGITALIZACAO.test(chave) ? idNaChave(chave) : null;
      if (id === null) return null;
      const r = await arquivos.ler(hospital, id);
      if (!r || r.metadado.finalidade !== 'documento_digitalizado') return null;
      return new Uint8Array(r.conteudo);
    },
  };
}

/** O armazém pelo ambiente: com o núcleo, o disco local (ARQUIVOS_RAIZ); sem ele, em memória. */
export function criarArmazemDigitalizacao(
  nucleo: NucleoArmazem | null | undefined,
  cliente: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ArmazemDigitalizacao {
  const arquivos = arquivosDoAmbiente(nucleo, cliente, env);
  return arquivos ? armazemDigitalizacaoLocal(arquivos, env) : new ArmazemDigitalizacaoMemoria();
}
