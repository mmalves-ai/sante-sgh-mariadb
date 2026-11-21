// Tipos do índice da rede (MPI): leitura e escrita do índice de pacientes da rede.
// Melhoria: a escrita se discrimina pelo alvo de negócio (pessoa, vínculo, suspeita), com ids numéricos e data ISO, sem
// nome de tabela inexistente no modelo. O resto dos tipos (forma entre bancos) é redesenhado no lote da rede (onda 2).

export interface ParNovo {
  readonly a: { readonly id: number; readonly pront: number };
  readonly b: { readonly id: number; readonly pront: number };
  readonly escore: number;
  readonly criterios: readonly string[];
}

/**
 * Escrita no índice de pacientes da rede, por ALVO de negócio (não por nome de tabela: o modelo próprio, com um banco
 * por cliente, ainda não decidiu as tabelas do índice — ver o pedido de redesenho do lote 01-06; a suspeita de
 * duplicata tende a ser `suspeita_duplicidade`, 03_CAD). Ids numéricos e instantes em data ISO (UTC).
 */
export type EscritaIndiceRede =
  | {
      readonly alvo: 'pessoa';
      readonly acao: 'inserir_se_ausente';
      /** Id do paciente que representa a pessoa no cliente. */
      readonly pacienteId: number;
      /** Instante ISO 8601 (UTC). */
      readonly em: string;
    }
  | {
      readonly alvo: 'vinculo';
      readonly acao: 'gravar';
      readonly linha: Omit<VinculoRedeLido, 'estabelecimento'> & { readonly estabelecimento: string };
    }
  | {
      readonly alvo: 'suspeita';
      readonly acao: 'mudar_situacao';
      readonly chave: string;
      readonly situacao: 'aberto' | 'vinculado' | 'outra_pessoa';
      readonly origem?: 'automatico' | 'humano';
      /** Id do usuário que decidiu. */
      readonly porUsuarioId: number;
      /** Instante ISO 8601 (UTC). */
      readonly em: string;
      readonly justificativa: string | null;
    };

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
