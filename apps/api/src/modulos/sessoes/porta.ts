// Porta da agenda de sessões e recursos (M50, etapa 6; ficha, seções 4 a 7): o que a grade das cadeiras e salas, a série
// de sessões e a ficha do paciente leem e gravam, independente de onde (a API não escreve SQL; fronteira Nx):
//   - `legado`: leituras READ ONLY pelos repositórios de @sgh/legado e as gravações só do novo numa transação SGH_ com a
//     SGH_TRILHA junto (as travas do recurso e do paciente e a releitura da ocupação ficam no adaptador);
//   - `memoria`: a sessão sintética de dev/ci (E2E), com cadeiras e salas sintéticas e os pacientes do cadastro sintético;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type {
  LinhaTrilha,
  OcupacaoLida,
  RecursoSessaoLido,
  SerieSessoesSgh,
  SessaoSghLida,
  SituacaoSessaoSgh,
} from '@sgh/legado';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_SESSOES = Symbol('PORTA_SESSOES');

export type ContextoSessoes = ContextoPortaM18;

export interface GravadorSessoes {
  agendarSerie(s: Omit<SerieSessoesSgh, 'hospital'>): Promise<{ serie: number; ids: number[] }>;
  atualizar(a: {
    id: number;
    situacao: Exclude<SituacaoSessaoSgh, 'agendada'>;
    motivo: string | null;
    versao: number;
    usuario: string;
  }): Promise<void>;
  cancelarRestantes(a: {
    id: number;
    serie: number;
    ordem: number;
    motivo: string;
    versao: number;
    usuario: string;
  }): Promise<number>;
  registrarEvento(linha: LinhaTrilha): Promise<void>;
}

export interface PacienteSessao {
  readonly id: number;
  readonly prontuario: number | null;
  readonly nome: string;
  readonly nascimento: string | null;
  readonly ativo: boolean;
}

export interface PortaSessoes extends PortaGravacaoM18<GravadorSessoes> {
  /** O relógio do banco ("AAAA-MM-DDTHH:MM" e "AAAA-MM-DD"). */
  relogio(c: ContextoSessoes): Promise<{ agora: string; hoje: string }>;
  recursos(c: ContextoSessoes): Promise<RecursoSessaoLido[]>;
  dominios(c: ContextoSessoes): Promise<{
    complexidades: { codigo: number; nome: string }[];
    duracoes: { codigo: number; nome: string }[];
  }>;
  periodo(
    c: ContextoSessoes,
    de: string,
    ate: string,
    recursos: readonly number[] | null,
  ): Promise<{ sessoes: SessaoSghLida[]; cortada: boolean }>;
  doPaciente(
    c: ContextoSessoes,
    paciente: number,
    desde: string,
  ): Promise<{ sessoes: SessaoSghLida[]; cortada: boolean }>;
  sessao(c: ContextoSessoes, id: number): Promise<SessaoSghLida | null>;
  serie(c: ContextoSessoes, serie: number): Promise<SessaoSghLida[]>;
  /** A ocupação ativa que impede cada horário, conferida horário a horário (nunca a janela inteira, sem corte). */
  ocupacoes(
    c: ContextoSessoes,
    alvo: { readonly recurso: number } | { readonly paciente: number },
    horarios: readonly { readonly inicio: string; readonly fim: string }[],
  ): Promise<OcupacaoLida[]>;
  paciente(c: ContextoSessoes, id: number): Promise<PacienteSessao | null>;
  nomes(c: ContextoSessoes, ids: readonly number[]): Promise<Map<number, string>>;
}

export const METODOS_PORTA_SESSOES: ReadonlySet<string> = new Set([
  'podeGravar',
  'executar',
  'gravarSgh',
  'relogio',
  'recursos',
  'dominios',
  'periodo',
  'doPaciente',
  'sessao',
  'serie',
  'ocupacoes',
  'paciente',
  'nomes',
]);
