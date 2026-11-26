// Etiqueta do pacote estéril da CME (F7, 04-CME linha 118; RDC 15/2012, art. 83): o produto, o lote do ciclo, a data
// da esterilização, a data limite de uso, o método e o responsável pelo preparo, com o código da etiqueta em Code 128
// (o leitor da CME e do bloco rastreia por ele até o ciclo, a cirurgia e o paciente). Nada de paciente na etiqueta.
// O que falta na etiqueta é recusado antes (faltasDaEtiqueta, @sgh/dominio-cirurgia); aqui só o desenho ZPL
// (50 × 30 mm, 203 dpi), comparável como texto.
import { campoZpl, ErroZpl } from './modelos.js';

export interface DadosEtiquetaPacoteEsteril {
  /** O código da etiqueta (PE + estabelecimento + número), no Code 128. */
  readonly codigo: string;
  readonly produto: string;
  readonly lote: string;
  /** DD/MM/AAAA. */
  readonly esterilizadoEm: string;
  /** DD/MM/AAAA. */
  readonly validade: string;
  readonly metodo: string;
  readonly preparadoPor: string;
}

/** O ZPL da etiqueta do pacote estéril (uma etiqueta, ^XA…^XZ). */
export function zplEtiquetaPacoteEsteril(d: DadosEtiquetaPacoteEsteril): string {
  if (!/^[0-9A-Z]{3,40}$/.test(d.codigo)) throw new ErroZpl('Código da etiqueta do pacote inválido.');
  for (const [nome, v] of [
    ['produto', d.produto],
    ['lote', d.lote],
    ['método', d.metodo],
    ['responsável', d.preparadoPor],
  ] as const)
    if (!v.trim()) throw new ErroZpl(`Falta o ${nome} na etiqueta do pacote.`);
  if (![d.esterilizadoEm, d.validade].every((x) => /^\d{2}\/\d{2}\/\d{4}$/.test(x)))
    throw new ErroZpl('Data da etiqueta do pacote inválida.');
  const linha = (t: string, n = 34) => t.trim().toUpperCase().slice(0, n);
  return [
    '^XA',
    '^CI28',
    '^PW400',
    '^LL240',
    '^LH0,0',
    '^FO10,10^A0N,24,24' + campoZpl(linha(d.produto, 30)),
    '^FO10,38^A0N,20,20' + campoZpl(linha(`LOTE ${d.lote}  ${d.metodo}`)),
    '^FO10,62^A0N,20,20' + campoZpl(linha(`ESTER ${d.esterilizadoEm}  VAL ${d.validade}`)),
    '^FO10,86^A0N,18,18' + campoZpl(linha(`PREP ${d.preparadoPor}`)),
    `^FO10,112^BCN,70,N,N,N^FD${d.codigo}^FS`,
    '^FO10,190^A0N,22,22' + campoZpl(d.codigo),
    '^PQ1',
    '^XZ',
    '',
  ].join('\n');
}
