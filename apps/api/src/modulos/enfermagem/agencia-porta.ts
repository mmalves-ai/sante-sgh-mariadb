// Porta da agência transfusional, etapa 2 (M47; ficha, seções 4, 5 e 7; chave `agencia.completa`, DP-21), independente
// de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY (a imuno-hematologia, a tipagem e as provas da requisição, o estoque, o histórico da
//     bolsa, os exames imuno-hematológicos já lançados na conta) e as gravações só do novo numa transação SGH_ com a
//     SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre a agência da etapa 1 em memória, com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  BolsaEstoqueLida,
  CadastrosDoEstoque,
  ExameImunoLancado,
  FiltroEstoque,
  ImunoHematologiaLida,
  MovimentoBolsaLido,
  SituacaoBolsaEstoque,
  VersaoBolsaLida,
} from '@sgh/contratos';
import type { ProvaCruzadaResumo, ResultadoImunoResumo } from '@sgh/dominio-sadt';
import type {
  CorrecaoBolsaSgh,
  ImunoHematologiaSgh,
  MovimentoBolsaSgh,
  RecebimentoBolsaSgh,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_AGENCIA = Symbol('PORTA_AGENCIA');

export type ContextoAgencia = ContextoPortaM18;
/** Sem o estabelecimento (que a porta põe), distributivo sobre a união dos exames. */
type SemHospital<T> = T extends unknown ? Omit<T, 'hospital'> : never;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorAgencia {
  registrarImuno(x: SemHospital<ImunoHematologiaSgh>): Promise<{ id: number; repetida: boolean }>;
  liberarImuno(x: { readonly id: number; readonly usuario: string }): Promise<{ id: number }>;
  invalidarImuno(x: {
    readonly id: number;
    readonly usuario: string;
    readonly motivo: string;
  }): Promise<{ id: number }>;
  receberBolsa(x: SemHospital<RecebimentoBolsaSgh>): Promise<{ id: number; repetida: boolean }>;
  movimentarBolsa(x: SemHospital<MovimentoBolsaSgh>): Promise<{
    id: number;
    situacao: SituacaoBolsaEstoque;
    numero: string;
    repetida: boolean;
  }>;
  /** W0-03: a bolsa corrigida antes do uso (a versão anterior guardada); 409 depois do uso. */
  corrigirBolsa(x: SemHospital<CorrecaoBolsaSgh>): Promise<{ id: number; numero: string; versao: number }>;
}

export interface FiltroImunoPorta {
  readonly id?: number | undefined;
  readonly estado?: string | undefined;
  readonly tipo?: string | undefined;
  readonly requisicao?: number | undefined;
  readonly paciente?: number | undefined;
}

export interface PortaAgencia extends PortaGravacaoM18<GravadorAgencia> {
  imunos(
    c: ContextoAgencia,
    f: FiltroImunoPorta,
  ): Promise<{ itens: ImunoHematologiaLida[]; cortada: boolean }>;
  /** Os resultados do paciente para a tipagem do receptor (a da agência prevalece sobre o cadastro). */
  resultadosDoPaciente(c: ContextoAgencia, paciente: number): Promise<ResultadoImunoResumo[]>;
  provas(c: ContextoAgencia, requisicao: number): Promise<ProvaCruzadaResumo[]>;
  estoque(
    c: ContextoAgencia,
    f: FiltroEstoque & { readonly agora: string },
  ): Promise<{ itens: BolsaEstoqueLida[]; cortada: boolean }>;
  bolsa(
    c: ContextoAgencia,
    chave: { readonly id: number } | { readonly numero: string },
    agora: string,
  ): Promise<BolsaEstoqueLida | null>;
  movimentos(c: ContextoAgencia, bolsa: number): Promise<MovimentoBolsaLido[]>;
  /** W0-03: as versões anteriores da bolsa (a do recebimento primeiro). */
  versoesBolsa(c: ContextoAgencia, bolsa: number): Promise<VersaoBolsaLida[]>;
  /** Os locais de armazenagem e os motivos de devolução ou perda (os combos do recebimento e dos movimentos). */
  cadastrosDoEstoque(c: ContextoAgencia): Promise<CadastrosDoEstoque>;
  /** Exames imuno-hematológicos do laboratório já lançados na conta do paciente (pelo prontuário). */
  examesLancados(c: ContextoAgencia, prontuario: number, agora: string): Promise<ExameImunoLancado[]>;
}

export const METODOS_PORTA_AGENCIA: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'imunos',
  'resultadosDoPaciente',
  'provas',
  'estoque',
  'bolsa',
  'movimentos',
  'versoesBolsa',
  'cadastrosDoEstoque',
  'examesLancados',
]);
