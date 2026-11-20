// Porta da avaliação de desempenho, das competências e do PDI (W0-06, parte 5; M2 de mercado): o que as telas leem e
// gravam, independente de onde (a API não escreve SQL; fronteira Nx). Só tabelas SGH_ (script 1066).
//   - `legado`: leituras de @sgh/legado em transação READ ONLY; gravações numa transação só SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E); nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  AvaliacaoLida,
  CicloAvaliacaoLido,
  CompetenciaAvalLida,
  CompetenciaCargoLida,
  CorrecaoPesLida,
  DadosCicloSgh,
  DadosPdiSgh,
  NotaAvaliacaoLida,
  PdiLido,
  SituacaoCiclo,
  SituacaoPdi,
  VinculoExperienciaLido,
  VinculoPessoasContado,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_AVALIACAO = Symbol('PORTA_AVALIACAO');

export type ContextoAvaliacao = ContextoPortaM18;
export type AlvoDependenciaAvaliacao = 'competencia' | 'ciclo-avaliacao' | 'avaliacao-rascunho';

/** As gravações SGH_ da avaliação numa transação só SGH_, com as releituras dentro dela. */
export interface GravadorAvaliacao {
  incluirCompetencia(x: { nome: string; descricao: string | null; por: string }): Promise<number>;
  alterarCompetencia(x: {
    id: number;
    versao: number;
    nome: string;
    descricao: string | null;
    por: string;
  }): Promise<void>;
  situacaoCompetencia(x: {
    id: number;
    versao: number;
    ativo: boolean;
    motivo: string;
    por: string;
  }): Promise<void>;
  excluirCompetencia(x: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
  ligarCompetenciaCargo(x: { cargo: number; competencia: number; por: string }): Promise<number>;
  desligarCompetenciaCargo(x: {
    cargo: number;
    competencia: number;
    motivo: string;
    por: string;
  }): Promise<void>;
  incluirCiclo(x: DadosCicloSgh & { por: string }): Promise<number>;
  alterarCiclo(x: DadosCicloSgh & { id: number; versao: number; por: string }): Promise<void>;
  situacaoCiclo(x: {
    id: number;
    versao: number;
    situacao: SituacaoCiclo;
    motivo: string;
    por: string;
  }): Promise<void>;
  excluirCiclo(x: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
  incluirAvaliacao(x: {
    ciclo: number;
    vinculo: number;
    cargo: number | null;
    marco: 45 | 90 | null;
    avaliador: string;
    competencias: readonly number[];
    por: string;
  }): Promise<number>;
  lancarNotas(x: {
    id: number;
    versao: number;
    parecer: string | null;
    notas: readonly { competencia: number; nota: number | null; comentario: string | null }[];
    por: string;
  }): Promise<void>;
  finalizarAvaliacao(x: { id: number; versao: number; por: string }): Promise<void>;
  ciencia(x: {
    id: number;
    versao: number;
    modo: 'proprio' | 'registrada';
    observacao: string | null;
    por: string;
  }): Promise<void>;
  corrigirAvaliacao(x: {
    anterior: number;
    versao: number;
    motivo: string;
    avaliador: string;
    por: string;
  }): Promise<number>;
  excluirAvaliacao(x: { id: number; versao: number; motivo: string; por: string }): Promise<void>;
  incluirPdi(x: DadosPdiSgh & { vinculo: number; por: string }): Promise<number>;
  alterarPdi(x: DadosPdiSgh & { id: number; versao: number; por: string }): Promise<void>;
  situacaoPdi(x: {
    id: number;
    versao: number;
    situacao: SituacaoPdi;
    concluidaEm: string | null;
    motivo: string;
    por: string;
  }): Promise<void>;
  registrarCorrecao(x: {
    tabela: string;
    registro: number;
    operacao: string;
    antes: Record<string, unknown>;
    depois: Record<string, unknown>;
    motivo: string;
    por: string;
  }): Promise<void>;
}

export interface PortaAvaliacao extends PortaGravacaoM18<GravadorAvaliacao> {
  hoje(c: ContextoAvaliacao): Promise<string>;
  competencias(c: ContextoAvaliacao): Promise<CompetenciaAvalLida[]>;
  competencia(c: ContextoAvaliacao, id: number): Promise<CompetenciaAvalLida | null>;
  /** As competências ligadas a um cargo (ou a todos, cargo nulo). */
  competenciasDoCargo(c: ContextoAvaliacao, cargo: number | null): Promise<CompetenciaCargoLida[]>;
  ciclos(c: ContextoAvaliacao): Promise<CicloAvaliacaoLido[]>;
  ciclo(c: ContextoAvaliacao, id: number): Promise<CicloAvaliacaoLido | null>;
  avaliacoes(
    c: ContextoAvaliacao,
    filtro: { readonly ciclo: number } | { readonly vinculo: number },
  ): Promise<AvaliacaoLida[]>;
  avaliacao(c: ContextoAvaliacao, id: number): Promise<AvaliacaoLida | null>;
  notas(c: ContextoAvaliacao, avaliacao: number): Promise<NotaAvaliacaoLida[]>;
  /** O cargo (SGH_PES_CARGO) do vínculo, se houver. */
  cargoDoVinculo(c: ContextoAvaliacao, vinculo: number): Promise<number | null>;
  /** Vínculos CLT não desligados admitidos desde a data (candidatos ao alerta de experiência). */
  vinculosEmExperiencia(c: ContextoAvaliacao, admitidoDesde: string): Promise<VinculoExperienciaLido[]>;
  pdiDoColaborador(c: ContextoAvaliacao, vinculo: number): Promise<PdiLido[]>;
  pdi(c: ContextoAvaliacao, id: number): Promise<PdiLido | null>;
  /** O que barra a exclusão física (o mapa de dependências de packages/legado). */
  dependencias(
    c: ContextoAvaliacao,
    alvo: AlvoDependenciaAvaliacao,
    id: number,
  ): Promise<VinculoPessoasContado[]>;
  correcoes(c: ContextoAvaliacao, tabela: string, registros: readonly number[]): Promise<CorrecaoPesLida[]>;
}

export const METODOS_PORTA_AVALIACAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'hoje',
  'competencias',
  'competencia',
  'competenciasDoCargo',
  'ciclos',
  'ciclo',
  'avaliacoes',
  'avaliacao',
  'notas',
  'cargoDoVinculo',
  'vinculosEmExperiencia',
  'pdiDoColaborador',
  'pdi',
  'dependencias',
  'correcoes',
]);
