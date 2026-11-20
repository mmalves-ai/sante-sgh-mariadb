// Cliente das telas da contabilidade, etapa 2 (M54-F2): o apoio (chave, permissões, contas analíticas), os lançamentos
// (lista, detalhe, manual, estorno), a contabilização dos fatos, o razão, a conciliação e os períodos (situação com as
// parcelas e os impedimentos; encerrar e reabrir com a senha). O servidor é a fonte: as respostas são os tipos de
// @sgh/contratos (ROTAS_CONTABIL_F2), conferidos só na forma.
import {
  type ApoioLancamentos,
  type ConciliacaoListada,
  type DetalheLancamento,
  type LancamentoManual,
  type LancamentosContabeis,
  type PendentesConciliacao,
  type PeriodosContabeis,
  type RazaoConta,
  type ResultadoConciliacao,
  type ResultadoContabilizacaoLote,
  type ResultadoLancamento,
  type ResultadoPeriodo,
  ROTAS_CONTABIL_F2 as R,
  type SituacaoDoPeriodo,
  type TipoLancamento,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { novaChave } from './api-contabil.js';

const A = '/api';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const url = (r: { caminho: string }) => `${A}/${r.caminho}`;

export const lerApoioLancamentos = (empresa: number) =>
  ler(`${url(R.apoio)}${qs({ empresa })}`, confiar<ApoioLancamentos>());

export const lerLancamentos = (f: {
  empresa: number;
  competencia?: string | null;
  tipo?: TipoLancamento | null;
  conta?: string | null;
  pagina: number;
  tamanho: number;
}) => ler(`${url(R.lancamentos)}${qs(f)}`, confiar<LancamentosContabeis>());

export const lerDetalheLancamento = (empresa: number, id: number) =>
  ler(`${url(R.detalhe)}${qs({ empresa, id })}`, confiar<DetalheLancamento>());

export const lerRazao = (f: {
  empresa: number;
  conta: string;
  de: string;
  ate: string;
  centroCusto?: number | null;
  pagina?: number;
}) => ler(`${url(R.razao)}${qs(f)}`, confiar<RazaoConta>());

export const lerPendentesConciliacao = (f: { empresa: number; conta: string; ate?: string | null }) =>
  ler(`${url(R.pendentesConciliacao)}${qs(f)}`, confiar<PendentesConciliacao>());

export const lerConciliacoes = (empresa: number, conta: string) =>
  ler(`${url(R.conciliacoes)}${qs({ empresa, conta })}`, confiar<ConciliacaoListada[]>());

export const lerPeriodos = (empresa: number) =>
  ler(`${url(R.periodos)}${qs({ empresa })}`, confiar<PeriodosContabeis>());

export const lerSituacaoPeriodo = (empresa: number, competencia: string) =>
  ler(`${url(R.situacaoPeriodo)}${qs({ empresa, competencia })}`, confiar<SituacaoDoPeriodo>());

/** O manual leva a chave da intenção no corpo (o envio repetido não duplica o lançamento). */
export const incluirLancamentoManual = (l: LancamentoManual) =>
  enviar(url(R.incluir), l, confiar<ResultadoLancamento>(), novaChave('manual'));

export const estornarLancamento = (e: {
  empresa: number;
  id: number;
  data?: string;
  justificativa: string;
}) => enviar(url(R.estornar), e, confiar<ResultadoLancamento>(), novaChave('estorno'));

export const contabilizarFatos = (c: { empresa: number; competencia?: string; incluirRecusados: boolean }) =>
  enviar(url(R.contabilizar), c, confiar<ResultadoContabilizacaoLote>(), novaChave('contabilizar'));

export const conciliarPartidas = (c: {
  empresa: number;
  conta: string;
  partidas: readonly number[];
  observacao: string | null;
}) => enviar(url(R.conciliar), c, confiar<ResultadoConciliacao>(), novaChave('conciliar'));

export const desfazerConciliacao = (d: { empresa: number; id: number; justificativa: string }) =>
  enviar(url(R.desfazerConciliacao), d, confiar<ResultadoConciliacao>(), novaChave('desfazer'));

export const encerrarPeriodo = (p: {
  empresa: number;
  competencia: string;
  observacao: string | null;
  senha: string;
}) => enviar(url(R.encerrar), p, confiar<ResultadoPeriodo>(), novaChave('encerrar'));

export const reabrirPeriodo = (p: {
  empresa: number;
  competencia: string;
  justificativa: string;
  senha: string;
}) => enviar(url(R.reabrir), p, confiar<ResultadoPeriodo>(), novaChave('reabrir'));
