// Tipos de negócio do ponto (M52.4), independentes de onde a porta lê: o banco do cliente (MariaDB, pelo @sgh/nucleo)
// ou a memória sintética de dev/ci. Datas em ISO (AAAA-MM-DD), instantes no horário local do estabelecimento
// ("AAAA-MM-DDTHH:MM"), minutos inteiros, ids numéricos; o CPF do arquivo do relógio só como HMAC.
// Melhoria: o arquivo lido não carrega o estabelecimento (a porta já filtra pela sessão).

export interface OpcaoPonto {
  readonly codigo: number;
  readonly nome: string;
}

export interface DominiosPonto {
  readonly classesHora: readonly OpcaoPonto[];
  readonly eventosFolha: readonly OpcaoPonto[];
  readonly destinosBanco: readonly OpcaoPonto[];
  readonly iniciosBanco: readonly OpcaoPonto[];
  readonly modelosRelogio: readonly OpcaoPonto[];
  readonly justificativas: readonly OpcaoPonto[];
  readonly periodos: readonly OpcaoPonto[];
  readonly movimentos: readonly OpcaoPonto[];
}

export interface FeriadoDoPeriodo {
  readonly data: string;
  readonly nome: string;
}

export interface NovoArquivoRelogio {
  readonly nome: string;
  readonly hash: string;
  readonly tamanho: number;
  readonly tipoRep: string;
  readonly modelo: number | null;
  readonly numeroRep: string | null;
  readonly cnpjEmpregador: string | null;
  readonly razaoSocial: string | null;
  readonly leiaute: string | null;
  readonly dataInicial: string | null;
  readonly dataFinal: string | null;
  readonly nsrInicial: number | null;
  readonly nsrFinal: number | null;
  readonly marcacoes: number;
  readonly novas: number;
  readonly jaImportadas: number;
  readonly semColaborador: number;
  readonly situacao: 'importado' | 'quarentena';
  readonly totalFalhas: number;
  /** JSON das falhas (código e linha), nunca o conteúdo da linha. */
  readonly falhas: string | null;
  readonly por: string;
}

export interface ArquivoRelogio extends Omit<NovoArquivoRelogio, 'por'> {
  readonly id: number;
  readonly importadoPor: string;
  readonly importadoEm: string;
}

export interface FiltroArquivosRelogio {
  readonly situacao: 'importado' | 'quarentena' | null;
  readonly de: string | null;
  readonly ate: string | null;
  readonly pular: number;
  /** No máximo o teto da tela (quem chama pede um a mais para saber se há a página seguinte). */
  readonly limite: number;
}

export interface MarcacaoRelogio {
  readonly id: number;
  readonly arquivo: number;
  readonly numeroRep: string;
  readonly nsr: number;
  /** Tipo do registro no arquivo do relógio (3: marcação no relógio; 7: marcação por programa). */
  readonly tipoRegistro: number;
  readonly instante: string;
  readonly criadoEm: string;
}

export interface NovaMarcacaoRelogio {
  readonly arquivo: number;
  readonly numeroRep: string;
  readonly nsr: number;
  readonly tipoRegistro: 3 | 7;
  readonly instante: string;
  /** Deslocamento local do arquivo (ex.: "-0300"). */
  readonly fuso: string;
  readonly cpfHmac: string;
  readonly pessoa: number | null;
  readonly vinculo: number | null;
}

export interface AjustePonto {
  readonly id: number;
  readonly vinculo: number;
  readonly dia: string;
  readonly tipo: string;
  readonly marcacao: number | null;
  readonly instante: string | null;
  readonly movimento: number | null;
  readonly justificativa: number | null;
  readonly periodo: number | null;
  readonly minutos: number | null;
  readonly motivo: string;
  readonly situacao: string;
  readonly pedidoPor: string;
  readonly pedidoEm: string;
  readonly decididoPor: string | null;
  readonly decididoEm: string | null;
  readonly motivoDecisao: string | null;
  readonly versao: number;
}

export interface NovoAjustePonto {
  readonly vinculo: number;
  readonly dia: string;
  readonly tipo: string;
  readonly marcacao: number | null;
  readonly instante: string | null;
  readonly movimento: number | null;
  readonly justificativa: number | null;
  readonly periodo: number | null;
  readonly minutos: number | null;
  readonly motivo: string;
  readonly por: string;
}

export type AcaoPeriodo = 'fechado' | 'reaberto' | 'ciencia';

export interface NovoEventoDoPeriodo {
  readonly vinculo: number;
  readonly competencia: string;
  readonly acao: AcaoPeriodo;
  readonly ref: number | null;
  readonly hash: string | null;
  readonly totais: string | null;
  readonly concorda: boolean | null;
  readonly texto: string | null;
  readonly por: string;
}

export interface EventoDoPeriodo extends Omit<NovoEventoDoPeriodo, 'por'> {
  readonly id: number;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface NovoMovimentoBancoHoras {
  readonly vinculo: number;
  readonly competencia: string;
  readonly origem: string;
  readonly destino: number;
  /** Minutos com sinal (negativo é débito). */
  readonly minutos: number;
  readonly fechamento: number | null;
  readonly motivo: string | null;
  readonly por: string;
}

export interface MovimentoBancoHoras extends Omit<NovoMovimentoBancoHoras, 'por'> {
  readonly id: number;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface RegraBancoDoRegime {
  readonly id: number;
  readonly regime: number;
  readonly destino: number;
  readonly inicio: number;
  readonly desde: string;
  readonly cicloMeses: number;
  readonly faltaDebita: boolean;
  readonly versao: number;
  /** A regra desativada não entra no fechamento (com o motivo da última mudança de situação). */
  readonly ativo?: boolean;
  readonly motivoSituacao?: string | null;
  /** Quem fez a última mudança (inclusão, alteração ou situação). */
  readonly alteradoPor?: string | null;
}

export interface GravacaoRegraBanco {
  readonly regime: number;
  readonly destino: number;
  readonly inicio: number;
  readonly desde: string;
  readonly cicloMeses: number;
  readonly faltaDebita: boolean;
  /** null = incluir; número = a versão lida (alterar). */
  readonly versao: number | null;
  readonly por: string;
}

export interface VinculoDoCpf {
  readonly vinculo: number;
  readonly pessoa: number;
  readonly admissao: string;
  readonly desligamento: string | null;
}
