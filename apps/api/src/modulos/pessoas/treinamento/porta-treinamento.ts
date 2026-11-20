// Porta dos treinamentos e da ciência de POP, fatia F6 (M52.6; ficha, seções 6 e 8, regra 20): o que a tela de
// treinamentos e o "Meu espaço" leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx). O colaborador
// vem da porta da gestão de pessoas (SGH_PES_VINCULO):
//   - `legado`: leituras de @sgh/legado em transação READ ONLY; gravações numa transação só SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E); nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
import type {
  AlteracaoTurmaSgh,
  CamposCursoSgh,
  CorrecaoPesLida,
  CienciaPopPesLida,
  ConclusaoPesLida,
  CursoPesLido,
  FiltroTurmasSgh,
  NovaTurmaSgh,
  NovaVersaoPopSgh,
  ParticipacaoPesLida,
  ParticipacaoSgh,
  ParticipantePesLido,
  PopPesLido,
  TurmaPesLida,
  VinculoAtivoTreinamento,
  VinculoResumoTreinamento,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';

export const PORTA_TREINAMENTO = Symbol('PORTA_TREINAMENTO');

export type ContextoTreinamento = ContextoPortaM18;
type SemHospital<T> = Omit<T, 'hospital'>;

/** As gravações SGH_ da F6 (treinamentos e POP) numa transação só SGH_, com as releituras dentro dela. */
export interface GravadorTreinamento {
  curso(id: number): Promise<CursoPesLido | null>;
  turma(id: number): Promise<TurmaPesLida | null>;
  participantes(turma: number): Promise<ParticipantePesLido[]>;
  pop(id: number): Promise<PopPesLido | null>;
  versoesPop(codigo: string): Promise<PopPesLido[]>;
  ciencias(f: { vinculo?: number; pops?: readonly number[] }): Promise<CienciaPopPesLida[]>;
  incluirCurso(c: CamposCursoSgh & { readonly por: string }): Promise<number>;
  alterarCurso(
    c: CamposCursoSgh & {
      readonly id: number;
      readonly versao: number;
      readonly ativo: boolean;
      readonly por: string;
    },
  ): Promise<void>;
  incluirTurma(t: SemHospital<NovaTurmaSgh>): Promise<number>;
  situacaoTurma(x: {
    id: number;
    versao: number;
    situacao: 'encerrada' | 'cancelada';
    motivo: string | null;
    por: string;
  }): Promise<void>;
  incluirParticipante(x: { treinamento: number; vinculo: number; por: string }): Promise<number>;
  registrarParticipacao(x: SemHospital<ParticipacaoSgh>): Promise<void>;
  incluirPop(x: SemHospital<NovaVersaoPopSgh>): Promise<number>;
  situacaoPop(x: {
    id: number;
    situacao: 'substituido' | 'revogado';
    motivo: string | null;
    por: string;
  }): Promise<void>;
  incluirCiencia(x: {
    pop: number;
    vinculo: number;
    treinamento: number | null;
    por: string;
  }): Promise<number>;
  /** W0-06: alterar a turma aberta pela versão lida. */
  alterarTurma(x: SemHospital<AlteracaoTurmaSgh>): Promise<void>;
  /** W0-06: retirar a inscrição sem presença (retrato antes do DELETE); false se já tem presença ou ciência. */
  retirarInscricao(x: { id: number; versao: number; motivo: string; por: string }): Promise<boolean>;
  /** W0-06: o valor anterior e o novo da alteração ou correção (trilha da gestão de pessoas). */
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

export interface PortaTreinamento extends PortaGravacaoM18<GravadorTreinamento> {
  relogio(c: ContextoTreinamento): Promise<{ hoje: string; agora: string }>;
  cursos(c: ContextoTreinamento): Promise<CursoPesLido[]>;
  curso(c: ContextoTreinamento, id: number): Promise<CursoPesLido | null>;
  turmas(c: ContextoTreinamento, f: FiltroTurmasSgh): Promise<TurmaPesLida[]>;
  turma(c: ContextoTreinamento, id: number): Promise<TurmaPesLida | null>;
  participantes(c: ContextoTreinamento, turma: number): Promise<ParticipantePesLido[]>;
  participacoes(c: ContextoTreinamento, vinculo: number): Promise<ParticipacaoPesLida[]>;
  conclusoes(c: ContextoTreinamento, vinculos: readonly number[] | null): Promise<ConclusaoPesLida[]>;
  pops(c: ContextoTreinamento, f: { vigentes?: boolean; codigo?: string }): Promise<PopPesLido[]>;
  pop(c: ContextoTreinamento, id: number): Promise<PopPesLido | null>;
  ciencias(
    c: ContextoTreinamento,
    f: { vinculo?: number; pops?: readonly number[] },
  ): Promise<CienciaPopPesLida[]>;
  ativos(c: ContextoTreinamento, unidade: number | null): Promise<VinculoAtivoTreinamento[]>;
  vinculos(c: ContextoTreinamento, ids: readonly number[]): Promise<VinculoResumoTreinamento[]>;
  /** W0-06: as alterações e correções dos registros (o mais recente primeiro). */
  correcoes(c: ContextoTreinamento, tabela: string, registros: readonly number[]): Promise<CorrecaoPesLida[]>;
}

export const METODOS_PORTA_TREINAMENTO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'cursos',
  'curso',
  'turmas',
  'turma',
  'participantes',
  'participacoes',
  'conclusoes',
  'pops',
  'pop',
  'ciencias',
  'ativos',
  'vinculos',
  'correcoes',
]);
