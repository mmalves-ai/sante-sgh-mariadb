// Cliente das telas da fatia F6 (M52.6): treinamentos (situação, cursos, turmas, POPs), "Meu espaço" e o plantão
// realizado com o relatório ao repasse. As gravações vão com o CSRF e a Idempotency-Key (uma por intenção); Problem
// Details viram ErroApi com o código da recusa. As respostas seguem os tipos de @sgh/contratos (o servidor é a fonte).
import type {
  AlterarCursoEntrada,
  AlterarTurmaEntrada,
  ApoioRealizado,
  ApoioTreinamento,
  CorrigirParticipacaoEntrada,
  CursoEntrada,
  FichaTreinamento,
  ListaCursos,
  ListaPops,
  ListaRealizado,
  ListaTarifas,
  ListaTurmas,
  MeuEspaco,
  PainelTreinamento,
  ParticipacaoEntrada,
  PopDetalhe,
  RegistrarRealizadoEntrada,
  RelatorioRepasse,
  ResultadoF6,
  ResultadoLancamentoPlantao,
  SugestaoRealizado,
  TarifaPlantaoEntrada,
  TurmaEntrada,
  TurmaResposta,
  VersaoPopEntrada,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const T = '/api/pessoas/treinamentos';
const R = '/api/pessoas/realizado';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const ok = () => confiar<ResultadoF6>();

export interface ColaboradorBusca {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly cargo: string;
  readonly funcao: string | null;
  readonly unidadeNome: string | null;
  readonly desligamento: string | null;
}

// ── Treinamentos ──────────────────────────────────────────────────────────────────────────────────────────────

export const lerApoioTreinamento = () => ler(`${T}/apoio`, confiar<ApoioTreinamento>());
export const lerSituacao = (f: { unidade?: number; curso?: number; situacao?: string; termo?: string }) =>
  ler(`${T}/situacao${qs(f)}`, confiar<PainelTreinamento>());
export const buscarColaboradores = (termo: string) =>
  ler(`${T}/colaboradores${qs({ termo })}`, confiar<{ itens: ColaboradorBusca[] }>());
export const lerFicha = (vinculo: number) =>
  ler(`${T}/colaboradores/${vinculo}`, confiar<FichaTreinamento>());
export const lerCursos = () => ler(`${T}/cursos`, confiar<ListaCursos>());
export const incluirCurso = (e: CursoEntrada) => enviar(`${T}/cursos`, e, ok(), novaChave('f6.curso'));
export const alterarCurso = (e: AlterarCursoEntrada) => {
  const { curso, ...resto } = e;
  return enviar(`${T}/cursos/${curso}`, resto, ok(), novaChave('f6.curso.alterar'));
};
export const lerTurmas = (situacao: string) => ler(`${T}/turmas${qs({ situacao })}`, confiar<ListaTurmas>());
export const lerTurma = (id: number) => ler(`${T}/turmas/${id}`, confiar<TurmaResposta>());
export const abrirTurma = (e: TurmaEntrada) => enviar(`${T}/turmas`, e, ok(), novaChave('f6.turma'));
export const inscrever = (turma: number, vinculos: number[]) =>
  enviar(`${T}/turmas/${turma}/inscricoes`, { vinculos }, ok(), novaChave('f6.inscricao'));
export const registrarParticipacao = (turma: number, e: Omit<ParticipacaoEntrada, 'treinamento'>) =>
  enviar(`${T}/turmas/${turma}/participacao`, e, ok(), novaChave('f6.participacao'));
export const encerrarTurma = (turma: number, versao: number) =>
  enviar(`${T}/turmas/${turma}/encerramento`, { versao }, ok(), novaChave('f6.turma.encerrar'));
export const cancelarTurma = (turma: number, versao: number, motivo: string) =>
  enviar(`${T}/turmas/${turma}/cancelamento`, { versao, motivo }, ok(), novaChave('f6.turma.cancelar'));
// W0-06: alterar a turma aberta, retirar a inscrição feita por engano e corrigir a presença lançada (com o motivo).
// O corpo pode trazer `treinamento`: o servidor usa sempre o da rota.
export const alterarTurma = (turma: number, e: Omit<AlterarTurmaEntrada, 'treinamento'>) =>
  enviar(`${T}/turmas/${turma}/alteracao`, e, ok(), novaChave('f6.turma.alterar'));
export const retirarInscricao = (turma: number, vinculo: number, versao: number, motivo: string) =>
  enviar(
    `${T}/turmas/${turma}/inscricoes/${vinculo}/retirada`,
    { versao, motivo },
    ok(),
    novaChave('f6.inscricao.retirar'),
  );
export const corrigirParticipacao = (
  turma: number,
  e: Omit<CorrigirParticipacaoEntrada, 'treinamento' | 'vinculo'> & { vinculo: number },
) => {
  const { vinculo, ...resto } = e;
  return enviar(
    `${T}/turmas/${turma}/participacao/${vinculo}/correcao`,
    resto,
    ok(),
    novaChave('f6.participacao.corrigir'),
  );
};
export const urlListaPresenca = (turma: number) => `${T}/turmas/${turma}/lista/pdf`;
export const lerPops = () => ler(`${T}/pops`, confiar<ListaPops>());
export const lerPop = (codigo: string) =>
  ler(`${T}/pops/${encodeURIComponent(codigo)}`, confiar<PopDetalhe>());
export const publicarPop = (e: VersaoPopEntrada) => enviar(`${T}/pops`, e, ok(), novaChave('f6.pop'));
export const revogarPop = (id: number, motivo: string) =>
  enviar(`${T}/pops/${id}/revogacao`, { motivo }, ok(), novaChave('f6.pop.revogar'));

// ── Meu espaço ────────────────────────────────────────────────────────────────────────────────────────────────

export const lerMeuEspaco = (vinculo?: number) =>
  ler(`/api/pessoas/meu${qs({ vinculo })}`, confiar<MeuEspaco>());
export const darCiencia = (pop: number, vinculo: number | null) =>
  enviar(`/api/pessoas/meu/pops/${pop}/ciencia`, { vinculo }, ok(), novaChave('f6.ciencia'));

// ── Plantão realizado e repasse ───────────────────────────────────────────────────────────────────────────────

export const lerApoioRealizado = () => ler(`${R}/apoio`, confiar<ApoioRealizado>());
export const lerRealizado = (f: { competencia: string; unidade?: number; situacao?: string }) =>
  ler(`${R}${qs(f)}`, confiar<ListaRealizado>());
export const lerSugestao = (plantao: number) =>
  ler(`${R}/plantoes/${plantao}/sugestao`, confiar<SugestaoRealizado>());
export const registrarRealizado = (e: RegistrarRealizadoEntrada) => {
  const { plantao, ...resto } = e;
  return enviar(`${R}/plantoes/${plantao}`, resto, ok(), novaChave('f6.realizado'));
};
export const decidirRealizado = (
  id: number,
  decisao: 'aprovar' | 'recusar',
  versao: number,
  motivo: string | null,
) => enviar(`${R}/${id}/decisao`, { decisao, versao, motivo }, ok(), novaChave('f6.realizado.decisao'));
/** W0-06: estorno do realizado aprovado, com o motivo (409 quando a competência já foi apurada). */
export const estornarRealizado = (id: number, versao: number, motivo: string) =>
  enviar(`${R}/${id}/estorno`, { versao, motivo }, ok(), novaChave('f6.realizado.estorno'));
export const lerTarifas = () => ler(`${R}/tarifas`, confiar<ListaTarifas>());
export const incluirTarifa = (e: TarifaPlantaoEntrada) =>
  enviar(`${R}/tarifas`, e, ok(), novaChave('f6.tarifa'));
export const encerrarTarifa = (id: number, fim: string) =>
  enviar(`${R}/tarifas/${id}/encerramento`, { fim }, ok(), novaChave('f6.tarifa.fim'));
export const lerRelatorio = (competencia: string) =>
  ler(`${R}/repasse${qs({ competencia })}`, confiar<RelatorioRepasse>());
export const urlRelatorioPdf = (competencia: string) => `${R}/repasse/pdf${qs({ competencia })}`;
export const urlRelatorioCsv = (competencia: string) => `${R}/repasse/csv${qs({ competencia })}`;
export const lancarNoRepasse = (
  competencia: string,
  prestador: number,
  registro: number,
  realizados: readonly number[],
) =>
  enviar(
    `${R}/repasse/lancamento`,
    { competencia, prestador, registro, realizados },
    confiar<ResultadoLancamentoPlantao>(),
    novaChave('f6.repasse'),
  );
