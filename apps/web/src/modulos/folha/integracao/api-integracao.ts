// Cliente da integração da folha com o financeiro e o contábil (M53.9, etapa F8): o apoio (empresas, rotinas, destinos,
// a sugestão do perfil, as classificações e o de-para vigente), a busca de credores, as vigências do de-para e a nova
// vigência, as origens do ano (períodos fechados e retornos da folha externa), a prévia e o lançamento dos títulos, os
// lançamentos do ano com o detalhe e o custo de pessoal por centro de custo. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção); as respostas seguem os tipos de @sgh/contratos.
import type {
  ApoioIntegracaoFolha,
  CustoPessoalPeriodo,
  GravarIntegracaoFolhaEntrada,
  IntegracaoFolhaLida,
  LancamentoFolha,
  LancarTitulosFolhaEntrada,
  ListaCredoresFolha,
  ListaLancamentosFolha,
  ListaOrigensFolha,
  PreviaTitulosFolha,
  PreviaTitulosFolhaEntrada,
  ResultadoLancamentoFolha,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const I = '/api/pessoas/folha/integracao';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerApoioIntegracao = (empresa: number | null) =>
  ler(`${I}/apoio${qs({ empresa })}`, confiar<ApoioIntegracaoFolha>());
export const buscarCredores = (termo: string) =>
  ler(`${I}/credores${qs({ termo })}`, confiar<ListaCredoresFolha>());
export const lerDePara = (empresa: number) =>
  ler(`${I}/de-para${qs({ empresa })}`, confiar<IntegracaoFolhaLida[]>());
export const gravarDePara = (e: GravarIntegracaoFolhaEntrada) =>
  enviar(`${I}/de-para`, e, confiar<IntegracaoFolhaLida>(), novaChave('m53.integracao.de-para'));
export const lerOrigens = (empresa: number, ano: number) =>
  ler(`${I}/origens${qs({ empresa, ano })}`, confiar<ListaOrigensFolha>());
export const previaTitulos = (e: PreviaTitulosFolhaEntrada) =>
  enviar(`${I}/previa`, e, confiar<PreviaTitulosFolha>(), novaChave('m53.integracao.previa'));
export const lancarTitulos = (e: LancarTitulosFolhaEntrada) =>
  enviar(`${I}/lancamentos`, e, confiar<ResultadoLancamentoFolha>(), novaChave('m53.integracao.lancar'));
export const lerLancamentos = (empresa: number, ano: number) =>
  ler(`${I}/lancamentos${qs({ empresa, ano })}`, confiar<ListaLancamentosFolha>());
export const lerLancamento = (id: number) => ler(`${I}/lancamentos/${id}`, confiar<LancamentoFolha>());
export const lerCusto = (empresa: number, periodo: string) =>
  ler(`${I}/custo${qs({ empresa, periodo })}`, confiar<CustoPessoalPeriodo>());
