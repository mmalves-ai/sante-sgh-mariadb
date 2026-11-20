// Escopo da agenda (cap-08 §8.4; catálogo do M06: as permissões agenda.* aceitam os escopos `unidade` e `tipoAgenda`):
// o servidor decide sobre a AGENDA alvo de cada leitura e gravação, nunca só pelo tipo da permissão.
//   - unidade da agenda: REAGENDA.UNID quando informada (> 0); senão a unidade da ligação revisada
//     (SGH_AGE_AGENDA_LIGACAO.UNIDADE); sem nenhuma das duas, a agenda é "sem unidade" e vale para todas as
//     unidades, como no legado (as 138 agendas do pc têm UNID 0 e 277 usuários têm unidade em TBUNIUSE: o filtro
//     estrito esconderia a agenda inteira do call center). D-ESC-17.
//   - tipo da agenda: REAGENDA.TIPO (0 nas 138) contra TBAGEUSE.TPAGE (0 nos 29 usuários que o têm): comparação
//     estrita (falha fechada).
//   - o que não tem agenda resolvida (marcação órfã, pedido da fila sem agenda) fica fora para quem tem escopo
//     restrito (falha fechada).
import { filtroDeEscopo } from '@sgh/dominio-acesso';
import type { AgendaLida, LigacaoLida } from '@sgh/legado';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';

export interface EscopoAgenda {
  /** Unidades aceitas (texto, como vêm do legado); null = sem restrição. */
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
  a: Pick<AgendaLida, 'unidade'>,
  ligacao: Pick<LigacaoLida, 'unidade'> | undefined,
): number | null {
  if (a.unidade > 0) return a.unidade;
  const u = ligacao?.unidade ?? null;
  return u !== null && u > 0 ? u : null;
}

/** A agenda está no escopo? */
export function agendaNoEscopo(
  e: EscopoAgenda | undefined,
  a: { readonly unidade: number | null; readonly tipo: number | null },
): boolean {
  if (!e) return true;
  if (e.unidades !== null && a.unidade !== null && !e.unidades.includes(String(a.unidade))) return false;
  if (e.tipos !== null && !e.tipos.includes(String(a.tipo ?? 0))) return false;
  return true;
}
