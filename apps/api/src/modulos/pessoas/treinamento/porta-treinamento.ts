// Porta dos treinamentos e da ciência de POP, fatia F6 (ficha, seções 6 e 8, regra 20): o que a tela de treinamentos
// e o "Meu espaço" leem e gravam, independente de onde (a API não escreve SQL):
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-treinamento-propria.ts);
//   - `memoria`: a sessão sintética de dev/ci (E2E);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: a porta também dá as unidades (setores) do estabelecimento, no mesmo espaço de códigos da lotação do
// vínculo e do alcance do POP.
import type { ContextoPortaM18, PortaGravacaoM18 } from '../../exames/public-api.js';
import type {
  AlteracaoTurma,
  CamposCurso,
  CienciaPop,
  ConclusaoTreinamento,
  CorrecaoTreinamento,
  CursoTreinamento,
  FiltroTurmas,
  NovaTurma,
  NovaVersaoPop,
  ParticipacaoDoVinculo,
  ParticipanteTreinamento,
  RegistroParticipacao,
  TurmaTreinamento,
  UnidadeTreinamento,
  VersaoPop,
  VinculoAtivoTreinamento,
  VinculoResumoTreinamento,
} from './tipos-treinamento.js';

export * from './tipos-treinamento.js';

export const PORTA_TREINAMENTO = Symbol('PORTA_TREINAMENTO');

export type ContextoTreinamento = ContextoPortaM18;

/** As gravações da F6 (treinamentos e POP) numa transação só, com as releituras dentro dela. */
export interface GravadorTreinamento {
  curso(id: number): Promise<CursoTreinamento | null>;
  turma(id: number): Promise<TurmaTreinamento | null>;
  participantes(turma: number): Promise<ParticipanteTreinamento[]>;
  pop(id: number): Promise<VersaoPop | null>;
  versoesPop(codigo: string): Promise<VersaoPop[]>;
  ciencias(f: { vinculo?: number; pops?: readonly number[] }): Promise<CienciaPop[]>;
  incluirCurso(c: CamposCurso & { readonly por: string }): Promise<number>;
  alterarCurso(
    c: CamposCurso & {
      readonly id: number;
      readonly versao: number;
      readonly ativo: boolean;
      readonly por: string;
    },
  ): Promise<void>;
  incluirTurma(t: NovaTurma): Promise<number>;
  situacaoTurma(x: {
    id: number;
    versao: number;
    situacao: 'encerrada' | 'cancelada';
    motivo: string | null;
    por: string;
  }): Promise<void>;
  incluirParticipante(x: { treinamento: number; vinculo: number; por: string }): Promise<number>;
  registrarParticipacao(x: RegistroParticipacao): Promise<void>;
  incluirPop(x: NovaVersaoPop): Promise<number>;
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
  /** Alterar a turma aberta pela versão lida. */
  alterarTurma(x: AlteracaoTurma): Promise<void>;
  /** Retirar a inscrição sem presença (o registro fica guardado); false se já tem presença ou ciência. */
  retirarInscricao(x: { id: number; versao: number; motivo: string; por: string }): Promise<boolean>;
  /** O valor anterior e o novo da alteração ou correção (trilha da gestão de pessoas). */
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
  unidades(c: ContextoTreinamento): Promise<UnidadeTreinamento[]>;
  cursos(c: ContextoTreinamento): Promise<CursoTreinamento[]>;
  curso(c: ContextoTreinamento, id: number): Promise<CursoTreinamento | null>;
  turmas(c: ContextoTreinamento, f: FiltroTurmas): Promise<TurmaTreinamento[]>;
  turma(c: ContextoTreinamento, id: number): Promise<TurmaTreinamento | null>;
  participantes(c: ContextoTreinamento, turma: number): Promise<ParticipanteTreinamento[]>;
  participacoes(c: ContextoTreinamento, vinculo: number): Promise<ParticipacaoDoVinculo[]>;
  conclusoes(c: ContextoTreinamento, vinculos: readonly number[] | null): Promise<ConclusaoTreinamento[]>;
  pops(c: ContextoTreinamento, f: { vigentes?: boolean; codigo?: string }): Promise<VersaoPop[]>;
  pop(c: ContextoTreinamento, id: number): Promise<VersaoPop | null>;
  ciencias(c: ContextoTreinamento, f: { vinculo?: number; pops?: readonly number[] }): Promise<CienciaPop[]>;
  ativos(c: ContextoTreinamento, unidade: number | null): Promise<VinculoAtivoTreinamento[]>;
  vinculos(c: ContextoTreinamento, ids: readonly number[]): Promise<VinculoResumoTreinamento[]>;
  /** As alterações e correções dos registros (a mais recente primeiro). */
  correcoes(
    c: ContextoTreinamento,
    tabela: string,
    registros: readonly number[],
  ): Promise<CorrecaoTreinamento[]>;
}

export const METODOS_PORTA_TREINAMENTO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'unidades',
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
