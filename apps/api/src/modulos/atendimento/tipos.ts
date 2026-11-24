// Tipos de negócio do atendimento externo (recepção, consultório e pronto atendimento): o que as portas (própria sobre
// o MariaDB e memória de dev/ci) entregam às telas, em vocabulário neutro (booleano, data e instante ISO, id numérico).
// Melhoria: os tipos deixam de vir de um pacote de leitura do sistema antigo e passam a ser do próprio módulo.
import type { DependenteDoProblema } from '@sgh/nucleo';
import type { TipoAtendimento } from '@sgh/contratos';

export const ORIGENS_ESCORE_PA = ['classificacao', 'reavaliacao', 'relancamento'] as const;
export type OrigemEscorePa = (typeof ORIGENS_ESCORE_PA)[number];

/** Sinais usados no escore de deterioração e de sepse do PA. */
export interface SinaisDoEscore {
  readonly fr: number | null;
  readonly spo2: number | null;
  readonly o2: number | null;
  readonly pas: number | null;
  readonly fc: number | null;
  readonly consciencia: string | null;
  readonly temperatura: number | null;
  readonly leucocitos: number | null;
  readonly bastoes10: boolean | null;
}

/** Escore do PA calculado pelo servidor, a gravar (só inclusão). */
export interface NovoEscorePa {
  readonly cabecalho: string;
  readonly reg: number;
  readonly origem: OrigemEscorePa;
  readonly sinais: SinaisDoEscore;
  readonly news2: number;
  readonly news2Completo: boolean;
  readonly qsofa: number;
  readonly qsofaCompleto: boolean;
  readonly sirs: number;
  readonly sirsCompleto: boolean;
  readonly nivel: string;
  readonly sugereSepse: boolean;
  readonly limiarNews2: number;
  readonly limiarQsofa: number;
  /** O relançamento: o escore estornado que este substitui (do mesmo atendimento). */
  readonly substitui: number | null;
  readonly motivo: string | null;
  readonly usuario: string;
}

/** Escore do PA registrado (com o estorno, quando houve). */
export interface EscorePaRegistrado extends Omit<NovoEscorePa, 'usuario'> {
  readonly id: number;
  readonly aferidoEm: string;
  readonly usuario: string;
  readonly estorno: { readonly motivo: string; readonly usuario: string; readonly em: string } | null;
}

/** Os sinais mais recentes de um atendimento (um por tipo). */
export interface SinaisRecentes {
  readonly pas: number | null;
  readonly pad: number | null;
  readonly fc: number | null;
  readonly fr: number | null;
  readonly temperatura: number | null;
  readonly saturacao: number | null;
  readonly glicemia: number | null;
  readonly dor: number | null;
  readonly glasgow: number | null;
}

/** Item da fila do consultório. */
export interface ItemFila {
  readonly reg: number;
  readonly cabecalho: string;
  /** O cadastro do paciente: o prontuário eletrônico abre por ele. */
  readonly idPaciente: number | null;
  readonly paciente: string;
  readonly prontuario: number;
  readonly senha: string | null;
  readonly prioridade: '0' | '1' | '2';
  readonly agendadoPara: string | null;
  readonly chegada: string;
  /** A última etapa do fluxo da senha no local (C chamada, A em atendimento, L liberada, X, N) ou a situação da fila. */
  readonly letraNoLocal: string | null;
  readonly situacaoNovo: string | null;
  readonly chamadas: number;
  readonly tipo: TipoAtendimento | null;
  readonly convenio: string;
  readonly crm: number;
  readonly encerrado: boolean;
}

/** Atendimento aberto no quadro do PA. */
export interface AtendimentoPa {
  readonly reg: number;
  readonly cabecalho: string;
  readonly paciente: string;
  readonly nascimento: string | null;
  readonly senha: string | null;
  readonly prioridade: '0' | '1' | '2';
  readonly chegada: string;
  readonly profissional: string;
  readonly marcas: { etapa: string; em: string }[];
  readonly leito: string | null;
  readonly observacaoDesde: string | null;
  /** As marcas de etapa existem (o atendimento aberto fora do fluxo do PA não tem). */
  readonly comMarcas: boolean;
  /** Saída sem o desfecho codificado: 'liberado' (a senha liberada) ou 'alta'; null = aberto. */
  readonly saida: 'liberado' | 'alta' | null;
  /** Nome social e prontuário (painel do PA e fila da classificação). */
  readonly prontuario?: number;
  readonly nomeSocial?: string | null;
}

export interface LeitoObservacao {
  readonly id: number;
  readonly codigo: string;
  readonly local: string;
  readonly tipo: string;
  readonly ativo: boolean;
  readonly ocupacao: {
    reg: number;
    cabecalho: string;
    paciente: string;
    entrada: string;
    minutos: number;
  } | null;
}

export interface IndicadoresDados {
  readonly porTipo: {
    tipoAte: number;
    laboratorio: boolean;
    especialidadeZero: boolean;
    caracters: number;
    total: number;
  }[];
  readonly desfechos: { desfecho: string; tipoAte: number; total: number }[];
  /** As fichas de PA com as marcas de etapa. */
  readonly marcasPa: { cabecalho: string; etapa: string; em: string }[];
  readonly observacoes: { cabecalho: string; minutos: number }[];
  readonly paTotal: number;
  /** Visitas ao PA do período e dos 3 dias anteriores (retorno em 72 horas; paciente = chave do paciente). */
  readonly visitasPa: { paciente: string; data: string; hora: string }[];
  /** Fichas do PA do período que resultaram em internação. */
  readonly internacoesPa: { viaDesfecho: number; viaEncaminhamento: number; total: number };
}

export interface ApoioAtendimentoDados {
  readonly convenios: { codigo: number; nome: string; ativo: boolean }[];
  readonly unidades: { codigo: number; nome: string }[];
  readonly especialidades: { codigo: number; nome: string }[];
  readonly profissionais: {
    id: number;
    crm: number;
    nome: string;
    especialidades: number[];
    ativo: boolean;
    cbo: string;
  }[];
  readonly centrosCusto: { codigo: number; nome: string }[];
  readonly motivosExclusao: { codigo: number; nome: string }[];
  /** As marcas da herança em vigor para a sessão, pela chave da regra (`HERANCAS[].chave`). */
  readonly heranca: Record<string, boolean>;
  /** A configuração por escopo: a do estabelecimento (sem as regras pessoais) e as regras pessoais do usuário. */
  readonly herancaEscopo?: {
    readonly estabelecimento: Record<string, boolean>;
    readonly pessoal: Record<string, boolean>;
  };
}

/** A marcação de agenda que a abertura do atendimento preenche. */
export interface MarcacaoParaAbertura {
  readonly id: number;
  readonly data: string;
  readonly hora: string;
  readonly hoje: boolean;
  readonly registro: number;
  readonly paciente: { id: number; nome: string; prontuario: number; nascimento: string | null } | null;
  readonly convenio: number;
  readonly crm: number;
  readonly especialidade: number;
  readonly unidade: number;
  readonly centroCusto: number;
  readonly procedimento: number;
  readonly retorno: boolean;
}

/** A prévia da exclusão do atendimento (o que impede e o que acontece com a conta). */
export interface PreviaCancelamentoDados {
  readonly pode: boolean;
  readonly motivo: string | null;
  readonly situacaoConta: string;
  readonly itensConta: number;
  readonly procedimentosExtras: number;
  readonly senha: number | null;
  readonly desfecho: boolean;
  /** Atendimento aberto a partir de uma marcação (a marcação volta a não atendida). */
  readonly marcacao?: boolean;
  /** O que impede a exclusão física (quantos e quais) e a oferta da anulação lógica. */
  readonly dependentes?: readonly DependenteDoProblema[];
  readonly saida?: 'anular';
}

/** O termo da busca do dia: número do atendimento, senha (letras e número) ou nome. */
export function termoDoDia(
  termo: string | undefined,
):
  | { tipo: 'numero'; n: number }
  | { tipo: 'senha'; letra: string; n: number }
  | { tipo: 'nome'; t: string }
  | null {
  const t = (termo ?? '').trim().toUpperCase().slice(0, 40);
  if (t.length === 0) return null;
  if (/^\d{1,16}$/.test(t) && Number.isSafeInteger(Number(t))) return { tipo: 'numero', n: Number(t) };
  const sen = /^([A-Z]{1,4})\s*-?\s*(\d{1,6})$/.exec(t);
  if (sen) return { tipo: 'senha', letra: sen[1] as string, n: Number(sen[2]) };
  return t.length >= 2 ? { tipo: 'nome', t } : null;
}
