// O montador do lote TISS (M31; ficha, seção 5, `faturamento.gerarLote`, e regras 1, 3 e 4): monta a mensagem 04.03.00
// com os números gravados pelo contador, valida no XSD oficial (com o hash do epílogo conferido), explica o erro em
// português e, só se válida, guarda o XML (S3 com Object Lock na API; memória nos testes) pela chave única do lote e do
// hash, com o SHA-256 do arquivo. Nada é guardado quando o XSD recusa.
import type { DadosLoteTiss, LoteMontado, MontadorLoteTiss } from '@sgh/contratos';
import { faltasDoPrestador, explicarErroXsd, montarLote } from './montagem.js';
import { type ArquivoEsquema, carregarEsquemas, conferirLote } from './validacao.js';

/** Guarda imutável: grava a chave nova (recusa sobrescrever) e devolve a versão do objeto. */
export type GuardarXml = (chave: string, bytes: Uint8Array) => Promise<{ versao: string | null }>;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Chave do objeto do lote: estabelecimento, convênio, o número do lote (a chave natural, conhecida antes de gravar) e o
 * hash do arquivo (o mesmo conteúdo, a mesma chave).
 */
export const chaveXmlLote = (d: Pick<DadosLoteTiss, 'hospital' | 'convenio' | 'numeroLote'>, hash: string) =>
  `${d.hospital}/tiss/lotes/${d.convenio}/${d.numeroLote}-${hash.slice(0, 16)}.xml`;

export function criarMontadorLote(guardar: GuardarXml): MontadorLoteTiss {
  let esquemas: Promise<ArquivoEsquema[]> | null = null;
  return async (d: DadosLoteTiss): Promise<LoteMontado> => {
    const faltas = faltasDoPrestador(d.prestador);
    const valor =
      d.contas
        .flatMap((c) => c.itens)
        .reduce((s, i) => s + Math.round(i.quantidade * i.valorUnitario * 100), 0) / 100;
    const vazio = (erros: string[]): LoteMontado => ({
      valido: false,
      erros,
      explicacao: erros.map(explicarErroXsd),
      versao: '04.03.00',
      hashEpilogo: '',
      hashArquivo: '',
      bytes: 0,
      guias: d.contas.length,
      valor,
      chaveObjeto: '',
      versaoObjeto: null,
    });
    if (faltas.length) return vazio(faltas.map((f) => `Falta ${f} no cadastro.`));
    let m;
    try {
      m = montarLote(d.prestador, d.numeroLote, d.sequencial, d.contas, d.agora);
    } catch (e) {
      return vazio([e instanceof Error ? e.message : String(e)]);
    }
    esquemas ??= carregarEsquemas();
    const c = await conferirLote(m, await esquemas);
    if (c.estado !== 'pronto')
      return { ...vazio(c.erros as string[]), hashEpilogo: m.hash, bytes: m.bytes.length };
    const hashArquivo = await sha256Hex(m.bytes);
    const chave = chaveXmlLote(d, hashArquivo);
    const g = await guardar(chave, m.bytes);
    return {
      valido: true,
      erros: [],
      explicacao: [],
      versao: m.versao,
      hashEpilogo: m.hash,
      hashArquivo,
      bytes: m.bytes.length,
      guias: d.contas.length,
      valor,
      chaveObjeto: chave,
      versaoObjeto: g.versao,
    };
  };
}

/** Guarda em memória (testes e sessão sintética): a chave existente é recusada (imutável). */
export function guardaXmlMemoria(objetos = new Map<string, Uint8Array>()): GuardarXml & {
  objetos: Map<string, Uint8Array>;
} {
  const f = async (chave: string, bytes: Uint8Array) => {
    if (objetos.has(chave)) throw new Error(`Objeto ${chave} já existe: o XML guardado é imutável.`);
    objetos.set(chave, bytes);
    return { versao: `memoria-${objetos.size}` };
  };
  return Object.assign(f, { objetos });
}
