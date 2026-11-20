// Registro do ato cirúrgico (ficha do M18, `cirurgia.registrarCirurgia`; Anexo A). CCCADCIR guarda o porte em TIPO_CIR
// (P/M/G, CHECK no banco), o potencial de contaminação em POT_CONT (L limpa 557 de 573, P potencialmente contaminada
// 15, C contaminada; I infectada é a quarta classe clássica, nunca vista: recusada), a duração em HHMM e as horas de
// início e fim (HORA_I/HORA_T) e de anestesia (HORA_IA/HORA_TA) em HHMM. O que o legado não tem coluna (entrada e
// saída de sala, incisão, ASA) vai à SGH_CC_REGISTRO_EXT.
import { duracaoEntre, minutosDeHhmm } from './tempo.js';

export const PORTES = [
  { codigo: 'P', rotulo: 'Pequeno porte' },
  { codigo: 'M', rotulo: 'Médio porte' },
  { codigo: 'G', rotulo: 'Grande porte' },
] as const;
export type Porte = (typeof PORTES)[number]['codigo'];

export const POTENCIAIS_CONTAMINACAO = [
  { codigo: 'L', rotulo: 'Limpa' },
  { codigo: 'P', rotulo: 'Potencialmente contaminada' },
  { codigo: 'C', rotulo: 'Contaminada' },
] as const;
export type PotencialContaminacao = (typeof POTENCIAIS_CONTAMINACAO)[number]['codigo'];

/** Técnica do procedimento (CCLANCIR.TECNICA: 0 510, 1 50, 2 35 desde 10/2025; rótulos a confirmar com o bloco, DP-3). */
export const TECNICAS = [
  { codigo: 0, rotulo: 'Convencional' },
  { codigo: 1, rotulo: 'Videolaparoscopia' },
  { codigo: 2, rotulo: 'Robótica' },
] as const;

export interface TemposDoAto {
  /** HHMM. */
  readonly inicio: string;
  readonly fim: string;
  readonly inicioAnestesia?: string | null;
  readonly fimAnestesia?: string | null;
}

export type Problema = { readonly campo: string; readonly texto: string };

/** Confere os tempos do ato: horas HHMM válidas, anestesia envolvendo a cirurgia; devolve a duração em minutos. */
export function conferirTempos(t: TemposDoAto): { duracaoMin: number | null; problemas: Problema[] } {
  const problemas: Problema[] = [];
  if (minutosDeHhmm(t.inicio) === null)
    problemas.push({ campo: 'inicio', texto: 'Hora de início inválida.' });
  if (minutosDeHhmm(t.fim) === null) problemas.push({ campo: 'fim', texto: 'Hora de término inválida.' });
  const duracaoMin = duracaoEntre(t.inicio, t.fim);
  if (problemas.length === 0 && duracaoMin === null)
    problemas.push({ campo: 'fim', texto: 'O término tem de vir depois do início.' });
  const ia = t.inicioAnestesia ?? null;
  const fa = t.fimAnestesia ?? null;
  if (ia !== null && minutosDeHhmm(ia) === null)
    problemas.push({ campo: 'inicioAnestesia', texto: 'Hora de início da anestesia inválida.' });
  if (fa !== null && minutosDeHhmm(fa) === null)
    problemas.push({ campo: 'fimAnestesia', texto: 'Hora de término da anestesia inválida.' });
  if (
    ia !== null &&
    fa !== null &&
    problemas.every((p) => !p.campo.endsWith('Anestesia')) &&
    duracaoEntre(ia, fa) === null
  )
    problemas.push({ campo: 'fimAnestesia', texto: 'O término da anestesia tem de vir depois do início.' });
  return { duracaoMin, problemas };
}

/** Porte sugerido pela duração (referência de mercado: até 2 h pequeno, até 4 h médio, acima grande). */
export function porteSugerido(duracaoMin: number): Porte {
  if (duracaoMin <= 120) return 'P';
  if (duracaoMin <= 240) return 'M';
  return 'G';
}
