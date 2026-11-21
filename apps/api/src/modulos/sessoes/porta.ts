// Porta da agenda de sessões e recursos (M50, etapa 6; ficha, seções 4 a 7): o que a grade das cadeiras e salas, a série
// de sessões e a ficha do paciente leem e gravam, independente de onde (a API não escreve SQL):
//   - `banco`: a porta própria (porta-propria.ts) sobre o plano de sessões (plano_sessao), as sessões
//     (sessao_terapeutica) e os recursos da agenda (recurso_agendavel e agenda_recurso), pelo @sgh/nucleo, com as
//     travas do recurso e do paciente e a releitura da ocupação na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com cadeiras e salas sintéticas e os pacientes do cadastro sintético;
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: tipos de negócio do módulo; o usuário vem do contexto (id); a série grava o plano terapêutico com o item, o
// profissional solicitante e a fonte pagadora (o que o modelo exige para faturar a sessão).
import type { SituacaoSessao, TipoPlanoSessao } from '@sgh/contratos';
import type { ContextoPortaM18, PortaGravacaoM18 } from '../exames/public-api.js';

export const PORTA_SESSOES = Symbol('PORTA_SESSOES');

export type ContextoSessoes = ContextoPortaM18;

/** Uma cadeira ou sala na agenda a que pertence, com o que aceita (complexidade e duração 0 = todas). */
export interface RecursoDeSessao {
  readonly recurso: number;
  readonly identificacao: string;
  readonly agenda: number;
  readonly nomeAgenda: string;
  readonly unidade: number;
  readonly tipo: number;
  readonly prioridade: number;
  readonly complexidade: number;
  readonly duracao: number;
  /** Faixa etária aceita, em anos (null = sem limite). */
  readonly faixaInicial: number | null;
  readonly faixaFinal: number | null;
  readonly ativo: boolean;
}

/** Uma sessão agendada da série, como a grade e a ficha do paciente leem. */
export interface SessaoAgendada {
  readonly id: number;
  readonly serie: number;
  readonly ordem: number;
  readonly total: number;
  readonly agenda: number;
  readonly recurso: number;
  readonly complexidade: number;
  readonly duracao: number;
  readonly paciente: number;
  readonly prontuario: number | null;
  readonly planoTipo: TipoPlanoSessao;
  readonly plano: string;
  /** "AAAA-MM-DDTHH:MM" (hora civil do estabelecimento). */
  readonly inicio: string;
  readonly fim: string;
  readonly situacao: SituacaoSessao;
  readonly observacao: string | null;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
  readonly alteradoPor: string | null;
  readonly alteradoEm: string | null;
  readonly versao: number;
}

/** A ocupação ativa que impede um horário (a sessão de outra série no mesmo recurso ou do mesmo paciente). */
export interface OcupacaoSessaoLida {
  readonly id: number;
  readonly serie: number;
  readonly inicio: string;
  readonly fim: string;
}

/** A série nova, conferida pelo domínio (as datas e os conflitos já relidos). */
export interface SerieNova {
  readonly agenda: number;
  readonly recurso: number;
  readonly complexidade: number;
  readonly duracao: number;
  readonly duracaoMin: number;
  readonly intervaloDias: number;
  readonly pularFimDeSemana: boolean;
  readonly paciente: number;
  readonly prontuario: number | null;
  readonly planoTipo: TipoPlanoSessao;
  readonly plano: string;
  readonly observacao: string | null;
  /** O item marcado em cada sessão, quem indicou e quem paga (o plano exige; a porta própria recusa sem eles). */
  readonly itemAgendavel: number | null;
  readonly solicitante: number | null;
  readonly fontePagadora: number | null;
  readonly sessoes: readonly { readonly ordem: number; readonly inicio: string; readonly fim: string }[];
}

export interface GravadorSessoes {
  agendarSerie(s: SerieNova): Promise<{ serie: number; ids: number[] }>;
  atualizar(a: {
    id: number;
    situacao: Exclude<SituacaoSessao, 'agendada'>;
    motivo: string | null;
    versao: number;
  }): Promise<void>;
  cancelarRestantes(a: {
    id: number;
    serie: number;
    ordem: number;
    motivo: string;
    versao: number;
  }): Promise<number>;
}

export interface PacienteSessao {
  readonly id: number;
  readonly prontuario: number | null;
  readonly nome: string;
  readonly nascimento: string | null;
  readonly ativo: boolean;
}

export interface PortaSessoes extends PortaGravacaoM18<GravadorSessoes> {
  /** O relógio do estabelecimento ("AAAA-MM-DDTHH:MM" e "AAAA-MM-DD"). */
  relogio(c: ContextoSessoes): Promise<{ agora: string; hoje: string }>;
  recursos(c: ContextoSessoes): Promise<RecursoDeSessao[]>;
  dominios(c: ContextoSessoes): Promise<{
    complexidades: { codigo: number; nome: string }[];
    duracoes: { codigo: number; nome: string }[];
  }>;
  periodo(
    c: ContextoSessoes,
    de: string,
    ate: string,
    recursos: readonly number[] | null,
  ): Promise<{ sessoes: SessaoAgendada[]; cortada: boolean }>;
  doPaciente(
    c: ContextoSessoes,
    paciente: number,
    desde: string,
  ): Promise<{ sessoes: SessaoAgendada[]; cortada: boolean }>;
  sessao(c: ContextoSessoes, id: number): Promise<SessaoAgendada | null>;
  serie(c: ContextoSessoes, serie: number): Promise<SessaoAgendada[]>;
  /** A ocupação ativa que impede cada horário, conferida horário a horário (nunca a janela inteira, sem corte). */
  ocupacoes(
    c: ContextoSessoes,
    alvo: { readonly recurso: number } | { readonly paciente: number },
    horarios: readonly { readonly inicio: string; readonly fim: string }[],
  ): Promise<OcupacaoSessaoLida[]>;
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
