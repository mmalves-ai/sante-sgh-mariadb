// Cliente da tela "Carga e sincronismo" (obra carga-painel, ADR 0010): a conta da plataforma com papel plataforma
// (ADR 0021) ou o administrador da plataforma. Gravações com o CSRF da sessão em uso (o da conta, x-csrf-plataforma,
// ou o da sessão do hospital, x-csrf; o servidor confere o da sessão que atendeu); as respostas passam pelos esquemas dos contratos. Problem Details viram ErroApi (a mensagem do servidor
// vai à tela). A senha da origem só vai na gravação e nunca volta.
import {
  type CargaCliente,
  type EstadoExecucaoConector,
  type ListaConectores,
  type ModoCarga,
  type OrigemServidor,
  type OrigemServidorEntrada,
  type ProgressoCarga,
  type TesteOrigem,
  ESTADOS_EXECUCAO_ATIVOS,
  esquemaCargaCliente,
  esquemaListaConectores,
  esquemaOrigemServidor,
  esquemaTesteOrigem,
} from '@sgh/contratos';
import { z } from 'zod';
import { buscarSessao, tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { buscarEu, csrfPlataforma } from '../suporte/api-suporte.js';

const B = '/api/plataforma/carga';

/** Qual sessão atende a tela: a conta da plataforma, o administrador, outra (sem permissão) ou nenhuma. */
export type AcessoCarga = 'conta' | 'administrador' | 'sem-permissao' | 'sem-sessao';

let sessaoEmUso: 'conta' | 'administrador' = 'administrador';

/**
 * A guarda da tela (rota pública, como as da conta da plataforma): primeiro a conta da plataforma (GET
 * /api/plataforma/eu; só o papel plataforma), depois a sessão do hospital do administrador (ator 'plataforma').
 * Guarda a sessão em uso para o CSRF das gravações.
 */
export async function acessoDaCarga(buscar: typeof fetch = fetch): Promise<AcessoCarga> {
  try {
    const eu = await buscarEu(buscar);
    if (eu.conta.papel === 'PLATAFORMA') {
      sessaoEmUso = 'conta';
      return 'conta';
    }
    return 'sem-permissao';
  } catch {
    /* sem conta da plataforma: tenta o administrador */
  }
  try {
    const s = await buscarSessao(buscar);
    if (s.usuario.ator === 'plataforma') {
      sessaoEmUso = 'administrador';
      return 'administrador';
    }
    return 'sem-permissao';
  } catch {
    return 'sem-sessao';
  }
}

const csrfDaSessao = (): Record<string, string> =>
  sessaoEmUso === 'conta' ? { 'x-csrf-plataforma': csrfPlataforma() } : { 'x-csrf': tokenCsrf() };
const cli = (codigo: string) => `${B}/clientes/${encodeURIComponent(codigo)}`;

async function pedir<T>(metodo: 'GET' | 'POST' | 'PUT', url: string, esquema: z.ZodType<T>, corpo?: unknown) {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      ...(metodo === 'GET' ? {} : { 'content-type': 'application/json', ...csrfDaSessao() }),
    },
    ...(metodo === 'GET' ? {} : { body: JSON.stringify(corpo ?? {}) }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  const texto = r.status === 204 ? '' : await r.text();
  return esquema.parse(texto ? JSON.parse(texto) : undefined);
}

/** Respostas de ação (pedir, pausar, retomar): a tela relê o progresso logo depois, então o corpo não importa. */
const qualquer = z.unknown();

export const listarConectores = (): Promise<ListaConectores> =>
  pedir('GET', `${B}/conectores`, esquemaListaConectores);
export const lerCarga = (codigo: string): Promise<CargaCliente> =>
  pedir('GET', `${cli(codigo)}/carga`, esquemaCargaCliente);
export const gravarOrigemServidor = (
  codigo: string,
  entrada: OrigemServidorEntrada,
): Promise<OrigemServidor> => pedir('PUT', `${cli(codigo)}/origem-servidor`, esquemaOrigemServidor, entrada);
export const testarOrigem = (codigo: string): Promise<TesteOrigem> =>
  pedir('POST', `${cli(codigo)}/origem-servidor/testar`, esquemaTesteOrigem);
export const iniciarCarga = (codigo: string, modo: ModoCarga): Promise<unknown> =>
  pedir('POST', `${cli(codigo)}/carga`, qualquer, { modo });
export const pausarCarga = (codigo: string): Promise<unknown> =>
  pedir('POST', `${cli(codigo)}/carga/pausar`, qualquer);
export const retomarCarga = (codigo: string): Promise<unknown> =>
  pedir('POST', `${cli(codigo)}/carga/retomar`, qualquer);

/** Endereço do download do log da execução (text/plain, attachment). */
export const urlLogCarga = (codigo: string, id: number): string => `${cli(codigo)}/carga/${id}/log`;

/** A execução está na fila, rodando ou pausando: a tela acompanha a cada 2 s. */
export const cargaAtiva = (estado: EstadoExecucaoConector | null | undefined): boolean =>
  !!estado && ESTADOS_EXECUCAO_ATIVOS.includes(estado);

export interface SegmentosCarga {
  /** Percentual geral processado (linhas processadas / total), de 0 a 100, sem casas. */
  readonly percentual: number;
  /** Larguras dos segmentos da barra, em %, somando no máximo 100. */
  readonly gravado: number;
  readonly recusado: number;
  readonly restante: number;
  /** Contagens de linhas de cada segmento. */
  readonly linhasGravadas: number;
  readonly linhasRecusadas: number;
  readonly linhasRestantes: number;
  /** Recusas sobre o total de linhas, em %, com até uma casa. */
  readonly percentualErros: number;
}

const limitar = (v: number) => Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));

/**
 * Segmentos da barra de evolução: gravado (gravadas + iguais puladas), recusado e restante, por linhas. Sem total de
 * linhas (plano ainda não contado), usa o percentual da execução, todo como gravado.
 */
export function segmentosCarga(p: ProgressoCarga | null, percentualExecucao = 0): SegmentosCarga {
  const total = p?.linhasTotal ?? 0;
  if (!p || total <= 0) {
    const pc = Math.floor(limitar(percentualExecucao));
    return {
      percentual: pc,
      gravado: pc,
      recusado: 0,
      restante: 100 - pc,
      linhasGravadas: (p?.gravadas ?? 0) + (p?.puladasIguais ?? 0),
      linhasRecusadas: p?.recusadas ?? 0,
      linhasRestantes: 0,
      percentualErros: 0,
    };
  }
  const ok = p.gravadas + p.puladasIguais;
  const gravado = limitar((ok / total) * 100);
  const recusado = Math.min(limitar((p.recusadas / total) * 100), 100 - gravado);
  const processadas = Math.max(p.linhasProcessadas, ok + p.recusadas);
  return {
    percentual: Math.floor(limitar((processadas / total) * 100)),
    gravado,
    recusado,
    restante: Math.max(0, 100 - gravado - recusado),
    linhasGravadas: ok,
    linhasRecusadas: p.recusadas,
    linhasRestantes: Math.max(0, total - processadas),
    percentualErros: Math.round(limitar((p.recusadas / total) * 100) * 10) / 10,
  };
}

/** Partes do endereço `host:porta/banco` da origem de servidor, para preencher o formulário. */
export function partesEndereco(endereco: string): { host: string; porta: number; banco: string } | null {
  const m = /^([^:/]+):(\d{1,5})\/(.+)$/.exec(endereco);
  return m ? { host: m[1]!, porta: Number(m[2]), banco: m[3]! } : null;
}
