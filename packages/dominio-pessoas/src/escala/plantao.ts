// Forma do plantão na escala (M52.2; ficha, seção 6): começa dentro da competência da escala, termina depois de
// começar, dura de 1 h a 24 h (D-DUR-52) e o sobreaviso traz o tempo de chegada (regra 10, usada na F3).
import { DURACAO_MAXIMA_PLANTAO_MIN, DURACAO_MINIMA_PLANTAO_MIN, type TipoPlantao } from '@sgh/contratos';
import { duracaoMin, type Intervalo } from './tempo.js';

export interface PlantaoProposto extends Intervalo {
  readonly tipo: TipoPlantao;
  readonly chegadaMin: number | null;
}

export type Recusa = { readonly ok: false; readonly codigo: string; readonly mensagem: string };
export type Conferencia = { readonly ok: true } | Recusa;

export const OK: Conferencia = { ok: true };
export const recusar = (codigo: string, mensagem: string): Recusa => ({ ok: false, codigo, mensagem });

export function conferirFormaDoPlantao(p: PlantaoProposto, competencia: string): Conferencia {
  if (p.inicio.slice(0, 7) !== competencia)
    return recusar('fora-da-competencia', 'O plantão precisa começar dentro do mês da escala.');
  const d = duracaoMin(p);
  if (d <= 0) return recusar('fim-antes-do-inicio', 'O fim do plantão precisa vir depois do início.');
  if (d < DURACAO_MINIMA_PLANTAO_MIN)
    return recusar('plantao-curto', 'O plantão precisa ter ao menos 1 hora.');
  if (d > DURACAO_MAXIMA_PLANTAO_MIN)
    return recusar('plantao-longo', 'O plantão pode ter no máximo 24 horas seguidas.');
  if (p.tipo === 'sobreaviso' && (p.chegadaMin === null || p.chegadaMin <= 0))
    return recusar('sem-chegada', 'Informe o tempo de chegada do sobreaviso.');
  if (p.tipo !== 'sobreaviso' && p.chegadaMin !== null)
    return recusar('chegada-fora-do-sobreaviso', 'O tempo de chegada vale só para o sobreaviso.');
  return OK;
}
