// Porta da agenda de exames (M18): o que as telas leem e gravam, independente de onde (a API não escreve SQL;
// fronteira Nx):
//   - `legado`: o núcleo do legado (leituras READ ONLY dos repositórios de @sgh/legado; gravações pelo EXECUTOR do
//     M04, com a trilha na mesma transação; a cobertura por exame, só do novo, em transação SGH_ com a SGH_TRILHA);
//   - `memoria`: a sessão sintética de dev/ci (E2E): agendas, horários e marcações SINTÉTICOS em memória, com as
//     mesmas validações (Zod dos contratos) e as mesmas recusas das receitas; nada vai à cópia;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  AgendaExameLida,
  CancelamentoExameLido,
  CoberturaExameLida,
  ContatoMarcacaoExame,
  ExtensaoExameLida,
  GeracaoLida,
  HorarioExameLidoBanco,
  LinhaEscalaExameLida,
  MarcacaoExameLida,
  OpcoesExameLidas,
  RelogioLido,
  ResiduoExameLido,
  VagaExameLida,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from './apoio-gravacao.js';

export const PORTA_EXAME = Symbol('PORTA_EXAME');

export interface GravadorSghExame {
  incluirCobertura(r: {
    agenda: number;
    nome: string;
    crm: number;
    exame: string;
    idExame: number;
    convenio: number | null;
    usuario: string;
  }): Promise<number>;
  encerrarCobertura(r: {
    agenda: number;
    idExame: number;
    convenio: number | null;
    usuario: string;
  }): Promise<number>;
}

export interface PortaExame extends PortaGravacaoM18<GravadorSghExame> {
  relogio(c: ContextoPortaM18): Promise<RelogioLido>;
  agendas(c: ContextoPortaM18): Promise<AgendaExameLida[]>;
  agenda(c: ContextoPortaM18, id: number): Promise<AgendaExameLida | null>;
  convenios(c: ContextoPortaM18, id: number): Promise<{ codigo: number; nome: string }[]>;
  escala(c: ContextoPortaM18, nome: string, crm: number): Promise<LinhaEscalaExameLida[]>;
  geracoes(c: ContextoPortaM18, nome: string, crm: number): Promise<GeracaoLida[]>;
  feriados(c: ContextoPortaM18, de: string, ate: string): Promise<{ data: string; nome: string }[]>;
  horarios(
    c: ContextoPortaM18,
    nome: string,
    crm: number,
    de: string,
    ate: string,
  ): Promise<{ itens: HorarioExameLidoBanco[]; truncado: boolean }>;
  vagas(
    c: ContextoPortaM18,
    f: { agendas: readonly number[] | null; de: string; ate: string; limite?: number },
  ): Promise<{ itens: VagaExameLida[]; truncado: boolean }>;
  marcacoesDoDia(
    c: ContextoPortaM18,
    data: string,
    agenda: { nome: string; crm: number } | null,
  ): Promise<{ itens: MarcacaoExameLida[]; truncado: boolean }>;
  marcacoesDoPaciente(
    c: ContextoPortaM18,
    idPaciente: number,
  ): Promise<{ itens: MarcacaoExameLida[]; truncado: boolean }>;
  marcacao(
    c: ContextoPortaM18,
    id: number,
  ): Promise<{ marcacao: MarcacaoExameLida; contato: ContatoMarcacaoExame } | null>;
  cancelamentos(
    c: ContextoPortaM18,
    f: { de: string; ate: string; agendas: readonly string[] | null; pagina: number; porPagina: number },
  ): Promise<{ itens: CancelamentoExameLido[]; total: number }>;
  residuo(c: ContextoPortaM18, de: string, ate: string): Promise<ResiduoExameLido>;
  opcoes(c: ContextoPortaM18): Promise<OpcoesExameLidas>;
  extensoes(c: ContextoPortaM18, ids: readonly number[]): Promise<Map<number, ExtensaoExameLida>>;
  cobertura(c: ContextoPortaM18, agenda: number | null): Promise<CoberturaExameLida[]>;
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
