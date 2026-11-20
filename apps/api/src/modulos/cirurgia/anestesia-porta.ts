// Porta da anestesia no bloco (M46, etapa 1: APA, ficha anestésica e SRPA; ficha, seções 4, 5 e 7), independente de onde
// (a API não escreve SQL; fronteira Nx):
//   - `legado`: as leituras READ ONLY (os domínios da ficha, o contexto do paciente e da cirurgia, o profissional da
//     sessão, as SGH_CC_APA, SGH_CC_FA* e SGH_CC_SRPA) e as gravações só do novo numa transação SGH_ com a SGH_TRILHA
//     junto; a receita relê na MESMA transação a ficha (travada) e a versão, e o domínio confere de novo ali;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras e recusas; nada vai à cópia;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// O agendamento, a sala e os nomes dos profissionais vêm da porta do centro cirúrgico (M18).
import type {
  AberturaFichaSgh,
  ApaLidaSgh,
  ApaSgh,
  AvaliacaoSrpaLidaSgh,
  AvaliacaoSrpaSgh,
  ContextoAnestesiaLido,
  DominiosFichaLidos,
  FichaLidaSgh,
  LoteFichaSgh,
} from '@sgh/legado';
import type { MarcoFicha, SituacaoFicha } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_ANESTESIA = Symbol('PORTA_ANESTESIA');

type SemHospital<T> = Omit<T, 'hospital'>;

/** Gravações só do novo (SGH_), numa transação com a SGH_TRILHA junto; as leituras aqui são da mesma transação. */
export interface GravadorAnestesia {
  /** Revisão do M46.1: o agendamento relido na transação (a linha da agenda existe? o estado do novo). */
  agendamentoNaTransacao(agendamento: number): Promise<{ existe: boolean; estado: string | null }>;
  registrarApa(
    a: SemHospital<ApaSgh>,
  ): Promise<{ id: number; versao: number; repetida: boolean; pendencias: string[] }>;
  /** A ficha relida na transação (travada até o fim), ou null. */
  ficha(agendamento: number): Promise<FichaLidaSgh | null>;
  abrirFicha(f: SemHospital<AberturaFichaSgh>): Promise<{ id: number; versao: number; nova: boolean }>;
  subirVersao(v: {
    readonly ficha: number;
    readonly versaoVista: number;
    readonly usuario: string;
    readonly marco?: { readonly marco: MarcoFicha; readonly momento: string };
    readonly situacao?: SituacaoFicha;
  }): Promise<number>;
  lancar(l: SemHospital<LoteFichaSgh>): Promise<{ ids: number[]; repetida: boolean; noBalanco: number }>;
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
  srpa(agendamento: number): Promise<AvaliacaoSrpaLidaSgh[]>;
  registrarSrpa(s: SemHospital<AvaliacaoSrpaSgh>): Promise<{ id: number; repetida: boolean }>;
}

/** O profissional da sessão (os registros TBCBOPRO ativos); null sem cadastro de profissional. */
export interface ProfissionalDaSessao {
  readonly nome: string | null;
  readonly registros: readonly number[];
}

export interface PortaAnestesia extends PortaGravacaoM18<GravadorAnestesia> {
  dominios(c: ContextoPortaM18): Promise<DominiosFichaLidos>;
  contexto(c: ContextoPortaM18, agendamento: number): Promise<ContextoAnestesiaLido | null>;
  profissional(c: ContextoPortaM18, login: string): Promise<ProfissionalDaSessao | null>;
  apas(c: ContextoPortaM18, agendamento: number): Promise<ApaLidaSgh[]>;
  ficha(c: ContextoPortaM18, agendamento: number): Promise<FichaLidaSgh | null>;
  srpa(c: ContextoPortaM18, agendamento: number): Promise<AvaliacaoSrpaLidaSgh[]>;
  quadroSrpa(
    c: ContextoPortaM18,
    desde: string,
  ): Promise<{ series: AvaliacaoSrpaLidaSgh[][]; truncado: boolean }>;
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
