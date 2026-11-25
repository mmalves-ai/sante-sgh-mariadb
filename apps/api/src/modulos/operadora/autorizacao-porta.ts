// Porta da autorização prévia da operadora própria (M56, etapa 4, F4): o que a tela dos pedidos e dos auditores lê e
// grava, independente de onde:
//   - `banco`: a porta própria sobre o banco do cliente (pedido_autorizacao_plano e itens, histórico e anexos,
//     auditor_plano), pelo @sgh/nucleo e o Executor;
//   - `memoria`: a sessão sintética de dev/ci (E2E);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: o contexto é o do @sgh/nucleo (cliente, estabelecimento e usuário por id) e o estabelecimento de cada
// gravação vem da sessão, nunca da entrada.
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { Prestador } from './rede-porta.js';
import {
  type DadosAnexoComplemento,
  type DadosAuditor,
  type DadosAutorizacao,
  type DadosAutorizacaoResumo,
  type DadosElegibilidadeBeneficiario,
  type DadosEventoAutorizacao,
  type DadosItemAutorizacao,
  type DadosItemDominioAutorizacao,
  type DadosOperadora,
  type DadosPrestadorParaAutorizacao,
  type DadosProcedimentoTuss,
  type DadosRegrasRol,
  type DominioAutorizacao,
  type EntradaDecisao,
  type EntradaDesignacao,
  type EntradaRegistroAutorizacao,
  type FiltroAutorizacoesPorta,
  type TotaisAutorizacoes,
} from './dados-portas.js';

export const PORTA_AUTORIZACAO_OPERADORA = Symbol('PORTA_AUTORIZACAO_OPERADORA');

/** O contexto da sessão: o do núcleo (ids) mais a rede e o código do estabelecimento (exibição). */
export type ContextoAutorizacao = ContextoPorta;

type SemHospital<T> = Omit<T, 'hospital'>;

interface AcaoPorta {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
}

/** O que a gravação da autorização faz dentro da transação (com a trilha junto). */
export interface GravadorAutorizacao {
  proximoProtocolo(): Promise<number>;
  proximaSenha(): Promise<number>;
  registrar(r: SemHospital<EntradaRegistroAutorizacao>): Promise<{ id: number; versao: number }>;
  pedirComplemento(a: AcaoPorta & { pedido: string }): Promise<{ id: number; versao: number }>;
  responderComplemento(a: AcaoPorta & { resposta: string }): Promise<{ id: number; versao: number }>;
  /** W0-10: a resposta do prestador pelo portal, com anexos (pedido_autorizacao_plano_anexo), só a autorização dele. */
  responderComplementoPortal(
    a: AcaoPorta & {
      prestador: number;
      acesso: number;
      resposta: string;
      anexos: readonly { nome: string; bytes: Uint8Array }[];
    },
  ): Promise<{ id: number; versao: number; evento: number; anexos: number[] }>;
  abrirJunta(
    a: AcaoPorta & {
      divergencia: string;
      desempatador: { nome: string; crm: string; uf: string };
      notificadosEm: string;
    },
  ): Promise<{ id: number; versao: number }>;
  decidir(d: SemHospital<EntradaDecisao>): Promise<{ id: number; versao: number }>;
  cancelar(a: AcaoPorta & { motivo: string }): Promise<{ id: number; versao: number }>;
  designar(d: SemHospital<EntradaDesignacao>): Promise<{ id: number }>;
  /** W0-10: com pedidos em análise do auditor, só com `redistribuirPara` (senão 409 auditor-com-autorizacoes). */
  encerrar(
    a: AcaoPorta & { motivo: string; redistribuirPara?: number | null },
  ): Promise<{ id: number; redistribuidos: number }>;
  /** W0-10: os dados da designação ativa, sobre a versão vista. Devolve o nome do cadastro do profissional. */
  alterar(
    a: AcaoPorta & {
      categoria: 'medico' | 'enfermeiro';
      conselho: string;
      numero: string;
      uf: string;
      motivo: string;
    },
  ): Promise<{ id: number; versao: number; nome: string }>;
}

export interface PortaAutorizacaoOperadora {
  readonly destino: 'banco' | 'memoria';
  /** O relógio do banco: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoAutorizacao): Promise<{ hoje: string; agora: string }>;
  dominios(c: ContextoAutorizacao): Promise<Record<DominioAutorizacao, DadosItemDominioAutorizacao[]>>;
  operadoras(c: ContextoAutorizacao): Promise<DadosOperadora[]>;
  prestadores(c: ContextoAutorizacao): Promise<DadosPrestadorParaAutorizacao[]>;
  prestador(c: ContextoAutorizacao, id: number): Promise<Prestador | null>;
  elegibilidade(c: ContextoAutorizacao, carteirinha: string): Promise<DadosElegibilidadeBeneficiario | null>;
  procedimentosTuss(c: ContextoAutorizacao, codigos: readonly string[]): Promise<DadosProcedimentoTuss[]>;
  buscarTuss(c: ContextoAutorizacao, termo: string): Promise<DadosProcedimentoTuss[]>;
  nomeDoCid(c: ContextoAutorizacao, codigo: string): Promise<string | null>;
  /** C2-122: as regras de cobertura do rol vigentes da operadora para os procedimentos, com o sexo e o nascimento. */
  regrasDoRol(
    c: ContextoAutorizacao,
    operadora: number,
    beneficiario: number,
    codigos: readonly string[],
  ): Promise<DadosRegrasRol>;
  autorizacoes(
    c: ContextoAutorizacao,
    f: FiltroAutorizacoesPorta,
  ): Promise<{ itens: DadosAutorizacaoResumo[]; proxima: number | null }>;
  totais(c: ContextoAutorizacao): Promise<TotaisAutorizacoes>;
  autorizacao(c: ContextoAutorizacao, id: number): Promise<DadosAutorizacao | null>;
  itens(c: ContextoAutorizacao, id: number): Promise<DadosItemAutorizacao[]>;
  eventos(c: ContextoAutorizacao, id: number): Promise<DadosEventoAutorizacao[]>;
  /** W0-10: os anexos das respostas ao complemento (sem o conteúdo) e um anexo com o conteúdo (do prestador, se dado). */
  anexosDoComplemento(c: ContextoAutorizacao, id: number): Promise<DadosAnexoComplemento[]>;
  anexoDoComplemento(
    c: ContextoAutorizacao,
    anexo: number,
    prestador?: number,
  ): Promise<{ autorizacao: number; nome: string; tipo: string; sha256: string; bytes: Buffer } | null>;
  auditores(c: ContextoAutorizacao): Promise<DadosAuditor[]>;
  auditor(c: ContextoAutorizacao, id: number): Promise<DadosAuditor | null>;
  designacoes(c: ContextoAutorizacao, login: string): Promise<DadosAuditor[]>;
  gravar<T>(
    c: ContextoAutorizacao,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorAutorizacao) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_AUTORIZACAO: ReadonlySet<string> = new Set([
  'relogio',
  'dominios',
  'operadoras',
  'prestadores',
  'prestador',
  'elegibilidade',
  'procedimentosTuss',
  'buscarTuss',
  'nomeDoCid',
  'regrasDoRol',
  'autorizacoes',
  'totais',
  'autorizacao',
  'itens',
  'eventos',
  'anexosDoComplemento',
  'anexoDoComplemento',
  'auditores',
  'auditor',
  'designacoes',
  'gravar',
]);
