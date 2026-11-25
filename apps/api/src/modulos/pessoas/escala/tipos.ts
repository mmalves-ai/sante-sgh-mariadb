// Tipos de negócio das portas da escala de plantão e do plantão realizado (F2.2, lote 03-04): o que a porta lê e grava,
// em vocabulário neutro (booleano, data ISO "AAAA-MM-DD", instante "AAAA-MM-DDTHH:MM", id numérico). Nada de
// estabelecimento em texto: a porta filtra pelo estabelecimento do contexto da sessão. `por` é o login de quem gravou
// (exibição); o banco guarda o id do usuário.
// Melhoria: sem o código do estabelecimento em cada registro (o isolamento é da porta, pelo contexto); o plantão é do
// colaborador, e o vínculo de trabalho é o ativo do colaborador no estabelecimento.

/** Teto de linhas da leitura "quem está de plantão agora". */
export const TETO_LEITURA_INSTANTE = 400;

export interface CamposRegimeJornada {
  readonly codigo: string;
  readonly nome: string;
  /** Tipo de jornada (tabela oficial do eSocial). */
  readonly jornada: number;
  /** Contrato em tempo parcial (0: não é; tabela oficial do eSocial). */
  readonly contratoParcial: number;
  readonly folgaPadrao: number | null;
  readonly minutosPlantao: number;
  readonly descansoMinimoMin: number;
  readonly limiteSemanalHoras: number;
  readonly acordo: string | null;
  readonly ativo: boolean;
}
export interface RegistroRegime extends CamposRegimeJornada {
  readonly id: number;
  readonly versao: number;
}
export interface RegistroVigencia {
  readonly vinculo: number;
  readonly regime: number;
  readonly desde: string;
  readonly por: string;
}
export interface RegistroVigenciaHistorico extends RegistroVigencia {
  readonly id: number;
  readonly em: string;
  readonly anulada: { readonly por: string; readonly em: string; readonly motivo: string } | null;
}
export interface CoberturaTurnos {
  readonly manha: number;
  readonly tarde: number;
  readonly noite: number;
}
export interface RegistroEscala {
  readonly id: number;
  /** Setor da escala (setor_funcional.id). */
  readonly unidade: number;
  /** Nome do setor (exibição). */
  readonly setor: string;
  /** Competência "AAAA-MM". */
  readonly competencia: string;
  readonly tipo: string;
  readonly estado: string;
  readonly cobertura: CoberturaTurnos;
  readonly justificativaFuro: string | null;
  readonly publicadaEm: string | null;
  readonly publicadaPor: string | null;
  readonly canceladaEm?: string | null;
  readonly canceladaPor?: string | null;
  readonly motivoCancelamento?: string | null;
  readonly versao: number;
  /** Plantões previstos (não cancelados). */
  readonly plantoes: number;
}
export interface FiltroRegistrosEscala {
  readonly competencia?: string | undefined;
  readonly unidade?: number | undefined;
  readonly tipo?: string | undefined;
  readonly estado?: string | undefined;
}
export interface DadosNovaEscala {
  readonly unidade: number;
  readonly setor: string;
  readonly competencia: string;
  readonly tipo: string;
  readonly cobertura: CoberturaTurnos;
  readonly por: string;
}
export interface RegistroPlantao {
  readonly id: number;
  readonly escala: number;
  readonly vinculo: number;
  /** Colaborador escalado. */
  readonly pessoa: number;
  readonly profissional: number | null;
  readonly registro: number | null;
  readonly tipo: string;
  readonly inicio: string;
  readonly fim: string;
  readonly chegadaMin: number | null;
  readonly situacao: string;
  readonly alertaConselho: string | null;
  readonly redeNaoConferida: boolean;
  readonly motivo: string | null;
  readonly versao: number;
}
export interface DadosNovoPlantao {
  readonly escala: number;
  readonly vinculo: number;
  readonly pessoa: number;
  readonly profissional: number | null;
  readonly registro: number | null;
  readonly tipo: string;
  readonly inicio: string;
  readonly fim: string;
  readonly chegadaMin: number | null;
  readonly alertaConselho: string | null;
  readonly redeNaoConferida: boolean;
  readonly motivo: string | null;
  readonly por: string;
}
export interface DadosMudancaPlantao {
  readonly id: number;
  readonly versao: number;
  readonly tipo: string;
  readonly inicio: string;
  readonly fim: string;
  readonly chegadaMin: number | null;
  readonly registro: number | null;
  readonly alertaConselho: string | null;
  readonly redeNaoConferida: boolean;
  readonly motivo: string | null;
  readonly por: string;
}
export interface DadosEventoEscala {
  readonly escala: number;
  readonly plantao: number | null;
  readonly acao: string;
  readonly descricao: string;
  readonly motivo: string | null;
  readonly por: string;
}
export interface RegistroEventoEscala {
  readonly id: number;
  readonly plantao: number | null;
  readonly acao: string;
  readonly descricao: string;
  readonly motivo: string | null;
  readonly por: string;
  readonly em: string;
}
export interface RegistroTroca {
  readonly id: number;
  readonly tipo: string;
  readonly estado: string;
  readonly plantao: number;
  readonly versaoPlantao: number;
  readonly vinculo: number;
  readonly vinculoColega: number;
  readonly plantaoColega: number | null;
  readonly versaoColega: number | null;
  readonly motivo: string;
  readonly pedidoPor: string;
  readonly pedidoEm: string;
  readonly respostaPor: string | null;
  readonly respostaEm: string | null;
  readonly confirmacao: string | null;
  readonly decisaoPor: string | null;
  readonly decisaoEm: string | null;
  readonly motivoDecisao: string | null;
  readonly versao: number;
}
export interface DadosNovaTroca {
  readonly tipo: string;
  readonly plantao: number;
  readonly versaoPlantao: number;
  readonly vinculo: number;
  readonly vinculoColega: number;
  readonly plantaoColega: number | null;
  readonly versaoColega: number | null;
  readonly motivo: string;
  readonly por: string;
}
export interface FiltroRegistrosTroca {
  readonly estado?: string;
  readonly escala?: number;
  /** Só as trocas em que um destes vínculos é parte (quem pede ou o colega). */
  readonly vinculos?: readonly number[];
}
export interface RegistroAcionamento {
  readonly id: number;
  readonly plantao: number;
  readonly situacao: string;
  readonly acionadoEm: string;
  readonly acionadoPor: string;
  readonly motivo: string;
  readonly atendimento: number | null;
  /** Prazo de chegada; nulo quando o modelo não o registra (pedido 03-04): o atraso não é calculável. */
  readonly prazoChegada: string | null;
  readonly chegouEm: string | null;
  readonly encerradoPor: string | null;
  readonly motivoCancelamento: string | null;
  readonly versao: number;
}
export interface DadosNovoAcionamento {
  readonly plantao: number;
  readonly acionadoEm: string;
  readonly prazoChegada: string;
  readonly motivo: string;
  readonly atendimento: number | null;
  readonly por: string;
}
export interface DadosDimensionamento {
  readonly unidade: number;
  readonly setor: string;
  readonly data: string;
  readonly turno: string;
  readonly fonte: string;
  readonly unidadeInternacao: string | null;
  readonly pacientes: {
    readonly minimos: number;
    readonly intermediarios: number;
    readonly altaDependencia: number;
    readonly semiIntensivos: number;
    readonly intensivos: number;
  };
  readonly nasSoma: number;
  readonly nasPacientes: number;
  readonly naoClassificados: number | null;
  readonly jornadaSemanalHoras: number;
  readonly ist: number;
  readonly totalHoras: number;
  readonly km: number;
  readonly quantitativo: number;
  readonly totalProfissionais: number;
  readonly enfermeiros: number;
  readonly tecnicos: number;
  readonly percentualEnfermeiros: number;
  readonly categoriaPrevalente: string | null;
  readonly coberturaSugerida: number;
  readonly parcelas: readonly string[];
  readonly por: string;
}
export interface RegistroDimensionamento extends Omit<DadosDimensionamento, 'por'> {
  readonly id: number;
  readonly calculadoPor: string;
  readonly calculadoEm: string;
}
export interface RegistroPlantaoNoInstante {
  readonly id: number;
  readonly escala: number;
  readonly unidade: number;
  readonly setor: string;
  readonly tipoEscala: string;
  readonly vinculo: number;
  readonly nome: string;
  readonly profissional: number | null;
  readonly registro: number | null;
  readonly tipo: string;
  readonly inicio: string;
  readonly fim: string;
  readonly chegadaMin: number | null;
  readonly situacao: string;
}
export interface FiltroPlantaoNoInstante {
  readonly unidade?: number;
  readonly setor?: string;
  readonly tipo?: string;
}
export interface UnidadeInternacaoOcupada {
  /** Código da unidade de internação. */
  readonly unidade: string;
  readonly nome: string;
  readonly internados: number;
}
/** A classificação de pacientes do turno, só pela categoria e pelo total (nada do paciente além do id). */
export interface ClassificacaoDoTurno {
  readonly paciente: number;
  readonly instrumento: 'fugulin' | 'nas';
  readonly categoria: string;
  readonly total: number;
}
export interface OpcaoDominioEscala {
  readonly codigo: number;
  readonly nome: string;
}
export interface OpcaoTempoParcial extends OpcaoDominioEscala {
  readonly limiteSemanalHoras: number | null;
}
/** Registros ligados a outro (mapa de dependências): o grupo de negócio e a quantidade. */
export interface DependenciaContada {
  readonly grupo: string;
  readonly tabela: string;
  readonly coluna: string;
  readonly quantidade: number;
}
export interface EventoPeriodoPonto {
  readonly id: number;
  readonly vinculo: number;
  readonly competencia: string;
  readonly acao: 'fechado' | 'reaberto' | 'ciencia';
  readonly ref: number | null;
  readonly hash: string | null;
  readonly totais: string | null;
  readonly concorda: boolean | null;
  readonly texto: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}
export interface RegistroPlantaoParaRealizado {
  readonly plantao: number;
  readonly escala: number;
  readonly estadoEscala: string;
  readonly unidade: number;
  readonly vinculo: number;
  readonly pessoa: number;
  readonly nome: string;
  readonly tipoVinculo: string;
  readonly usuario: number | null;
  readonly registro: number | null;
  readonly tipo: string;
  readonly inicio: string;
  readonly fim: string;
  readonly situacao: string;
}
export interface RegistroRealizado {
  readonly id: number;
  readonly plantao: number;
  readonly vinculo: number;
  readonly pessoa: number;
  readonly inicio: string;
  readonly fim: string;
  readonly minutos: number;
  readonly origem: 'informado' | 'ponto';
  readonly observacao: string | null;
  readonly situacao: 'informado' | 'aprovado' | 'recusado' | 'substituido' | 'estornado';
  readonly informadoPor: string;
  readonly informadoEm: string;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
  readonly motivo: string | null;
  readonly tarifa: number | null;
  readonly valorHora: number | null;
  readonly valor: number | null;
  /** C2-100: a regra de plantão que deu o valor (null: tarifa geral por hora ou sem valor). */
  readonly regraPlantao?: number | null;
  /** A conta escrita do valor, parcela por parcela. */
  readonly parcelas?: string | null;
  readonly lancamento: number | null;
  readonly lancadoPor: string | null;
  readonly versao: number;
  readonly estorno?: {
    readonly por: string;
    readonly em: string;
    readonly motivo: string;
    readonly lancamento: number | null;
  } | null;
}
export interface DadosNovoRealizado {
  readonly plantao: number;
  readonly vinculo: number;
  readonly inicio: string;
  readonly fim: string;
  readonly minutos: number;
  readonly origem: 'informado' | 'ponto';
  readonly observacao: string | null;
  readonly por: string;
}
export interface RegistroTarifaPlantao {
  readonly id: number;
  readonly tipo: string;
  /** Setor (setor_funcional.id) ou null: vale para todos. */
  readonly unidade: number | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly valorHora: number;
  readonly criadoPor: string;
}
