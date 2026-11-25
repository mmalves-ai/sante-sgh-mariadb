// Porta da lista de trabalho DICOM e do PACS (M47, etapa 3; ficha, seções 4 a 8): o que a tela da lista de trabalho, a
// geração automática, a entrada do status e o prontuário leem e gravam, independente de onde (a API não escreve SQL;
// fronteira Nx):
//   - `banco`: o banco do cliente (MariaDB) pelo @sgh/nucleo (pacs-porta-propria.ts): o item da lista de trabalho em
//     item_lista_trabalho_imagem, a mensagem ao PACS pela fila de integração (integracao_mensagem, saída), o status
//     recebido como mensagem de entrada (integracao_mensagem, entrada; idempotente pela chave da mensagem) e o estudo
//     arquivado em estudo_imagem; tudo pelo Executor, com a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre a porta em memória do SADT (exames sintéticos), com o
//     simulador de modalidade no lugar do PACS (a entrega é imediata);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: contexto do núcleo (cliente, estabelecimento e usuário por id) e tipos de negócio próprios; o item guarda a
// modalidade do cadastro do exame e a mensagem de saída, sem tabela espelho.
import type { ExameSadt } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_PACS = Symbol('PORTA_PACS');

/** O contexto do núcleo com o código do estabelecimento e da rede (o número de acesso e os parâmetros usam). */
export type ContextoPacs = ContextoPortaM18 & {
  readonly rede: string;
  readonly hospital: string;
  /** A chave de idempotência da requisição; sem ela, cada gravação é nova. */
  readonly chaveIdempotencia?: string;
};

export type StatusEstudoCodigo = 'em-andamento' | 'concluido' | 'descontinuado';

/** Um item da lista de trabalho como o banco guarda (com a entrega da última mensagem ao PACS). */
export interface ItemMwlBanco {
  readonly id: number;
  /** Id do exame pedido (exame_item). */
  readonly exame: number;
  readonly paciente: number | null;
  /** Chave de negócio do exame (número da requisição e sequência). */
  readonly chaveNatural: string;
  readonly ato: number;
  readonly idModalidade: number | null;
  readonly modalidade: string;
  readonly accession: string;
  readonly envios: number;
  readonly idOutbox: string | null;
  readonly ultimoEnvioEm: string;
  readonly ultimoEnvioPor: string;
  readonly origem: 'automatico' | 'manual';
  readonly criadoEm: string;
  /** A entrega do último envio (null sem mensagem registrada). */
  readonly entrega: { situacao: string; tentativas: number; resposta: string | null } | null;
}

/** Uma mensagem de status do estudo recebida (a sequência dá o status vigente). */
export interface StatusEstudoBanco {
  readonly id: number;
  readonly mwl: number;
  readonly exame: number;
  readonly accession: string;
  readonly status: StatusEstudoCodigo;
  readonly uidEstudo: string | null;
  readonly uidMpps: string | null;
  readonly ocorridoEm: string;
  readonly visualizador: number | null;
  readonly chaveMensagem: string;
  readonly origem: 'pacs' | 'simulador';
  readonly recebidoEm: string;
}

export interface ModalidadeLida {
  readonly id: number;
  readonly sigla: string;
  readonly ativa: boolean;
}

/** O item novo da lista de trabalho. */
export interface NovoItemMwl {
  readonly exame: number;
  readonly paciente: number | null;
  readonly chaveNatural: string;
  readonly ato: number;
  readonly modalidade: { readonly id: number | null; readonly sigla: string };
  /** O número de acesso a partir do ID do item (regra do domínio: único pelo ID). */
  readonly accession: (id: number) => string;
  readonly chaveIdempotencia: string;
  readonly origem: 'automatico' | 'manual';
  readonly por: string;
}

/** O status recebido do PACS (ou do simulador). */
export interface NovoStatusEstudo {
  readonly mwl: number;
  readonly exame: number;
  readonly accession: string;
  readonly status: StatusEstudoCodigo;
  readonly uidEstudo: string | null;
  readonly uidMpps: string | null;
  /** AAAA-MM-DDTHH:MM[:SS] (hora local). */
  readonly ocorridoEm: string;
  readonly visualizador: number | null;
  readonly chaveMensagem: string;
  readonly origem: 'pacs' | 'simulador';
  readonly por: string;
}

/** O que a gravação da lista de trabalho faz dentro da transação (com a trilha junto). */
export interface GravadorPacs {
  registrarItem(r: NovoItemMwl): Promise<{ id: number; accession: string; outbox: string }>;
  reenviar(r: {
    id: number;
    envios: number;
    exame: number;
    accession: string;
    modalidade: string;
    por: string;
  }): Promise<{ id: number; envios: number; outbox: string }>;
  registrarStatus(r: NovoStatusEstudo): Promise<{ estudo: StatusEstudoBanco; repetida: boolean }>;
}

export interface PortaPacs extends PortaGravacaoM18<GravadorPacs> {
  /** O relógio do estabelecimento: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoPacs): Promise<{ hoje: string; agora: string }>;
  /** Os exames de imagem do dia (setor imagem, sem os cancelados), com o teto. */
  examesDoDia(
    c: ContextoPacs,
    data: string,
    f?: { readonly ato?: number | undefined; readonly termo?: string | undefined },
  ): Promise<{ itens: ExameSadt[]; cortada: boolean }>;
  examesPorId(c: ContextoPacs, ids: readonly number[]): Promise<ExameSadt[]>;
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
  /** O parceiro do código dado (o do parâmetro do estabelecimento), se ativo e com o evento da lista (null: não serve). */
  parceiroDaWorklist(c: ContextoPacs, codigo: string): Promise<{ codigo: string; nome: string } | null>;
}

export const METODOS_PORTA_PACS: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'relogio',
  'examesDoDia',
  'examesPorId',
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
