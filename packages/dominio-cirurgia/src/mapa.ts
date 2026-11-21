// Mapa cirúrgico (ficha do M18, seção 4: "Mapa cirúrgico do dia e da semana", 7 dias por consulta). Monta os blocos
// de cada sala num dia (posição e altura em minutos desde a abertura do mapa), com o alerta de sobreposição (as que o
// outro sistema gravou) e de data impossível. Sem banco: a API lê a agenda e a tela desenha.
import { diaDoInstante, minutosAbsolutos, minutosDaHora, somarMinutos } from './tempo.js';
import { idsSobrepostos, type OcupacaoSala, sobreposicoesNoMapa } from './sobreposicao.js';

export interface BlocoDoMapa {
  readonly id: number;
  readonly sala: number;
  readonly inicio: string;
  readonly fim: string;
  /** Minutos desde a abertura do mapa (pode ser negativo: começou antes). */
  readonly topo: number;
  readonly altura: number;
  readonly sobreposto: boolean;
}

export interface MapaDoDia {
  readonly dia: string;
  readonly abertura: string;
  readonly fechamento: string;
  readonly salas: readonly { readonly sala: number; readonly blocos: readonly BlocoDoMapa[] }[];
  readonly sobreposicoes: number;
}

/** Abertura e fechamento do mapa: 07:00 às 21:00 (estendido pelo que houver antes ou depois). */
export function montarMapa(
  dia: string,
  salas: readonly number[],
  ocupacoes: readonly OcupacaoSala[],
  preparoMinimoMin = 0,
  abertura = '07:00',
  fechamento = '21:00',
): MapaDoDia {
  const doDia = ocupacoes.filter((o) => diaDoInstante(o.inicio) === dia);
  const sobre = sobreposicoesNoMapa(doDia, preparoMinimoMin);
  const marcados = idsSobrepostos(sobre);
  const ab = minutosAbsolutos(`${dia} ${horaValida(abertura)}`);
  const blocos = doDia.map((o) => {
    const ini = minutosAbsolutos(o.inicio);
    return {
      id: o.id,
      sala: o.sala,
      inicio: o.inicio,
      fim: somarMinutos(o.inicio, Math.max(o.duracaoMin, 1)),
      topo: ini - ab,
      altura: Math.max(o.duracaoMin, 1),
      sobreposto: marcados.has(o.id),
    };
  });
  return {
    dia,
    abertura: horaValida(abertura),
    fechamento: horaValida(fechamento),
    salas: salas.map((s) => ({
      sala: s,
      blocos: blocos.filter((b) => b.sala === s).sort((a, b) => a.topo - b.topo),
    })),
    sobreposicoes: sobre.length,
  };
}

function horaValida(h: string): string {
  const m = minutosDaHora(h);
  if (m === null) return '07:00';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Os dias de uma semana a partir de `inicio` (até 7, o teto da consulta). */
export function diasDaJanela(inicio: string, dias = 7): string[] {
  const n = Math.min(Math.max(dias, 1), 7);
  return Array.from({ length: n }, (_, i) => somarMinutos(`${inicio} 00:00`, i * 1440).slice(0, 10));
}

/** Taxa de ocupação da sala no dia (minutos ocupados / minutos do turno do mapa), em %. */
export function ocupacaoDaSala(
  blocos: readonly Pick<BlocoDoMapa, 'topo' | 'altura'>[],
  minutosDoTurno = 840,
): number {
  if (minutosDoTurno <= 0) return 0;
  const usados = blocos.reduce(
    (s, b) => s + Math.max(0, Math.min(b.topo + b.altura, minutosDoTurno) - Math.max(b.topo, 0)),
    0,
  );
  return Math.round((usados / minutosDoTurno) * 1000) / 10;
}
