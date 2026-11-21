// Tipos de negócio dos treinamentos e da ciência de POP (fatia F6): o que a porta lê e grava, independente de onde
// (banco do cliente ou memória). Vocabulário neutro: datas ISO, ids numéricos, booleanos e os códigos do contrato.
// Melhoria: os tipos são do próprio módulo, com os códigos do contrato (presença, aproveitamento, situação da turma e do
// POP, modalidade, categoria), não as linhas lidas de tabelas de outro sistema.
import type {
  AproveitamentoTreinamentoCodigo,
  CategoriaCurso,
  ModalidadeTurma,
  PresencaTreinamentoCodigo,
  SituacaoPopCodigo,
  SituacaoTurma,
} from '@sgh/contratos';

/** Público do curso obrigatório: a unidade (setor) pelo id ou a função pela chave (`chaveFuncao`). */
export interface AlvoCursoTreinamento {
  readonly tipo: 'unidade' | 'funcao';
  readonly valor: string;
}

export interface CamposCurso {
  readonly codigo: string;
  readonly titulo: string;
  readonly conteudo: string;
  readonly categoria: CategoriaCurso;
  readonly cargaMinimaMin: number;
  /** 0: não vence. */
  readonly validadeMeses: number;
  readonly obrigatorio: boolean;
  readonly alvos: readonly AlvoCursoTreinamento[];
}

export interface CursoTreinamento extends CamposCurso {
  readonly id: number;
  readonly ativo: boolean;
  readonly alvos: AlvoCursoTreinamento[];
  readonly versao: number;
}

export interface CamposTurma {
  readonly inicio: string;
  readonly fim: string;
  readonly cargaMin: number;
  readonly instrutor: string;
  readonly modalidade: ModalidadeTurma;
  readonly local: string | null;
  /** A versão do POP trabalhada na turma (id da versão). */
  readonly pop: number | null;
  readonly observacao: string | null;
}

export interface NovaTurma extends CamposTurma {
  readonly curso: number;
  readonly por: string;
}

export interface AlteracaoTurma extends CamposTurma {
  readonly id: number;
  readonly versao: number;
  readonly por: string;
}

export interface FiltroTurmas {
  readonly situacao?: SituacaoTurma;
  readonly curso?: number;
  readonly de?: string;
  readonly ate?: string;
}

export interface TurmaTreinamento extends CamposTurma {
  readonly id: number;
  readonly curso: number;
  readonly situacao: SituacaoTurma;
  /** Motivo do cancelamento. */
  readonly motivo: string | null;
  readonly versao: number;
  readonly participantes: number;
  readonly concluintes: number;
}

export interface ParticipanteTreinamento {
  readonly id: number;
  readonly treinamento: number;
  readonly vinculo: number;
  readonly presenca: PresencaTreinamentoCodigo;
  readonly aproveitamento: AproveitamentoTreinamentoCodigo | null;
  readonly conclusao: string | null;
  readonly validoAte: string | null;
  readonly observacao: string | null;
  readonly versao: number;
}

export interface RegistroParticipacao {
  readonly id: number;
  readonly versao: number;
  readonly presenca: PresencaTreinamentoCodigo;
  readonly aproveitamento: AproveitamentoTreinamentoCodigo | null;
  readonly conclusao: string | null;
  readonly validoAte: string | null;
  readonly observacao: string | null;
  readonly por: string;
}

/** A participação do vínculo com os dados da turma (a ficha). */
export interface ParticipacaoDoVinculo extends ParticipanteTreinamento {
  readonly curso: number;
  readonly inicio: string;
  readonly fim: string;
  readonly cargaMin: number;
  readonly instrutor: string;
  readonly turmaSituacao: SituacaoTurma;
}

export interface ConclusaoTreinamento {
  readonly vinculo: number;
  readonly curso: number;
  readonly conclusao: string;
  readonly validoAte: string | null;
}

export interface VersaoPop {
  readonly id: number;
  readonly codigo: string;
  readonly versao: number;
  readonly titulo: string;
  /** Unidade (setor) alcançada; null: o estabelecimento inteiro. */
  readonly unidade: number | null;
  readonly vigencia: string;
  readonly resumo: string;
  readonly referencia: string | null;
  readonly alteracoes: string | null;
  readonly situacao: SituacaoPopCodigo;
  readonly motivo: string | null;
  readonly publicadoPor: string;
  readonly publicadoEm: string;
}

export interface NovaVersaoPop {
  readonly codigo: string;
  readonly versao: number;
  readonly titulo: string;
  readonly unidade: number | null;
  readonly vigencia: string;
  readonly resumo: string;
  readonly referencia: string | null;
  readonly alteracoes: string | null;
  readonly por: string;
}

export interface CienciaPop {
  readonly id: number;
  readonly pop: number;
  readonly vinculo: number;
  readonly origem: 'proprio' | 'treinamento';
  readonly treinamento: number | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

/** Alteração ou correção registrada com o valor anterior e o novo (a trilha da gestão de pessoas). */
export interface CorrecaoTreinamento {
  readonly id: number;
  readonly tabela: string;
  readonly registro: number;
  readonly operacao: string;
  readonly antes: Record<string, unknown>;
  readonly depois: Record<string, unknown>;
  readonly motivo: string;
  readonly por: string;
  readonly em: string;
}

export interface VinculoAtivoTreinamento {
  readonly id: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly cargo: string;
  readonly funcao: string | null;
  /** Unidade (setor) de lotação. */
  readonly unidade: number | null;
  readonly admissao: string;
}

export interface VinculoResumoTreinamento extends VinculoAtivoTreinamento {
  readonly desligamento: string | null;
}

/** Unidade (setor) do estabelecimento, para os alvos dos cursos e o alcance dos POPs. */
export interface UnidadeTreinamento {
  readonly codigo: number;
  readonly nome: string;
}

/** As tabelas cujas alterações e correções ficam na trilha com o valor anterior. */
export const TABELAS_CORRECAO = ['turma_treinamento', 'presenca_treinamento'] as const;
export type TabelaCorrecao = (typeof TABELAS_CORRECAO)[number];
