// Porta das contas médicas recebidas dos prestadores (M56, etapa 5, F5): o que a tela das contas lê e grava,
// independente de onde:
//   - `banco`: a porta própria sobre o banco do cliente (lote_conta_recebida, guia_conta_recebida e itens,
//     glosa_conta_recebida, recurso_glosa_recebido), pelo @sgh/nucleo e o Executor;
//   - `memoria`: a sessão sintética de dev/ci (E2E);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: o contexto é o do @sgh/nucleo (cliente, estabelecimento e usuário por id) e o estabelecimento de cada
// gravação vem da sessão, nunca da entrada.
import type { MotivoGlosaLido } from '@sgh/contratos';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { Prestador } from './rede-porta.js';
import {
  type DadosAuditor,
  type DadosAutorizacaoDaSenha,
  type DadosConta,
  type DadosContaResumo,
  type DadosElegibilidadeBeneficiario,
  type DadosEventoConta,
  type DadosGuiaConta,
  type DadosItemConta,
  type DadosOperadora,
  type DadosRecursoItem,
  type DecisaoRecursoItem,
  type EntradaDecisaoItem,
  type EntradaGlosaItem,
  type EntradaItemRecorrido,
  type EntradaRecebimentoConta,
  type FiltroContasPorta,
  type FiltroPagamentosPorta,
  type TotaisContas,
} from './dados-portas.js';

export const PORTA_CONTAS_OPERADORA = Symbol('PORTA_CONTAS_OPERADORA');

/** O contexto da sessão: o do núcleo (ids) mais a rede e o código do estabelecimento (exibição). */
export type ContextoContas = ContextoPorta;

type SemHospital<T> = Omit<T, 'hospital'>;

interface AcaoPorta {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
}

type Feito = Promise<{ id: number; versao: number }>;

/** C2-074: o arquivo do lote enviado pelo portal do prestador (arquivo_enviado_prestador), ligado ao lote gerado. */
export interface ArquivoEnviadoPortal {
  readonly prestador: number;
  /** A conta do portal que enviou. */
  readonly contaPortal: number;
  /** O binário na porta de arquivos (disco local, ADR 0004). */
  readonly arquivo: number;
  readonly nome: string;
  readonly sha256: string;
  readonly versaoPadrao: string | null;
  readonly guias: number;
  readonly valor: number;
  /** O lote gerado (lote_conta_recebida). */
  readonly lote: number;
}

/** O que a gravação das contas faz dentro da transação (com a trilha junto). */
export interface GravadorContas {
  proximoProtocolo(): Promise<number>;
  receber(r: SemHospital<EntradaRecebimentoConta>): Feito;
  /** C2-074: o registro do arquivo enviado pelo portal, na mesma transação do lote. */
  registrarArquivoEnviado(a: ArquivoEnviadoPortal): Feito;
  glosar(a: AcaoPorta & { itens: readonly EntradaGlosaItem[]; texto: string; desfeita: boolean }): Feito;
  concluir(
    a: AcaoPorta & {
      auditor: number;
      situacao: 'analisada' | 'paga';
      observacao: string | null;
      texto: string;
    },
  ): Feito;
  devolver(a: AcaoPorta & { motivo: string }): Feito;
  registrarRecurso(
    a: AcaoPorta & { guia: number; valor: number; justificativa: string; situacao: 'analisada' | 'paga' },
  ): Feito;
  decidirRecurso(
    a: AcaoPorta & {
      guia: number;
      valorAcatado: number;
      situacaoRecurso: 'acatado' | 'parcial' | 'mantido';
      parecer: string;
      situacao: 'analisada' | 'paga';
    },
  ): Feito;
  pagar(
    a: AcaoPorta & { valor: number; data: string; documento: string; situacao: 'analisada' | 'paga' },
  ): Feito;
  /** W0-10 (M8): o recurso por item do prestador pelo portal (a guia recebe a soma; uma linha por item). */
  registrarRecursoItens(
    a: AcaoPorta & {
      guia: number;
      itens: readonly EntradaItemRecorrido[];
      justificativa: string;
      situacao: 'analisada' | 'paga';
      acesso: number;
    },
  ): Promise<{ id: number; versao: number; recursos: number[] }>;
  /** W0-10 (M8): a decisão do recurso por item (todos os itens de uma vez; a guia pela soma; outra pessoa). */
  decidirRecursoItens(
    a: AcaoPorta & {
      guia: number;
      decisoes: readonly EntradaDecisaoItem[];
      parecer: string;
      situacao: 'analisada' | 'paga';
    },
  ): Promise<{ id: number; versao: number; decisao: DecisaoRecursoItem; valorAcatado: number }>;
}

export interface PortaContasOperadora {
  readonly destino: 'banco' | 'memoria';
  /** O relógio do banco: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoContas): Promise<{ hoje: string; agora: string }>;
  operadoras(c: ContextoContas): Promise<DadosOperadora[]>;
  /** Os prestadores da rede (o filtro da lista e o seletor). */
  prestadores(c: ContextoContas): Promise<{ id: number; nome: string }[]>;
  prestadorPorDocumento(c: ContextoContas, documento: string): Promise<Prestador | null>;
  elegibilidade(c: ContextoContas, carteirinha: string): Promise<DadosElegibilidadeBeneficiario | null>;
  autorizacoesPorSenha(c: ContextoContas, senhas: readonly string[]): Promise<DadosAutorizacaoDaSenha[]>;
  guiasJaApresentadas(c: ContextoContas, prestador: number, numeros: readonly string[]): Promise<Set<string>>;
  loteJaRecebido(
    c: ContextoContas,
    x: { operadora: number; prestador: number; numeroLote: string; sha256: string },
  ): Promise<boolean>;
  motivos(c: ContextoContas): Promise<MotivoGlosaLido[]>;
  designacoes(c: ContextoContas, login: string): Promise<DadosAuditor[]>;
  contas(
    c: ContextoContas,
    f: FiltroContasPorta,
  ): Promise<{ itens: DadosContaResumo[]; proxima: number | null }>;
  totais(c: ContextoContas): Promise<TotaisContas>;
  conta(c: ContextoContas, id: number): Promise<DadosConta | null>;
  guias(c: ContextoContas, id: number): Promise<DadosGuiaConta[]>;
  itens(c: ContextoContas, id: number): Promise<DadosItemConta[]>;
  eventos(c: ContextoContas, id: number): Promise<DadosEventoConta[]>;
  /** W0-10 (M8): os recursos por item do lote, com a decisão de cada um. */
  recursosItens(c: ContextoContas, id: number): Promise<DadosRecursoItem[]>;
  pagamentos(
    c: ContextoContas,
    f: FiltroPagamentosPorta,
  ): Promise<{ itens: DadosContaResumo[]; proxima: number | null }>;
  /** C2-074: guarda o XML do lote na porta de arquivos antes da transação (sem armazenamento: 503). */
  guardarArquivoLote(
    c: ContextoContas,
    e: { conteudo: Uint8Array; nome: string },
  ): Promise<{ id: number; reaproveitado: boolean }>;
  /** C2-074: remove o arquivo novo que ficou sem dono (a transação do lote falhou). */
  descartarArquivoLote(c: ContextoContas, id: number): Promise<void>;
  /** C2-074: a guarda legal do XML (5 anos) depois do COMMIT do lote (antes dele, o arquivo ainda pode ser descartado). */
  fixarGuardaArquivoLote(c: ContextoContas, id: number): Promise<void>;
  gravar<T>(
    c: ContextoContas,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorContas) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_CONTAS: ReadonlySet<string> = new Set([
  'relogio',
  'operadoras',
  'prestadores',
  'prestadorPorDocumento',
  'elegibilidade',
  'autorizacoesPorSenha',
  'guiasJaApresentadas',
  'loteJaRecebido',
  'motivos',
  'designacoes',
  'contas',
  'totais',
  'conta',
  'guias',
  'itens',
  'eventos',
  'recursosItens',
  'pagamentos',
  'guardarArquivoLote',
  'descartarArquivoLote',
  'fixarGuardaArquivoLote',
  'gravar',
]);
