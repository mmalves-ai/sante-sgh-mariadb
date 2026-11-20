// Respostas das telas do ponto, fatia F4 (M52.4; ficha do M52, seções 4, 7 e 8; regras 11 a 15). Nenhum CPF sai daqui:
// o colaborador vem pelo vínculo, pelo nome e pela matrícula; o AEJ (que tem o CPF por obrigação legal) é um arquivo à
// parte, com permissão própria e leitura auditada.
import type { CorrecaoResposta } from './treinamento-respostas.js';
import type {
  AcaoFechamento,
  AlertaPonto,
  ClasseHora,
  DestinoBanco,
  EventoFolha,
  FalhaAfd,
  FonteMarcacao,
  InconsistenciaPonto,
  InicioBanco,
  OrigemBanco,
  SituacaoAfd,
  SituacaoAjuste,
  TipoAjuste,
  TipoRep,
} from './ponto-vocabulario.js';

export interface OpcaoPonto {
  readonly codigo: number;
  readonly rotulo: string;
}

export interface ApoioPonto {
  readonly hoje: string;
  /** A competência que a tela abre: a anterior (a que já pode fechar). */
  readonly competenciaPadrao: string;
  readonly gravacao: { readonly ligada: boolean; readonly motivo: string | null };
  readonly acoes: {
    readonly importar: boolean;
    readonly justificar: boolean;
    readonly aprovar: boolean;
    readonly exportar: boolean;
    readonly regraBanco: boolean;
    readonly motivo: string | null;
  };
  /** Regra 15: a biometria no ponto fica desligada até a base legal do DPO (o aviso mostra por quê). */
  readonly biometria: { readonly ligada: boolean; readonly motivo: string };
  readonly dominios: {
    readonly modelosRelogio: readonly OpcaoPonto[];
    readonly movimentos: readonly OpcaoPonto[];
    readonly justificativas: readonly OpcaoPonto[];
    readonly periodos: readonly OpcaoPonto[];
    readonly classes: readonly OpcaoPonto[];
    readonly eventos: readonly OpcaoPonto[];
    readonly destinosBanco: readonly OpcaoPonto[];
    readonly iniciosBanco: readonly OpcaoPonto[];
    readonly unidades: readonly OpcaoPonto[];
  };
  readonly parametros: {
    readonly leiauteAfd: string;
    readonly conferirCrc: boolean;
    readonly toleranciaMarcacaoMin: number;
    readonly toleranciaDiariaMin: number;
    readonly janelaMarcacaoMin: number;
    readonly faixa1Min: number;
    readonly intervaloPreAssinalado: boolean;
  };
}

export interface FalhaAfdResposta {
  readonly codigo: FalhaAfd;
  readonly rotulo: string;
  readonly linha: number | null;
}

export interface ArquivoAfdResumo {
  readonly id: number;
  readonly nome: string;
  readonly situacao: SituacaoAfd;
  readonly tipoRep: TipoRep;
  readonly modelo: string | null;
  readonly numeroRep: string | null;
  readonly de: string | null;
  readonly ate: string | null;
  readonly marcacoes: number;
  readonly novas: number;
  readonly jaImportadas: number;
  readonly semColaborador: number;
  readonly totalFalhas: number;
  readonly importadoPor: string;
  readonly importadoEm: string;
}

export interface ArquivoAfdDetalhe extends ArquivoAfdResumo {
  readonly falhas: readonly FalhaAfdResposta[];
}

export interface ResultadoImportacaoAfd extends ArquivoAfdDetalhe {
  readonly mensagem: string;
}

export interface ListaArquivosAfd {
  readonly itens: readonly ArquivoAfdResumo[];
  readonly pagina: number;
  /** Há a página seguinte (a lista pede um arquivo a mais do que mostra). */
  readonly temMais: boolean;
}

export interface LinhaPainelPonto {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly cargo: string;
  readonly unidadeNome: string | null;
  readonly setor: string | null;
  readonly estado: 'aberto' | 'fechado';
  readonly marcacoes: number;
  readonly ajustesPendentes: number;
  readonly ciencia: boolean;
  readonly saldoBancoMin: number | null;
}

export interface PainelPonto {
  readonly competencia: string;
  readonly itens: readonly LinhaPainelPonto[];
  readonly total: number;
  readonly pagina: number;
  readonly paginas: number;
  readonly contagens: {
    readonly abertos: number;
    readonly fechados: number;
    readonly comAjustePendente: number;
    readonly semCiencia: number;
  };
}

export interface ColaboradorPonto {
  readonly vinculo: number;
  readonly nome: string;
  readonly matricula: string | null;
  readonly cargo: string;
  readonly unidadeNome: string | null;
  readonly setor: string | null;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly regime: string | null;
}

export interface MarcacaoEspelho {
  readonly id: number | null;
  readonly instante: string;
  readonly fonte: FonteMarcacao;
  readonly desconsiderada: boolean;
  readonly ajuste: number | null;
}

export interface MinutosClasse {
  readonly classe: ClasseHora;
  readonly rotulo: string;
  readonly minutos: number;
}

export interface DiaEspelho {
  readonly dia: string;
  readonly feriado: boolean;
  readonly previstos: readonly { readonly inicio: string; readonly fim: string }[];
  readonly marcacoes: readonly MarcacaoEspelho[];
  readonly minutos: readonly MinutosClasse[];
  readonly noturnoReduzidoMin: number;
  readonly abonadoMin: number;
  readonly justificativa: string | null;
  readonly inconsistencias: readonly { readonly codigo: InconsistenciaPonto; readonly rotulo: string }[];
  readonly alertas: readonly { readonly codigo: AlertaPonto; readonly rotulo: string }[];
}

export interface AjustePontoResposta {
  readonly id: number;
  readonly tipo: TipoAjuste;
  readonly tipoRotulo: string;
  readonly dia: string;
  readonly marcacao: number | null;
  readonly instante: string | null;
  readonly movimento: number | null;
  readonly movimentoRotulo: string | null;
  readonly justificativa: number | null;
  readonly justificativaRotulo: string | null;
  readonly periodo: number | null;
  readonly periodoRotulo: string | null;
  readonly minutos: number | null;
  readonly motivo: string;
  readonly situacao: SituacaoAjuste;
  readonly pedidoPor: string;
  readonly pedidoEm: string;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
  readonly motivoDecisao: string | null;
}

export interface MovimentoBancoResposta {
  readonly id: number;
  readonly competencia: string;
  readonly origem: OrigemBanco;
  readonly origemRotulo: string;
  readonly destino: DestinoBanco;
  readonly minutos: number;
  readonly motivo: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface RegraBancoResposta {
  readonly regime: number;
  readonly destino: DestinoBanco;
  readonly inicio: InicioBanco;
  readonly desde: string;
  readonly cicloMeses: number;
  readonly faltaDebita: boolean;
  readonly versao: number;
  /** W0-06: a regra desativada não entra no fechamento; o motivo da última mudança de situação. */
  readonly ativo?: boolean;
  readonly motivoSituacao?: string | null;
}

export interface BancoEspelho {
  readonly regra: RegraBancoResposta | null;
  readonly saldoAnteriorMin: number;
  /** O que o fechamento lança (ou lançou) no banco: crédito das extras, débito dos atrasos e a virada do ciclo. */
  readonly creditoMin: number;
  readonly debitoMin: number;
  readonly saldoFinalMin: number;
  readonly movimentos: readonly MovimentoBancoResposta[];
  /** As contas impressas (toda conta agregada vai com as parcelas). */
  readonly parcelas: readonly string[];
}

export interface EventoPeriodoResposta {
  readonly id: number;
  readonly acao: AcaoFechamento;
  readonly acaoRotulo: string;
  readonly concorda: boolean | null;
  readonly texto: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface EspelhoPonto {
  readonly colaborador: ColaboradorPonto;
  readonly competencia: string;
  readonly hoje: string;
  readonly estado: 'aberto' | 'fechado';
  readonly versao: number;
  /** SHA-256 do conteúdo do espelho (a ciência é dada sobre este resumo). */
  readonly hash: string;
  readonly ciencia: EventoPeriodoResposta | null;
  readonly trilha: readonly EventoPeriodoResposta[];
  readonly dias: readonly DiaEspelho[];
  readonly totais: readonly MinutosClasse[];
  readonly eventos: readonly {
    readonly codigo: EventoFolha;
    readonly rotulo: string;
    readonly minutos: number;
  }[];
  readonly semanasDsr: readonly string[];
  readonly diasInconsistentes: number;
  readonly ajustes: readonly AjustePontoResposta[];
  readonly banco: BancoEspelho;
  /** As contas da apuração (minutos por classe e o adicional noturno), para conferência. */
  readonly parcelas: readonly string[];
  readonly acoes: {
    readonly justificar: boolean;
    readonly aprovar: boolean;
    readonly fechar: boolean;
    readonly reabrir: boolean;
    readonly ciencia: boolean;
    readonly exportar: boolean;
    /** Por que uma ação está desligada: a sessão de suporte ("como") ou o próprio ponto do aprovador. */
    readonly motivo: string | null;
  };
}

export interface MeuEspelho {
  readonly vinculos: readonly {
    readonly vinculo: number;
    readonly cargo: string;
    readonly unidadeNome: string | null;
  }[];
  readonly competencias: readonly string[];
  readonly espelho: EspelhoPonto | null;
}

export interface ResultadoPonto {
  readonly id: number | null;
  readonly mensagem: string;
}

export interface RegrasBancoLista {
  readonly itens: readonly RegraBancoResposta[];
  /** W0-06: o histórico das mudanças de situação (o valor anterior: ativo, motivo e autor), o mais recente primeiro. */
  readonly correcoes?: readonly (CorrecaoResposta & { readonly regime: number | null })[];
}
