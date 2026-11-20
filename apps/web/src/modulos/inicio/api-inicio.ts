// Cliente das telas do M27 (página inicial, filas do médico e da recepção, mensagens, central de avisos e dicionário),
// validado pelos contratos. As gravações vão com o CSRF e a Idempotency-Key (uma por intenção de gravar); Problem
// Details viram ErroApi e o código da recusa (ex.: recurso-desligado, destino-desconhecido) fica em `problema.codigo`.
import {
  type CaixaMensagens,
  type CentralAvisos,
  type ComunicadoDetalhe,
  type CorrigirComunicado,
  type EncerrarComunicado,
  esquemaComunicadoDetalhe,
  type VigenciaComunicado,
  type DicionarioPessoal,
  type EnviarMensagem,
  esquemaCaixaMensagens,
  esquemaCentralAvisos,
  esquemaDicionarioPessoal,
  esquemaEnvioMensagem,
  esquemaGravacaoPalavra,
  esquemaMensagemRecebida,
  esquemaMensagensAnteriores,
  esquemaMudancaAviso,
  esquemaPaginaInicio,
  esquemaWorklistMedico,
  esquemaWorklistRecepcao,
  type MensagemRecebida,
  type PaginaInicio,
  type PublicarComunicado,
  type Sessao,
  type WorklistMedico,
  type WorklistRecepcao,
} from '@sgh/contratos';
import type { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, lerJson, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const A = '/api/acesso';

/** Canal de eventos da central de avisos (só diz "mudou"; a tela relê). */
export const CANAL_AVISOS = `${A}/avisos/eventos`;
/** Canal de eventos da fila da recepção (a senha emitida ou chamada aqui ou na outra ponta). */
export const CANAL_RECEPCAO = '/api/recepcao/worklist/eventos';

/**
 * O dono das leituras do M27 nas chaves do cache (login e estabelecimento): a troca de usuário ou de estabelecimento
 * sem recarregar a página (a sessão sintética antes do login, o "login como", a troca de estabelecimento) nunca mostra
 * a fila, o sino ou a caixa da sessão anterior.
 */
export function donoDaSessao(s: Pick<Sessao, 'usuario' | 'estabelecimentoAtivo'> | undefined): string {
  return `${s?.usuario.login ?? s?.usuario.id ?? ''}@${s?.estabelecimentoAtivo ?? ''}`;
}

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m27.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

async function excluir<T>(url: string, esquema: z.ZodType<T>, chave: string): Promise<T> {
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { accept: 'application/json', 'x-csrf': tokenCsrf(), 'idempotency-key': chave },
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

// ── Página inicial e filas ───────────────────────────────────────────────────────────────────────────
export const lerPaginaInicio = (): Promise<PaginaInicio> => ler(`${A}/inicio`, esquemaPaginaInicio);
export const lerWorklistMedico = (): Promise<WorklistMedico> =>
  ler('/api/pep/worklist/medico', esquemaWorklistMedico);
export const lerWorklistRecepcao = (recepcao: number | null): Promise<WorklistRecepcao> =>
  ler(`/api/recepcao/worklist${qs({ recepcao })}`, esquemaWorklistRecepcao);

// ── Central de avisos ────────────────────────────────────────────────────────────────────────────────
export const lerAvisos = (): Promise<CentralAvisos> => ler(`${A}/avisos`, esquemaCentralAvisos);
export const marcarAviso = (id: number, estado: 'lido' | 'resolvido', chave: string) =>
  enviar(`${A}/avisos/${id}/${estado === 'lido' ? 'lido' : 'resolver'}`, {}, esquemaMudancaAviso, chave);

// ── Mensagens e comunicados ──────────────────────────────────────────────────────────────────────────
export const lerCaixa = (): Promise<CaixaMensagens> => ler(`${A}/mensagens`, esquemaCaixaMensagens);
export const abrirMensagem = (id: number): Promise<MensagemRecebida> =>
  ler(`${A}/mensagens/${id}`, esquemaMensagemRecebida);
export const lerAnteriores = () => ler(`${A}/mensagens-anteriores`, esquemaMensagensAnteriores);
export const enviarMensagem = (m: EnviarMensagem, chave: string) =>
  enviar(`${A}/mensagens`, m, esquemaEnvioMensagem, chave);
export const publicarComunicado = (c: PublicarComunicado, chave: string) =>
  enviar(`${A}/comunicados`, c, esquemaEnvioMensagem, chave);
export const darCiencia = (id: number, chave: string): Promise<MensagemRecebida> =>
  enviar(`${A}/mensagens/${id}/ciencia`, {}, esquemaMensagemRecebida, chave);

// W0-09: o comunicado por inteiro e o ciclo de vida dele (sempre com motivo).
export const lerComunicado = (id: number): Promise<ComunicadoDetalhe> =>
  ler(`${A}/comunicados/${id}`, esquemaComunicadoDetalhe);
export async function corrigirComunicado(
  id: number,
  c: CorrigirComunicado,
  chave: string,
): Promise<ComunicadoDetalhe> {
  const r = await fetch(`${A}/comunicados/${id}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(c),
  });
  return lerJson(r, esquemaComunicadoDetalhe);
}
export const encurtarVigenciaComunicado = (id: number, v: VigenciaComunicado, chave: string) =>
  enviar(`${A}/comunicados/${id}/vigencia`, v, esquemaComunicadoDetalhe, chave);
export const encerrarComunicado = (id: number, e: EncerrarComunicado, chave: string) =>
  enviar(`${A}/comunicados/${id}/encerramento`, e, esquemaComunicadoDetalhe, chave);

// ── Dicionário pessoal ───────────────────────────────────────────────────────────────────────────────
export const lerDicionario = (): Promise<DicionarioPessoal> =>
  ler(`${A}/dicionario`, esquemaDicionarioPessoal);
export const incluirPalavra = (palavra: string, chave: string) =>
  enviar(`${A}/dicionario`, { palavra }, esquemaGravacaoPalavra, chave);
export const excluirPalavra = (palavra: string, chave: string) =>
  excluir(`${A}/dicionario/${encodeURIComponent(palavra)}`, esquemaGravacaoPalavra, chave);
