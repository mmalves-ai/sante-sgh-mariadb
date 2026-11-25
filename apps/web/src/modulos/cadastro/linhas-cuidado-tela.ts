// Programas de saúde e linhas de cuidado na tela (F8, 02-CAD linha 11): a validação na hora da inscrição e da mudança de
// estado, com as mesmas regras do domínio (`@sgh/dominio-cadastro`, linha-cuidado.ts) que o servidor confere de novo. A
// tela mostra só os próximos estados que o servidor calculou para a inscrição e pede o motivo ao suspender ou encerrar.
import type { EstadoPrograma, Inscricao, Programa, TipoEstado } from './api-linhas-cuidado.js';

/** Hoje no fuso do navegador, AAAA-MM-DD. */
export function hojeIso(agora = new Date()): string {
  const d = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 10);
}

export const MOTIVO_MINIMO = 5;

/** O estado pede o motivo: suspende ou encerra a inscrição (estado final ou marcado para encerrar). */
export function pedeMotivo(e: Pick<EstadoPrograma, 'tipo' | 'encerra'> | null | undefined): boolean {
  if (!e) return false;
  return e.tipo === 'suspenso' || e.encerra || ['alta', 'abandono', 'transferido', 'obito'].includes(e.tipo);
}

export type Falta =
  'programa' | 'data' | 'dataFutura' | 'referencia' | 'jaInscrito' | 'estado' | 'motivo' | 'dataAntes';

/** O que falta para inscrever; a lista vazia libera o botão. */
export function faltasInscricao(
  f: { linha: number; referencia: number | null; vigenciaInicio: string },
  programas: readonly Pick<Programa, 'id' | 'exigeReferencia'>[],
  inscricoes: readonly Pick<Inscricao, 'linha' | 'encerrada'>[],
  hoje: string,
): Falta[] {
  const r: Falta[] = [];
  const p = programas.find((x) => x.id === f.linha);
  if (!p) r.push('programa');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.vigenciaInicio)) r.push('data');
  else if (f.vigenciaInicio > hoje) r.push('dataFutura');
  if (p?.exigeReferencia && !f.referencia) r.push('referencia');
  if (p && inscricoes.some((i) => i.linha.id === p.id && !i.encerrada)) r.push('jaInscrito');
  return r;
}

/** O que falta para mudar o estado de uma inscrição viva. */
export function faltasMudanca(
  f: { estado: number; data: string; motivo: string },
  inscricao: Pick<Inscricao, 'proximos' | 'estadoDesde'>,
  estados: readonly EstadoPrograma[],
  hoje: string,
): Falta[] {
  const r: Falta[] = [];
  const e = estados.find((x) => x.id === f.estado);
  if (!e || !inscricao.proximos.includes(e.id)) r.push('estado');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.data)) r.push('data');
  else if (f.data > hoje) r.push('dataFutura');
  else if (f.data < inscricao.estadoDesde.slice(0, 10)) r.push('dataAntes');
  if (pedeMotivo(e) && f.motivo.trim().length < MOTIVO_MINIMO) r.push('motivo');
  return r;
}

/** Ordem de leitura do painel: os vivos primeiro, depois os que encerram. */
export const ORDEM_TIPOS: readonly TipoEstado[] = [
  'incluido',
  'ativo',
  'suspenso',
  'alta',
  'abandono',
  'transferido',
  'obito',
];
