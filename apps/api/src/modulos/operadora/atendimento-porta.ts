// Porta do atendimento ao beneficiário e do portal do prestador da operadora própria (M56, etapa 6, F7): o que a
// tela dos protocolos, a consulta de elegibilidade e o portal leem e gravam, independente de onde:
//   - `banco`: a porta própria sobre o banco do cliente (protocolo_beneficiario e andamento/resposta,
//     conta_portal_prestador, consulta_elegibilidade_recebida), pelo @sgh/nucleo e o Executor;
//   - `memoria`: a sessão sintética de dev/ci (E2E);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Melhoria: o contexto é o do @sgh/nucleo (cliente, estabelecimento e usuário por id) e o estabelecimento de cada
// gravação vem da sessão, nunca da entrada.
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { Prestador } from './rede-porta.js';
import {
  type DadosAcessoPortalParaEntrada,
  type DadosAcessoPortalPrestador,
  type DadosConsultaElegibilidade,
  type DadosConsultaProtocolo,
  type DadosElegibilidadeBeneficiario,
  type DadosEventoProtocolo,
  type DadosItemDominio,
  type DadosOperadora,
  type DadosProtocolo,
  type DadosProtocoloResumo,
  type DadosReanalise,
  type DadosRespostaPrestador,
  type EntradaConsultaElegibilidade,
  type EntradaCriacaoAcessoPortal,
  type EntradaRegistroProtocolo,
  type FiltroProtocolosPorta,
  type TotaisProtocolos,
} from './dados-portas.js';

export const PORTA_ATENDIMENTO_OPERADORA = Symbol('PORTA_ATENDIMENTO_OPERADORA');

/** O contexto da sessão: o do núcleo (ids) mais a rede e o código do estabelecimento (exibição). */
export type ContextoAtendimento = ContextoPorta;

type SemHospital<T> = Omit<T, 'hospital'>;

interface AcaoPorta {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
}
type Feito = Promise<{ id: number; versao: number }>;

/** Os domínios da fatia (lidos inteiros do banco do estabelecimento). */
export interface DominiosAtendimento {
  readonly origem: readonly DadosItemDominio[];
  readonly funcoesPortal: readonly DadosItemDominio[];
  readonly tiposAtendimento: readonly DadosItemDominio[];
}

/** O que a gravação da fatia faz dentro da transação (com a trilha junto). */
export interface GravadorAtendimento {
  proximoProtocolo(): Promise<number>;
  registrar(r: SemHospital<EntradaRegistroProtocolo>): Feito;
  analisar(a: AcaoPorta): Feito;
  interagir(a: AcaoPorta & { situacao: string; texto: string }): Feito;
  prorrogar(a: AcaoPorta & { situacao: string; ate: string; motivo: string }): Feito;
  responder(
    a: AcaoPorta & {
      conclusao: string;
      resposta: string;
      fundamento: string | null;
      meio: string;
      respondidoEm: string;
      escritaPrazoEm: string | null;
    },
  ): Feito;
  pedirEscrita(a: AcaoPorta & { situacao: string; pedidaEm: string; escritaPrazoEm: string | null }): Feito;
  enviarEscrita(a: AcaoPorta & { meio: string }): Feito;
  encerrar(a: AcaoPorta): Feito;
  cancelar(a: AcaoPorta & { motivo: string }): Feito;
  reanalise(
    a: AcaoPorta & { situacao: string; novo: SemHospital<EntradaRegistroProtocolo> },
  ): Promise<{ id: number; versao: number; origem: { id: number; versao: number } }>;
  criarAcesso(c: SemHospital<EntradaCriacaoAcessoPortal>): Feito;
  alterarAcesso(a: AcaoPorta & { funcoes: string; tipoAtendimento: number }): Feito;
  reemitirAcesso(a: AcaoPorta & { ativacaoResumo: string; ativacaoValidade: string }): Feito;
  encerrarAcesso(a: AcaoPorta & { motivo: string }): Feito;
  ativarAcesso(a: {
    id: number;
    ativacaoResumo: string;
    senhaResumo: string;
    segundoFator: string;
    usuario: string;
  }): Promise<{ id: number }>;
  /** A troca da senha ou do segundo fator pelo prestador (W0-10): só a conta ativa, na versão lida. */
  trocarCredencial(a: AcaoPorta & { senhaResumo: string | null; segundoFator: string | null }): Feito;
  /** W0-10: a resposta do prestador a uma interação da operadora no protocolo dele, com um anexo opcional. */
  responderInteracaoPrestador(
    a: AcaoPorta & {
      prestador: number;
      acesso: number;
      interacao: number;
      texto: string;
      anexo: { nome: string; bytes: Uint8Array } | null;
    },
  ): Promise<{ id: number; versao: number; resposta: number; evento: number }>;
  /** W0-10 (M7): o registro da consulta de elegibilidade do prestador (só inclusão). */
  registrarElegibilidade(x: SemHospital<EntradaConsultaElegibilidade>): Promise<{ id: number }>;
  /** A tentativa de entrada, com o contador decidido no banco; `alteradas` 0 = a conta não está mais ativa ou foi bloqueada. */
  tentativaPortal(t: {
    id: number;
    acertou: boolean;
    agora: string;
    limite: number;
    bloqueioAte: string;
  }): Promise<{ id: number; alteradas: number }>;
}

export interface PortaAtendimentoOperadora {
  readonly destino: 'banco' | 'memoria';
  /** O relógio do banco: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoAtendimento): Promise<{ hoje: string; agora: string }>;
  dominios(c: ContextoAtendimento): Promise<DominiosAtendimento>;
  operadoras(c: ContextoAtendimento): Promise<DadosOperadora[]>;
  elegibilidade(c: ContextoAtendimento, carteirinha: string): Promise<DadosElegibilidadeBeneficiario | null>;
  /** W0-10 (M7): a validade da via mais recente da carteirinha e as últimas consultas de elegibilidade do prestador. */
  validadeCarteirinha(c: ContextoAtendimento, beneficiario: number): Promise<string | null>;
  consultasElegibilidade(c: ContextoAtendimento, prestador: number): Promise<DadosConsultaElegibilidade[]>;
  prestador(c: ContextoAtendimento, id: number): Promise<Prestador | null>;
  protocolos(
    c: ContextoAtendimento,
    f: FiltroProtocolosPorta,
  ): Promise<{ itens: DadosProtocoloResumo[]; proxima: number | null }>;
  totais(c: ContextoAtendimento): Promise<TotaisProtocolos>;
  protocolo(c: ContextoAtendimento, id: number): Promise<DadosProtocolo | null>;
  reanalises(c: ContextoAtendimento, id: number): Promise<DadosReanalise[]>;
  eventos(c: ContextoAtendimento, id: number): Promise<DadosEventoProtocolo[]>;
  consulta(
    c: ContextoAtendimento,
    numero: string,
    prestador?: number,
  ): Promise<DadosConsultaProtocolo | null>;
  /** W0-10: as respostas do prestador no protocolo (sem conteúdo) e um anexo com o conteúdo (do prestador, se dado). */
  respostasPrestador(c: ContextoAtendimento, id: number): Promise<DadosRespostaPrestador[]>;
  anexoDaResposta(
    c: ContextoAtendimento,
    resposta: number,
    prestador?: number,
  ): Promise<{ protocolo: number; nome: string; tipo: string; sha256: string; bytes: Buffer } | null>;
  acessos(c: ContextoAtendimento): Promise<DadosAcessoPortalPrestador[]>;
  acesso(c: ContextoAtendimento, id: number): Promise<DadosAcessoPortalPrestador | null>;
  acessoParaEntrada(
    c: ContextoAtendimento,
    chave: { login: string } | { ativacaoResumo: string },
  ): Promise<DadosAcessoPortalParaEntrada | null>;
  gravar<T>(
    c: ContextoAtendimento,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: GravadorAtendimento) => Promise<T>,
  ): Promise<T>;
}

export const METODOS_PORTA_ATENDIMENTO: ReadonlySet<string> = new Set([
  'relogio',
  'dominios',
  'operadoras',
  'elegibilidade',
  'validadeCarteirinha',
  'consultasElegibilidade',
  'prestador',
  'protocolos',
  'totais',
  'protocolo',
  'reanalises',
  'eventos',
  'consulta',
  'respostasPrestador',
  'anexoDaResposta',
  'acessos',
  'acesso',
  'acessoParaEntrada',
  'gravar',
]);
