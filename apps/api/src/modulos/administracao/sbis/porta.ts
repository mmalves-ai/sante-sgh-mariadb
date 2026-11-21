// M59-F5 (ficha do M59, seções 4, 6 e 7): a porta do pacote de evidências SBIS, do termo das concessões e do backup
// verificado. A própria (porta-propria.ts) lê e grava as tabelas do produto no banco do cliente pelo @sgh/nucleo, com a
// trilha na mesma transação do Executor, e lê a identificação do estabelecimento (nome, CNES, CNPJ) e a política de
// senha e sessão; a de memória serve o dev e o CI.
// Melhoria: tipos de negócio do próprio módulo (ciclo, concessão, verificação do dia), sem os tipos de leitura do
// sistema anterior; `faltando` diz, por recurso, as tabelas que faltam no banco do cliente, em vez de bloquear tudo.
import type {
  AvaliarItemPedido,
  CicloSbis,
  CodigoConcessao,
  ItemCicloSbis,
  ParecerSbis,
  RegistrarRestauracaoPedido,
  Restauracao,
} from '@sgh/contratos';
import type { RegistroConcessao, VerificacaoDia } from '@sgh/dominio-acesso';

export const PORTA_SBIS = Symbol('PORTA_SBIS');

/** Um ciclo de avaliação gravado (o resumo dos itens é calculado pelo serviço). */
export type CicloCertificacao = Omit<CicloSbis, 'resumo'>;
/** O registro de uma concessão provisória (o domínio: ausente vale vigente). */
export type ConcessaoRegistrada = RegistroConcessao;
/** A verificação da cadeia da trilha num dia. */
export type VerificacaoDiaTrilha = VerificacaoDia;

/** O que a gravação leva à trilha de auditoria (quem, de onde, o evento e a correlação da requisição). */
export interface TrilhaSbis {
  readonly rede: string;
  readonly hospital: string;
  readonly usuario: string;
  readonly evento: string;
  readonly recurso: string;
  readonly operacao: string;
  readonly resultado: 'sucesso';
  readonly estacao: string | null;
  readonly correlacao: string;
  /** A Idempotency-Key do pedido de gravação (o reenvio do mesmo pedido não grava de novo); null fora do HTTP. */
  readonly chaveIdempotencia?: string | null;
}

/** Os recursos da porta que dependem de tabela própria (cada um falta ou não no banco do cliente). */
export type RecursoSbis = 'ciclos' | 'concessoes' | 'backup';

export interface IdentificacaoEstabelecimento {
  readonly nome: string | null;
  readonly cnes: string | null;
  readonly cnpj: string | null;
}

export interface ConfigSeguranca {
  readonly limiteTentativas: number | null;
  readonly inatividadeSegundos: number | null;
}

export interface NovoCiclo {
  readonly tipo: string;
  readonly competencia: string;
  readonly versao: string;
  readonly referencia: string;
  readonly avaliador: string | null;
  readonly por: string;
  readonly requisitos: readonly string[];
}

export interface PortaSbis {
  readonly destino: 'banco' | 'memoria';
  /** Tabelas do recurso que faltam no banco (vazio: pronto). */
  faltando(h: string, recurso: RecursoSbis): Promise<string[]>;
  concessoes(h: string): Promise<ConcessaoRegistrada[]>;
  encerrar(
    h: string,
    c: { codigo: CodigoConcessao; evidencia: string; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  reabrir(
    h: string,
    c: { codigo: CodigoConcessao; motivo: string; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  prever(
    h: string,
    c: { codigo: CodigoConcessao; fimPrevisto: string | null; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  ciclos(h: string): Promise<CicloCertificacao[]>;
  ciclo(h: string, id: string): Promise<CicloCertificacao | null>;
  itens(h: string, id: string): Promise<ItemCicloSbis[]>;
  abrir(h: string, n: NovoCiclo, t: TrilhaSbis): Promise<{ id: string } | null>;
  avaliar(
    h: string,
    a: { idCiclo: string; requisito: string; por: string; pedido: AvaliarItemPedido },
    t: TrilhaSbis,
  ): Promise<boolean>;
  corrigir(
    h: string,
    a: { idCiclo: string; requisito: string; por: string; descricao: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  verificar(
    h: string,
    a: { idCiclo: string; requisito: string; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  concluir(
    h: string,
    c: { id: string; parecer: ParecerSbis; parecerTexto: string; certificado: string | null; por: string },
    t: TrilhaSbis,
  ): Promise<boolean>;
  cancelar(h: string, c: { id: string; motivo: string; por: string }, t: TrilhaSbis): Promise<boolean>;
  restauracoes(h: string): Promise<Restauracao[]>;
  registrarRestauracao(
    h: string,
    r: { por: string; pedido: RegistrarRestauracaoPedido },
    t: TrilhaSbis,
  ): Promise<{ id: string }>;
  identificacao(h: string): Promise<IdentificacaoEstabelecimento>;
  configSeguranca(h: string): Promise<ConfigSeguranca>;
  verificarDias(h: string, dias: readonly string[]): Promise<VerificacaoDiaTrilha[]>;
}

/** Sem núcleo nem fonte sintética: toda chamada falha (503 no serviço), nunca dado inventado. */
export function portaSbisIndisponivel(): PortaSbis {
  const falha = () => Promise.reject(new Error('banco do cliente indisponível neste servidor'));
  return {
    destino: 'banco',
    faltando: falha,
    concessoes: falha,
    encerrar: falha,
    reabrir: falha,
    prever: falha,
    ciclos: falha,
    ciclo: falha,
    itens: falha,
    abrir: falha,
    avaliar: falha,
    corrigir: falha,
    verificar: falha,
    concluir: falha,
    cancelar: falha,
    restauracoes: falha,
    registrarRestauracao: falha,
    identificacao: falha,
    configSeguranca: falha,
    verificarDias: falha,
  };
}
