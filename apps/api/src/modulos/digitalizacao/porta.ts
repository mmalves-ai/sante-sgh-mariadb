// Porta da digitalização certificada (M50, etapa 6; ficha, seções 4 a 7): o que a fila do SAME, a captura, a
// conferência e a assinatura leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: o banco do cliente (MariaDB) pelo @sgh/nucleo (porta-propria.ts): leituras somente leitura e as
//     gravações numa operação do Executor (trilha, outbox e idempotência na mesma transação; a assinatura e a
//     validação gravadas na mesma transação do documento);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com os pacientes do cadastro sintético;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { AssinaturaParaGravar, ValidacaoParaGravar } from '../assinatura/tipos.js';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';
import type {
  CapturaDigitalizacao,
  DocumentoDigitalizado,
  PacienteDoProntuario,
  SituacaoDigitalizacao,
} from './tipos.js';

export type { CapturaDigitalizacao, DocumentoDigitalizado, PacienteDoProntuario } from './tipos.js';

export const PORTA_DIGITALIZACAO = Symbol('PORTA_DIGITALIZACAO');

export type ContextoDigitalizacao = ContextoPortaM18;

/**
 * O pedido repetível da tela: a Idempotency-Key da requisição, a ação e os dados efetivos da gravação (entram no hash;
 * a mesma chave com outros dados é recusada). A repetição devolve o resultado já gravado, sem gravar de novo.
 */
export interface PedidoGravacaoDigitalizacao {
  readonly chave: string;
  readonly acao: 'capturar' | 'conferir';
  readonly entrada: Readonly<Record<string, string | number | boolean | null>>;
}

/** Contexto de uma gravação da tela: o da sessão mais o pedido repetível (sem ele, a gravação não é repetível). */
export type ContextoGravacaoDigitalizacao = ContextoDigitalizacao & {
  readonly pedido?: PedidoGravacaoDigitalizacao;
};

/** Chave da operação no núcleo: a Idempotency-Key do pedido com a ação (até 80 caracteres). */
export const chaveDoPedido = (p: PedidoGravacaoDigitalizacao) => `${p.chave}:${p.acao}`.slice(0, 80);
/** Nome da operação de uma gravação da tela. */
export const operacaoDoPedido = (p: PedidoGravacaoDigitalizacao) => `digitalizacao.${p.acao}`;

export interface GravadorDigitalizacao {
  capturar(c: CapturaDigitalizacao): Promise<{ id: number; lote: number; ordem: number }>;
  conferir(c: {
    id: number;
    situacao: 'conferido' | 'recusado';
    motivo: string | null;
    versao: number;
    /** Login de quem confere (a porta própria usa o usuário da sessão, por id). */
    usuario: string;
  }): Promise<void>;
  /** A assinatura ICP-Brasil (com a validação) e o documento "assinado", na mesma transação. */
  assinar(a: {
    id: number;
    assinatura: Omit<AssinaturaParaGravar, 'hospital'>;
    validacao: Omit<ValidacaoParaGravar, 'assinatura'>;
    usuario: string;
  }): Promise<number>;
  /** A assinatura que não validou (só a evidência; o documento continua conferido). */
  registrarFalha(a: {
    assinatura: Omit<AssinaturaParaGravar, 'hospital'>;
    validacao: Omit<ValidacaoParaGravar, 'assinatura'>;
  }): Promise<number>;
}

export interface PortaDigitalizacao extends PortaGravacaoM18<GravadorDigitalizacao> {
  /**
   * O resultado já gravado para o mesmo pedido (Idempotency-Key + ação), ou null. A mesma chave com outros dados ou de
   * outra pessoa: 422 idempotencia-divergente.
   */
  repeticao<T>(c: ContextoGravacaoDigitalizacao): Promise<{ readonly valor: T } | null>;
  relogio(c: ContextoDigitalizacao): Promise<{ agora: string; hoje: string }>;
  fila(
    c: ContextoDigitalizacao,
    situacao: SituacaoDigitalizacao | null,
  ): Promise<{
    itens: DocumentoDigitalizado[];
    cortada: boolean;
    contagens: Record<SituacaoDigitalizacao, number>;
  }>;
  documento(c: ContextoDigitalizacao, id: number): Promise<DocumentoDigitalizado | null>;
  porIds(c: ContextoDigitalizacao, ids: readonly number[]): Promise<DocumentoDigitalizado[]>;
  doProntuario(c: ContextoDigitalizacao, pront: number): Promise<DocumentoDigitalizado[]>;
  loteExiste(c: ContextoDigitalizacao, lote: number): Promise<boolean>;
  /** O resumo SHA-256 já digitalizado no estabelecimento (antes de guardar o arquivo). */
  hashExiste(c: ContextoDigitalizacao, hash: string): Promise<boolean>;
  paciente(c: ContextoDigitalizacao, pront: number): Promise<PacienteDoProntuario | null>;
  prontuarioDaInternacao(c: ContextoDigitalizacao, reg: number): Promise<number | null>;
  nomes(c: ContextoDigitalizacao, ids: readonly number[]): Promise<Map<number, string>>;
}

export const METODOS_PORTA_DIGITALIZACAO: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'repeticao',
  'relogio',
  'fila',
  'documento',
  'porIds',
  'doProntuario',
  'loteExiste',
  'hashExiste',
  'paciente',
  'prontuarioDaInternacao',
  'nomes',
]);
