// Crachá da visita (M50, etapa 5; regra 9; ficha, seção 7: "crachá ZPL"): o código (aleatório, sem dado da pessoa), a
// validade (o fim do horário da unidade ou a duração máxima, o que vier antes; o acompanhante, 24 horas; com a exceção
// do supervisor, a duração máxima a partir de agora), a etiqueta em ZPL para a impressora térmica e a avaliação da
// passagem na catraca (a saída nunca é negada a quem tem a visita: ninguém fica preso). Regras puras.
import type { PapelVisita, ResultadoCatraca, SentidoCatraca, SentidoTerminal } from '@sgh/contratos';
import type { RegraVisita } from './regra.js';

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Código do crachá (12 caracteres de 32 símbolos, sem I, L, O e U) a partir de bytes aleatórios. */
export function codigoDoCracha(bytes: Uint8Array): string {
  if (bytes.length < 12) throw new Error('Crachá: faltam bytes aleatórios.');
  return Array.from(bytes.slice(0, 12), (b) => ALFABETO[b % 32]).join('');
}

const minutos = (instante: string): number => Date.parse(`${instante.slice(0, 16)}:00Z`) / 60_000;
const instante = (min: number): string => new Date(min * 60_000).toISOString().slice(0, 16);

/** Validade do crachá (AAAA-MM-DDTHH:mm), sempre depois de agora. */
export function validadeDoCracha(
  agora: string,
  regra: Pick<RegraVisita, 'horaFim' | 'duracaoMaxMin'>,
  papel: PapelVisita,
  excecao: boolean,
): string {
  const a = minutos(agora);
  if (papel === 'acompanhante') return instante(a + 24 * 60);
  const pelaDuracao = a + regra.duracaoMaxMin;
  if (excecao) return instante(pelaDuracao);
  const fim = minutos(`${agora.slice(0, 10)}T${regra.horaFim}`);
  const v = Math.min(pelaDuracao, fim);
  return instante(v > a ? v : pelaDuracao);
}

/** O crachá venceu? */
export const crachaVencido = (validoAte: string, agora: string): boolean =>
  agora.slice(0, 16) >= validoAte.slice(0, 16);

/** Texto seguro para o ZPL (sem os caracteres de comando ^ e ~; até o tamanho). */
function zplTexto(t: string, max: number): string {
  return t
    .replace(/[\^~\\]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, max);
}

/** A etiqueta do crachá em ZPL II (UTF-8 com ^CI28; código de barras Code 128 com o código do crachá). */
export function zplDoCracha(c: {
  readonly codigo: string;
  readonly visitante: string;
  readonly destino: string;
  readonly validoAte: string;
  readonly papel: PapelVisita;
}): string {
  const validade = `${c.validoAte.slice(8, 10)}/${c.validoAte.slice(5, 7)} ${c.validoAte.slice(11, 16)}`;
  return [
    '^XA',
    '^CI28',
    '^PW600',
    '^LL400',
    `^FO30,30^A0N,40,40^FD${c.papel === 'acompanhante' ? 'ACOMPANHANTE' : 'VISITANTE'}^FS`,
    `^FO30,90^A0N,32,32^FD${zplTexto(c.visitante, 34)}^FS`,
    `^FO30,140^A0N,28,28^FD${zplTexto(c.destino, 40)}^FS`,
    `^FO30,185^A0N,28,28^FDValido ate ${validade}^FS`,
    `^FO30,240^BY2^BCN,100,Y,N,N^FD${zplTexto(c.codigo, 20)}^FS`,
    '^XZ',
  ].join('\n');
}

export type MotivoCatraca =
  'cracha-desconhecido' | 'visita-encerrada' | 'cracha-vencido' | 'terminal-inativo' | 'sentido-do-terminal';

export interface AvaliacaoCatraca {
  readonly resultado: ResultadoCatraca;
  readonly motivo: MotivoCatraca | null;
  /** A passagem encerra a visita (a saída pela catraca). */
  readonly encerra: boolean;
}

/** A passagem do crachá na catraca. */
export function avaliarCatraca(e: {
  readonly visita: { readonly validoAte: string; readonly saida: string | null } | null;
  readonly agora: string;
  readonly sentido: SentidoCatraca;
  readonly terminal: { readonly ativo: boolean; readonly sentido: SentidoTerminal };
}): AvaliacaoCatraca {
  const negar = (motivo: MotivoCatraca): AvaliacaoCatraca => ({
    resultado: 'negado',
    motivo,
    encerra: false,
  });
  if (!e.terminal.ativo) return negar('terminal-inativo');
  if (e.terminal.sentido !== 'ambos' && e.terminal.sentido !== e.sentido) return negar('sentido-do-terminal');
  if (!e.visita) return negar('cracha-desconhecido');
  if (e.sentido === 'saida') return { resultado: 'liberado', motivo: null, encerra: e.visita.saida === null };
  if (e.visita.saida !== null) return negar('visita-encerrada');
  if (crachaVencido(e.visita.validoAte, e.agora)) return negar('cracha-vencido');
  return { resultado: 'liberado', motivo: null, encerra: false };
}
