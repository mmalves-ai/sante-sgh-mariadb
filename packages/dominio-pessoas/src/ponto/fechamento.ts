// Fechamento do período de ponto e ciência do espelho (M52.4; cap-07 §7.1.3: "Espelho de ponto no autosserviço, com
// ciência do colaborador"). A trilha do período é SÓ DE INCLUSÃO (fechado, reaberto, ciência): o estado é o do último
// fechamento ou reabertura; a ciência vale para o fechamento em vigor (reaberto e fechado de novo, a ciência é pedida
// outra vez). Só fecha a competência que já terminou, sem marcação ímpar e sem ajuste pendente.
import type { AcaoFechamento } from '@sgh/contratos';
import { diasEntre } from '../datas.js';
import { diasDaCompetencia } from '../escala/tempo.js';
import type { RecusaPonto } from './ajuste.js';
import { recusaSesmt as recusa } from '../sesmt/recusa.js';

export interface EventoPeriodoLido {
  readonly id: number;
  readonly acao: AcaoFechamento;
  /** Na ciência e na reabertura: o fechamento a que se refere. */
  readonly ref: number | null;
  readonly concorda: boolean | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface EstadoPeriodo {
  readonly estado: 'aberto' | 'fechado';
  /** O fechamento em vigor. */
  readonly fechamento: number | null;
  /** Quantas vezes o período foi fechado (a versão do espelho). */
  readonly versao: number;
  readonly ciencia: EventoPeriodoLido | null;
}

export function estadoDoPeriodo(eventos: readonly EventoPeriodoLido[]): EstadoPeriodo {
  const ordem = [...eventos].sort((a, b) => a.id - b.id);
  let fechamento: number | null = null;
  let versao = 0;
  for (const e of ordem) {
    if (e.acao === 'fechado') {
      fechamento = e.id;
      versao++;
    } else if (e.acao === 'reaberto') fechamento = null;
  }
  const ciencia =
    fechamento === null ? null : (ordem.find((e) => e.acao === 'ciencia' && e.ref === fechamento) ?? null);
  return { estado: fechamento === null ? 'aberto' : 'fechado', fechamento, versao, ciencia };
}

export function ultimoDiaDaCompetencia(competencia: string): string {
  const dias = diasDaCompetencia(competencia);
  return dias[dias.length - 1]!;
}

export function conferirFechamento(c: {
  readonly competencia: string;
  readonly hoje: string;
  readonly estado: EstadoPeriodo;
  readonly diasInconsistentes: number;
  readonly ajustesPendentes: number;
}): RecusaPonto | null {
  if (c.estado.estado === 'fechado') return recusa('ja-fechado', 'O período já está fechado.');
  if (diasEntre(ultimoDiaDaCompetencia(c.competencia), c.hoje) <= 0)
    return recusa(
      'periodo-em-curso',
      'O período só fecha depois do último dia da competência.',
      'competencia',
    );
  if (c.ajustesPendentes > 0)
    return recusa(
      'ajustes-pendentes',
      `Há ${c.ajustesPendentes} ajuste(s) aguardando aprovação: decida antes de fechar.`,
    );
  if (c.diasInconsistentes > 0)
    return recusa(
      'inconsistencias',
      `Há ${c.diasInconsistentes} dia(s) com número ímpar de marcações: inclua ou desconsidere a marcação antes de fechar.`,
    );
  return null;
}

/** Reabre só o fechado, e só se nenhuma competência seguinte do mesmo vínculo já estiver fechada (o banco encadeia). */
export function conferirReabertura(estado: EstadoPeriodo, seguinteFechada: boolean): RecusaPonto | null {
  if (estado.estado !== 'fechado') return recusa('nao-fechado', 'O período não está fechado.');
  if (seguinteFechada)
    return recusa(
      'seguinte-fechado',
      'Uma competência seguinte já está fechada: reabra primeiro a mais recente.',
      'competencia',
    );
  return null;
}

/** A ciência do colaborador: só do próprio espelho, do período fechado, uma vez por fechamento. */
export function conferirCiencia(estado: EstadoPeriodo, proprio: boolean): RecusaPonto | null {
  if (!proprio) return recusa('nao-e-o-proprio', 'A ciência é do próprio colaborador.');
  if (estado.estado !== 'fechado')
    return recusa('nao-fechado', 'O espelho só recebe ciência depois do fechamento.');
  if (estado.ciencia) return recusa('ja-ciente', 'A ciência deste espelho já foi registrada.');
  return null;
}
