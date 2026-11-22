// Cliente do painel de onboarding de clientes (F4 L3): só o administrador da plataforma. Gravações com o CSRF; as
// respostas passam pelos esquemas dos contratos. Problem Details viram ErroApi (a mensagem do servidor vai à tela).
import {
  type ClienteCriado,
  type ExecucaoConector,
  type ExecucaoPedida,
  esquemaClienteCriado,
  esquemaExecucaoConector,
  esquemaExecucaoPedida,
  esquemaListaClientesOnboarding,
  esquemaListaExecucoes,
  esquemaListaOrigens,
  esquemaOrigemVinculada,
  ESTADOS_EXECUCAO_ATIVOS,
  type ListaClientesOnboarding,
  type ListaExecucoes,
  type ListaOrigens,
  type OrigemVinculada,
} from '@sgh/contratos';
import type { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const B = '/api/plataforma/onboarding';

async function pedir<T>(metodo: 'GET' | 'POST' | 'PUT', url: string, esquema: z.ZodType<T>, corpo?: unknown) {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      ...(metodo === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf': tokenCsrf() }),
    },
    ...(metodo === 'GET' ? {} : { body: JSON.stringify(corpo ?? {}) }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

export const listarClientes = (): Promise<ListaClientesOnboarding> =>
  pedir('GET', `${B}/clientes`, esquemaListaClientesOnboarding);
export const listarOrigens = (): Promise<ListaOrigens> => pedir('GET', `${B}/origens`, esquemaListaOrigens);
export const criarCliente = (codigo: string, nome: string): Promise<ClienteCriado> =>
  pedir('POST', `${B}/clientes`, esquemaClienteCriado, { codigo, nome });
export const vincularOrigem = (codigo: string, arquivo: string): Promise<OrigemVinculada> =>
  pedir('PUT', `${B}/clientes/${encodeURIComponent(codigo)}/origem`, esquemaOrigemVinculada, { arquivo });
export const pedirExecucao = (
  codigo: string,
  tipo: 'importar' | 'sincronizar',
  confirmarExclusaoEmMassa = false,
): Promise<ExecucaoPedida> =>
  pedir(
    'POST',
    `${B}/clientes/${encodeURIComponent(codigo)}/execucoes`,
    esquemaExecucaoPedida,
    confirmarExclusaoEmMassa ? { tipo, confirmarExclusaoEmMassa: true } : { tipo },
  );
export const listarExecucoes = (codigo: string): Promise<ListaExecucoes> =>
  pedir('GET', `${B}/clientes/${encodeURIComponent(codigo)}/execucoes`, esquemaListaExecucoes);
export const lerExecucao = (codigo: string, id: number): Promise<ExecucaoConector> =>
  pedir('GET', `${B}/clientes/${encodeURIComponent(codigo)}/execucoes/${id}`, esquemaExecucaoConector);

/** L10: endereço da exportação do relatório (CSV), com o filtro por entidade e regra da tela. */
export function urlRelatorioCsv(
  codigo: string,
  id: number,
  filtro: { entidade?: string; regra?: string } = {},
): string {
  const q = new URLSearchParams();
  if (filtro.entidade) q.set('entidade', filtro.entidade);
  if (filtro.regra) q.set('regra', filtro.regra);
  const qs = q.toString();
  return `${B}/clientes/${encodeURIComponent(codigo)}/execucoes/${id}/relatorio.csv${qs ? `?${qs}` : ''}`;
}

/** A execução ainda está na fila ou rodando (a tela acompanha o progresso). */
export const execucaoAtiva = (e: ExecucaoConector | null | undefined): boolean =>
  !!e && ESTADOS_EXECUCAO_ATIVOS.includes(e.estado);

/** Tamanho legível do arquivo (GB/MB/KB), sem casas além de uma. */
export function tamanhoLegivel(bytes: number | null): string {
  if (bytes == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}
