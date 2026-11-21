// Respostas da API da anestesia (ficha do M46, etapa 1): o que as telas da APA, da ficha anestésica e da SRPA
// recebem. Só identificadores e rótulos; o nome do paciente vem do cabeçalho do atendimento já auditado (leitura de
// prontuário), nunca do painel.
import type { GravacaoAgenda } from '../agenda/respostas.js';
import type {
  ClasseAsa,
  ConclusaoApa,
  DestinoAltaSrpa,
  ItemAldrete,
  MarcoFicha,
  MomentoSrpa,
  ParteFicha,
  RecusaAnestesia,
  SinalFicha,
  SituacaoFicha,
  TipoIngestao,
} from './anestesia-vocabulario.js';

/** Domínio lido do banco para os combos da ficha (SanteSelecao; cache por estabelecimento). */
export interface ItemDominioAnestesia {
  readonly id: number;
  readonly rotulo: string;
  readonly sigla: string | null;
  readonly ativo: boolean;
}

export interface DominiosFichaResposta {
  readonly tiposAnestesia: readonly ItemDominioAnestesia[];
  readonly posicoes: readonly ItemDominioAnestesia[];
  readonly modosRespiratorios: readonly ItemDominioAnestesia[];
  readonly funcoesEquipe: readonly ItemDominioAnestesia[];
  readonly tiposSinalLegado: readonly ItemDominioAnestesia[];
  readonly utilizacoes: readonly ItemDominioAnestesia[];
}

export interface AlergiaApa {
  readonly alergia: number;
  readonly nome: string;
}

export interface ExameRecenteApa {
  readonly id: number;
  readonly exame: string;
  readonly data: string | null;
  readonly liberado: boolean;
}

/** Contexto do paciente e da cirurgia para a APA e a ficha (leitura auditada). */
export interface ContextoAnestesiaResposta {
  readonly agendamento: number;
  readonly reg: number;
  /** O id do atendimento (null: sem atendimento; os fluidos da ficha não vão ao balanço hídrico). */
  readonly atendimento: number | null;
  readonly paciente: number | null;
  /** O nome do paciente (leitura auditada de prontuário); null sem paciente localizado. */
  readonly nome: string | null;
  readonly sala: number;
  readonly dataHora: string;
  readonly procedimento: string | null;
  readonly tipoAnestesiaAgendado: number | null;
  /** O anestesista do agendamento (id do registro profissional; null = sem anestesista). */
  readonly anestesistaAgendado: number | null;
  readonly anestesistaAgendadoNome: string | null;
  readonly alergias: readonly AlergiaApa[];
  readonly examesRecentes: readonly ExameRecenteApa[];
  readonly truncado: boolean;
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  /** A creatinina mais recente (mg/dL): acima de 2 sugere o critério de Lee. */
  readonly creatinina: number | null;
  readonly medicacoesEmUso: readonly string[];
  readonly medicacoesTruncado: boolean;
}

export interface JejumAvaliado {
  readonly tipo: TipoIngestao;
  readonly horas: number | null;
  readonly minimo: number;
  readonly suficiente: boolean;
}

export interface ApaResposta {
  readonly id: number;
  readonly agendamento: number;
  readonly versao: number;
  readonly avaliadoEm: string;
  readonly avaliadoPor: number;
  readonly asa: ClasseAsa;
  readonly emergencia: boolean;
  readonly rotuloAsa: string;
  readonly lee: { readonly pontos: number; readonly classe: 'I' | 'II' | 'III' | 'IV' };
  readonly jejum: readonly JejumAvaliado[];
  readonly conclusao: ConclusaoApa;
  readonly fechaPendencia: boolean;
  /** O formulário do prontuário (id do registro clínico) quando o formulário novo do M45 estiver publicado. */
  readonly registroProntuario: number | null;
  readonly avaliadoPorNome: string | null;
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  readonly viaAerea: Readonly<Record<string, unknown>>;
  /** As últimas ingestões informadas (para a retificação). */
  readonly ultimaIngestao: Readonly<Record<string, string | null>>;
  readonly criteriosLee: readonly string[];
  readonly alergiasConferidas: boolean;
  readonly comorbidades: string | null;
  readonly medicacoesEmUso: string | null;
  readonly examesConsiderados: string | null;
  readonly anestesiasAnteriores: string | null;
  readonly plano: Readonly<Record<string, unknown>>;
  readonly ressalvas: string | null;
  readonly usuario: string;
}

/** A tela da APA: o contexto, a versão vigente, o histórico de versões e o que a sessão pode. */
export interface TelaApaResposta {
  readonly contexto: ContextoAnestesiaResposta;
  readonly vigente: ApaResposta | null;
  readonly versoes: readonly {
    readonly versao: number;
    readonly avaliadoEm: string;
    readonly conclusao: ConclusaoApa;
    readonly usuario: string;
  }[];
  readonly tiposAnestesia: readonly ItemDominioAnestesia[];
  readonly gravacao: GravacaoAgenda;
}

export interface LancamentoFichaResposta {
  readonly id: number;
  readonly parte: ParteFicha;
  readonly momento: string;
  readonly fim: string | null;
  readonly descricao: string;
  readonly valor: number | null;
  readonly unidade: string | null;
  readonly registradoPor: number;
  readonly registradoEm: string;
  /** Infusão contínua ou gás (pode ganhar o fim depois). */
  readonly podeEncerrar: boolean;
  /** Fluido e perda: levado ao balanço hídrico (null nas outras partes). */
  readonly noBalanco: boolean | null;
  /** Os campos da parte (sinal: tipo e valor; fármaco: item, dose, via…), para o gráfico e a lista. */
  readonly dados: Readonly<Record<string, string | number | null>>;
}

export interface LacunaSinal {
  readonly inicio: string;
  readonly fim: string;
  readonly sinais: readonly SinalFicha[];
  readonly justificada: boolean;
}

export interface ResponsavelFicha {
  readonly anestesista: number;
  readonly de: string;
  readonly ate: string | null;
}

export interface FichaAnestesicaResposta {
  readonly id: number;
  readonly agendamento: number;
  readonly versao: number;
  readonly situacao: SituacaoFicha;
  readonly marcos: Partial<Record<MarcoFicha, string>>;
  readonly lancamentos: readonly LancamentoFichaResposta[];
  readonly lacunas: readonly LacunaSinal[];
  readonly responsaveis: readonly ResponsavelFicha[];
  readonly totais: {
    readonly ganhosMl: number;
    readonly perdasMl: number;
    readonly hemocomponentesMl: number;
  };
  readonly assinadaPor: number | null;
  readonly assinadaEm: string | null;
  /** O que impede assinar agora (vazio = pode assinar). */
  readonly pendenciasAssinatura: readonly RecusaAnestesia[];
  readonly hash: string | null;
  /** Os anestesistas da cirurgia (o do agendamento, a equipe com a função e quem teve a responsabilidade). */
  readonly anestesistas: readonly number[];
  readonly responsavelAtual: number | null;
  readonly passagens: readonly {
    readonly id: number;
    readonly momento: string;
    readonly de: number;
    readonly para: number;
    readonly resumo: string;
  }[];
  readonly justificativas: readonly {
    readonly id: number;
    readonly inicio: string;
    readonly fim: string;
    readonly motivo: string;
  }[];
  readonly adendos: readonly {
    readonly id: number;
    readonly texto: string;
    readonly profissional: number;
    readonly em: string;
  }[];
  /** Os nomes dos profissionais citados (equipe, responsáveis, assinatura). */
  readonly nomes: Readonly<Record<string, string>>;
}

/** A tela da ficha: o contexto, a ficha (null antes do primeiro lançamento), os domínios e o que a sessão pode. */
export interface TelaFichaResposta {
  readonly contexto: ContextoAnestesiaResposta;
  readonly ficha: FichaAnestesicaResposta | null;
  readonly dominios: DominiosFichaResposta;
  /** O relógio do estabelecimento (AAAA-MM-DDTHH:mm). */
  readonly agora: string;
  /** O registro profissional da sessão que é anestesista da cirurgia, ou o primeiro da sessão (null: sem registro). */
  readonly profissionalSessao: number | null;
  readonly gravacao: GravacaoAgenda;
}

export interface AvaliacaoSrpaResposta {
  readonly id: number;
  readonly momento: MomentoSrpa;
  readonly em: string;
  readonly aldrete: Readonly<Record<ItemAldrete, number>>;
  readonly total: number;
  readonly dor: number;
  readonly nvpo: number;
  readonly registradoPor: number | null;
  readonly usuario: string;
}

export interface SrpaResposta {
  readonly agendamento: number;
  readonly reg: number;
  readonly avaliacoes: readonly AvaliacaoSrpaResposta[];
  readonly regraVersao: number;
  readonly proximaAvaliacaoAte: string | null;
  readonly podeDarAlta: boolean;
  readonly impedimentosAlta: readonly RecusaAnestesia[];
  readonly alta: { readonly em: string; readonly destino: DestinoAltaSrpa } | null;
  /** O ID da última avaliação (concorrência: a gravação recusa se outra entrou no meio); 0 sem avaliação. */
  readonly ultima: number;
  readonly avaliacaoVencida: boolean;
}

export interface TelaSrpaResposta {
  readonly contexto: ContextoAnestesiaResposta;
  readonly srpa: SrpaResposta;
  readonly agora: string;
  readonly gravacao: GravacaoAgenda;
}

export interface QuadroSrpaResposta {
  readonly linhas: readonly LinhaQuadroSrpa[];
  readonly truncado: boolean;
  readonly agora: string;
  readonly gravacao: GravacaoAgenda;
}

/** Uma cirurgia do dia para a escolha da APA, da ficha e da admissão na SRPA (com a situação de cada registro). */
export interface CirurgiaParaAnestesia {
  readonly agendamento: number;
  readonly sala: number;
  readonly inicio: string;
  readonly paciente: string;
  readonly procedimento: string | null;
  readonly apa: ConclusaoApa | null;
  readonly ficha: SituacaoFicha | null;
  readonly srpa: MomentoSrpa | null;
}

export interface CirurgiasParaAnestesiaResposta {
  readonly data: string;
  readonly itens: readonly CirurgiaParaAnestesia[];
  readonly truncado: boolean;
}

/** O resultado de uma gravação da anestesia (o ID do registro e a mensagem para a tela). */
export interface ResultadoAnestesia {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
}

/** Linha do quadro da SRPA (sem nome do paciente: leito, tempo de permanência e o último índice). */
export interface LinhaQuadroSrpa {
  readonly agendamento: number;
  readonly sala: number;
  readonly admitidoEm: string;
  readonly ultimoTotal: number | null;
  readonly avaliacaoVencida: boolean;
  readonly podeDarAlta: boolean;
  readonly proximaAte: string | null;
  readonly permanenciaMin: number;
  /** O nome do paciente só para quem tem a leitura da SRPA (leitura auditada). */
  readonly paciente: string | null;
}
