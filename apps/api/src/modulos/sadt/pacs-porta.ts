// Porta da lista de trabalho DICOM e do PACS (M47, etapa 3; ficha, seções 4 a 8): o que a tela da lista de trabalho, a
// geração automática, a entrada do status e o prontuário leem e gravam, independente de onde (a API não escreve SQL;
// fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY (os exames de imagem pelas leituras do M26, as
//     modalidades e os visualizadores do cadastro, os itens com a entrega do M34 e os status) e as gravações SGH_ (o
//     item com a outbox, o reenvio, o status) numa transação SGH_ com a SGH_TRILHA junto; em dev sobre a cópia
//     compartilhada, as gravações são recusadas (`sghSoLeitura`), como nos outros módulos;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre a porta em memória do SADT (exames sintéticos), com o
//     simulador de modalidade no lugar do PACS (a entrega é imediata); nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Nenhuma tabela legada é escrita (ficha, seção 5: operações só SGH_).
import type { ExameSadt } from '@sgh/contratos';
import type {
  ExameImagemPendente,
  ItemMwlBanco,
  ItemMwlSgh,
  LinhaTrilha,
  ModalidadeLida,
  StatusEstudoBanco,
  StatusEstudoSgh,
} from '@sgh/legado';
import type { PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_PACS = Symbol('PORTA_PACS');

export interface ContextoPacs {
  readonly rede: string;
  readonly hospital: string;
}

type SemHospital<T> = Omit<T, 'hospital' | 'rede'>;

/** O que a gravação SGH_ da lista de trabalho faz dentro da transação (com a trilha junto). */
export interface GravadorPacs {
  registrarItem(r: SemHospital<ItemMwlSgh>): Promise<{ id: number; accession: string; outbox: string }>;
  reenviar(r: {
    id: number;
    envios: number;
    exame: number;
    accession: string;
    modalidade: string;
    por: string;
  }): Promise<{ id: number; envios: number; outbox: string }>;
  registrarStatus(r: SemHospital<StatusEstudoSgh>): Promise<{ estudo: StatusEstudoBanco; repetida: boolean }>;
}

export interface PortaPacs extends PortaGravacaoM18<GravadorPacs> {
  /** O relógio do banco: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoPacs): Promise<{ hoje: string; agora: string }>;
  /** Os exames de imagem do dia (as leituras do M26: setor imagem, sem os suspensos), com o teto. */
  examesDoDia(
    c: ContextoPacs,
    data: string,
    f?: { readonly ato?: number | undefined; readonly termo?: string | undefined },
  ): Promise<{ itens: ExameSadt[]; cortada: boolean }>;
  examesPorId(c: ContextoPacs, ids: readonly number[]): Promise<ExameSadt[]>;
  examesSemItem(
    c: ContextoPacs,
    f: { desde: string; ate: string; atos: readonly number[]; teto: number },
  ): Promise<{ itens: ExameImagemPendente[]; cortada: boolean }>;
  modalidades(c: ContextoPacs): Promise<ModalidadeLida[]>;
  modalidadeDoCadastro(
    c: ContextoPacs,
    exames: readonly number[],
  ): Promise<Map<number, { id: number; sigla: string }>>;
  visualizadores(c: ContextoPacs): Promise<{ id: number; nome: string }[]>;
  itens(c: ContextoPacs, exames: readonly number[]): Promise<ItemMwlBanco[]>;
  item(c: ContextoPacs, chave: { id: number } | { accession: string }): Promise<ItemMwlBanco | null>;
  itensDoPaciente(c: ContextoPacs, paciente: number): Promise<ItemMwlBanco[]>;
  status(c: ContextoPacs, exames: readonly number[]): Promise<StatusEstudoBanco[]>;
  /** O parceiro de integração ativo que assina o evento da lista de trabalho (null: nenhum). */
  parceiroDaWorklist(c: ContextoPacs): Promise<{ codigo: string; nome: string } | null>;
  gravarSgh<T>(
    c: ContextoPacs,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorPacs) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_PACS: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'relogio',
  'examesDoDia',
  'examesPorId',
  'examesSemItem',
  'modalidades',
  'modalidadeDoCadastro',
  'visualizadores',
  'itens',
  'item',
  'itensDoPaciente',
  'status',
  'parceiroDaWorklist',
  'gravarSgh',
]);
