// Porta da anestesia no bloco (M46, etapa 1: APA, ficha anestésica e SRPA; ficha, seções 4, 5 e 7), independente de onde
// (a API não escreve SQL; fronteira Nx):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (porta-propria), com o Executor e a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O agendamento, a sala e os nomes dos profissionais vêm da porta do centro cirúrgico (M18).
import type {
  AberturaFicha,
  AvaliacaoPreAnestesica,
  AvaliacaoRecuperacao,
  ContextoAnestesia,
  DominiosFicha,
  FichaAnestesica,
  LoteFicha,
  RegistroApa,
  RegistroSrpa,
} from './tipos.js';
import type { MarcoFicha, SituacaoFicha } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_ANESTESIA = Symbol('PORTA_ANESTESIA');

type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações diretas no banco, numa transação com a trilha de auditoria junto; as leituras aqui são da mesma transação. */
export interface GravadorAnestesia {
  /** Revisão do M46.1: o agendamento relido na transação (a linha da agenda existe? o estado do novo). */
  agendamentoNaTransacao(agendamento: number): Promise<{ existe: boolean; estado: string | null }>;
  registrarApa(
    a: SemHospital<RegistroApa>,
  ): Promise<{ id: number; versao: number; repetida: boolean; pendencias: string[] }>;
  /** A ficha relida na transação (travada até o fim), ou null. */
  ficha(agendamento: number): Promise<FichaAnestesica | null>;
  abrirFicha(f: SemHospital<AberturaFicha>): Promise<{ id: number; versao: number; nova: boolean }>;
  subirVersao(v: {
    readonly ficha: number;
    readonly versaoVista: number;
    readonly usuario: string;
    readonly marco?: { readonly marco: MarcoFicha; readonly momento: string };
    readonly situacao?: SituacaoFicha;
  }): Promise<number>;
  lancar(l: SemHospital<LoteFicha>): Promise<{ ids: number[]; repetida: boolean; noBalanco: number }>;
  encerrar(x: {
    readonly ficha: number;
    readonly lancamento: number;
    readonly fim: string;
    readonly usuario: string;
  }): Promise<{ tabela: string }>;
  passar(p: {
    readonly ficha: number;
    readonly momento: string;
    readonly de: number;
    readonly para: number;
    readonly paraCod: number;
    readonly resumo: string;
    readonly usuario: string;
    readonly chave: string | null;
  }): Promise<{ id: number; repetida: boolean }>;
  justificar(j: {
    readonly ficha: number;
    readonly inicio: string;
    readonly fim: string;
    readonly motivo: string;
    readonly profissional: number | null;
    readonly usuario: string;
    readonly chave: string | null;
  }): Promise<{ id: number; repetida: boolean }>;
  assinar(a: {
    readonly ficha: number;
    readonly versaoVista: number;
    readonly profissional: number;
    readonly hash: string;
    readonly usuario: string;
  }): Promise<{ versao: number }>;
  adendo(a: {
    readonly ficha: number;
    readonly texto: string;
    readonly profissional: number;
    readonly usuario: string;
    readonly chave: string | null;
  }): Promise<{ id: number; repetida: boolean }>;
  /** A série da SRPA relida na transação. */
  srpa(agendamento: number): Promise<AvaliacaoRecuperacao[]>;
  registrarSrpa(s: SemHospital<RegistroSrpa>): Promise<{ id: number; repetida: boolean }>;
}

/** O profissional da sessão (os registros TBCBOPRO ativos); null sem cadastro de profissional. */
export interface ProfissionalDaSessao {
  readonly nome: string | null;
  readonly registros: readonly number[];
}

export interface PortaAnestesia extends PortaGravacaoM18<GravadorAnestesia> {
  dominios(c: ContextoPortaM18): Promise<DominiosFicha>;
  contexto(c: ContextoPortaM18, agendamento: number): Promise<ContextoAnestesia | null>;
  profissional(c: ContextoPortaM18, login: string): Promise<ProfissionalDaSessao | null>;
  apas(c: ContextoPortaM18, agendamento: number): Promise<AvaliacaoPreAnestesica[]>;
  ficha(c: ContextoPortaM18, agendamento: number): Promise<FichaAnestesica | null>;
  srpa(c: ContextoPortaM18, agendamento: number): Promise<AvaliacaoRecuperacao[]>;
  quadroSrpa(
    c: ContextoPortaM18,
    desde: string,
  ): Promise<{ series: AvaliacaoRecuperacao[][]; truncado: boolean }>;
  /** A situação dos registros da anestesia dos agendamentos (a escolha do dia). */
  situacoes(
    c: ContextoPortaM18,
    agendamentos: readonly number[],
  ): Promise<Map<number, { apa: string | null; ficha: string | null; srpa: string | null }>>;
}

export const METODOS_PORTA_ANESTESIA: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'dominios',
  'contexto',
  'profissional',
  'apas',
  'ficha',
  'srpa',
  'quadroSrpa',
  'situacoes',
]);
