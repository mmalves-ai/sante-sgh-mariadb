// Escopo da agenda (cap-08 §8.4; as permissões agenda.* aceitam os escopos `unidade` e `tipoAgenda`): o servidor
// decide sobre a AGENDA alvo de cada leitura e gravação, nunca só pelo tipo da permissão.
//   - unidade da agenda: agenda_servico.unidade_assistencial_id; senão a unidade do vínculo revisado; sem nenhuma,
//     a agenda é "sem unidade" e vale para todas as unidades (D-ESC-17).
//   - tipo da agenda: a categoria (agenda_servico.categoria_agenda_id) contra os tipos do escopo: comparação estrita
//     (falha fechada; agenda sem categoria não entra em escopo restrito por tipo).
//   - o que não tem agenda resolvida (pedido da fila sem agenda) fica fora para quem tem escopo restrito (falha
//     fechada).
import { filtroDeEscopo } from '@sgh/dominio-acesso';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';

export interface EscopoAgenda {
  /** Unidades aceitas (ids em texto, como vêm do escopo da sessão); null = sem restrição. */
  readonly unidades: readonly string[] | null;
  /** Tipos de agenda aceitos; null = sem restrição. */
  readonly tipos: readonly string[] | null;
}

export const ESCOPO_LIVRE: EscopoAgenda = { unidades: null, tipos: null };

/** O escopo da sessão para a permissão da rota (as permissões agenda.* têm os mesmos escopos do módulo). */
export function escopoDaRequisicao(req: RequisicaoAutorizada): EscopoAgenda {
  const a = req.sgh;
  if (!a) return ESCOPO_LIVRE;
  const f = filtroDeEscopo(a.permissao ?? 'agenda.agenda.ler', a.sessao.escopos);
  return { unidades: f.unidade ?? null, tipos: f.tipoAgenda ?? null };
}

export const restrito = (e: EscopoAgenda | undefined): boolean =>
  !!e && (e.unidades !== null || e.tipos !== null);

/** Unidade efetiva da agenda (null = não informada). */
export function unidadeDaAgenda(
  a: { readonly unidade: number | null },
  vinculo: { readonly unidade: number | null } | undefined,
): number | null {
  if (a.unidade !== null && a.unidade > 0) return a.unidade;
  const u = vinculo?.unidade ?? null;
  return u !== null && u > 0 ? u : null;
}

/** A agenda está no escopo? */
export function agendaNoEscopo(
  e: EscopoAgenda | undefined,
  a: { readonly unidade: number | null; readonly tipo: number | null },
): boolean {
  if (!e) return true;
  if (e.unidades !== null && a.unidade !== null && !e.unidades.includes(String(a.unidade))) return false;
  if (e.tipos !== null && (a.tipo === null || !e.tipos.includes(String(a.tipo)))) return false;
  return true;
}
