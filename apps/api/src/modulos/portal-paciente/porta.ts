// Porta do portal do paciente (M50, etapa 1): o que o serviço lê e grava, independente de onde (a API não escreve SQL;
// fronteira Nx). Implementações:
//   - `banco`: a porta própria sobre o MariaDB do cliente (porta-propria.ts), pelo @sgh/nucleo;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo.
import type {
  AtoCopia,
  AtivacaoPortal,
  CopiaNaFila,
  ConsentimentoPortal,
  ContaPortal,
  DocumentoPortal,
  FiltroFilaVinculosPortal,
  ItemDominioPortal,
  LeituraTitular,
  RegistroTrilhaPortal,
  NovaContaPortal,
  NovaTrocaEmailPortal,
  TrocaEmailPortal,
  NovoVinculoPortal,
  PacientePortal,
  PedidoPortal,
  VinculoPortal,
} from './tipos.js';

import type { ContextoNucleo } from '@sgh/nucleo';

export const PORTA_PORTAL_PACIENTE = Symbol('PORTA_PORTAL_PACIENTE');

/** O contexto do núcleo do estabelecimento do portal (o id resolvido pelo código), para as portas de outros módulos. */
export type ContextoPortalNucleo = ContextoNucleo & { readonly rede: string; readonly hospital: string };

export interface ContextoPortal {
  readonly rede: string;
  readonly hospital: string;
}

export interface ConsentimentoParaGravar {
  readonly idPaciente: number;
  readonly pront: number;
  readonly finalidade: string;
  readonly versao: string;
  readonly situacao: number;
  readonly signatario: number;
  readonly usuario: string;
  readonly conta: number;
  readonly vinculo: number | null;
}

export interface PedidoParaGravar {
  readonly idPaciente: number;
  readonly tipo: string;
  readonly descricao: string | null;
  readonly por: string;
  readonly prazoDias: number;
  readonly conta: number;
  /** D-IDENT-50: a conta ativa com segundo fator já é a identidade verificada. */
  readonly identidadeVerificada: boolean;
}

type TrilhaPedidoPortal = Omit<RegistroTrilhaPortal, 'tabelaAlvo' | 'idAlvo' | 'chaveNaturalAlvo'>;

/** W0-10 (M2): o pedido de acesso aberto como cópia do prontuário (portal ou balcão), com o ato da solicitação. */
export interface CopiaParaGravar {
  readonly idPaciente: number;
  readonly canal: 'portal' | 'balcao';
  /** A conta do portal que pediu (null no balcão). */
  readonly conta: number | null;
  readonly identidadeVerificada: boolean;
  readonly descricao: string | null;
  readonly por: string;
  readonly prazoDias: number;
  readonly solicitante: string;
  readonly vinculo: string | null;
  readonly prova: string | null;
}

/** W0-10 (M2): um ato da cópia sobre o pedido travado (`conferir` é a regra pura: devolve a recusa ou null). */
export interface AtoCopiaParaGravar {
  readonly protocolo: string;
  readonly idPaciente: number | null;
  readonly ato: 'legitimidade' | 'geracao' | 'entrega';
  readonly solicitante?: string;
  readonly vinculo?: string | null;
  readonly prova?: string | null;
  readonly hash?: string;
  readonly paginas?: number;
  readonly meio?: string;
  readonly recebedor?: string | null;
  readonly por: string;
  readonly conferir: (situacao: string, atos: readonly { readonly ato: string }[]) => string | null;
}

/** As gravações (o estabelecimento vem do contexto da transação). */
export interface GravadorPortal {
  criarConta(c: Omit<NovaContaPortal, 'rede' | 'hospital'>): Promise<{ id: number }>;
  reemitirConvite(
    conta: number,
    versao: number,
    c: { conviteResumo: string; conviteValidoAte: Date; origem: string; por: string; refazer: boolean },
  ): Promise<void>;
  registrarErroConvite(conta: number): Promise<void>;
  ativar(conta: number, versao: number, a: AtivacaoPortal): Promise<void>;
  registrarEntrada(
    conta: number,
    r: { acertou: boolean; tentativas: number; bloqueadoAte: Date | null },
  ): Promise<void>;
  trocarSenha(conta: number, versao: number, senhaResumo: string): Promise<void>;
  /** W0-10: o autenticador novo (envelope cifrado), depois do primeiro código conferido. */
  trocarSegundoFator(conta: number, versao: number, envelope: string): Promise<void>;
  /** W0-10: o pedido da troca do e-mail (cancela o pendente anterior da conta). */
  pedirTrocaEmail(t: Omit<NovaTrocaEmailPortal, 'rede'>): Promise<{ id: number }>;
  confirmarTrocaEmail(
    troca: number,
    conta: number,
    versao: number,
    email: { email: string; resumo: string },
  ): Promise<void>;
  cancelarTrocaEmail(troca: number): Promise<void>;
  bloquear(conta: number, versao: number, d: { motivo: string; por: string }): Promise<void>;
  desbloquear(conta: number, versao: number, por: string): Promise<void>;
  encerrar(conta: number, versao: number | null, d: { motivo: string; por: string }): Promise<void>;
  pedirVinculo(v: Omit<NovoVinculoPortal, 'hospital'>): Promise<{ id: number }>;
  decidirVinculo(
    vinculo: number,
    versao: number,
    d:
      | { aprovar: true; escopos: readonly string[]; validade: string | null; por: string }
      | { aprovar: false; motivo: string; por: string },
  ): Promise<void>;
  encerrarVinculo(vinculo: number, versao: number | null, d: { motivo: string; por: string }): Promise<void>;
  /** `portal.registrarConsentimento`: o escritor do M11 e a origem do portal (canal, conta e vínculo). */
  registrarConsentimento(c: ConsentimentoParaGravar): Promise<{ id: number }>;
  revogarConsentimento(r: { idPaciente: number; id: number; motivo: number; usuario: string }): Promise<void>;
  /** `portal.registrarPedidoTitular`: o escritor do M10 (que grava a própria trilha) e a conta que abriu. */
  registrarPedido(
    p: PedidoParaGravar,
    trilha: Omit<RegistroTrilhaPortal, 'tabelaAlvo' | 'idAlvo' | 'chaveNaturalAlvo'>,
  ): Promise<{
    id: string;
    protocolo: string;
  }>;
  /**
   * W0-10: o titular cancela com motivo o pedido não respondido da conta (o escritor do M10, que grava a própria
   * trilha). `conferir` é a regra pura sobre a linha travada (devolve a recusa ou null).
   */
  cancelarPedido(
    p: {
      protocolo: string;
      idPaciente: number;
      conta: number;
      motivo: string;
      observacao: string | null;
      por: string;
      conferir: (situacao: string) => string | null;
    },
    trilha: Omit<RegistroTrilhaPortal, 'tabelaAlvo' | 'idAlvo' | 'chaveNaturalAlvo'>,
  ): Promise<void>;
  /**
   * W0-10 (M1): a manifestação à ouvidoria interna pelo portal (o escritor da ouvidoria do W0-04, canal "portal",
   * identificada com o paciente da sessão); o protocolo sai da sequência da ouvidoria.
   */
  registrarManifestacao(m: ManifestacaoPortalParaGravar): Promise<{ id: number; protocolo: string }>;
  /**
   * W0-10 (M2): o pedido de acesso como cópia do prontuário e o ato da solicitação na mesma transação (o escritor do
   * M10 grava a trilha do pedido; a do ato vai em `trilhas.copia`).
   */
  pedirCopia(
    p: CopiaParaGravar,
    trilhas: { readonly pedido: TrilhaPedidoPortal; readonly copia: TrilhaPedidoPortal },
  ): Promise<{ id: string; protocolo: string }>;
  /** W0-10 (M2): legitimidade, geração (hash e chave do PDF) ou entrega, com o pedido travado e a trilha. */
  registrarAtoCopia(
    d: AtoCopiaParaGravar,
    trilha: TrilhaPedidoPortal,
  ): Promise<{ id: string; idPedido: string; protocolo: string; situacao: string }>;
}

export interface ManifestacaoPortalParaGravar {
  readonly protocoloDe: (numero: number) => string;
  readonly tipo: string;
  readonly paciente: number;
  readonly area: string;
  readonly relato: string;
  readonly recebidaEm: string;
  readonly prazoEm: string;
  readonly usuario: string;
}

/** W0-10 (M1): a manifestação do portal como a ouvidoria interna a lê (a mesma linha). */
export interface ManifestacaoPortalLida {
  readonly id: number;
  readonly protocolo: string;
  readonly tipo: string;
  readonly area: string;
  readonly relato: string;
  readonly recebidaEm: string;
  readonly prazoEm: string;
  readonly situacao: string;
  readonly resposta: string | null;
  readonly respondidaEm: string | null;
  readonly canceladaEm?: string | null;
}

export type TrilhaDaGravacao<T> = RegistroTrilhaPortal | ((r: T) => RegistroTrilhaPortal | null) | null;

export interface DominiosConsentimento {
  readonly signatarios: (ItemDominioPortal & { readonly ativo: boolean })[];
  readonly situacoes: (ItemDominioPortal & { readonly ativo: boolean })[];
  readonly revogacoes: (ItemDominioPortal & { readonly ativo: boolean })[];
}

export interface PortaPortalPaciente {
  readonly destino: 'banco' | 'memoria';
  /** O contexto do núcleo do estabelecimento da sessão (as portas de SADT, agenda e cadastro o pedem). */
  contexto(c: ContextoPortal): Promise<ContextoPortalNucleo>;
  /** Uma transação SGH_ com a trilha junto (a função devolve null quando nada foi gravado: sem linha de trilha). */
  gravar<T>(
    c: ContextoPortal,
    fn: (g: GravadorPortal) => Promise<T>,
    trilha: TrilhaDaGravacao<T>,
  ): Promise<T>;
  paciente(c: ContextoPortal, id: number): Promise<PacientePortal | null>;
  pacientesPorProntuario(c: ContextoPortal, prontuario: number): Promise<PacientePortal[]>;
  capacidadesCivis(c: ContextoPortal): Promise<ItemDominioPortal[]>;
  conta(c: ContextoPortal, id: number): Promise<ContaPortal | null>;
  contaPorEmail(c: ContextoPortal, emailResumo: string): Promise<ContaPortal | null>;
  contaPorConvite(c: ContextoPortal, conviteResumo: string): Promise<ContaPortal | null>;
  trocaEmailPorToken(c: ContextoPortal, tokenResumo: string): Promise<TrocaEmailPortal | null>;
  trocaEmailPendente(c: ContextoPortal, conta: number): Promise<TrocaEmailPortal | null>;
  contaDoPaciente(c: ContextoPortal, paciente: number): Promise<ContaPortal | null>;
  contasAbertas(c: ContextoPortal): Promise<{ conta: number; paciente: number; versao: number }[]>;
  vinculosDaConta(c: ContextoPortal, conta: number): Promise<VinculoPortal[]>;
  vinculosDoTitular(c: ContextoPortal, paciente: number): Promise<VinculoPortal[]>;
  vinculo(c: ContextoPortal, id: number): Promise<VinculoPortal | null>;
  /** Uma página da fila da conferência (por ordem de chegada; TETO_FILA_VINCULOS por página). */
  filaVinculos(
    c: ContextoPortal,
    f: FiltroFilaVinculosPortal,
  ): Promise<{ itens: VinculoPortal[]; haMais: boolean }>;
  vinculosAtivos(c: ContextoPortal): Promise<VinculoPortal[]>;
  guardiaoConfere(c: ContextoPortal, titular: number, responsavel: number): Promise<boolean>;
  dominiosConsentimento(c: ContextoPortal): Promise<DominiosConsentimento>;
  consentimentos(c: ContextoPortal, paciente: number): Promise<ConsentimentoPortal[]>;
  pedidos(c: ContextoPortal, conta: number, paciente: number): Promise<PedidoPortal[]>;
  documentos(
    c: ContextoPortal,
    paciente: number,
    tipos: readonly string[],
    pagina: number,
    apenas?: number | null,
  ): Promise<{ itens: DocumentoPortal[]; haMais: boolean }>;
  leituras(
    c: ContextoPortal,
    paciente: number,
    eventos: readonly string[],
    de: string,
    ate: string,
  ): Promise<{ itens: LeituraTitular[]; haMais: boolean }>;
  nomes(c: ContextoPortal, logins: readonly string[]): Promise<Map<string, string>>;
  /** W0-10 (M1): as manifestações do paciente feitas pelo portal (as mais recentes primeiro). */
  manifestacoes(c: ContextoPortal, paciente: number): Promise<ManifestacaoPortalLida[]>;
  /** W0-10 (M1): os feriados do período (o prazo da resposta da ouvidoria em dias úteis). */
  feriados(c: ContextoPortal, de: string, ate: string): Promise<readonly { data: string; nome: string }[]>;
  /** W0-10 (M2): a fila da cópia do prontuário (os não entregues primeiro, por prazo). */
  filaCopias(
    c: ContextoPortal,
    f: { readonly pendentes: boolean; readonly idPaciente?: number },
  ): Promise<CopiaNaFila[]>;
  /** W0-10 (M2): os atos de uma cópia, em ordem. */
  atosCopia(c: ContextoPortal, idPedido: string): Promise<AtoCopia[]>;
}

export const METODOS_PORTA_PORTAL: ReadonlySet<string> = new Set([
  'gravar',
  'contexto',
  'paciente',
  'pacientesPorProntuario',
  'capacidadesCivis',
  'conta',
  'contaPorEmail',
  'contaPorConvite',
  'trocaEmailPorToken',
  'trocaEmailPendente',
  'contaDoPaciente',
  'contasAbertas',
  'vinculosDaConta',
  'vinculosDoTitular',
  'vinculo',
  'filaVinculos',
  'vinculosAtivos',
  'guardiaoConfere',
  'dominiosConsentimento',
  'consentimentos',
  'pedidos',
  'documentos',
  'leituras',
  'nomes',
  'manifestacoes',
  'feriados',
  'filaCopias',
  'atosCopia',
]);
