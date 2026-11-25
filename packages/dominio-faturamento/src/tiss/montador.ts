// O montador do lote TISS (M31; ficha, seção 5, `faturamento.gerarLote`, e regras 1, 3 e 4): monta a mensagem 04.03.00
// com os números gravados pelo contador, valida no XSD oficial (com o hash do epílogo conferido), explica o erro em
// português e, só se válida, guarda o XML (S3 com Object Lock na API; memória nos testes) pela chave única do lote e do
// hash, com o SHA-256 do arquivo. Nada é guardado quando o XSD recusa.
import type { DadosLoteTiss, DadosPrestador, LoteMontado, MontadorLoteTiss } from '@sgh/contratos';
import type { RecursoGlosa } from './lote.js';
import { faltasDoPrestador, explicarErroXsd, montarLote, montarRecurso } from './montagem.js';
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

/** O que a guia de recurso de glosa precisa para virar o XML do lote de recurso (F3.7, 06-FAT linha 34). */
export interface DadosRecursoTiss {
  readonly hospital: string;
  readonly convenio: number;
  /** Número do lote TISS do recurso (sequência do estabelecimento); é o sequencial da transação. */
  readonly numeroLote: string;
  readonly prestador: Pick<DadosPrestador, 'registroAns' | 'codigoPrestador'>;
  readonly recurso: RecursoGlosa;
  readonly agora: Date;
}

export type MontadorRecursoTiss = (d: DadosRecursoTiss) => Promise<LoteMontado>;

/** O montador do lote com o do recurso de glosa (a mesma guarda e o mesmo validador). */
export type MontadorLoteComRecurso = MontadorLoteTiss & { readonly recurso: MontadorRecursoTiss };

/** Chave do XML do recurso: estabelecimento, convênio, número do lote do recurso e o hash do arquivo. */
export const chaveXmlRecurso = (
  d: Pick<DadosRecursoTiss, 'hospital' | 'convenio' | 'numeroLote'>,
  hash: string,
) => `${d.hospital}/tiss/recursos/${d.convenio}/${d.numeroLote}-${hash.slice(0, 16)}.xml`;

/**
 * Monta a mensagem RECURSO_GLOSA, valida no XSD oficial (hash do epílogo conferido) e, só se válida, guarda o XML pela
 * chave do lote do recurso. Nada é guardado quando o XSD recusa; o erro volta explicado em português.
 */
export function criarMontadorRecurso(
  guardar: GuardarXml,
  carregar: () => Promise<ArquivoEsquema[]> = carregarEsquemas,
): MontadorRecursoTiss {
  let esquemas: Promise<ArquivoEsquema[]> | null = null;
  return async (d) => {
    const valor =
      d.recurso.guias
        .flatMap((g) => (g.itens?.length ? g.itens.map((i) => i.valorRecursado) : [g.valorRecursado]))
        .reduce((s, v) => s + Math.round(v * 100), 0) / 100;
    const vazio = (erros: string[], hashEpilogo = '', bytes = 0): LoteMontado => ({
      valido: false,
      erros,
      explicacao: erros.map(explicarErroXsd),
      versao: '04.03.00',
      hashEpilogo,
      hashArquivo: '',
      bytes,
      guias: d.recurso.guias.length,
      valor,
      chaveObjeto: '',
      versaoObjeto: null,
    });
    let m;
    try {
      m = montarRecurso({ ...d.prestador, cnes: '', nome: '' }, d.numeroLote, d.recurso, d.agora);
    } catch (e) {
      return vazio([e instanceof Error ? e.message : String(e)]);
    }
    esquemas ??= carregar();
    const c = await conferirLote(m, await esquemas);
    if (c.estado !== 'pronto') return vazio(c.erros as string[], m.hash, m.bytes.length);
    const hashArquivo = await sha256Hex(m.bytes);
    const chave = chaveXmlRecurso(d, hashArquivo);
    const g = await guardar(chave, m.bytes);
    return {
      valido: true,
      erros: [],
      explicacao: [],
      versao: m.versao,
      hashEpilogo: m.hash,
      hashArquivo,
      bytes: m.bytes.length,
      guias: d.recurso.guias.length,
      valor,
      chaveObjeto: chave,
      versaoObjeto: g.versao,
    };
  };
}

export function criarMontadorLote(guardar: GuardarXml): MontadorLoteComRecurso {
  return Object.assign(criarMontadorSoLote(guardar), { recurso: criarMontadorRecurso(guardar) });
}

function criarMontadorSoLote(guardar: GuardarXml): MontadorLoteTiss {
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
