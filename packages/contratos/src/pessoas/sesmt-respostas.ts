// Respostas das telas do SESMT, fatia F5 (M52; ficha, seções 4 e 7). O prontuário ocupacional é dado de saúde: cada
// leitura da ficha do colaborador é auditada (regra 16) e nada daqui vai ao PEP. Sem CPF, sem identificação de
// paciente. Os rótulos dos códigos ficam no vocabulário; os dos domínios do eSocial chegam no apoio.
import type {
  AssinaturaEpi,
  DoseVacinaSesmt,
  EstadoAcidente,
  ExposicaoBiologica,
  FonteExposicao,
  GravidadePendencia,
  MarcoSorologia,
  MaterialBiologico,
  NaturezaAso,
  PendenciaSesmt,
  ResultadoExameOcupacional,
  ResultadoSorologia,
  SituacaoProfilaxia,
  TesteFonte,
  TipoAcidente,
  TipoLinhaRisco,
  TipoRegistroEpi,
  VacinaSesmt,
} from './sesmt-vocabulario.js';
import type { DadosCatEntrada } from './sesmt-entradas.js';
import type { CorrecaoResposta } from './treinamento-respostas.js';

export interface OpcaoSesmt {
  readonly codigo: number;
  readonly rotulo: string;
}
export interface OpcaoSesmtTexto {
  readonly codigo: string;
  readonly rotulo: string;
}

export interface ApoioSesmt {
  readonly hoje: string;
  readonly agora: string;
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: {
    readonly ocupacional: boolean;
    readonly vacina: boolean;
    readonly acidente: boolean;
    readonly risco: boolean;
    readonly epi: boolean;
    readonly motivo: string | null;
  };
  readonly dominios: {
    readonly tiposAso: readonly OpcaoSesmt[];
    readonly conclusoesAso: readonly OpcaoSesmt[];
    readonly tiposCat: readonly OpcaoSesmt[];
    readonly iniciativasCat: readonly OpcaoSesmt[];
    readonly partesCorpo: readonly OpcaoSesmt[];
    readonly naturezas: readonly OpcaoSesmt[];
    readonly agentes: readonly OpcaoSesmt[];
    readonly situacoes: readonly OpcaoSesmt[];
    readonly gruposRisco: readonly OpcaoSesmtTexto[];
    readonly eficaciasEpc: readonly OpcaoSesmt[];
    readonly unidades: readonly OpcaoSesmt[];
  };
  readonly parametros: {
    readonly periodicidadeAsoMeses: number;
    readonly alertaAsoDias: number;
    readonly prazoCatDiasUteis: number;
  };
}

export interface PendenciaResposta {
  readonly codigo: PendenciaSesmt;
  readonly texto: string;
  readonly gravidade: GravidadePendencia;
}

/** O colaborador nas telas do SESMT (sem CPF). */
export interface ColaboradorSesmt {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly cargo: string;
  readonly funcao: string | null;
  readonly unidade: number | null;
  readonly unidadeNome: string | null;
  readonly setor: string | null;
  readonly admissao: string;
  readonly desligamento: string | null;
}

export interface LinhaPainelSesmt extends ColaboradorSesmt {
  readonly proximoAso: string | null;
  readonly pendencias: readonly PendenciaResposta[];
}

export interface PainelSesmt {
  readonly hoje: string;
  readonly itens: readonly LinhaPainelSesmt[];
  readonly total: number;
  readonly pagina: number;
  readonly paginas: number;
  /** Quantos colaboradores ativos com cada pendência (todos os ativos, antes do filtro e da página). */
  readonly contagens: Readonly<Partial<Record<PendenciaSesmt, number>>>;
  readonly ativos: number;
}

export interface BuscaColaboradoresSesmt {
  readonly itens: readonly ColaboradorSesmt[];
}

export interface ExameOcupacionalLido {
  readonly id: number;
  readonly exame: string;
  readonly data: string;
  readonly resultado: ResultadoExameOcupacional;
}

export interface AsoResposta {
  readonly id: number;
  readonly tipo: number;
  readonly tipoRotulo: string;
  readonly natureza: NaturezaAso;
  readonly data: string;
  readonly conclusao: number;
  readonly conclusaoRotulo: string;
  readonly restricoes: string | null;
  readonly medico: string;
  readonly medicoConselho: string | null;
  readonly proximo: string | null;
  readonly observacao: string | null;
  readonly exames: readonly ExameOcupacionalLido[];
  /** Este registro corrige o de ID `retifica` (com o motivo); o retificado aparece riscado, nunca some. */
  readonly retifica: number | null;
  readonly motivoRetificacao: string | null;
  readonly retificadoPor: number | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface ProntuarioOcupacional {
  readonly colaborador: ColaboradorSesmt;
  readonly hoje: string;
  readonly aso: {
    readonly situacao: 'valido' | 'a-vencer' | 'vencido' | 'sem-aso' | 'encerrado';
    readonly proximo: string | null;
    readonly diasParaVencer: number | null;
  };
  readonly asos: readonly AsoResposta[];
  readonly pendencias: readonly PendenciaResposta[];
  /** Pedido do exame ao laboratório do hospital: pelo fluxo de pedido de exame de hoje (regra 22). */
  readonly pedidoExame: { readonly integrado: false; readonly motivo: string };
}

export interface RegistroVacinaResposta {
  readonly id: number;
  readonly registro: 'dose' | 'anti-hbs';
  readonly vacina: VacinaSesmt;
  readonly vacinaRotulo: string;
  readonly dose: DoseVacinaSesmt | null;
  readonly data: string;
  readonly lote: string | null;
  readonly validadeLote: string | null;
  readonly antiHbs: number | null;
  readonly observacao: string | null;
  readonly retifica: number | null;
  readonly motivoRetificacao: string | null;
  readonly retificadoPor: number | null;
  readonly registradoPor: string;
}

export interface SituacaoVacinaResposta {
  readonly vacina: VacinaSesmt;
  readonly rotulo: string;
  readonly doses: number;
  readonly esquema: number;
  readonly completo: boolean;
  readonly ultimaDose: string | null;
  readonly reforcoAte: string | null;
  readonly antiHbs: number | null;
  readonly pendencias: readonly PendenciaResposta[];
}

export interface CarteiraVacinas {
  readonly colaborador: ColaboradorSesmt;
  readonly hoje: string;
  readonly situacao: readonly SituacaoVacinaResposta[];
  readonly registros: readonly RegistroVacinaResposta[];
}

export interface SorologiaResposta {
  readonly id: number;
  readonly marco: MarcoSorologia;
  readonly marcoRotulo: string;
  readonly prevista: string;
  readonly realizada: string | null;
  readonly resultado: ResultadoSorologia | null;
  readonly observacao: string | null;
  readonly atrasada: boolean;
}

export interface AcidenteResumo {
  readonly id: number;
  readonly vinculo: number;
  readonly nome: string;
  readonly ocorridoEm: string;
  readonly tipo: TipoAcidente;
  readonly biologico: boolean;
  readonly estado: EstadoAcidente;
  readonly catPrazo: string;
  readonly catNumero: string | null;
  readonly profilaxia: SituacaoProfilaxia;
  readonly pendencias: readonly PendenciaResposta[];
}

export interface ListaAcidentes {
  readonly hoje: string;
  readonly itens: readonly AcidenteResumo[];
  readonly depois: number | null;
}

export interface AcidenteResposta extends AcidenteResumo {
  readonly versao: number;
  readonly colaborador: ColaboradorSesmt;
  readonly unidade: number | null;
  readonly local: string;
  readonly descricao: string;
  readonly perfurocortante: boolean;
  readonly exposicao: ExposicaoBiologica | null;
  readonly material: MaterialBiologico | null;
  readonly fonte: FonteExposicao | null;
  readonly fonteTeste: TesteFonte | null;
  readonly parteCorpo: number | null;
  readonly natureza: number | null;
  readonly agente: number | null;
  readonly situacao: number | null;
  readonly afastamento: boolean;
  readonly obito: boolean;
  readonly profilaxiaEm: string | null;
  readonly profilaxiaObs: string | null;
  readonly profilaxiaSugerida: SituacaoProfilaxia;
  readonly tipoCat: number | null;
  readonly iniciativaCat: number | null;
  readonly catEmitidaEm: string | null;
  readonly catEmitidaPor: string | null;
  readonly encerradoEm: string | null;
  readonly motivoEncerramento: string | null;
  readonly sorologias: readonly SorologiaResposta[];
  readonly registradoPor: string;
  /** W0-06: os dados da CAT para o S-2210. */
  readonly cat: DadosCatEntrada;
  /** W0-06: a anulação (o motivo é o do encerramento). */
  readonly anuladoEm: string | null;
  readonly anuladoPor: string | null;
  /** W0-06: o histórico da retificação e da anulação (motivo, quem, quando e o valor anterior). */
  readonly correcoes?: readonly CorrecaoResposta[];
  /** W0-06: as empresas para o S-2210 e os eventos do acidente na fila do eSocial (nulo sem a fila). */
  readonly esocial?: EsocialDoAcidente | null;
}

/** W0-06: um S-2210 do acidente na fila (o original, o retificador e o descartado continuam guardados). */
export interface EventoCatResposta {
  readonly id: number;
  readonly evento: string;
  readonly situacao: string;
  readonly recibo: string | null;
  /** O evento que este retifica. */
  readonly anterior: number | null;
  readonly motivo: string | null;
  readonly em: string;
}

export interface EsocialDoAcidente {
  readonly empresas: readonly { readonly codigo: number; readonly rotulo: string }[];
  readonly eventos: readonly EventoCatResposta[];
}

export interface LinhaRiscoResposta {
  readonly id: number;
  readonly unidade: number | null;
  readonly unidadeNome: string | null;
  readonly setor: string | null;
  readonly funcao: string;
  readonly tipo: TipoLinhaRisco;
  readonly fatorRisco: string | null;
  readonly fatorRiscoRotulo: string | null;
  readonly grupoRisco: string | null;
  readonly grupoRiscoRotulo: string | null;
  readonly epc: number | null;
  readonly epcRotulo: string | null;
  readonly epi: string | null;
  readonly descricao: string | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly motivoFim: string | null;
}

export interface MapaRiscos {
  readonly hoje: string;
  readonly linhas: readonly LinhaRiscoResposta[];
}

export interface FatoresRisco {
  readonly itens: readonly OpcaoSesmtTexto[];
}

export interface RegistroEpiResposta {
  readonly id: number;
  readonly tipo: TipoRegistroEpi;
  readonly data: string;
  readonly epi: string | null;
  readonly caNumero: string | null;
  readonly caValidade: string | null;
  readonly quantidade: number | null;
  readonly assinatura: AssinaturaEpi | null;
  readonly assinadaEm: string | null;
  readonly periodoInicio: string | null;
  readonly doseMsv: number | null;
  readonly dosimetro: string | null;
  readonly agente: string | null;
  readonly duracaoMin: number | null;
  readonly observacao: string | null;
  readonly registradoPor: string;
  /** W0-06: o cancelamento com motivo (a cancelada não conta na pendência nem na dose). */
  readonly canceladoEm: string | null;
  readonly canceladoPor: string | null;
  readonly motivoCancelamento: string | null;
}

export interface EpiDoColaborador {
  readonly colaborador: ColaboradorSesmt;
  readonly hoje: string;
  /** O mapa que vale para a função e a unidade do vínculo. */
  readonly riscos: readonly LinhaRiscoResposta[];
  readonly episFaltando: readonly string[];
  readonly registros: readonly RegistroEpiResposta[];
  readonly dose: {
    readonly ano: number;
    readonly totalMsv: number;
    readonly parcelasMsv: readonly number[];
    readonly situacao: 'normal' | 'acima-limite' | 'acima-teto';
  };
  readonly pendencias: readonly PendenciaResposta[];
  /** W0-06: o histórico do cancelamento das entregas (motivo, quem, quando e o valor anterior). */
  readonly correcoes?: readonly CorrecaoResposta[];
}

export interface ResultadoSesmt {
  readonly id: number;
  readonly mensagem: string;
  /** W0-06: o que a operação pôs na fila do eSocial (retificador, S-3000 ou descarte do não enviado). */
  readonly esocial?: EfeitoEsocialSesmt;
}

/** W0-06: o efeito de uma operação do SESMT na fila do eSocial (nada sai do dev: a transmissão fica desligada). */
export interface EfeitoEsocialSesmt {
  readonly operacao: 'nenhuma' | 'original' | 'retificacao' | 'exclusao' | 'descarte';
  /** O evento gravado na fila (S-2210 ou S-3000); nulo na prévia, no descarte e quando não houve. */
  readonly evento: number | null;
  /** O evento anterior que continua guardado (o retificado, o excluído ou o descartado). */
  readonly anterior: number | null;
  readonly valido: boolean;
  readonly pendencias: readonly { codigo: string; mensagem: string }[];
}

/** PPP de consulta (D-PPP-525): um período de atribuição com os fatores de risco e o EPI exigido que valeram nele. */
export interface PeriodoPppResposta {
  readonly inicio: string;
  readonly fim: string | null;
  readonly funcao: string;
  readonly unidadeNome: string | null;
  readonly setor: string | null;
  readonly linhas: readonly (LinhaRiscoResposta & {
    readonly vigenteDe: string;
    readonly vigenteAte: string | null;
  })[];
}

/** Perfil Profissiográfico Previdenciário de consulta do colaborador (D-PPP-525). */
export interface PppColaborador {
  readonly colaborador: ColaboradorSesmt;
  readonly hoje: string;
  readonly periodos: readonly PeriodoPppResposta[];
  /** As entregas de EPI (com o CA) e as leituras do dosímetro, da mais antiga à mais nova. */
  readonly registros: readonly RegistroEpiResposta[];
  /** A monitoração biológica (os ASO em vigor e os exames): só para quem consulta o prontuário ocupacional. */
  readonly asos: readonly AsoResposta[] | null;
}
