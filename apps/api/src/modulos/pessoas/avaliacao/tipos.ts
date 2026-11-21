// Tipos de negócio da avaliação de desempenho, das competências e do PDI (F2.2, lote 03-02): o que a porta devolve às
// telas, sem forma de banco. Os campos que a tela já conhece vêm do contrato (@sgh/contratos); os demais são do módulo.
import type {
  AvaliacaoResposta,
  CicloAvaliacaoResposta,
  IncluirCicloEntrada,
  IncluirPdiEntrada,
  PdiResposta,
} from '@sgh/contratos';

export type SituacaoCiclo = CicloAvaliacaoResposta['situacao'];
export type SituacaoPdi = PdiResposta['situacao'];
export type TipoCiclo = IncluirCicloEntrada['tipo'];

/** Os dados do ciclo que a tela informa (nome, tipo, período, prazo e a escala de notas). */
export type DadosCiclo = Pick<IncluirCicloEntrada, 'nome' | 'tipo' | 'inicio' | 'fim' | 'prazo' | 'notaMax'>;

export interface CicloRegistrado extends DadosCiclo {
  readonly id: number;
  readonly situacao: SituacaoCiclo;
  readonly motivoSituacao: string | null;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

/** Os dados da ação do PDI que a tela informa. */
export type DadosPdi = Pick<IncluirPdiEntrada, 'avaliacao' | 'competencia' | 'curso' | 'acao' | 'prazo'>;

export type AvaliacaoRegistrada = AvaliacaoResposta;
export type PdiRegistrado = PdiResposta;

export interface CompetenciaRegistrada {
  readonly id: number;
  readonly nome: string;
  readonly descricao: string | null;
  readonly ativo: boolean;
  readonly motivoSituacao: string | null;
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface CompetenciaDoCargo {
  readonly id: number;
  readonly cargo: number;
  readonly competencia: number;
  readonly nome: string;
  readonly ativa: boolean;
}

export interface NotaAvaliacao {
  readonly competencia: number;
  readonly nome: string;
  readonly nota: number | null;
  readonly comentario: string | null;
}

/** Vínculo CLT em experiência (candidato ao alerta de 45 e 90 dias). */
export interface VinculoEmExperiencia {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly cargo: number | null;
  readonly admissao: string;
  readonly centroCusto: number | null;
  readonly setor: string | null;
}

/** O que barra a exclusão física: o grupo, a tabela, a coluna e a quantidade. */
export interface DependenciaContada {
  readonly grupo: string;
  readonly tabela: string;
  readonly coluna: string;
  readonly quantidade: number;
}

/** Correção registrada (o valor anterior e o novo, com o motivo). */
export interface CorrecaoRegistrada {
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

/** A chave do estado em memória pelo contexto (o estabelecimento da sessão, ou o código dele nos testes). */
export function chaveDoContexto(c: object): string {
  const x = c as { hospital?: unknown; estabelecimento?: unknown };
  return String(x.hospital ?? x.estabelecimento ?? '');
}
