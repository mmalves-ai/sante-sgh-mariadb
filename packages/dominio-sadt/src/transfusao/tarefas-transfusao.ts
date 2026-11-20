// Sinais vitais do ato como tarefa na linha do tempo do turno (ficha do M47, regra 4; cap-05b §5.11): antes do início
// (exigido para iniciar, regra 2), aos 10 a 15 minutos do início e ao término. A tarefa "durante" abre aos 10 minutos e
// fica atrasada depois dos 15; a "depois" abre no término e fica atrasada depois da janela (60 minutos, parâmetro). O
// M25 mostra as tarefas na linha do tempo do turno ao lado das doses (a tela consome a lista daqui).
import type { EstadoAtoTransfusional, MomentoSinaisTransfusao } from '@sgh/contratos';

export const JANELA_DURANTE_MIN = { abre: 10, atrasa: 15 } as const;
export const JANELA_DEPOIS_MIN = 60;

export type SituacaoTarefa = 'feita' | 'aguardando' | 'devida' | 'atrasada';

export interface TarefaSinaisTransfusao {
  readonly momento: MomentoSinaisTransfusao;
  readonly abreEm: string | null;
  readonly atrasaEm: string | null;
  readonly situacao: SituacaoTarefa;
}

const mais = (iso: string, min: number) =>
  new Date(Date.parse(`${iso.slice(0, 19)}Z`) + min * 60_000).toISOString().slice(0, 19);

function situacao(feita: boolean, abre: string | null, atrasa: string | null, agora: string): SituacaoTarefa {
  if (feita) return 'feita';
  if (abre === null || agora < abre) return 'aguardando';
  if (atrasa !== null && agora > atrasa) return 'atrasada';
  return 'devida';
}

/** Regra 4: as três tarefas do ato com a situação no instante. */
export function tarefasDoAto(c: {
  readonly inicioEm: string;
  readonly terminoEm: string | null;
  readonly estado: EstadoAtoTransfusional;
  readonly feitos: readonly MomentoSinaisTransfusao[];
  readonly agora: string;
  readonly janelaDepoisMin?: number;
}): readonly TarefaSinaisTransfusao[] {
  const abreDurante = mais(c.inicioEm, JANELA_DURANTE_MIN.abre);
  const atrasaDurante = mais(c.inicioEm, JANELA_DURANTE_MIN.atrasa);
  // Interrompido antes dos 10 minutos: a tarefa "durante" não se aplica (vale a "depois").
  const duranteAplica = !(c.estado === 'interrompido' && c.terminoEm !== null && c.terminoEm < abreDurante);
  const abreDepois = c.terminoEm;
  const atrasaDepois =
    c.terminoEm === null ? null : mais(c.terminoEm, c.janelaDepoisMin ?? JANELA_DEPOIS_MIN);
  const t: TarefaSinaisTransfusao[] = [
    {
      momento: 'antes',
      abreEm: null,
      atrasaEm: c.inicioEm,
      situacao: c.feitos.includes('antes') ? 'feita' : 'atrasada',
    },
  ];
  if (duranteAplica)
    t.push({
      momento: 'durante',
      abreEm: abreDurante,
      atrasaEm: atrasaDurante,
      situacao: situacao(c.feitos.includes('durante'), abreDurante, atrasaDurante, c.agora),
    });
  t.push({
    momento: 'depois',
    abreEm: abreDepois,
    atrasaEm: atrasaDepois,
    situacao: situacao(c.feitos.includes('depois'), abreDepois, atrasaDepois, c.agora),
  });
  return t;
}

/** O ato tem os sinais completos (indicador e conclusão): todas as tarefas aplicáveis feitas. */
export function sinaisCompletos(t: readonly TarefaSinaisTransfusao[]): boolean {
  return t.every((x) => x.situacao === 'feita');
}

/** A medida "durante" fora da janela de 10 a 15 minutos é aceita, mas marcada (vai ao indicador). */
export function medidaForaDaJanela(
  momento: MomentoSinaisTransfusao,
  inicioEm: string,
  medidoEm: string,
): boolean {
  if (momento !== 'durante') return false;
  return (
    medidoEm < mais(inicioEm, JANELA_DURANTE_MIN.abre) || medidoEm > mais(inicioEm, JANELA_DURANTE_MIN.atrasa)
  );
}
