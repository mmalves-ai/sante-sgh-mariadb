// Leitura do arquivo oficial na tela (M13): os arquivos do DATASUS (tabela unificada), a base de CEP e os CSV da
// TUSS costumam vir em ISO-8859-1/Windows-1252, e File.text() decodifica sempre como UTF-8 (os acentos virariam
// U+FFFD e, no banco, "?"). Os bytes são lidos e decodificados como UTF-8 estrito; se não forem UTF-8 válido, como
// Windows-1252 (superconjunto do Latin-1). A codificação detectada vai junto com o arquivo e fica na carga.
import type { CharsetArquivoCatalogo } from '@sgh/contratos';

export function decodificarArquivo(bytes: ArrayBuffer | Uint8Array): {
  texto: string;
  charset: CharsetArquivoCatalogo;
} {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // BOM de UTF-8: sai do texto.
  const semBom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
  try {
    return { texto: new TextDecoder('utf-8', { fatal: true }).decode(semBom), charset: 'utf-8' };
  } catch {
    return { texto: new TextDecoder('windows-1252').decode(b), charset: 'windows-1252' };
  }
}

/** Lê o arquivo escolhido como bytes e decodifica (UTF-8 ou Windows-1252). */
export async function lerArquivoOficial(
  f: Blob & { readonly name: string },
): Promise<{ nome: string; conteudo: string; charset: CharsetArquivoCatalogo }> {
  const { texto, charset } = decodificarArquivo(await f.arrayBuffer());
  return { nome: f.name, conteudo: texto, charset };
}
