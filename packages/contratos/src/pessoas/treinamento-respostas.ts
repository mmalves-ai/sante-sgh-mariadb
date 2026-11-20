// Respostas da fatia F6 da gestão de pessoas (M52.6; ficha, seções 5, 7 e 8, regras 20 e 21): telas de treinamentos
// (situação, cursos, turmas, POPs, ficha do colaborador), "Meu espaço" (autosserviço) e o plantão realizado com o
// relatório e o lançamento no repasse. Nenhum CPF sai daqui.
import type {
  AproveitamentoTreinamentoCodigo,
  CategoriaCurso,
  ModalidadeTurma,
  OrigemRealizado,
  PresencaTreinamentoCodigo,
  SituacaoPopCodigo,
  SituacaoRealizadoCodigo,
  SituacaoTreinamentoCodigo,
  SituacaoTurma,
} from './treinamento-vocabulario.js';

export interface ResultadoF6 {
  readonly id: number;
  readonly mensagem: string;
}

export interface GravacaoF6 {
  readonly ligada: boolean;
  readonly motivo: string | null;
}

export interface OpcaoF6 {
  readonly codigo: number;
  readonly rotulo: string;
}

// ── Treinamentos ──────────────────────────────────────────────────────────────────────────────────────────────

export interface ApoioTreinamento {
  readonly hoje: string;
  readonly gravacao: GravacaoF6;
  readonly acoes: { readonly registrar: boolean; readonly motivo: string | null };
  readonly unidades: readonly OpcaoF6[];
  readonly alertaDias: number;
}

export interface AlvoCursoResposta {
  readonly tipo: 'unidade' | 'funcao';
  readonly valor: string;
  readonly rotulo: string;
}

export interface CursoResposta {
  readonly id: number;
  readonly codigo: string;
  readonly titulo: string;
  readonly conteudo: string;
  readonly categoria: CategoriaCurso;
  readonly cargaMinimaMin: number;
  readonly validadeMeses: number;
  readonly obrigatorio: boolean;
  readonly ativo: boolean;
  readonly alvos: readonly AlvoCursoResposta[];
  readonly versao: number;
}

export interface ListaCursos {
  readonly itens: readonly CursoResposta[];
}

export interface TurmaResumo {
  readonly id: number;
  readonly curso: number;
  readonly cursoCodigo: string;
  readonly cursoTitulo: string;
  readonly inicio: string;
  readonly fim: string;
  readonly cargaMin: number;
  readonly instrutor: string;
  readonly modalidade: ModalidadeTurma;
  readonly situacao: SituacaoTurma;
  readonly participantes: number;
  readonly concluintes: number;
}

export interface ListaTurmas {
  readonly itens: readonly TurmaResumo[];
  readonly limitado: boolean;
}

export interface ParticipanteResposta {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly unidadeNome: string | null;
  readonly presenca: PresencaTreinamentoCodigo;
  readonly aproveitamento: AproveitamentoTreinamentoCodigo | null;
  readonly conclusao: string | null;
  readonly validoAte: string | null;
  readonly observacao: string | null;
  readonly versao: number;
}

/** W0-06: uma alteração ou correção com o valor anterior e o novo (a trilha da gestão de pessoas). */
export interface CorrecaoResposta {
  readonly id: number;
  readonly operacao: string;
  readonly registro: number;
  readonly antes: Readonly<Record<string, unknown>>;
  readonly depois: Readonly<Record<string, unknown>>;
  readonly motivo: string;
  readonly por: string;
  readonly em: string;
}

export interface PopResumo {
  readonly id: number;
  readonly codigo: string;
  readonly versao: number;
  readonly titulo: string;
}

export interface TurmaResposta extends TurmaResumo {
  readonly local: string | null;
  readonly observacao: string | null;
  readonly cursoConteudo: string;
  readonly validadeMeses: number;
  readonly pop: PopResumo | null;
  readonly motivoCancelamento: string | null;
  readonly versao: number;
  readonly lista: readonly ParticipanteResposta[];
  readonly acoes: {
    readonly inscrever: boolean;
    readonly registrar: boolean;
    readonly encerrar: boolean;
    readonly cancelar: boolean;
    /** W0-06: alterar a turma aberta, retirar inscrição feita por engano e corrigir presença lançada. */
    readonly alterar?: boolean;
    readonly retirar?: boolean;
    readonly corrigir?: boolean;
    readonly motivo: string | null;
  };
  /** W0-06: as alterações e correções da turma e da lista, com o valor anterior (o mais recente primeiro). */
  readonly correcoes?: readonly CorrecaoResposta[];
}

export interface PendenciaCursoResposta {
  readonly curso: number;
  readonly codigo: string;
  readonly titulo: string;
  readonly situacao: SituacaoTreinamentoCodigo;
  readonly validoAte: string | null;
  readonly dias: number | null;
}

export interface LinhaSituacaoTreinamento {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly unidadeNome: string | null;
  readonly funcao: string | null;
  readonly pendencias: readonly PendenciaCursoResposta[];
  readonly popsPendentes: number;
}

export interface PainelTreinamento {
  readonly hoje: string;
  readonly itens: readonly LinhaSituacaoTreinamento[];
  readonly contagem: {
    readonly colaboradores: number;
    readonly emDia: number;
    readonly aVencer: number;
    readonly vencidos: number;
    readonly pendentes: number;
  };
  readonly limitado: boolean;
}

export interface CursoDoColaborador {
  readonly curso: number;
  readonly codigo: string;
  readonly titulo: string;
  readonly obrigatorio: boolean;
  readonly situacao: SituacaoTreinamentoCodigo;
  readonly ultimaConclusao: string | null;
  readonly validoAte: string | null;
}

export interface ParticipacaoDoColaborador {
  readonly treinamento: number;
  readonly cursoTitulo: string;
  readonly inicio: string;
  readonly fim: string;
  readonly cargaMin: number;
  readonly instrutor: string;
  readonly presenca: PresencaTreinamentoCodigo;
  readonly aproveitamento: AproveitamentoTreinamentoCodigo | null;
  readonly conclusao: string | null;
  readonly validoAte: string | null;
}

export interface PopDoColaborador extends PopResumo {
  readonly vigencia: string;
  readonly ciente: string | null;
  readonly origemCiencia: 'proprio' | 'treinamento' | null;
}

export interface FichaTreinamento {
  readonly colaborador: {
    readonly vinculo: number;
    readonly nome: string;
    readonly matricula: string | null;
    readonly unidadeNome: string | null;
    readonly funcao: string | null;
    readonly cargo: string;
  };
  readonly cursos: readonly CursoDoColaborador[];
  readonly participacoes: readonly ParticipacaoDoColaborador[];
  readonly pops: readonly PopDoColaborador[];
}

export interface PopResposta extends PopResumo {
  readonly unidade: number | null;
  readonly unidadeNome: string | null;
  readonly vigencia: string;
  readonly situacao: SituacaoPopCodigo;
  readonly resumo: string;
  readonly referencia: string | null;
  readonly alteracoes: string | null;
  readonly motivo: string | null;
  readonly publicadoPor: string;
  readonly publicadoEm: string;
  readonly adesao: {
    readonly alcancados: number;
    readonly cientes: number;
    readonly percentual: number;
  } | null;
}

export interface ListaPops {
  readonly itens: readonly PopResposta[];
}

export interface PopDetalhe {
  readonly versoes: readonly PopResposta[];
  readonly pendentes: readonly {
    vinculo: number;
    nome: string;
    matricula: string | null;
    unidadeNome: string | null;
  }[];
  readonly limitado: boolean;
}

// ── Meu espaço (autosserviço) ─────────────────────────────────────────────────────────────────────────────────

export interface MeuPlantao {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string;
  readonly tipo: string;
  readonly unidadeNome: string | null;
  readonly chegadaMin: number | null;
}

export interface MeuPopPendente extends PopResumo {
  readonly vigencia: string;
  readonly resumo: string;
  readonly referencia: string | null;
  readonly alteracoes: string | null;
}

export type BlocoMeuEspaco = 'plantoes' | 'ponto' | 'saude';

export interface MeuEspaco {
  readonly hoje: string;
  readonly liberado: GravacaoF6;
  readonly colaborador: {
    readonly vinculo: number;
    readonly nome: string;
    readonly matricula: string | null;
    readonly tipo: string;
    readonly cargo: string;
    readonly funcao: string | null;
    readonly unidadeNome: string | null;
    readonly admissao: string;
    readonly desligamento: string | null;
  } | null;
  readonly outrosVinculos: readonly { vinculo: number; rotulo: string }[];
  /** Os blocos que não puderam ser lidos agora (a tela avisa em vez de mostrar "nenhum"). */
  readonly indisponiveis: readonly BlocoMeuEspaco[];
  readonly plantoes: readonly MeuPlantao[];
  readonly ponto: { readonly saldoBancoMin: number | null; readonly competencia: string };
  readonly treinamentos: readonly PendenciaCursoResposta[];
  readonly pops: readonly MeuPopPendente[];
  readonly saude: {
    readonly proximoAso: string | null;
    readonly asoVencido: boolean;
    readonly vacinasPendentes: readonly string[];
  };
  /** Holerite e férias: só com a folha no Sante SGH (M53); senão, a frase de onde consultar. */
  readonly folha: { readonly disponivel: boolean; readonly mensagem: string };
}

// ── Plantão realizado e repasse ───────────────────────────────────────────────────────────────────────────────

export interface RealizadoResposta {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string;
  readonly minutos: number;
  readonly origem: OrigemRealizado;
  readonly situacao: SituacaoRealizadoCodigo;
  readonly observacao: string | null;
  readonly informadoPor: string;
  readonly informadoEm: string;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
  readonly motivo: string | null;
  readonly valorHora: number | null;
  readonly valor: number | null;
  readonly parcelas: string | null;
  readonly lancamento: number | null;
  readonly versao: number;
  /** W0-06: o estorno (quem, quando, o motivo e o lançamento negativo no repasse, se havia lançamento). */
  readonly estorno?: {
    readonly por: string;
    readonly em: string;
    readonly motivo: string;
    readonly lancamento: number | null;
  } | null;
  /**
   * Revisão W0-06: estornado e lançado no repasse, sem o lançamento negativo ligado (o estorno parou no meio). O mesmo
   * pedido de estorno o conclui: liga o negativo já lançado ou o lança.
   */
  readonly estornoPendente?: boolean;
}

export interface LinhaRealizado {
  readonly plantao: number;
  readonly escala: number;
  readonly unidadeNome: string | null;
  readonly vinculo: number;
  readonly nome: string;
  readonly tipoVinculo: string;
  readonly tipoPlantao: string;
  readonly previstoInicio: string;
  readonly previstoFim: string;
  readonly realizado: RealizadoResposta | null;
  readonly acoes: {
    readonly registrar: boolean;
    readonly decidir: boolean;
    /** W0-06: estornar o aprovado (com o motivo). */
    readonly estornar?: boolean;
    readonly motivo: string | null;
  };
}

export interface ApoioRealizado {
  readonly hoje: string;
  readonly agora: string;
  readonly gravacao: GravacaoF6;
  readonly acoes: {
    readonly registrar: boolean;
    readonly aprovar: boolean;
    readonly lancar: boolean;
    readonly tarifa: boolean;
    readonly motivo: string | null;
  };
  readonly unidades: readonly OpcaoF6[];
  /** O lançamento no repasse (DP-33): a chave, o evento configurado e o motivo quando desligado. */
  readonly repasse: {
    readonly ligado: boolean;
    readonly evento: number | null;
    readonly motivo: string | null;
  };
}

export interface ListaRealizado {
  readonly competencia: string;
  readonly itens: readonly LinhaRealizado[];
  readonly contagem: {
    readonly plantoes: number;
    readonly semRealizado: number;
    readonly aguardando: number;
    readonly aprovados: number;
    readonly recusados: number;
  };
  readonly limitado: boolean;
}

export interface SugestaoRealizado {
  readonly plantao: number;
  readonly sugestao: { readonly inicio: string; readonly fim: string } | null;
  readonly marcacoes: number;
}

export interface TarifaResposta {
  readonly id: number;
  readonly tipo: string;
  readonly unidade: number | null;
  readonly unidadeNome: string | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly valorHora: number;
  readonly criadoPor: string;
}

export interface ListaTarifas {
  readonly itens: readonly TarifaResposta[];
}

export interface GrupoRepasseResposta {
  readonly prestador: number;
  readonly registro: number;
  readonly nome: string;
  readonly competencia: string;
  readonly realizados: readonly number[];
  readonly plantoes: number;
  readonly minutos: number;
  readonly valor: number;
  readonly parcelas: string;
}

export interface RelatorioRepasse {
  readonly competencia: string;
  readonly grupos: readonly GrupoRepasseResposta[];
  readonly lancados: readonly {
    readonly realizado: number;
    readonly nome: string;
    readonly lancamento: number;
    readonly valor: number | null;
  }[];
  readonly foraDoRepasse: readonly {
    readonly realizado: number;
    readonly nome: string;
    readonly motivo: string;
  }[];
  readonly total: { readonly valor: number; readonly parcelas: string };
  readonly repasse: {
    readonly ligado: boolean;
    readonly evento: number | null;
    readonly motivo: string | null;
  };
  readonly limitado: boolean;
}

export interface ResultadoLancamentoPlantao {
  readonly lancamento: number;
  readonly valor: number;
  readonly realizados: number;
  readonly mensagem: string;
}
