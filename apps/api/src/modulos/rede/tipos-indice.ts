// Tipos do índice da rede (MPI): leitura e escrita do índice de pacientes da rede.
// Melhoria: a escrita se discrimina pelo alvo de negócio (pessoa, vínculo, suspeita), com ids numéricos e data ISO, sem
// nome de tabela inexistente no modelo. Lote 02-13: no banco do cliente, cada "banco" do contexto é um estabelecimento do mesmo banco.
import type { LinhaTrilha } from '@sgh/nucleo';

export interface ParNovo {
  readonly a: { readonly id: number; readonly pront: number };
  readonly b: { readonly id: number; readonly pront: number };
  readonly escore: number;
  readonly criterios: readonly string[];
}

/**
 * Escrita no índice de pacientes da rede, por ALVO de negócio (não por nome de tabela). No banco do cliente (um banco por
 * cliente, todos os estabelecimentos juntos), a "pessoa da rede" é o próprio paciente, o par suspeito é uma linha de
 * `suspeita_duplicidade` e "a mesma pessoa" é a unificação dos dois cadastros (feita no cadastro). Instantes em ISO 8601.
 */
export type EscritaIndiceRede =
  | {
      readonly alvo: 'pessoa';
      readonly acao: 'inserir_se_ausente';
      /** Identificador da pessoa da rede. */
      readonly pessoa: string;
      readonly em: string;
    }
  | {
      readonly alvo: 'vinculo';
      readonly acao: 'gravar';
      readonly linha: VinculoRedeLido;
    }
  | {
      readonly alvo: 'suspeita';
      readonly acao: 'mudar_situacao';
      readonly chave: string;
      readonly situacao: 'aberto' | 'vinculado' | 'outra_pessoa';
      readonly origem?: 'automatico' | 'humano';
      /** Login de quem decidiu (exibição); no banco, quem decide é o usuário do contexto da gravação. */
      readonly por: string;
      readonly em: string;
      readonly justificativa: string | null;
    };

/** A linha da trilha de uma gravação do índice (o instante é o da gravação, quando ausente). */
export type TrilhaRede = Omit<LinhaTrilha, 'ocorridoEm'> & { readonly ocorridoEm?: Date };

export interface ResultadoEscritasIndice {
  readonly gravadas: number;
  readonly jaEstavam: number;
}

export interface CandidatoParaGravarRede {
  readonly chave: string;
  readonly idLocal: number;
  readonly prontuarioLocal: number;
  readonly estabelecimentoRemoto: string;
  readonly idRemoto: number;
  readonly prontuarioRemoto: number;
  readonly pontuacao: number;
  readonly criterios: readonly string[];
  readonly divergencias: readonly string[];
  readonly situacao: 'aberto' | 'vinculado';
  readonly por: string;
  readonly em: string;
}

export interface CadastroRedeLido {
  readonly estabelecimento: string;
  readonly id: number;
  readonly prontuario: number;
  readonly nome: string | null;
  readonly mae: string | null;
  readonly nascimento: string | null;
  readonly sexo: 'F' | 'M' | null;
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly ativo: boolean;
  readonly idUnificado: number | null;
  readonly nomeFoneticoBanco: string | null;
  readonly maeFoneticaBanco: string | null;
  readonly atualizadoEm: string | null;
}

export interface ChavesProcuraRede {
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly nomeFoneticoBanco: string | null;
  readonly maeFoneticaBanco: string | null;
  readonly nascimento: string | null;
}

export interface VinculoRedeLido {
  readonly estabelecimento: string;
  readonly chave: string;
  readonly pessoa: string;
  readonly idLocal: number;
  readonly prontuarioLocal: number;
  readonly estabelecimentoRemoto: string;
  readonly idRemoto: number;
  readonly prontuarioRemoto: number;
  readonly origem: 'automatico' | 'humano';
  readonly situacao: 'ativo' | 'desfeito';
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly desfeitoPor: string | null;
  readonly desfeitoEm: string | null;
  readonly justificativa: string | null;
}

export interface CandidatoRedeLido {
  readonly estabelecimento: string;
  readonly chave: string;
  readonly idLocal: number;
  readonly prontuarioLocal: number;
  readonly estabelecimentoRemoto: string;
  readonly idRemoto: number;
  readonly prontuarioRemoto: number;
  readonly pontuacao: number;
  readonly criterios: readonly string[];
  readonly divergencias: readonly string[];
  readonly situacao: 'aberto' | 'vinculado' | 'outra_pessoa';
  readonly origem: 'automatico' | 'humano' | null;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
  readonly criadoEm: string | null;
}

export interface FiltroFilaRede {
  readonly situacao: CandidatoRedeLido['situacao'];
  readonly pontuacaoMinima?: number;
  readonly pontuacaoMaxima?: number;
  readonly estabelecimentoRemoto?: string;
  readonly estabelecimentosRemotos?: readonly string[];
  readonly prontuarioLocal?: number;
  readonly pagina: number;
  readonly porPagina: number;
}
