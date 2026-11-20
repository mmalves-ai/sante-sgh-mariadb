// Cliente das solicitações do autoatendimento (W0-06, parte 6d; M3 de mercado): as do próprio colaborador ("Minhas
// solicitações", no Meu espaço) e a fila do gestor. As gravações vão com o CSRF e a Idempotency-Key (uma por intenção);
// a leitura do atestado é POST porque grava o acesso (LGPD art. 46). As respostas seguem os tipos de @sgh/contratos.
import type {
  AtestadoPessoaResposta,
  DecidirSolicitacaoEntrada,
  FiltroFilaSolicitacoes,
  IncluirSolicitacaoEntrada,
  LerAtestadoEntrada,
  ListaSolicitacoesPessoa,
  ResultadoSolicitacaoPessoa,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const M = '/api/pessoas/meu/solicitacoes';
const F = '/api/pessoas/solicitacoes';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const ok = () => confiar<ResultadoSolicitacaoPessoa>();

// ── As minhas ─────────────────────────────────────────────────────────────────────────────────────────────────

export const lerMinhasSolicitacoes = (vinculo?: number | null) =>
  ler(`${M}${qs({ vinculo })}`, confiar<ListaSolicitacoesPessoa>());
export const incluirSolicitacao = (e: IncluirSolicitacaoEntrada) =>
  enviar(M, e, ok(), novaChave('pes.solicitacao'));
export const desistirSolicitacao = (id: number, versao: number, motivo: string) =>
  enviar(`${M}/${id}/desistencia`, { versao, motivo }, ok(), novaChave('pes.solicitacao.desistencia'));
export const lerMeuAtestado = (id: number, e: LerAtestadoEntrada) =>
  enviar(`${M}/${id}/atestado`, e, confiar<AtestadoPessoaResposta>(), novaChave('pes.atestado.meu'));

// ── A fila do gestor ──────────────────────────────────────────────────────────────────────────────────────────

export const lerFilaSolicitacoes = (f: Partial<FiltroFilaSolicitacoes> = {}) =>
  ler(`${F}${qs(f)}`, confiar<ListaSolicitacoesPessoa>());
export const decidirSolicitacao = (id: number, e: Omit<DecidirSolicitacaoEntrada, 'solicitacao'>) =>
  enviar(`${F}/${id}/decisao`, e, ok(), novaChave('pes.solicitacao.decisao'));
export const lerAtestadoFila = (id: number, e: LerAtestadoEntrada) =>
  enviar(`${F}/${id}/atestado`, e, confiar<AtestadoPessoaResposta>(), novaChave('pes.atestado.fila'));
