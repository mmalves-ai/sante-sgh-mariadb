// Guarda dos arquivos do financeiro (M32; ficha, seção 6; ADR 0004): o extrato importado, a remessa e o retorno
// bancário, o XML da NFS-e, a DMED, a EFD-REINF e o lote contábil vão ao disco da máquina, sob a raiz de arquivos, na
// pasta do banco do cliente (porta de arquivos do núcleo), numa chave única por tipo e SHA-256: a chave já ocupada é
// recusada antes de gravar e o arquivo gravado fica somente leitura. A gravação da tabela dona registra o arquivo em
// `arquivo` (hash, tamanho, tipo, imutável e guarda legal de 5 anos) na mesma transação (porta-propria.ts), e é esse
// registro que o vigia do worker confere. Em memória na sessão sintética.
import { guardaLocal, type LocalizadorArquivos } from '../tiss/armazem-xml.js';

export interface ArmazemFinanceiro {
  guardar(chave: string, bytes: Uint8Array, tipo: string): Promise<{ versao: string | null }>;
  ler(chave: string): Promise<Uint8Array | null>;
}

export class ErroSobrescritaArquivo extends Error {
  override readonly name = 'ErroSobrescritaArquivo';
}

export function armazemFinanceiroMemoria(): ArmazemFinanceiro & { objetos: Map<string, Uint8Array> } {
  const objetos = new Map<string, Uint8Array>();
  return {
    objetos,
    async guardar(chave, bytes) {
      if (objetos.has(chave))
        throw new ErroSobrescritaArquivo(`O arquivo ${chave} já está guardado: é imutável.`);
      objetos.set(chave, bytes);
      return { versao: null };
    },
    ler: async (chave) => objetos.get(chave) ?? null,
  };
}

export function armazemFinanceiroLocal(
  localizador: () => LocalizadorArquivos,
  cliente: string,
): ArmazemFinanceiro {
  const g = guardaLocal(localizador, cliente);
  const recusar = (chave: string) =>
    new ErroSobrescritaArquivo(`O arquivo ${chave} já está guardado: é imutável.`);
  return {
    async guardar(chave, bytes) {
      await g.gravar(chave, bytes, { recusar });
      return { versao: null };
    },
    ler: (chave) => g.ler(chave),
  };
}
