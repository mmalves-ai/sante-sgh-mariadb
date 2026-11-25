// Porta da portaria e dos visitantes (M50, etapa 5; ficha, seções 4, 5 e 7), independente de onde (a API não escreve
// SQL; fronteira Nx):
//   - `banco` (porta-propria.ts): o banco do cliente pelo @sgh/nucleo; as gravações numa operação do Executor, com a
//     trilha, o outbox e a idempotência na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E): internados, domínios e cadastros SINTÉTICOS em memória, com as
//     mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AcompanhanteRegistrado,
  AvaliacaoDaVisita,
  BloqueioVisitaRegistrado,
  ColaboradorDoCracha,
  DominiosDaPortaria,
  EventoCatracaRegistrado,
  InternadoPortaria,
  NovaRegraVisita,
  NovaVisita,
  NovaRegraAcesso,
  NovoAcompanhante,
  NovoBloqueioVisita,
  NovoTerminal,
  NovoVisitante,
  RegraAcessoRegistrada,
  RegraVisitaRegistrada,
  SituacaoDoPaciente,
  TerminalDaCatraca,
  TerminalRegistrado,
  VisitaDoCracha,
  VisitanteRegistrado,
  VisitaRegistrada,
} from './tipos.js';
import type { MotivoBloqueioVisita, PapelVisita, ResultadoCatraca, SentidoCatraca } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_PORTARIA = Symbol('PORTA_PORTARIA');

/** Contexto da porta; `chavePedido` é a Idempotency-Key do pedido (o reenvio devolve o mesmo resultado). */
export type ContextoPortaria = ContextoPortaM18 & { readonly chavePedido?: string | null };

/** Gravações diretas da porta, numa transação com a trilha junto. */
export interface GravadorPortaria {
  registrarVisitante(v: NovoVisitante): Promise<{ id: number; novo: boolean; fotoAnterior: string | null }>;
  expurgarVisitantes(x: {
    readonly hoje: string;
    readonly usuario: string;
    readonly teto: number;
    /** Prazo de guarda do estabelecimento, em dias (o mesmo de `vencidos`); sem ele, o prazo padrão. */
    readonly retencaoDias?: number;
  }): Promise<{ ids: number[]; fotos: string[] }>;
  registrarVisita(
    v: NovaVisita,
    avaliar: (r: SituacaoDoPaciente) => AvaliacaoDaVisita,
  ): Promise<{ id: number; papel: PapelVisita; repetida: boolean }>;
  encerrarVisita(x: {
    readonly id: number;
    readonly saida: string;
    readonly origem: 'portaria' | 'catraca' | 'expirada';
    readonly usuario: string;
  }): Promise<number>;
  definirRegra(r: NovaRegraVisita): Promise<{ id: number; versao: number }>;
  bloquear(b: NovoBloqueioVisita): Promise<number>;
  revogarBloqueio(x: {
    readonly id: number;
    readonly motivo: string;
    readonly usuario: string;
    readonly podeClinico: boolean;
    /** A rota clínica revoga só o bloqueio clínico (conferido no gravador, depois da trava). */
    readonly exigeMotivo?: 'clinico' | null;
  }): Promise<{ id: number; internacao: number; motivo: MotivoBloqueioVisita }>;
  registrarAcompanhante(a: NovoAcompanhante): Promise<{ id: number; substituido: number | null }>;
  encerrarAcompanhante(x: {
    readonly id: number;
    readonly motivo: string;
    readonly fim: string;
    readonly usuario: string;
  }): Promise<{ id: number; internacao: number }>;
  configurarTerminal(t: NovoTerminal): Promise<{ id: number; versao: number }>;
  registrarEventoCatraca(
    ev: {
      readonly terminal: number;
      readonly cracha: string;
      readonly sentido: SentidoCatraca;
      readonly ocorridoEm: string;
      readonly chave: string;
      readonly usuario: string;
    },
    avaliar: (x: {
      terminal: TerminalDaCatraca;
      visita: VisitaDoCracha | null;
      /** Sem visita no crachá, o colaborador do crachá (pela matrícula) e as regras de acesso do terminal. */
      colaborador: ColaboradorDoCracha | null;
      regras: readonly RegraAcessoRegistrada[];
    }) => {
      readonly resultado: ResultadoCatraca;
      readonly motivo: string | null;
      readonly encerra: boolean;
      /** A regra de acesso que liberou ou recusou o colaborador. */
      readonly regra?: number | null;
    },
  ): Promise<{
    id: number;
    resultado: ResultadoCatraca;
    motivo: string | null;
    visita: number | null;
    colaborador: number | null;
    repetido: boolean;
  }>;
  /** A regra de acesso do colaborador num terminal, pela versão (nunca apagada: a desativação guarda o histórico). */
  gravarRegraAcesso(r: NovaRegraAcesso): Promise<{ id: number; versao: number }>;
  /** O crachá do colaborador ligado à matrícula do estabelecimento (null retira). */
  vincularCrachaColaborador(x: {
    readonly matricula: string;
    readonly cracha: string | null;
    readonly usuario: string;
  }): Promise<{ id: number }>;
}

export interface PortaPortaria extends PortaGravacaoM18<GravadorPortaria> {
  /** O relógio do banco do estabelecimento (AAAA-MM-DDTHH:mm:ss, hora local). */
  relogio(c: ContextoPortaria): Promise<string>;
  dominios(c: ContextoPortaria): Promise<DominiosDaPortaria>;
  unidades(c: ContextoPortaria): Promise<{ unidade: string; nome: string }[]>;
  internados(c: ContextoPortaria): Promise<InternadoPortaria[]>;
  internado(c: ContextoPortaria, internacao: number): Promise<InternadoPortaria | null>;
  regras(c: ContextoPortaria): Promise<RegraVisitaRegistrada[]>;
  bloqueios(c: ContextoPortaria, internacao?: number | null): Promise<BloqueioVisitaRegistrado[]>;
  visitante(c: ContextoPortaria, id: number): Promise<VisitanteRegistrado | null>;
  buscarVisitantes(
    c: ContextoPortaria,
    b: { readonly documento: { tipo: string; numero: string } | null; readonly nomeBusca: string | null },
  ): Promise<VisitanteRegistrado[]>;
  /** Cadastros com a guarda vencida (sem visita aberta); `retencaoDias` é o prazo do estabelecimento. */
  vencidos(c: ContextoPortaria, hoje: string, retencaoDias?: number): Promise<number>;
  abertas(c: ContextoPortaria): Promise<VisitaRegistrada[]>;
  visita(c: ContextoPortaria, id: number): Promise<VisitaRegistrada | null>;
  visitasDoPeriodo(
    c: ContextoPortaria,
    f: {
      readonly internacao: number | null;
      readonly unidade: string | null;
      readonly de: string;
      readonly ate: string;
    },
  ): Promise<VisitaRegistrada[]>;
  acompanhantes(c: ContextoPortaria, unidade?: string | null): Promise<AcompanhanteRegistrado[]>;
  terminais(c: ContextoPortaria): Promise<TerminalRegistrado[]>;
  eventos(c: ContextoPortaria, teto?: number): Promise<EventoCatracaRegistrado[]>;
  /** As regras de acesso do colaborador nos terminais do estabelecimento. */
  regrasAcesso(c: ContextoPortaria): Promise<RegraAcessoRegistrada[]>;
  /** Os perfis de acesso e os setores do estabelecimento (o que a regra escolhe). */
  perfisESetores(
    c: ContextoPortaria,
  ): Promise<{ perfis: { id: number; nome: string }[]; setores: { id: number; nome: string }[] }>;
  foto(c: ContextoPortaria, visitante: number): Promise<string | null>;
}

export const METODOS_PORTA_PORTARIA: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'dominios',
  'unidades',
  'internados',
  'internado',
  'regras',
  'bloqueios',
  'visitante',
  'buscarVisitantes',
  'vencidos',
  'abertas',
  'visita',
  'visitasDoPeriodo',
  'acompanhantes',
  'terminais',
  'eventos',
  'regrasAcesso',
  'perfisESetores',
  'foto',
]);
