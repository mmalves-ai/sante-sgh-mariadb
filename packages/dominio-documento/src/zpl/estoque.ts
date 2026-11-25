// Etiqueta de identificação do estoque (F3.6, 05-SUP linha 14): uma por unidade, dose, embalagem ou caixa, com o
// DataMatrix GS1 (produto, validade, lote e o identificador do hospital na série) e o código linear (Code 128) só com
// o identificador. Legível: o item, o lote, a validade, a quantidade e o texto "(01)…(17)…(10)…(21)…". Nada de pessoa.
// O conteúdo dos códigos vem pronto de `montarEtiqueta` (@sgh/contratos/regras-suprimentos); aqui só o desenho ZPL
// (50 × 30 mm, 203 dpi), comparável como texto.
import { campoZpl, ErroZpl } from './modelos.js';

export interface DadosEtiquetaEstoque {
  /** O identificador da etiqueta (vai no Code 128). */
  readonly identificador: string;
  /** O conteúdo do DataMatrix GS1 com o separador GS entre os campos variáveis. */
  readonly datamatrix: string;
  /** O texto legível sob os códigos. */
  readonly legivel: string;
  readonly item: string;
  readonly lote: string | null;
  /** DD/MM/AAAA. */
  readonly validade: string | null;
  /** Quantidade e unidade ("10 CP"). */
  readonly quantidade: string;
}

/** O ZPL de uma etiqueta; várias etiquetas saem concatenadas (cada uma com ^XA…^XZ). */
export function zplEtiquetaEstoque(d: DadosEtiquetaEstoque): string {
  if (!/^[0-9A-Z]{3,40}$/.test(d.identificador)) throw new ErroZpl('Identificador da etiqueta inválido.');
  const partes = d.datamatrix.split('\u001d');
  if (partes.some((x) => !/^[\x21-\x7e]+$/.test(x) || /[\^~_]/.test(x)))
    throw new ErroZpl('Dado do DataMatrix inválido.');
  // ^BX com o escape `_` (7º parâmetro): `_1` é o FNC1 (o inicial marca GS1; os outros separam os campos variáveis).
  const dm = `_1${partes.join('_1')}`;
  const linha = (t: string, n = 30) => t.trim().toUpperCase().slice(0, n);
  return [
    '^XA',
    '^CI28',
    '^PW400',
    '^LL240',
    '^LH0,0',
    '^FO10,10^A0N,24,24' + campoZpl(linha(d.item, 30)),
    '^FO10,40^A0N,20,20' + campoZpl(linha(`LOTE ${d.lote ?? '-'}  VAL ${d.validade ?? '-'}`, 34)),
    '^FO10,64^A0N,20,20' + campoZpl(linha(`QTDE ${d.quantidade}`, 34)),
    `^FO10,92^BCN,60,N,N,N^FD${d.identificador}^FS`,
    '^FO10,158^A0N,18,18' + campoZpl(linha(d.identificador, 34)),
    '^FO10,182^A0N,16,16' + campoZpl(d.legivel.slice(0, 60)),
    `^FO270,40^BXN,4,200,,,,_^FD${dm}^FS`,
    '^PQ1',
    '^XZ',
    '',
  ].join('\n');
}
