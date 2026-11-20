// Porta da portaria e dos visitantes (M50, etapa 5; ficha, seções 4, 5 e 7), independente de onde (a API não escreve
// SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY (domínios, internados com o isolamento, regras, bloqueios, visitantes, visitas,
//     acompanhantes, terminais, eventos) e as gravações só do novo numa transação SGH_ com a SGH_TRILHA junto;
//   - `memoria`: a sessão sintética de dev/ci (E2E): internados, domínios e cadastros SINTÉTICOS em memória, com as
//     mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AcompanhanteSgh,
  AcompanhanteLidoSgh,
  AvaliacaoRelida,
  BloqueioLidoSgh,
  BloqueioSgh,
  DominiosPortariaLidos,
  EventoCatracaLidoSgh,
  InternadoPortaria,
  PacienteRelido,
  RegraVisitaLidaSgh,
  RegraVisitaSgh,
  TerminalLidoSgh,
  TerminalRelido,
  TerminalSgh,
  VisitaDoCracha,
  VisitaLidaSgh,
  VisitanteLidoSgh,
  VisitanteSgh,
  VisitaSgh,
} from '@sgh/legado';
import type { MotivoBloqueioVisita, PapelVisita, ResultadoCatraca, SentidoCatraca } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_PORTARIA = Symbol('PORTA_PORTARIA');

export type ContextoPortaria = ContextoPortaM18;

type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto. */
export interface GravadorPortaria {
  registrarVisitante(
    v: SemHospital<VisitanteSgh>,
  ): Promise<{ id: number; novo: boolean; fotoAnterior: string | null }>;
  expurgarVisitantes(x: {
    readonly hoje: string;
    readonly usuario: string;
    readonly teto: number;
  }): Promise<{ ids: number[]; fotos: string[] }>;
  registrarVisita(
    v: SemHospital<VisitaSgh>,
    avaliar: (r: PacienteRelido) => AvaliacaoRelida,
  ): Promise<{ id: number; papel: PapelVisita; repetida: boolean }>;
  encerrarVisita(x: {
    readonly id: number;
    readonly saida: string;
    readonly origem: 'portaria' | 'catraca' | 'expirada';
    readonly usuario: string;
  }): Promise<number>;
  definirRegra(r: SemHospital<RegraVisitaSgh>): Promise<{ id: number; versao: number }>;
  bloquear(b: SemHospital<BloqueioSgh>): Promise<number>;
  revogarBloqueio(x: {
    readonly id: number;
    readonly motivo: string;
    readonly usuario: string;
    readonly podeClinico: boolean;
    /** A rota clínica revoga só o bloqueio clínico (conferido no gravador, depois da trava). */
    readonly exigeMotivo?: 'clinico' | null;
  }): Promise<{ id: number; internacao: number; motivo: MotivoBloqueioVisita }>;
  registrarAcompanhante(a: SemHospital<AcompanhanteSgh>): Promise<{ id: number; substituido: number | null }>;
  encerrarAcompanhante(x: {
    readonly id: number;
    readonly motivo: string;
    readonly fim: string;
    readonly usuario: string;
  }): Promise<{ id: number; internacao: number }>;
  configurarTerminal(t: SemHospital<TerminalSgh>): Promise<{ id: number; versao: number }>;
  registrarEventoCatraca(
    ev: {
      readonly terminal: number;
      readonly cracha: string;
      readonly sentido: SentidoCatraca;
      readonly ocorridoEm: string;
      readonly chave: string;
      readonly usuario: string;
    },
    avaliar: (x: { terminal: TerminalRelido; visita: VisitaDoCracha | null }) => {
      readonly resultado: ResultadoCatraca;
      readonly motivo: string | null;
      readonly encerra: boolean;
    },
  ): Promise<{
    id: number;
    resultado: ResultadoCatraca;
    motivo: string | null;
    visita: number | null;
    repetido: boolean;
  }>;
}

export interface PortaPortaria extends PortaGravacaoM18<GravadorPortaria> {
  /** O relógio do banco do estabelecimento (AAAA-MM-DDTHH:mm:ss, hora local). */
  relogio(c: ContextoPortaria): Promise<string>;
  dominios(c: ContextoPortaria): Promise<DominiosPortariaLidos>;
  unidades(c: ContextoPortaria): Promise<{ unidade: string; nome: string }[]>;
  internados(c: ContextoPortaria): Promise<InternadoPortaria[]>;
  internado(c: ContextoPortaria, internacao: number): Promise<InternadoPortaria | null>;
  regras(c: ContextoPortaria): Promise<RegraVisitaLidaSgh[]>;
  bloqueios(c: ContextoPortaria, internacao?: number | null): Promise<BloqueioLidoSgh[]>;
  visitante(c: ContextoPortaria, id: number): Promise<VisitanteLidoSgh | null>;
  buscarVisitantes(
    c: ContextoPortaria,
    b: { readonly documento: { tipo: string; numero: string } | null; readonly nomeBusca: string | null },
  ): Promise<VisitanteLidoSgh[]>;
  vencidos(c: ContextoPortaria, hoje: string): Promise<number>;
  abertas(c: ContextoPortaria): Promise<VisitaLidaSgh[]>;
  visita(c: ContextoPortaria, id: number): Promise<VisitaLidaSgh | null>;
  visitasDoPeriodo(
    c: ContextoPortaria,
    f: {
      readonly internacao: number | null;
      readonly unidade: string | null;
      readonly de: string;
      readonly ate: string;
    },
  ): Promise<VisitaLidaSgh[]>;
  acompanhantes(c: ContextoPortaria, unidade?: string | null): Promise<AcompanhanteLidoSgh[]>;
  terminais(c: ContextoPortaria): Promise<TerminalLidoSgh[]>;
  eventos(c: ContextoPortaria, teto?: number): Promise<EventoCatracaLidoSgh[]>;
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
  'foto',
]);
