// Porta da comunicação interna do M27 (mensagens, comunicados, central de avisos, mensagens anteriores e o dicionário
// pessoal): o que as telas leem e gravam, independente de onde (a API não escreve SQL fora das portas):
//   - `banco`: a porta própria sobre o banco do cliente (comunicacao-porta-propria.ts), pelo @sgh/nucleo; as gravações
//     numa operação do Executor (trilha, outbox e idempotência na mesma transação; o texto nunca vai à trilha);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas validações e recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: o contexto é o do núcleo (cliente, estabelecimento, usuário e correlação por id) mais o código do
// estabelecimento (a chave do canal de avisos); os tipos são os do contrato das telas, sem tipos do sistema de origem.
import type {
  Aviso,
  ComunicadoDetalhe,
  MensagemAnterior,
  MensagemEnviada,
  MensagemRecebida,
  NovoAviso,
  TipoDestinoMensagem,
} from '@sgh/contratos';
import type { ContextoNucleo, ContextoOperacao } from '@sgh/nucleo';
import { createHash } from 'node:crypto';
import { portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';

export const PORTA_COMUNICACAO = Symbol('PORTA_COMUNICACAO');

/** Item da caixa: mensagem direta ou comunicado. */
export type TipoItemCaixa = 'mensagem' | 'comunicado';

/** Contexto da porta: o do núcleo (ids) mais a rede e o código do estabelecimento da sessão. */
export interface ContextoComunicacao extends ContextoNucleo {
  readonly rede: string;
  readonly hospital: string;
}

/** A gravação de dicionário leva o login (a memória guarda por login; o banco usa o id do contexto). */
export type ContextoOperacaoComunicacao = ContextoOperacao & { readonly login: string };

/** Linha da trilha de uma gravação da comunicação (o instante é o da transação). */
export type TrilhaComunicacao = TrilhaDaGravacao;

/** O comunicado como está gravado (sem a decisão "pode corrigir", que é do serviço). */
export type ComunicadoRegistrado = Omit<ComunicadoDetalhe, 'podeCorrigir'>;

/** O aviso da central com o evento que o gerou (a ciência resolve o aviso pelo objeto: tabela e id). */
export interface AvisoRegistrado extends Aviso {
  readonly evento: string;
}

export interface DestinatarioResolvido {
  readonly login: string;
  /** Por onde chegou: "usuario", "grupo MEDICOS", "setor 3", "unidade 1". */
  readonly via: string;
}

export interface DestinoComunicacao {
  readonly tipo: TipoDestinoMensagem;
  readonly valor: string;
}

/** Liberação da gravação (passo 0 do executor): pode gravar agora, com o código e o motivo. */
export interface LiberacaoComunicacao {
  readonly pode: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

/** Mensagem ou comunicado novo, com os destinatários já expandidos. */
export interface NovaMensagem {
  readonly tipo: 'mensagem' | 'comunicado';
  readonly remetente: string;
  readonly assunto: string;
  readonly texto: string;
  readonly cienciaObrigatoria: boolean;
  readonly atendimento: number | null;
  /** Instantes ISO (comunicado); nulos na mensagem. */
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  /** Resumo dos destinos escolhidos ("grupo MEDICOS; usuario X"). */
  readonly destinos: string;
  readonly idempotencia: string;
  readonly destinatarios: readonly DestinatarioResolvido[];
}

/** Gravações da comunicação, numa transação com a trilha (o estabelecimento vem do contexto). */
export interface GravadorComunicacao {
  gravarMensagem(m: NovaMensagem): Promise<{ id: number; repetida: boolean }>;
  /** `tipo`: mensagem direta ou comunicado (ids de tabelas diferentes; sem ele, a mensagem direta tem preferência). */
  marcarLida(r: { login: string; id: number; tipo?: TipoItemCaixa }): Promise<boolean>;
  registrarCiencia(r: { login: string; id: number; tipo?: TipoItemCaixa }): Promise<boolean>;
  gravarAviso(a: NovoAviso): Promise<number | null>;
  mudarEstadoAviso(r: { login: string; id: number; estado: 'lido' | 'resolvido' }): Promise<boolean>;
  /**
   * Resolve os avisos não resolvidos do usuário sobre um objeto (tabela e id): a ciência da mensagem resolve só o
   * aviso daquela mensagem, nunca o de um comunicado com o mesmo número. Devolve quantos resolveu.
   */
  resolverAvisosDoObjeto(r: { login: string; tabela: string; id: number }): Promise<number>;
  /** W0-09: corrige o texto ainda não lido (lido: recusa 409); o anterior vai ao evento do comunicado. */
  corrigirComunicado(r: {
    id: number;
    assunto: string;
    texto: string;
    motivo: string;
    por: string;
  }): Promise<void>;
  /** W0-09: encurta a vigência (nunca estende). */
  encurtarVigencia(r: { id: number; vigenciaFim: string; motivo: string; por: string }): Promise<void>;
  /** W0-09: encerra com o motivo (o comunicado e as ciências continuam visíveis). */
  encerrarComunicado(r: { id: number; motivo: string; por: string }): Promise<void>;
}

export interface PortaComunicacao {
  readonly destino: 'banco' | 'memoria';
  recebidas(c: ContextoComunicacao, login: string): Promise<MensagemRecebida[]>;
  recebida(
    c: ContextoComunicacao,
    login: string,
    id: number,
    tipo?: TipoItemCaixa,
  ): Promise<MensagemRecebida | null>;
  enviadas(c: ContextoComunicacao, login: string): Promise<MensagemEnviada[]>;
  anteriores(c: ContextoComunicacao, login: string): Promise<MensagemAnterior[]>;
  dicionario(c: ContextoComunicacao, login: string): Promise<{ palavra: string; fonetica: string }[]>;
  avisos(c: ContextoComunicacao, login: string): Promise<AvisoRegistrado[]>;
  /** W0-09: o comunicado por inteiro (texto, vigência, destinatários com a ciência e os eventos). */
  comunicado(c: ContextoComunicacao, id: number): Promise<ComunicadoRegistrado | null>;
  /** O atendimento de contexto existe neste estabelecimento? (só o paciente dele, para conferir a autorização). */
  atendimentoDoContexto(c: ContextoComunicacao, atendimento: number): Promise<{ paciente: number } | null>;
  destinatarios(
    c: ContextoComunicacao,
    destinos: readonly DestinoComunicacao[],
    teto: number,
  ): Promise<{ destinatarios: DestinatarioResolvido[]; desconhecidos: string[]; passou: boolean }>;
  podeGravar(c: ContextoComunicacao, operacao: string, login: string): Promise<LiberacaoComunicacao>;
  executar(
    c: ContextoComunicacao,
    operacao: string,
    entrada: unknown,
    octx: ContextoOperacaoComunicacao,
  ): Promise<{ resultado: Record<string, unknown>; repetida: boolean }>;
  /**
   * Grava numa transação com a linha da trilha. `chave`: a Idempotency-Key do pedido (o reenvio devolve o resultado
   * da primeira gravação, sem gravar de novo); sem ela, cada chamada é uma gravação.
   */
  gravarSgh<T>(
    c: ContextoComunicacao,
    trilha: TrilhaComunicacao | ((r: T) => TrilhaComunicacao),
    fn: (g: GravadorComunicacao) => Promise<T>,
    pedido?: PedidoGravacao,
  ): Promise<T>;
}

/**
 * O pedido de uma gravação da comunicação: a operação (nome próprio por ação, para a liberação e a idempotência), a
 * Idempotency-Key e o resumo do conteúdo (hash do assunto, texto, destinos e vigência; nunca o texto). O mesmo pedido
 * com outro conteúdo é recusado (idempotência divergente) em vez de devolver a gravação antiga.
 */
export interface PedidoGravacao {
  readonly operacao: string;
  readonly chave?: string;
  readonly resumo?: string;
}

export const METODOS_PORTA_COMUNICACAO: ReadonlySet<string> = new Set([
  'recebidas',
  'recebida',
  'enviadas',
  'anteriores',
  'dicionario',
  'avisos',
  'comunicado',
  'atendimentoDoContexto',
  'destinatarios',
  'podeGravar',
  'executar',
  'gravarSgh',
]);

export function portaComunicacaoIndisponivel(): PortaComunicacao {
  return portaIndisponivel<PortaComunicacao>(METODOS_PORTA_COMUNICACAO);
}

/**
 * O que a trilha guarda da versão anterior do comunicado corrigido: o tamanho e um resumo (sha256) do assunto e do
 * texto, nunca o conteúdo (a trilha é imutável e o texto corrigido pode ter sido justamente um dado indevido). A
 * versão anterior por inteiro depende da tabela comunicado_versao (pedido de DDL do lote 02-01).
 */
export function descricaoVersaoAnterior(assunto: string, texto: string): string {
  const resumo = createHash('sha256').update(JSON.stringify({ assunto, texto })).digest('hex').slice(0, 16);
  return `versão anterior: assunto com ${assunto.length} caracteres, texto com ${texto.length} caracteres (resumo ${resumo})`;
}
