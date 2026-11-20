// Cliente da avaliação de desempenho (W0-06, parte 5d; M2 de mercado): apoio, competências (e as do cargo), ciclos,
// avaliações (notas, finalização, ciência, correção por versão, exclusão do rascunho), alertas de experiência e PDI.
// Cada gravação leva o CSRF e uma Idempotency-Key por intenção; a recusa (409 com `codigo` e `bloqueios`) vira ErroApi.
// O identificador do registro vai na rota (o servidor sobrepõe o do corpo).
import type {
  AbrirAvaliacaoEntrada,
  AlertaExperienciaResposta,
  AlterarCicloEntrada,
  AlterarCompetenciaEntrada,
  AlterarPdiEntrada,
  ApoioAvaliacao,
  AvaliacaoResposta,
  AvaliacoesDoColaborador,
  CicloAvaliacaoResposta,
  CienciaPropriaEntrada,
  CienciaRegistradaEntrada,
  CompetenciaDoCargoResposta,
  CorrigirAvaliacaoEntrada,
  DesligarCompetenciaCargoEntrada,
  ExcluirAvaliacaoEntrada,
  ExcluirCicloEntrada,
  ExcluirCompetenciaEntrada,
  FichaAvaliacao,
  FichaCicloAvaliacao,
  FinalizarAvaliacaoEntrada,
  IncluirCicloEntrada,
  IncluirCompetenciaEntrada,
  IncluirPdiEntrada,
  LigarCompetenciaCargoEntrada,
  ListaCompetencias,
  NotasAvaliacaoEntrada,
  ResultadoAvaliacaoDesempenho,
  SituacaoCicloEntrada,
  SituacaoCompetenciaEntrada,
  SituacaoPdiEntrada,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave } from '../../exames/api-exames.js';

const P = '/api/pessoas/avaliacoes';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const lista = <X>() => z.array(confiar<X>());
const resultado = confiar<ResultadoAvaliacaoDesempenho>();
const gravar = (url: string, corpo: unknown, rotulo: string): Promise<ResultadoAvaliacaoDesempenho> =>
  enviar(url, corpo, resultado, novaChave(rotulo));

// ── Leituras ──
export const lerApoioAvaliacao = (): Promise<ApoioAvaliacao> => ler(`${P}/apoio`, confiar<ApoioAvaliacao>());
export const lerCompetencias = (): Promise<ListaCompetencias> =>
  ler(`${P}/competencias`, confiar<ListaCompetencias>());
export const lerCompetenciasDoCargo = (cargo: number): Promise<CompetenciaDoCargoResposta[]> =>
  ler(`${P}/cargos/${cargo}/competencias`, lista<CompetenciaDoCargoResposta>());
export const lerCiclos = (): Promise<CicloAvaliacaoResposta[]> =>
  ler(`${P}/ciclos`, lista<CicloAvaliacaoResposta>());
export const lerFichaCiclo = (ciclo: number): Promise<FichaCicloAvaliacao> =>
  ler(`${P}/ciclos/${ciclo}`, confiar<FichaCicloAvaliacao>());
export const lerAlertasExperiencia = (): Promise<AlertaExperienciaResposta[]> =>
  ler(`${P}/alertas-experiencia`, lista<AlertaExperienciaResposta>());
export const lerAvaliacoesDoColaborador = (vinculo: number): Promise<AvaliacoesDoColaborador> =>
  ler(`${P}/colaborador/${vinculo}`, confiar<AvaliacoesDoColaborador>());
export const lerFichaAvaliacao = (id: number): Promise<FichaAvaliacao> =>
  ler(`${P}/${id}`, confiar<FichaAvaliacao>());
export const lerMinhasAvaliacoes = (): Promise<AvaliacaoResposta[]> =>
  ler(`${P}/minhas`, lista<AvaliacaoResposta>());
export const lerMinhaAvaliacao = (id: number): Promise<FichaAvaliacao> =>
  ler(`${P}/minhas/${id}`, confiar<FichaAvaliacao>());

// ── Competência ──
export const incluirCompetencia = (e: IncluirCompetenciaEntrada) =>
  gravar(`${P}/competencias`, e, 'pessoas.competencia');
export const alterarCompetencia = (e: AlterarCompetenciaEntrada) =>
  gravar(`${P}/competencias/${e.competencia}/alteracao`, e, 'pessoas.competencia.alt');
export const situacaoCompetencia = (e: SituacaoCompetenciaEntrada) =>
  gravar(`${P}/competencias/${e.competencia}/situacao`, e, 'pessoas.competencia.sit');
export const excluirCompetencia = (e: ExcluirCompetenciaEntrada) =>
  gravar(`${P}/competencias/${e.competencia}/exclusao`, e, 'pessoas.competencia.exc');
export const ligarCompetenciaCargo = (e: LigarCompetenciaCargoEntrada) =>
  gravar(`${P}/cargos/${e.cargo}/competencias`, e, 'pessoas.cargo_competencia');
export const desligarCompetenciaCargo = (e: DesligarCompetenciaCargoEntrada) =>
  gravar(
    `${P}/cargos/${e.cargo}/competencias/${e.competencia}/desligamento`,
    e,
    'pessoas.cargo_competencia.des',
  );

// ── Ciclo ──
export const incluirCiclo = (e: IncluirCicloEntrada) => gravar(`${P}/ciclos`, e, 'pessoas.ciclo');
export const alterarCiclo = (e: AlterarCicloEntrada) =>
  gravar(`${P}/ciclos/${e.ciclo}/alteracao`, e, 'pessoas.ciclo.alt');
export const situacaoCiclo = (e: SituacaoCicloEntrada) =>
  gravar(`${P}/ciclos/${e.ciclo}/situacao`, e, 'pessoas.ciclo.sit');
export const excluirCiclo = (e: ExcluirCicloEntrada) =>
  gravar(`${P}/ciclos/${e.ciclo}/exclusao`, e, 'pessoas.ciclo.exc');

// ── Avaliação ──
export const abrirAvaliacao = (e: AbrirAvaliacaoEntrada) => gravar(P, e, 'pessoas.avaliacao');
export const lancarNotas = (e: NotasAvaliacaoEntrada) =>
  gravar(`${P}/${e.avaliacao}/notas`, e, 'pessoas.avaliacao.notas');
export const finalizarAvaliacao = (e: FinalizarAvaliacaoEntrada) =>
  gravar(`${P}/${e.avaliacao}/finalizacao`, e, 'pessoas.avaliacao.fin');
export const cienciaRegistrada = (e: CienciaRegistradaEntrada) =>
  gravar(`${P}/${e.avaliacao}/ciencia`, e, 'pessoas.avaliacao.ciencia');
export const cienciaPropria = (e: CienciaPropriaEntrada) =>
  gravar(`${P}/minhas/${e.avaliacao}/ciencia`, e, 'pessoas.avaliacao.ciencia_propria');
export const corrigirAvaliacao = (e: CorrigirAvaliacaoEntrada) =>
  gravar(`${P}/${e.avaliacao}/correcao`, e, 'pessoas.avaliacao.cor');
export const excluirAvaliacao = (e: ExcluirAvaliacaoEntrada) =>
  gravar(`${P}/${e.avaliacao}/exclusao`, e, 'pessoas.avaliacao.exc');

// ── PDI ──
export const incluirPdi = (e: IncluirPdiEntrada) => gravar(`${P}/pdi`, e, 'pessoas.pdi');
export const alterarPdi = (e: AlterarPdiEntrada) =>
  gravar(`${P}/pdi/${e.pdi}/alteracao`, e, 'pessoas.pdi.alt');
export const situacaoPdi = (e: SituacaoPdiEntrada) =>
  gravar(`${P}/pdi/${e.pdi}/situacao`, e, 'pessoas.pdi.sit');
