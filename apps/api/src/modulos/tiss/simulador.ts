// O simulador de operadora (M31; ficha, regra 13; convencoes.md §1, regra 10): fora de produção nenhum lote sai do
// estabelecimento; o "envio" vai a este simulador, que confere o XML como a operadora conferiria (a versão 04.03.00,
// o XSD e o hash do epílogo) e devolve um protocolo de recebimento SINTÉTICO (prefixo SIM) com o recibo. O contrato da
// resposta é o mesmo do consumidor do worker em produção (protocolo, recibo, situação 1 = recebido).
import {
  type ArquivoEsquema,
  carregarEsquemas,
  conferirHashEpilogo,
  iso88591,
  validarNoXsd,
} from '@sgh/dominio-faturamento';

export interface RespostaOperadora {
  readonly aceito: boolean;
  readonly protocolo: string | null;
  readonly recibo: string | null;
  /** Situação do protocolo na operadora: 1 recebido. */
  readonly situacao: number | null;
  readonly erros: readonly string[];
}

let esquemas: Promise<ArquivoEsquema[]> | null = null;

export async function simularOperadora(lote: number, xml: Uint8Array): Promise<RespostaOperadora> {
  esquemas ??= carregarEsquemas();
  const v = await validarNoXsd(xml, await esquemas);
  const h = conferirHashEpilogo(iso88591(xml));
  const erros = [...v.erros, ...(h.confere ? [] : ['hash do epílogo não confere'])];
  if (!v.valido || !h.confere) return { aceito: false, protocolo: null, recibo: null, situacao: null, erros };
  return {
    aceito: true,
    protocolo: `SIM${String(lote).padStart(9, '0')}`.slice(0, 12),
    recibo: `RECIBO-SIMULADO-${lote}`,
    situacao: 1,
    erros: [],
  };
}
