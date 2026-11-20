// Porta do atendimento ao beneficiário com protocolo e das contas do portal do prestador da operadora própria (M56,
// etapa 8, F7): o que a tela dos protocolos, a das contas do portal e o próprio portal leem e gravam, independente de
// onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras de @sgh/legado em transação READ ONLY (os protocolos e as contas em SGH_OPE_*, o beneficiário
//     pela carteirinha, os prestadores da rede, os domínios SPORIGEM_ATEND, PFPORTALOPCAO e PFTPATEND do banco do
//     estabelecimento) e as gravações SGH_OPE_PROTOCOLO, _EVT e SGH_OPE_PORTAL_ACESSO numa transação SGH_ com a
//     SGH_TRILHA junto; em dev sobre a cópia compartilhada, as gravações são recusadas (`sghSoLeitura`);
//   - `memoria`: a sessão sintética de dev/ci (E2E), sobre as portas em memória da F1 (beneficiários) e da F3 (rede),
//     com os domínios do vocabulário; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// O pedido de autorização (ligado ao protocolo, e o do portal) é lido e gravado pela porta da F4. Nenhuma tabela legada
// é escrita (seção 5 da ficha); os domínios são só lidos.
import type {
  AcessoPortalParaEntradaLido,
  AcessoPortalPrestadorLido,
  ConsultaElegibilidadeLida,
  ConsultaElegibilidadeSgh,
  ConsultaProtocoloLida,
  CriacaoAcessoPortalSgh,
  ElegibilidadeOpeLida,
  EventoProtocoloSghLido,
  FiltroProtocolosLido,
  ItemDominioLido,
  LinhaTrilha,
  OperadoraOpeLida,
  PrestadorLido,
  ProtocoloOpeLido,
  ProtocoloOpeResumoLido,
  ReanaliseLida,
  RegistroProtocoloSgh,
  RespostaPrestadorLida,
  TotaisProtocolosLidos,
} from '@sgh/legado';

export const PORTA_ATENDIMENTO_OPERADORA = Symbol('PORTA_ATENDIMENTO_OPERADORA');

export interface ContextoAtendimento {
  readonly rede: string;
  readonly hospital: string;
}

type SemHospital<T> = Omit<T, 'hospital'>;

interface AcaoSgh {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
}
type Feito = Promise<{ id: number; versao: number }>;

/** Os domínios da fatia (lidos inteiros do banco do estabelecimento). */
export interface DominiosAtendimento {
  readonly origem: readonly ItemDominioLido[];
  readonly funcoesPortal: readonly ItemDominioLido[];
  readonly tiposAtendimento: readonly ItemDominioLido[];
}

/** O que a gravação SGH_ da fatia faz dentro da transação (com a trilha junto). */
export interface GravadorAtendimento {
  proximoProtocolo(): Promise<number>;
  registrar(r: SemHospital<RegistroProtocoloSgh>): Feito;
  analisar(a: AcaoSgh): Feito;
  interagir(a: AcaoSgh & { situacao: string; texto: string }): Feito;
  prorrogar(a: AcaoSgh & { situacao: string; ate: string; motivo: string }): Feito;
  responder(
    a: AcaoSgh & {
      conclusao: string;
      resposta: string;
      fundamento: string | null;
      meio: string;
      respondidoEm: string;
      escritaPrazoEm: string | null;
    },
  ): Feito;
  pedirEscrita(a: AcaoSgh & { situacao: string; pedidaEm: string; escritaPrazoEm: string | null }): Feito;
  enviarEscrita(a: AcaoSgh & { meio: string }): Feito;
  encerrar(a: AcaoSgh): Feito;
  cancelar(a: AcaoSgh & { motivo: string }): Feito;
  reanalise(
    a: AcaoSgh & { situacao: string; novo: SemHospital<RegistroProtocoloSgh> },
  ): Promise<{ id: number; versao: number; origem: { id: number; versao: number } }>;
  criarAcesso(c: SemHospital<CriacaoAcessoPortalSgh>): Feito;
  alterarAcesso(a: AcaoSgh & { funcoes: string; tipoAtendimento: number }): Feito;
  reemitirAcesso(a: AcaoSgh & { ativacaoResumo: string; ativacaoValidade: string }): Feito;
  encerrarAcesso(a: AcaoSgh & { motivo: string }): Feito;
  ativarAcesso(a: {
    id: number;
    ativacaoResumo: string;
    senhaResumo: string;
    segundoFator: string;
    usuario: string;
  }): Promise<{ id: number }>;
  /** A troca da senha ou do segundo fator pelo prestador (W0-10): só a conta ativa, na versão lida. */
  trocarCredencial(a: AcaoSgh & { senhaResumo: string | null; segundoFator: string | null }): Feito;
  /** W0-10: a resposta do prestador a uma interação da operadora no protocolo dele, com um anexo opcional. */
  responderInteracaoPrestador(
    a: AcaoSgh & {
      prestador: number;
      acesso: number;
      interacao: number;
      texto: string;
      anexo: { nome: string; bytes: Uint8Array } | null;
    },
  ): Promise<{ id: number; versao: number; resposta: number; evento: number }>;
  /** W0-10 (M7): o registro da consulta de elegibilidade do prestador (só inclusão). */
  registrarElegibilidade(x: SemHospital<ConsultaElegibilidadeSgh>): Promise<{ id: number }>;
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
  readonly destino: 'legado' | 'memoria';
  /** O relógio do banco: hoje (AAAA-MM-DD) e agora (AAAA-MM-DDTHH:MM:SS). */
  relogio(c: ContextoAtendimento): Promise<{ hoje: string; agora: string }>;
  dominios(c: ContextoAtendimento): Promise<DominiosAtendimento>;
  operadoras(c: ContextoAtendimento): Promise<OperadoraOpeLida[]>;
  elegibilidade(c: ContextoAtendimento, carteirinha: string): Promise<ElegibilidadeOpeLida | null>;
  /** W0-10 (M7): a validade da via mais recente da carteirinha e as últimas consultas de elegibilidade do prestador. */
  validadeCarteirinha(c: ContextoAtendimento, beneficiario: number): Promise<string | null>;
  consultasElegibilidade(c: ContextoAtendimento, prestador: number): Promise<ConsultaElegibilidadeLida[]>;
  prestador(c: ContextoAtendimento, id: number): Promise<PrestadorLido | null>;
  protocolos(
    c: ContextoAtendimento,
    f: FiltroProtocolosLido,
  ): Promise<{ itens: ProtocoloOpeResumoLido[]; proxima: number | null }>;
  totais(c: ContextoAtendimento): Promise<TotaisProtocolosLidos>;
  protocolo(c: ContextoAtendimento, id: number): Promise<ProtocoloOpeLido | null>;
  reanalises(c: ContextoAtendimento, id: number): Promise<ReanaliseLida[]>;
  eventos(c: ContextoAtendimento, id: number): Promise<EventoProtocoloSghLido[]>;
  consulta(c: ContextoAtendimento, numero: string, prestador?: number): Promise<ConsultaProtocoloLida | null>;
  /** W0-10: as respostas do prestador no protocolo (sem conteúdo) e um anexo com o conteúdo (do prestador, se dado). */
  respostasPrestador(c: ContextoAtendimento, id: number): Promise<RespostaPrestadorLida[]>;
  anexoDaResposta(
    c: ContextoAtendimento,
    resposta: number,
    prestador?: number,
  ): Promise<{ protocolo: number; nome: string; tipo: string; sha256: string; bytes: Buffer } | null>;
  acessos(c: ContextoAtendimento): Promise<AcessoPortalPrestadorLido[]>;
  acesso(c: ContextoAtendimento, id: number): Promise<AcessoPortalPrestadorLido | null>;
  acessoParaEntrada(
    c: ContextoAtendimento,
    chave: { login: string } | { ativacaoResumo: string },
  ): Promise<AcessoPortalParaEntradaLido | null>;
  gravarSgh<T>(
    c: ContextoAtendimento,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
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
  'gravarSgh',
]);
