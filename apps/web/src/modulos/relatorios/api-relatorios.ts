// Cliente das telas do catálogo de relatórios, da triagem, dos pedidos e do envio agendado (M34), validado pelos
// contratos. As gravações vão com o CSRF e a Idempotency-Key; a exportação baixa o arquivo (o servidor registra e, com
// dado de pessoa, exige a justificativa); Problem Details viram ErroApi com o código da recusa.
import {
  type AgendamentoLido,
  esquemaAgendamentoLido,
  esquemaEventoRelatorio,
  type EventoGestaoRelatorio,
  esquemaExecucaoLida,
  esquemaHistoricoEnvioOrigem,
  esquemaPaginaTriagem,
  esquemaPedidoLido,
  esquemaRelatorioDescrito,
  esquemaResultadoRelatorio,
  esquemaTriagemLida,
  type ExecucaoLida,
  type FormatoExportacao,
  type HistoricoEnvioOrigem,
  type PaginaTriagem,
  type PedidoLido,
  type RelatorioDescrito,
  type ResultadoRelatorio,
  type TriagemLida,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const R = '/api/relatorios';
let sequencia = 0;

/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m34.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export const lerCatalogo = (): Promise<RelatorioDescrito[]> =>
  ler(`${R}/catalogo`, z.array(esquemaRelatorioDescrito));

export const executarRelatorio = (
  codigo: string,
  parametros: Record<string, string | number>,
): Promise<ResultadoRelatorio> =>
  enviar(
    `${R}/catalogo/${encodeURIComponent(codigo)}/executar`,
    { parametros },
    esquemaResultadoRelatorio,
    novaChave('emitir'),
  );

/** Exporta e baixa o arquivo (o nome vem do servidor). */
export async function exportarRelatorio(
  codigo: string,
  parametros: Record<string, string | number>,
  formato: FormatoExportacao,
  justificativa: string | null,
): Promise<void> {
  const r = await fetch(`${R}/catalogo/${encodeURIComponent(codigo)}/exportar`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('exportar'),
    },
    body: JSON.stringify({ parametros, formato, ...(justificativa ? { justificativa } : {}) }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  const nome =
    /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `${codigo}.${formato}`;
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const lerExecucoes = (relatorio: string | null): Promise<ExecucaoLida[]> =>
  ler(`${R}/execucoes${qs({ relatorio })}`, z.array(esquemaExecucaoLida));

export const lerTriagem = (f: {
  destino?: string;
  situacao?: string;
  marco?: string;
  termo?: string;
  pagina: number;
  tamanho: number;
}): Promise<PaginaTriagem> => ler(`${R}/triagem${qs(f)}`, esquemaPaginaTriagem);

export const decidirTriagem = (id: number, d: unknown): Promise<TriagemLida> =>
  enviar(`${R}/triagem/${id}`, d, esquemaTriagemLida, novaChave('triagem'));

export const lerPedidos = (): Promise<PedidoLido[]> => ler(`${R}/pedidos`, z.array(esquemaPedidoLido));
export const criarPedido = (p: unknown): Promise<{ id: string }> =>
  enviar(`${R}/pedidos`, p, z.object({ id: z.string() }), novaChave('pedido'));
export const responderPedido = (id: string, r: unknown): Promise<{ ok: true }> =>
  enviar(`${R}/pedidos/${id}/resposta`, r, z.object({ ok: z.literal(true) }), novaChave('resposta'));

// W0-09: o ciclo do pedido (corrigir o aberto, cancelar com motivo, excluir só o nunca atendido) e o histórico.
const ok = z.object({ ok: z.literal(true) });
export const alterarPedido = (id: string, p: unknown, chave: string): Promise<{ ok: true }> =>
  enviar(`${R}/pedidos/${id}`, p, ok, chave);
export const cancelarPedido = (id: string, motivo: string, chave: string): Promise<{ ok: true }> =>
  enviar(`${R}/pedidos/${id}/cancelamento`, { motivo }, ok, chave);
export const excluirPedido = (id: string, motivo: string, chave: string): Promise<{ ok: true }> =>
  enviar(`${R}/pedidos/${id}/exclusao`, { motivo }, ok, chave);
export const lerHistoricoPedido = (id: string): Promise<EventoGestaoRelatorio[]> =>
  ler(`${R}/pedidos/${id}/historico`, z.array(esquemaEventoRelatorio));

const esquemaAgendamentos = z.object({
  agendamentos: z.array(esquemaAgendamentoLido),
  origem: esquemaHistoricoEnvioOrigem,
  envioLigado: z.boolean(),
  motivo: z.string().nullable(),
});
export const lerAgendamentos = (): Promise<{
  agendamentos: AgendamentoLido[];
  origem: HistoricoEnvioOrigem;
  envioLigado: boolean;
  motivo: string | null;
}> => ler(`${R}/agendamentos`, esquemaAgendamentos);
export const criarAgendamento = (a: unknown): Promise<{ id: string; proximoEnvio: string }> =>
  enviar(
    `${R}/agendamentos`,
    a,
    z.object({ id: z.string(), proximoEnvio: z.string() }),
    novaChave('agendar'),
  );
/** W0-09: o Alterar leva o motivo e, para não redigitar, `manterEnderecos` (a tela só vê os mascarados). */
export const alterarAgendamento = (id: string, a: unknown, chave: string): Promise<{ ok: true }> =>
  enviar(`${R}/agendamentos/${id}`, a, ok, chave);
/** Desativar exige o motivo; reativar o aceita. */
export const ativarAgendamento = (
  id: string,
  ativo: boolean,
  motivo: string | null,
  chave: string,
): Promise<{ ok: true }> =>
  enviar(`${R}/agendamentos/${id}/ativo`, { ativo, ...(motivo ? { motivo } : {}) }, ok, chave);
/** W0-09: exclui só o envio que nunca rodou (o que já rodou: 409 com a oferta de desativar). */
export const excluirAgendamento = (id: string, motivo: string, chave: string): Promise<{ ok: true }> =>
  enviar(`${R}/agendamentos/${id}/exclusao`, { motivo }, ok, chave);
export const lerHistoricoAgendamento = (id: string): Promise<EventoGestaoRelatorio[]> =>
  ler(`${R}/agendamentos/${id}/historico`, z.array(esquemaEventoRelatorio));
export const enviarAgora = (id: string): Promise<{ situacao: 'enfileirado' | 'sem-fila'; link: string }> =>
  enviar(
    `${R}/agendamentos/${id}/enviar`,
    {},
    z.object({ situacao: z.enum(['enfileirado', 'sem-fila']), link: z.string() }),
    novaChave('enviar'),
  );
