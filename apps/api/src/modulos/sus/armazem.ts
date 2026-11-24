// Guarda do arquivo exportado ao SUS (M51; ficha, seção 12: "os arquivos gerados ficam guardados com o hash"; ADR
// 0004): o conteúdo tem dado pessoal (nome, endereço, CNS e nascimento no leiaute da CIHA) e vai ao disco da máquina,
// sob a raiz de arquivos, na pasta do banco do cliente (porta de arquivos do núcleo): gravação uma vez, somente
// leitura, a chave já ocupada recusada antes de gravar. A transação recusada remove o arquivo recém-gravado por esta
// guarda (nenhum dado pessoal fica órfão, fora do registro e do download auditado); `fixar`, depois do COMMIT, tira a
// chave do conjunto removível, e daí em diante `remover` a recusa (409 `arquivo-retido`), como a chave alheia.
// A guarda legal de 5 anos é o registro em `arquivo` com `retencao_ate`, gravado pela porta própria na mesma transação
// da remessa (porta-propria-arquivos.ts); a transação recusada remove o arquivo. Em memória na sessão sintética.
import { guardaLocal, type LocalizadorArquivos } from '../tiss/armazem-xml.js';
import type { ArmazemArquivoSus } from './servico.js';

export class ErroSobrescritaArquivoSus extends Error {
  override readonly name = 'ErroSobrescritaArquivoSus';
}

export function armazemSusMemoria(): ArmazemArquivoSus & {
  objetos: Map<string, Uint8Array>;
  fixados: Set<string>;
} {
  const objetos = new Map<string, Uint8Array>();
  const fixados = new Set<string>();
  return {
    objetos,
    fixados,
    async guardar(chave, bytes) {
      if (objetos.has(chave)) throw new ErroSobrescritaArquivoSus(`O arquivo ${chave} já está guardado.`);
      objetos.set(chave, bytes);
      return { versao: null };
    },
    async fixar(chave) {
      if (objetos.has(chave)) fixados.add(chave);
    },
    async remover(chave) {
      if (fixados.has(chave) || !objetos.has(chave))
        throw new ErroSobrescritaArquivoSus(`O arquivo ${chave} já foi confirmado ou não é desta guarda.`);
      objetos.delete(chave);
    },
    ler: async (chave) => objetos.get(chave) ?? null,
  };
}

export function armazemSusLocal(localizador: () => LocalizadorArquivos, cliente: string): ArmazemArquivoSus {
  const g = guardaLocal(localizador, cliente, { removivel: true });
  const recusar = (chave: string) =>
    new ErroSobrescritaArquivoSus(`O arquivo ${chave} já está guardado: o arquivo guardado é imutável.`);
  return {
    async guardar(chave, bytes) {
      await g.gravar(chave, bytes, { recusar });
      return { versao: null };
    },
    // No disco o arquivo já nasce somente leitura; confirmado, deixa de ser removível por esta guarda. A guarda legal
    // (retencao_ate) é a do registro em `arquivo`, gravado pela porta própria (pedido em aberto).
    async fixar(chave) {
      g.fixar(chave);
    },
    remover: (chave) => g.remover(chave),
    ler: (chave) => g.ler(chave),
  };
}
