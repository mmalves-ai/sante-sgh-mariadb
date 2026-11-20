// Etiqueta do lactário (ficha do M45, etapa 6; cap-06a §6.3 "rotulagem e controle de validade"): uma por porção, com os
// dois identificadores legíveis (nome completo e data de nascimento; prontuário como apoio), o leito, a fórmula, o
// volume, o horário da porção, o preparo e a validade, o lote e quem conferiu. O código só com os IDs do legado
// (internação) e o número da ordem; nunca nome nem documento no código. Comparado como texto com a referência.
import { campoZpl, ErroZpl } from './modelos.js';

export interface DadosEtiquetaLactario {
  readonly nomeCompleto: string;
  /** AAAA-MM-DD */
  readonly nascimento: string;
  readonly prontuario: number;
  readonly internacao: number;
  readonly ordem: number;
  readonly leito: string;
  readonly formula: string;
  readonly volumeMl: number;
  /** "DD/MM HH:MM" da porção. */
  readonly horario: string;
  /** "DD/MM HH:MM" do preparo e da validade. */
  readonly preparo: string;
  readonly validade: string;
  readonly lote: string | null;
  readonly conferidoPor: string;
}

const positivo = (nome: string, v: number) => {
  if (!Number.isSafeInteger(v) || v <= 0) throw new ErroZpl(`${nome} inválido: inteiro positivo.`);
  return String(v);
};

function dataLegivel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || iso === '1899-12-30')
    throw new ErroZpl('Data de nascimento ausente ou inválida: a etiqueta não sai.');
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Etiqueta da porção (térmica 60 × 40 mm, 203 dpi) com o DataMatrix da internação e da ordem. */
export function zplEtiquetaLactario(d: DadosEtiquetaLactario): string {
  const reg = positivo('internacao', d.internacao);
  const ordem = positivo('ordem', d.ordem);
  const pront = positivo('prontuario', d.prontuario);
  const volume = positivo('volume', d.volumeMl);
  const linha = (t: string, n = 32) => t.trim().toUpperCase().slice(0, n);
  return [
    '^XA',
    '^CI28',
    '^PW480',
    '^LL320',
    '^LH0,0',
    '^FO10,10^A0N,26,26' + campoZpl(linha(d.nomeCompleto, 34)),
    '^FO10,40^A0N,22,22' + campoZpl(linha(`NASC. ${dataLegivel(d.nascimento)}  PRONT. ${pront}`, 36)),
    '^FO10,66^A0N,22,22' + campoZpl(linha(`LEITO ${d.leito}  INT. ${reg}`, 36)),
    '^FO10,96^A0N,24,24' + campoZpl(linha(d.formula, 30)),
    '^FO10,124^A0N,24,24' + campoZpl(linha(`${volume} ML  PORCAO ${d.horario}`, 30)),
    '^FO10,154^A0N,20,20' + campoZpl(linha(`PREPARO ${d.preparo}  VAL ${d.validade}`, 40)),
    '^FO10,180^A0N,20,20' + campoZpl(linha(`LOTE ${d.lote ?? '-'}  CONF. ${d.conferidoPor}`, 40)),
    `^FO360,200^BXN,4,200^FDL${reg}|O${ordem}^FS`,
    '^PQ1',
    '^XZ',
    '',
  ].join('\n');
}
