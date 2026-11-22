// Arquivos dos laudos do patrimônio (W0-08, achado 6 da revisão; CPC 01 e CPC 27; RDC 509 arts. 8º e 15: guarda de pelo
// menos 5 anos; ADR 0004): o PDF do laudo vai ao disco da máquina, sob a raiz de arquivos, na pasta do banco do cliente
// (porta de arquivos do núcleo: gravação uma vez, somente leitura). A chave sai do SHA-256 do arquivo: o mesmo PDF
// nunca vira duas cópias e nada se sobrescreve; a leitura confere o hash. A anexação registra o PDF em `arquivo` (hash,
// tamanho, tipo, imutável e guarda legal de 5 anos) na mesma transação de `laudo_bem` (porta-propria.ts), e é esse
// registro que o vigia do worker confere. Sem núcleo (testes e a sessão sintética), em memória.
import { ErroOperacao, sha256 } from '@sgh/nucleo';
import { guardaLocal, type LocalizadorArquivos } from '../tiss/armazem-xml.js';

export interface ArmazemLaudoPatrimonio {
  readonly destino: 'disco' | 'memoria';
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

export function armazemLaudoLocal(
  localizador: () => LocalizadorArquivos,
  cliente: string,
): ArmazemLaudoPatrimonio {
  const g = guardaLocal(localizador, cliente);
  return {
    destino: 'disco',
    async guardar(_hospital, bytes, hash) {
      const chave = chaveLaudo(hash);
      if (sha256(bytes) !== hash)
        throw new ErroOperacao(
          400,
          'arquivo-divergente',
          'Arquivo divergente',
          'O PDF do laudo não confere com o resumo informado.',
        );
      // O mesmo arquivo já anexado (a outro ajuste ou numa tentativa recusada): o arquivo guardado é reaproveitado.
      await g.gravar(chave, bytes, {
        reaproveitar: true,
        recusar: () => new Error('laudo já guardado'),
      });
      return chave;
    },
    async ler(_hospital, chave) {
      if (!CHAVE_LAUDO.test(chave)) return null;
      const bytes = await g.ler(chave);
      if (bytes && sha256(bytes) !== chave.slice('patrimonio/laudos/'.length, -'.pdf'.length))
        throw new ErroOperacao(
          500,
          'arquivo-divergente',
          'Arquivo íntegro indisponível',
          'O laudo no armazenamento não confere com o hash da chave.',
        );
      return bytes;
    },
  };
}
