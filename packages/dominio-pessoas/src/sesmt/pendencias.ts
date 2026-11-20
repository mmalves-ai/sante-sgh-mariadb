// Pendências do SESMT do colaborador (painel; regras 17 a 19): ASO (sem ASO, vencido, a vencer, inapto), vacinas
// obrigatórias da NR-32 e o anti-HBs, EPI (assinatura e o exigido sem entrega), dose de radiação e os acidentes
// (CAT, profilaxia e sorologia). A gravidade "alerta" é o que já descumpre a norma; "aviso", o que está para vencer.
import { type GravidadePendencia, PENDENCIAS_SESMT, type PendenciaSesmt } from '@sgh/contratos';
import type { ResumoAso } from './aso.js';

const AVISOS: ReadonlySet<PendenciaSesmt> = new Set<PendenciaSesmt>([
  'aso-a-vencer',
  'cat-prazo',
  'anti-hbs-pendente',
  'epi-assinatura',
]);

export interface PendenciaLida {
  readonly codigo: PendenciaSesmt;
  readonly texto: string;
  readonly gravidade: GravidadePendencia;
}

export function pendenciasDoAso(r: ResumoAso, ativo: boolean): PendenciaSesmt[] {
  if (!ativo) return [];
  const p: PendenciaSesmt[] = [];
  if (r.situacao === 'sem-aso') p.push('sem-aso');
  if (r.situacao === 'vencido') p.push('aso-vencido');
  if (r.situacao === 'a-vencer') p.push('aso-a-vencer');
  if (r.inapto && r.situacao !== 'encerrado') p.push('inapto');
  return p;
}

/** Junta, sem repetir, na ordem do vocabulário, com o texto e a gravidade. */
export function juntarPendencias(...grupos: readonly (readonly PendenciaSesmt[])[]): PendenciaLida[] {
  const todas = new Set(grupos.flat());
  return (Object.keys(PENDENCIAS_SESMT) as PendenciaSesmt[])
    .filter((c) => todas.has(c))
    .map((codigo) => ({
      codigo,
      texto: PENDENCIAS_SESMT[codigo],
      gravidade: AVISOS.has(codigo) ? 'aviso' : 'alerta',
    }));
}
