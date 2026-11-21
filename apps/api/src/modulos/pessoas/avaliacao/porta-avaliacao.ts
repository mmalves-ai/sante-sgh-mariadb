// Porta da avaliação de desempenho, das competências e do PDI (W0-06, parte 5; M2 de mercado; F2.2 lote 03-02): o que
// as telas leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx).
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-propria.ts), gravações numa operação do Executor;
//   - `memoria`: a sessão sintética de dev/ci (E2E); nada vai ao banco;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';
import type {
  AvaliacaoRegistrada,
  CicloRegistrado,
  CompetenciaDoCargo,
  CompetenciaRegistrada,
  CorrecaoRegistrada,
  DadosCiclo,
  DadosPdi,
  DependenciaContada,
  NotaAvaliacao,
  PdiRegistrado,
  SituacaoCiclo,
  SituacaoPdi,
  VinculoEmExperiencia,
} from './tipos.js';

export const PORTA_AVALIACAO = Symbol('PORTA_AVALIACAO');

export type ContextoAvaliacao = ContextoPortaM18;
export type AlvoDependenciaAvaliacao = 'competencia' | 'ciclo-avaliacao' | 'avaliacao-rascunho';

/** As gravações da avaliação numa só transação, com as releituras dentro dela. */
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
  incluirCiclo(x: DadosCiclo & { por: string }): Promise<number>;
  alterarCiclo(x: DadosCiclo & { id: number; versao: number; por: string }): Promise<void>;
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
  incluirPdi(x: DadosPdi & { vinculo: number; por: string }): Promise<number>;
  alterarPdi(x: DadosPdi & { id: number; versao: number; por: string }): Promise<void>;
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
  competencias(c: ContextoAvaliacao): Promise<CompetenciaRegistrada[]>;
  competencia(c: ContextoAvaliacao, id: number): Promise<CompetenciaRegistrada | null>;
  /** As competências ligadas a um cargo (ou a todos, cargo nulo). */
  competenciasDoCargo(c: ContextoAvaliacao, cargo: number | null): Promise<CompetenciaDoCargo[]>;
  ciclos(c: ContextoAvaliacao): Promise<CicloRegistrado[]>;
  ciclo(c: ContextoAvaliacao, id: number): Promise<CicloRegistrado | null>;
  avaliacoes(
    c: ContextoAvaliacao,
    filtro: { readonly ciclo: number } | { readonly vinculo: number },
  ): Promise<AvaliacaoRegistrada[]>;
  avaliacao(c: ContextoAvaliacao, id: number): Promise<AvaliacaoRegistrada | null>;
  notas(c: ContextoAvaliacao, avaliacao: number): Promise<NotaAvaliacao[]>;
  /** O cargo do vínculo de trabalho, se houver. */
  cargoDoVinculo(c: ContextoAvaliacao, vinculo: number): Promise<number | null>;
  /** Vínculos CLT não desligados admitidos desde a data (candidatos ao alerta de experiência). */
  vinculosEmExperiencia(c: ContextoAvaliacao, admitidoDesde: string): Promise<VinculoEmExperiencia[]>;
  pdiDoColaborador(c: ContextoAvaliacao, vinculo: number): Promise<PdiRegistrado[]>;
  pdi(c: ContextoAvaliacao, id: number): Promise<PdiRegistrado | null>;
  /** O que barra a exclusão física (as dependências contadas). */
  dependencias(
    c: ContextoAvaliacao,
    alvo: AlvoDependenciaAvaliacao,
    id: number,
  ): Promise<DependenciaContada[]>;
  correcoes(
    c: ContextoAvaliacao,
    tabela: string,
    registros: readonly number[],
  ): Promise<CorrecaoRegistrada[]>;
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
