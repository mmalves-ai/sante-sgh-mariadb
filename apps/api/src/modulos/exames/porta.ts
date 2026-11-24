// Porta da agenda de exames (M18): o que as telas leem e gravam, independente de onde (a API não escreve SQL):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (porta-propria.ts): leituras somente leitura; gravações pelo
//     Executor (trilha, outbox e idempotência na mesma transação);
//   - `memoria`: a sessão sintética de dev/ci (E2E): agendas, horários e marcações SINTÉTICOS em memória, com as
//     mesmas validações (Zod dos contratos) e as mesmas recusas;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: escala, gerações, horários, marcações e cancelamentos por id da agenda (não mais por nome + registro do
// médico); tipos de negócio próprios (tipos.ts).
import type { ContextoPortaM18, PortaGravacaoM18 } from './apoio-gravacao.js';
import type {
  AgendaExame,
  CancelamentoExame,
  CoberturaExame,
  ContatoMarcacaoExame,
  ExtensaoExame,
  GeracaoGrade,
  HorarioExame,
  LinhaEscalaExame,
  MarcacaoExame,
  OpcoesDaAgendaExame,
  RelogioEstabelecimento,
  ResiduoExame,
  VagaExame,
} from './tipos.js';

export const PORTA_EXAME = Symbol('PORTA_EXAME');

/** Gravações diretas da cobertura por exame (sem operação do executor; a trilha vai junto). */
export interface GravadorCoberturaExame {
  incluirCobertura(r: { agenda: number; exame: number; convenio: number | null }): Promise<number>;
  /** Devolve quantas linhas encerrou (0 = não havia). */
  encerrarCobertura(r: { agenda: number; exame: number; convenio: number | null }): Promise<number>;
}
/** Nome antigo mantido para quem importa o gravador da porta. */
export type GravadorSghExame = GravadorCoberturaExame;

export interface PortaExame extends PortaGravacaoM18<GravadorCoberturaExame> {
  relogio(c: ContextoPortaM18): Promise<RelogioEstabelecimento>;
  agendas(c: ContextoPortaM18): Promise<AgendaExame[]>;
  agenda(c: ContextoPortaM18, id: number): Promise<AgendaExame | null>;
  convenios(c: ContextoPortaM18, id: number): Promise<{ codigo: number; nome: string }[]>;
  /** Escala da agenda: as faixas vigentes hoje ou, com o período, as que valem em algum dia dele. */
  escala(
    c: ContextoPortaM18,
    agenda: number,
    periodo?: { de: string; ate: string },
  ): Promise<LinhaEscalaExame[]>;
  geracoes(c: ContextoPortaM18, agenda: number): Promise<GeracaoGrade[]>;
  /** Feriados do período; null = o calendário de feriados não está disponível (a prévia avisa). */
  feriados(
    c: ContextoPortaM18,
    de: string,
    ate: string,
  ): Promise<{ data: string; nome: string; horaInicio?: string | null; horaFim?: string | null }[] | null>;
  /** Todos os horários de início já ocupados na agenda ("AAAA-MM-DD HH:MM"), sem teto: a prévia não os repete. */
  horariosExistentes(c: ContextoPortaM18, agenda: number, de: string, ate: string): Promise<string[]>;
  horarios(
    c: ContextoPortaM18,
    agenda: number,
    de: string,
    ate: string,
  ): Promise<{ itens: HorarioExame[]; truncado: boolean }>;
  vagas(
    c: ContextoPortaM18,
    f: { agendas: readonly number[] | null; de: string; ate: string; limite?: number },
  ): Promise<{ itens: VagaExame[]; truncado: boolean }>;
  marcacoesDoDia(
    c: ContextoPortaM18,
    data: string,
    agenda: number | null,
  ): Promise<{ itens: MarcacaoExame[]; truncado: boolean }>;
  marcacoesDoPaciente(
    c: ContextoPortaM18,
    idPaciente: number,
  ): Promise<{ itens: MarcacaoExame[]; truncado: boolean }>;
  marcacao(
    c: ContextoPortaM18,
    id: number,
  ): Promise<{ marcacao: MarcacaoExame; contato: ContatoMarcacaoExame } | null>;
  cancelamentos(
    c: ContextoPortaM18,
    f: { de: string; ate: string; agendas: readonly number[] | null; pagina: number; porPagina: number },
  ): Promise<{ itens: CancelamentoExame[]; total: number }>;
  residuo(c: ContextoPortaM18, de: string, ate: string): Promise<ResiduoExame>;
  opcoes(c: ContextoPortaM18): Promise<OpcoesDaAgendaExame>;
  extensoes(c: ContextoPortaM18, ids: readonly number[]): Promise<Map<number, ExtensaoExame>>;
  cobertura(c: ContextoPortaM18, agenda: number | null): Promise<CoberturaExame[]>;
}

export const METODOS_PORTA_EXAME: ReadonlySet<string> = new Set([
  'executar',
  'gravarSgh',
  'relogio',
  'agendas',
  'agenda',
  'convenios',
  'escala',
  'geracoes',
  'feriados',
  'horariosExistentes',
  'horarios',
  'vagas',
  'marcacoesDoDia',
  'marcacoesDoPaciente',
  'marcacao',
  'cancelamentos',
  'residuo',
  'opcoes',
  'extensoes',
  'cobertura',
]);
