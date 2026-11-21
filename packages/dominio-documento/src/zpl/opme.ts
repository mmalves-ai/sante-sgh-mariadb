// Etiqueta do consumo de OPME em sala (ficha do M46, etapa 3; regra 6; cap-05a §5.5): três vias iguais no rastreio e
// diferentes no destino — a do prontuário, a do paciente (o cartão de implante que ele leva) e a do faturamento (com o
// TUSS e a conta). Cada via leva o item, o fabricante, o modelo, o lote ou a série, o registro na Anvisa, a validade, o
// atendimento, a data da cirurgia e as iniciais do paciente (o nome completo fica no prontuário); o código de barras só
// com os IDs do novo e do estoque (o consumo e o lançamento da saída). Comparada como texto com a referência versionada
// (referencias/etiqueta-opme.zpl); a impressão física e a leitura no bloco são da validação humana.
import { campoZpl, ErroZpl } from './modelos.js';

export type ViaOpme = 'prontuario' | 'paciente' | 'faturamento';
export const VIAS_OPME: readonly ViaOpme[] = ['prontuario', 'paciente', 'faturamento'];
const ROTULO_VIA: Record<ViaOpme, string> = {
  prontuario: 'VIA PRONTUARIO',
  paciente: 'VIA PACIENTE',
  faturamento: 'VIA FATURAMENTO',
};

export interface DadosEtiquetaOpme {
  /** O consumo (id do rastreio da OPME) e o lançamento da saída do estoque (id da saída). */
  readonly consumo: number;
  readonly lancamento: number;
  readonly atendimento: number;
  readonly conta: number;
  readonly iniciais: string;
  /** DD/MM/AAAA da cirurgia. */
  readonly data: string;
  readonly item: string;
  readonly tuss: string | null;
  readonly quantidade: number;
  readonly fabricante: string;
  readonly modelo: string | null;
  readonly lote: string | null;
  readonly serie: string | null;
  readonly registroAnvisa: string;
  /** DD/MM/AAAA. */
  readonly validade: string | null;
}

const positivo = (nome: string, v: number) => {
  if (!Number.isSafeInteger(v) || v <= 0) throw new ErroZpl(`${nome} inválido: inteiro positivo.`);
  return String(v);
};
const linha = (t: string, n: number) => t.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, n);

/** Uma via (térmica 100 × 60 mm, 203 dpi) com o Code 128 do consumo e do lançamento. */
function via(d: DadosEtiquetaOpme, v: ViaOpme): string {
  const consumo = positivo('consumo', d.consumo);
  const lanc = positivo('lancamento', d.lancamento);
  const at = positivo('atendimento', d.atendimento);
  if (!(d.quantidade > 0)) throw new ErroZpl('Quantidade inválida.');
  if (!d.lote?.trim() && !d.serie?.trim()) throw new ErroZpl('Sem lote nem série: a etiqueta não sai.');
  if (!/^\d{7,13}$/.test(d.registroAnvisa)) throw new ErroZpl('Registro na Anvisa inválido.');
  const qtd = Number.isInteger(d.quantidade) ? String(d.quantidade) : d.quantidade.toFixed(3);
  return [
    '^XA',
    '^CI28',
    '^PW800',
    '^LL480',
    '^LH0,0',
    '^FO20,15^A0N,30,30' + campoZpl(ROTULO_VIA[v]),
    '^FO500,15^A0N,26,26' + campoZpl(linha(`AT ${at}  ${d.iniciais}`, 22)),
    '^FO20,55^A0N,30,30' + campoZpl(linha(d.item, 44)),
    '^FO20,95^A0N,24,24' + campoZpl(linha(`FABR ${d.fabricante}`, 54)),
    '^FO20,125^A0N,24,24' + campoZpl(linha(`MODELO ${d.modelo ?? '-'}`, 54)),
    '^FO20,155^A0N,26,26' + campoZpl(linha(`LOTE ${d.lote ?? '-'}  SERIE ${d.serie ?? '-'}`, 50)),
    '^FO20,190^A0N,24,24' + campoZpl(linha(`ANVISA ${d.registroAnvisa}  VAL ${d.validade ?? '-'}`, 54)),
    '^FO20,220^A0N,24,24' + campoZpl(linha(`QTDE ${qtd}  CIRURGIA ${d.data}`, 54)),
    ...(v === 'faturamento'
      ? ['^FO20,250^A0N,24,24' + campoZpl(linha(`TUSS ${d.tuss ?? '-'}  CONTA ${d.conta || '-'}`, 54))]
      : []),
    `^FO20,300^BY2^BCN,110,Y,N,N^FDOPME-${consumo}-${lanc}^FS`,
    '^PQ1',
    '^XZ',
  ].join('\n');
}

/** As três vias (prontuário, paciente e faturamento), na ordem, num só trabalho de impressão. */
export function zplEtiquetaOpme(d: DadosEtiquetaOpme): string {
  return `${VIAS_OPME.map((v) => via(d, v)).join('\n')}\n`;
}
