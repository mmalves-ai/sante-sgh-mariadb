// Porta da digitalização certificada (M50, etapa 6; ficha, seções 4 a 7): o que a fila do SAME, a captura, a
// conferência e a assinatura leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY pelos repositórios de @sgh/legado e as gravações só do novo numa transação SGH_ com a
//     SGH_TRILHA junto (a assinatura do M49 e a validação gravadas na mesma transação do documento);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com os pacientes do cadastro sintético;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AssinaturaParaGravar,
  CapturaDigitalizacaoSgh,
  DigitalizacaoSghLida,
  LinhaTrilha,
  SituacaoDigitalizacaoSgh,
  ValidacaoParaGravar,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_DIGITALIZACAO = Symbol('PORTA_DIGITALIZACAO');

export type ContextoDigitalizacao = ContextoPortaM18;

export interface GravadorDigitalizacao {
  capturar(
    c: Omit<CapturaDigitalizacaoSgh, 'hospital'>,
  ): Promise<{ id: number; lote: number; ordem: number }>;
  conferir(c: {
    id: number;
    situacao: 'conferido' | 'recusado';
    motivo: string | null;
    versao: number;
    usuario: string;
  }): Promise<void>;
  /** A assinatura ICP-Brasil do M49 (com a validação) e o documento "assinado", na mesma transação. */
  assinar(a: {
    id: number;
    assinatura: Omit<AssinaturaParaGravar, 'hospital'>;
    validacao: Omit<ValidacaoParaGravar, 'assinatura'>;
    usuario: string;
  }): Promise<number>;
  /** A assinatura que não validou (só a evidência no M49; o documento continua conferido). */
  registrarFalha(a: {
    assinatura: Omit<AssinaturaParaGravar, 'hospital'>;
    validacao: Omit<ValidacaoParaGravar, 'assinatura'>;
  }): Promise<number>;
  registrarEvento(linha: LinhaTrilha): Promise<void>;
}

export interface PacienteDoProntuario {
  readonly prontuario: number;
  readonly paciente: number;
  readonly nome: string;
  readonly internacoes: readonly { reg: number; entrada: string; saida: string | null }[];
}

export interface PortaDigitalizacao extends PortaGravacaoM18<GravadorDigitalizacao> {
  relogio(c: ContextoDigitalizacao): Promise<{ agora: string; hoje: string }>;
  fila(
    c: ContextoDigitalizacao,
    situacao: SituacaoDigitalizacaoSgh | null,
  ): Promise<{
    itens: DigitalizacaoSghLida[];
    cortada: boolean;
    contagens: Record<SituacaoDigitalizacaoSgh, number>;
  }>;
  documento(c: ContextoDigitalizacao, id: number): Promise<DigitalizacaoSghLida | null>;
  porIds(c: ContextoDigitalizacao, ids: readonly number[]): Promise<DigitalizacaoSghLida[]>;
  doProntuario(c: ContextoDigitalizacao, pront: number): Promise<DigitalizacaoSghLida[]>;
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
