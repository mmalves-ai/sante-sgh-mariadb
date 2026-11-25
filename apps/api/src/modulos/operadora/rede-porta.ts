// Porta da rede credenciada da operadora própria (M56, etapa 4, F3): o que a tela da rede lê e grava, independente de
// onde (a API não escreve SQL; fronteira Nx):
//   - `banco`: a porta própria sobre o banco do cliente (rede-porta-propria.ts): prestador_rede, o contrato escrito
//     (contrato_rede_prestador), o histórico (prestador_rede_historico) e os movimentos do registro de prestadores da
//     ANS (movimento_rede_ans), gravados pelo Executor do @sgh/nucleo com a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com prestadores e convênios SINTÉTICOS;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Os tipos são de negócio: os códigos numéricos são os do vocabulário do contrato (@sgh/contratos, operadora/rede.ts e
// vocabulario.ts); datas AAAA-MM-DD; nenhuma sentinela.
import type { TipoMotivoDescredenciamento } from '@sgh/contratos';
import type { PeriodoSuspensao } from '@sgh/dominio-operadora';
import type { ContextoNucleo } from '@sgh/nucleo';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { portaIndisponivel } from '../exames/public-api.js';

export const PORTA_REDE_OPERADORA = Symbol('PORTA_REDE_OPERADORA');

/** O contexto da sessão (cliente, estabelecimento e usuário por id) com a rede e o código do estabelecimento. */
export interface ContextoRede extends ContextoNucleo {
  readonly rede: string;
  readonly hospital: string;
}

/** Os domínios da rede que a tela de credenciamento usa (códigos do contrato). */
export const DOMINIOS_REDE = [
  'tipo',
  'natureza',
  'classificacao',
  'contratacao',
  'disponibilidade',
  'isencaoOnus',
  'regime',
  'remuneracao',
  'formaReajuste',
  'movimento',
] as const;
export type DominioRede = (typeof DOMINIOS_REDE)[number];

export interface ItemDominioRede {
  readonly codigo: number;
  readonly rotulo: string;
}

/** Convênio (fonte pagadora) que pode representar a operadora no faturamento do estabelecimento próprio. */
export interface ConvenioRede {
  readonly codigo: number;
  readonly nome: string;
  readonly registroAns: number | null;
}

/** Contrato escrito com o prestador (Lei 13.003/2014). */
export interface ContratoPrestador {
  readonly numero: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly formaReajuste: number;
  readonly mesReajuste: number;
}

/** O que o credenciamento e a alteração gravam (o documento e a pessoa não mudam depois de credenciado). */
export interface CamposPrestador {
  readonly nome: string;
  readonly nomeFantasia: string | null;
  readonly cnes: string | null;
  readonly uf: string;
  readonly municipioIbge: number;
  readonly tipo: number;
  readonly natureza: number;
  readonly classificacao: number;
  readonly contratacao: number;
  readonly operadoraIntermediaria: string | null;
  readonly disponibilidade: number;
  readonly isencaoOnus: number;
  readonly urgencia: boolean;
  readonly regime: number;
  readonly remuneracao: number;
  readonly contrato: ContratoPrestador;
  readonly ehOHospital: boolean;
  readonly estabelecimento: string | null;
  readonly convenio: number | null;
}

/** O prestador lido, com a situação VIGENTE (a saída agendada conta como credenciado até a data efetiva). */
export interface Prestador extends CamposPrestador {
  readonly id: number;
  readonly pessoa: 'F' | 'J';
  readonly documento: string;
  readonly situacao: 'credenciado' | 'descredenciado';
  readonly situacaoEm: string;
  readonly saidaEm: string | null;
  readonly motivoSituacao: string | null;
  readonly substituto: number | null;
  readonly avisoBeneficiariosEm: string | null;
  readonly autorizacaoAns: string | null;
  /** C2-118: as suspensões não canceladas do prestador inteiro (a porta em memória não as tem). */
  readonly suspensoes?: readonly PeriodoSuspensao[];
  readonly versao: number;
  readonly criadoEm: string;
  readonly criadoPor: string;
  readonly alteradoEm: string;
  readonly alteradoPor: string;
}

export const LIMITE_PAGINA_PRESTADORES = 50;
export const LIMITE_PAGINA_MOVIMENTOS = 100;

/** Nome para busca e ordem: maiúsculas, sem acento, espaços simples (a mesma regra na memória e no banco). */
export function nomeBuscaPrestador(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 120);
}

export interface FiltroPrestadores {
  readonly busca?: string;
  readonly situacao?: 'credenciado' | 'descredenciado';
  readonly tipo?: number;
  readonly apos?: { readonly nome: string; readonly id: number };
  readonly limite?: number;
}

export interface TotaisRede {
  readonly credenciados: number;
  readonly descredenciados: number;
  readonly hospitalares: number;
  readonly saidasAgendadas: number;
  readonly rpsPendentes: number;
}

/** Movimento da rede que vai ao registro de prestadores da ANS. */
export interface MovimentoRede {
  readonly id: number;
  readonly prestador: number;
  readonly prestadorNome: string;
  /** 1 inclusão, 2 alteração, 3 exclusão, 4 reinclusão (MOVIMENTO_RPS do contrato). */
  readonly movimento: number;
  readonly campos: string[];
  readonly motivo: string | null;
  readonly situacao: 'pendente' | 'enviado';
  readonly registradoEm: string;
  readonly registradoPor: string;
}

export interface Credenciamento extends CamposPrestador {
  readonly pessoa: 'F' | 'J';
  /** Só os caracteres do documento (sem pontuação), em maiúsculas. */
  readonly documento: string;
  /** Login de quem grava (a memória mostra; o banco grava o usuário da sessão por id). */
  readonly usuario: string;
}
export interface Alteracao extends CamposPrestador {
  readonly id: number;
  readonly versao: number;
  /** Campos do registro da ANS mudados (vazio: nenhum movimento, só a trilha). */
  readonly camposRps: readonly string[];
  readonly usuario: string;
}
export interface Descredenciamento {
  readonly id: number;
  readonly versao: number;
  readonly motivo: string;
  readonly efetivoEm: string;
  readonly avisoBeneficiariosEm: string;
  readonly substituto: number | null;
  readonly autorizacaoAns: string | null;
  /** O tipo do motivo (C2-118); sem ele, iniciativa da operadora. */
  readonly tipoMotivo?: TipoMotivoDescredenciamento | undefined;
  readonly usuario: string;
}
export interface Reinclusao {
  readonly id: number;
  readonly versao: number;
  readonly motivo: string;
  readonly contrato: ContratoPrestador;
  readonly usuario: string;
}

/** Resultado de cada gravação (plano: vai ao resultado da operação no núcleo). */
export interface GravacaoRede {
  readonly id: number;
  readonly versao: number;
  readonly movimento: number | null;
  readonly [campo: string]: number | string | boolean | null;
}

/** O que a gravação da rede faz dentro da transação (com a trilha junto). */
export interface GravadorRede {
  credenciar(c: Credenciamento): Promise<GravacaoRede & { movimento: number }>;
  alterar(a: Alteracao): Promise<GravacaoRede>;
  descredenciar(d: Descredenciamento): Promise<GravacaoRede & { movimento: number }>;
  reincluir(r: Reinclusao): Promise<GravacaoRede & { movimento: number }>;
}

export interface FiltroMovimentosPorta {
  readonly situacao?: 'pendente' | 'enviado';
  readonly prestador?: number;
  readonly apos?: number;
}

export interface PortaRedeOperadora {
  readonly destino: 'banco' | 'memoria';
  /** A data de hoje no relógio do banco (AAAA-MM-DD). */
  hoje(c: ContextoRede): Promise<string>;
  dominios(c: ContextoRede): Promise<Record<DominioRede, ItemDominioRede[]>>;
  convenios(c: ContextoRede): Promise<ConvenioRede[]>;
  prestadores(
    c: ContextoRede,
    f: FiltroPrestadores,
  ): Promise<{ itens: Prestador[]; proxima: { nome: string; id: number } | null }>;
  prestador(c: ContextoRede, id: number): Promise<Prestador | null>;
  totais(c: ContextoRede): Promise<TotaisRede>;
  movimentos(
    c: ContextoRede,
    f: FiltroMovimentosPorta,
  ): Promise<{ itens: MovimentoRede[]; proxima: number | null }>;
  /** Uma gravação (uma transação) com a linha da trilha da tela; na memória, a trilha é da API. */
  gravar<T extends GravacaoRede>(
    c: ContextoRede,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorRede) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_REDE: ReadonlySet<string> = new Set([
  'hoje',
  'dominios',
  'convenios',
  'prestadores',
  'prestador',
  'totais',
  'movimentos',
  'gravar',
]);

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaRedeOperadoraIndisponivel(): PortaRedeOperadora {
  return portaIndisponivel<PortaRedeOperadora>(METODOS_PORTA_REDE);
}
