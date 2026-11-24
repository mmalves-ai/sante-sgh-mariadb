// Respostas das telas do pós-fechamento (M31; ficha, seções 4 e 7): guias, lotes e protocolo, prazos, competências,
// demonstrativos, retorno e glosa (grade por conta), webservices por operadora e o painel de glosas. Só agregados,
// códigos e o que a tela precisa; o beneficiário aparece mascarado; nenhuma credencial (as colunas de senha e de
// certificado nunca são lidas).

export interface ContaProntaLote {
  readonly conta: number;
  readonly versao: string;
  readonly convenio: number;
  readonly tipoConta: string;
  readonly competencia: string;
  readonly chave: string;
  readonly beneficiario: string;
  readonly total: number;
  readonly itens: number;
  readonly dataEmissao: string | null;
  /** Tipos de guia em que a conta pode ir (pelo tipo da conta). */
  readonly tiposGuia: readonly number[];
}

export interface LoteLido {
  readonly id: number;
  readonly convenio: number;
  readonly convenioNome: string;
  readonly tipoGuia: number;
  readonly tipoGuiaNome: string;
  readonly transacao: number;
  readonly numero: string;
  readonly sequencial: string;
  readonly protocolo: string;
  readonly congelado: boolean;
  readonly dataHora: string | null;
  readonly contas: number;
  readonly valor: number;
  readonly situacao: string;
  readonly situacaoRotulo: string;
  readonly inferida: boolean;
  readonly aviso: string | null;
  /** O XML guardado pelo novo (versão, hashes, XSD); null no lote do outro sistema. */
  readonly xml: {
    readonly versao: string;
    readonly hashEpilogo: string;
    readonly hashArquivo: string;
    readonly chave: string;
    readonly valido: boolean;
    readonly erros: readonly string[];
  } | null;
  readonly diasSemProtocolo: number | null;
}

export interface ProtocoloHistorico {
  readonly acao: 'registrado' | 'limpo';
  readonly protocolo: string;
  readonly data: string | null;
  readonly recibo: string;
  readonly situacao: number | null;
  readonly situacaoNome: string;
  readonly autor: string;
  readonly em: string;
}

export interface LoteDetalhe extends LoteLido {
  readonly contasDoLote: readonly {
    readonly conta: number;
    readonly chave: string;
    readonly beneficiario: string;
    readonly total: number;
    readonly fechada: string;
  }[];
  readonly historico: readonly ProtocoloHistorico[];
  readonly mensagens: readonly {
    readonly direcao: string;
    readonly destino: string;
    readonly transacao: string;
    readonly situacao: string;
    readonly tentativa: number;
    readonly protocolo: string;
    readonly em: string;
  }[];
}

export interface ListaLotes {
  readonly itens: readonly LoteLido[];
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface ResultadoMontagem {
  readonly valido: boolean;
  readonly erros: readonly string[];
  readonly explicacao: readonly string[];
  readonly hash: string;
  readonly guias: number;
  readonly valor: number;
  readonly versao: string;
}

export interface PrazoEnvio {
  readonly convenio: number;
  readonly convenioNome: string;
  readonly entregas: readonly string[];
  readonly proximaEntrega: string | null;
  readonly lotesSemProtocolo: number;
  readonly lotesParados: number;
  readonly maisAntigoSemProtocolo: string | null;
  readonly prazoRecursoDias: number | null;
}

export interface CompetenciaLida {
  readonly convenio: number;
  readonly convenioNome: string;
  readonly ano: number;
  readonly mes: number;
  readonly fechada: boolean;
  readonly fechadaEm: string | null;
  readonly fechadaPor: string;
  /** Reaberta depois de um fechamento: quando, por quem e o motivo (null/'' na que nunca foi reaberta ou fechou de novo). */
  readonly reaberta: boolean;
  readonly reabertaEm: string | null;
  readonly reabertaPor: string;
  readonly motivoReabertura: string;
  /** Ciclos de fechamento e reabertura gravados (o histórico; nenhum é sobrescrito). */
  readonly ciclos: number;
  readonly contas: number;
  readonly emLote: number;
  readonly valor: number;
}

export interface DemonstrativoLido {
  readonly id: number;
  readonly lote: number;
  readonly convenio: number;
  readonly tipo: 'analise' | 'pagamento';
  readonly origem: 'xml' | 'digitacao';
  readonly numero: string;
  readonly dataEmissao: string;
  readonly itens: number;
  readonly casados: number;
  readonly semCasamento: number;
  readonly baixados: number;
  readonly valorInformado: number;
  readonly valorPago: number;
  readonly importadoPor: string;
  readonly importadoEm: string;
}

export interface ItemDemonstrativoLido {
  readonly id: number;
  readonly item: number | null;
  readonly versaoItem: string | null;
  readonly conta: number | null;
  readonly numeroGuia: string;
  readonly sequencial: number;
  readonly codigoProcedimento: string;
  readonly valorCobrado: number | null;
  readonly valorInformado: number;
  readonly valorPago: number;
  readonly quantidadePaga: number;
  readonly motivo: number;
  readonly motivoNome: string;
  readonly situacao: 'casado' | 'sem-casamento' | 'baixado';
}

export interface ItemGlosaLido {
  readonly item: number;
  readonly versao: string;
  /** O sequencial do item na guia enviada: é por ele que o demonstrativo casa. */
  readonly sequencial: number | null;
  readonly conta: number;
  readonly convenio: number;
  readonly competencia: string;
  readonly tipo: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
  readonly valorCobrado: number;
  readonly conciliado: boolean;
  readonly valorPago: number;
  readonly quantidadePaga: number;
  readonly dataPagamento: string | null;
  readonly glosa: number;
  readonly motivo: number;
  readonly motivoNome: string;
  readonly reapresenta: boolean;
  readonly valorRecurso: number;
  readonly quantidadeRecurso: number;
  readonly dataRecurso: string | null;
  readonly valorRetorno: number;
  readonly dataRetorno: string | null;
  readonly motivoRetorno: number;
  readonly estado: 'pendente' | 'aceita' | 'recorrida' | 'encerrada' | 'sem-glosa' | 'nao-conciliado';
  readonly desfecho: 'acatado' | 'parcial' | 'negado' | null;
  readonly prazoRecurso: string | null;
  readonly alertaPrazo: string | null;
  /**
   * A decisão do novo. `temEvidencia` só diz se a decisão de recorrer tem a referência do prontuário: o conteúdo sai
   * apenas pela leitura auditada (GET glosas/itens/:id/evidencia, com faturamento.glosa.decidir).
   */
  readonly decisao: {
    readonly motivo: string;
    readonly por: string;
    readonly em: string;
    readonly temEvidencia: boolean;
  } | null;
}

/** A evidência do prontuário anexada à decisão de recorrer (leitura auditada; nunca na grade). */
export interface EvidenciaGlosaLida {
  readonly item: number;
  readonly evidencia: string;
  readonly decididoPor: string;
  readonly decididoEm: string;
}

export interface ContaGlosa {
  readonly conta: number;
  readonly chave: string;
  readonly convenio: number;
  readonly competencia: string;
  readonly beneficiario: string;
  readonly cobrado: number;
  readonly pago: number;
  readonly glosa: number;
  readonly itensGlosados: number;
  readonly itensEmRecurso: number;
  readonly prazoMaisProximo: string | null;
}

export interface GradeGlosa {
  readonly regua: 'competencia';
  readonly contas: readonly ContaGlosa[];
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface MotivoGlosaLido {
  readonly codigo: number;
  readonly nome: string;
  readonly tipo: number;
  readonly tipoNome: string;
  readonly reapresenta: boolean;
}

export interface EndpointTissLido {
  readonly convenio: number;
  readonly transacao: string;
  readonly url: string;
  readonly referenciaCofre: string;
  readonly ativo: boolean;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface ConfiguracaoTissLida {
  readonly versoes: readonly { codigo: string; conhecidaNoOutroSistema: boolean }[];
  readonly transacoes: readonly { id: number; nome: string; tipo: string }[];
  /** Webservices cadastrados no outro sistema (só leitura; sem login nem senha). */
  readonly webservicesOutroSistema: readonly {
    readonly convenio: number;
    readonly transacao: number;
    readonly url: string;
  }[];
  readonly urlsPadrao: readonly { transacao: number; url: string }[];
  readonly convenios: readonly {
    readonly convenio: number;
    readonly nome: string;
    readonly codigoPrestador: string | null;
    readonly versaoConfigurada: string | null;
    readonly registroAns: string | null;
  }[];
  readonly endpoints: readonly EndpointTissLido[];
  readonly versaoGerada: string;
}

export interface PainelGlosa {
  readonly regua: 'competencia';
  readonly de: string;
  readonly ate: string;
  readonly somas: {
    readonly emitido: number;
    readonly itensEmitidos: number;
    readonly conciliado: number;
    readonly itensConciliados: number;
    readonly pago: number;
    readonly glosaLiquida: number;
    readonly glosaPositiva: number;
    readonly itensPagosAMaior: number;
    readonly contestado: number;
    readonly recuperado: number;
    readonly nuncaRecorrido: number;
  };
  readonly indicadores: {
    readonly taxaLiquida: number | null;
    readonly taxaPositiva: number | null;
    readonly exito: number | null;
    readonly exitoRotulo: string;
  };
  readonly porMotivo: readonly { codigo: number; nome: string; glosa: number; itens: number }[];
  readonly porConvenio: readonly {
    readonly convenio: number;
    readonly nome: string;
    readonly conciliado: number;
    readonly glosa: number;
    readonly contestado: number;
    readonly recuperado: number;
    readonly exitoRotulo: string;
  }[];
  readonly porFaturador: readonly { faturador: string; glosa: number; itens: number }[];
  readonly porFaixa: readonly { faixa: string; itens: number; glosa: number }[];
  readonly ciclo: { readonly mediaDias: number | null; readonly itens: number; readonly foraDaFaixa: number };
  readonly fila: { readonly pendentes: number; readonly emRecurso: number; readonly semPrazo: number };
  readonly geradoEm: string;
  readonly emCache: boolean;
}

export interface GravacaoTiss {
  readonly funcionalidades: Readonly<Record<string, { ligada: boolean; motivo: string | null }>>;
  readonly operacoes: Readonly<Record<string, { ligada: boolean; motivo: string | null }>>;
  readonly ambiente: string;
  readonly destinoEnvio: 'simulador' | 'operadora';
}

export interface ResultadoTiss {
  readonly mensagem: string;
  readonly repetida: boolean;
  readonly ids: Readonly<Record<string, number | string>>;
  readonly avisos: readonly string[];
}

export interface GuiaLida {
  readonly conta: number;
  readonly versao: string;
  readonly chave: string;
  readonly convenio: number;
  readonly convenioNome: string;
  readonly tipoConta: string;
  readonly tipoGuia: number;
  readonly tipoGuiaNome: string;
  readonly numeroGuia: string;
  readonly beneficiario: string;
  readonly emitida: boolean;
  readonly dataEmissao: string | null;
  readonly total: number;
  readonly lote: number | null;
}
