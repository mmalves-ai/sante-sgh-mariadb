// Tipos de negócio da digitalização certificada (F2.2, lote 03-02): o documento digitalizado como a porta lê e grava,
// no vocabulário do produto. Datas em ISO ("AAAA-MM-DD"; instantes "AAAA-MM-DDTHH:mm" no fuso do estabelecimento), ids
// numéricos; o prontuário é o número de prontuário do paciente e a internação é o id do atendimento.
import type { CorDigitalizacao, SituacaoDigitalizacao, TipoDocumentoDigitalizado } from '@sgh/contratos';

export type { SituacaoDigitalizacao } from '@sgh/contratos';

export interface DocumentoDigitalizado {
  readonly id: number;
  /** O lote de digitalização (id). */
  readonly lote: number;
  /** A ordem do documento no lote. */
  readonly ordem: number;
  readonly prontuario: number;
  /** O atendimento (internação) do papel; null = documento do prontuário. */
  readonly internacao: number | null;
  readonly paciente: number;
  readonly tipoDocumento: TipoDocumentoDigitalizado;
  readonly descricao: string;
  readonly dataDocumento: string;
  readonly paginas: number;
  readonly resolucaoDpi: number;
  readonly cor: CorDigitalizacao;
  /** A chave do objeto no armazenamento. */
  readonly arquivoChave: string;
  /** SHA-256 do arquivo (hexadecimal). */
  readonly hash: string;
  readonly tamanho: number;
  readonly situacao: SituacaoDigitalizacao;
  /** Login de quem capturou. */
  readonly capturadoPor: string;
  readonly capturadoEm: string;
  readonly conferidoPor: string | null;
  readonly conferidoEm: string | null;
  /** Motivo da recusa na conferência. */
  readonly motivo: string | null;
  /** A assinatura ICP-Brasil (id) de quem conferiu. */
  readonly assinatura: number | null;
  readonly assinadoPor: string | null;
  readonly assinadoEm: string | null;
  readonly carimboEm: string | null;
  /** Guarda legal do arquivo até (AAAA-MM-DD). */
  readonly guardaAte: string;
  readonly versao: number;
}

/** A captura com o índice (o paciente já conferido pelo prontuário). */
export interface CapturaDigitalizacao {
  /** null = um lote novo. */
  readonly lote: number | null;
  readonly prontuario: number;
  readonly internacao: number | null;
  readonly paciente: number;
  readonly tipoDocumento: TipoDocumentoDigitalizado;
  readonly descricao: string;
  readonly dataDocumento: string;
  readonly paginas: number;
  readonly resolucaoDpi: number;
  readonly cor: CorDigitalizacao;
  readonly arquivoChave: string;
  readonly hash: string;
  readonly tamanho: number;
  readonly guardaAte: string;
  /** Login de quem captura (a porta própria grava o usuário da sessão, por id). */
  readonly usuario: string;
}

export interface PacienteDoProntuario {
  readonly prontuario: number;
  readonly paciente: number;
  readonly nome: string;
  /** Os atendimentos do paciente no estabelecimento (`reg` = id do atendimento), o mais recente primeiro. */
  readonly internacoes: readonly { reg: number; entrada: string; saida: string | null }[];
}
