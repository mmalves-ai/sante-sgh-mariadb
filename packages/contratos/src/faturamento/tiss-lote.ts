// Dados do lote TISS lidos do banco para a montagem do XML (M31; ficha, seção 5, `faturamento.gerarLote`): o adaptador do
// legado lê a conta e os itens dentro da transação do lote (depois da numeração pelo contador, sob trava) e entrega estes
// dados ao montador (o gerador 04.03.00 de @sgh/dominio-faturamento, a validação no XSD e a guarda no S3, injetados pela
// API: o adaptador só depende de contratos). Só o que a guia leva; nunca credencial.

/** Profissional executante ou solicitante (conselho, número, UF e CBO, nos códigos da TISS). */
export interface ProfissionalTiss {
  readonly conselho: string;
  readonly numeroConselho: string;
  readonly uf: string;
  readonly cbos: string;
}

export type NaturezaItem = 'procedimento' | 'diaria' | 'taxa' | 'material' | 'medicamento' | 'gas' | 'opme';

export interface ItemContaTiss {
  readonly sequencial: number;
  /** Grupo do item: 1 diárias e taxas, 2 honorários, 3 SADT, 4 mat/med. */
  readonly tipo: number;
  readonly natureza: NaturezaItem;
  readonly data: string;
  readonly codigo: string;
  readonly codigoTabela: string;
  readonly descricao: string;
  readonly quantidade: number;
  readonly valorUnitario: number;
}

export interface ContaTiss {
  readonly conta: number;
  readonly tipoGuia: 1 | 2 | 3 | 4;
  readonly numeroGuia: string;
  readonly carteira: string;
  /** Atendimento ao recém-nascido (na conta da mãe). */
  readonly atendimentoRN: boolean;
  readonly inicio: { readonly data: string; readonly hora: string };
  readonly fim: { readonly data: string; readonly hora: string };
  readonly caraterAtendimento: '1' | '2';
  readonly tipoConsulta: '1' | '2' | '3' | '4';
  readonly tipoAtendimento: string;
  readonly senha: string;
  readonly guiaSolicitacao: string;
  readonly dataAutorizacao: string;
  readonly tipoFaturamento: '1' | '2' | '3' | '4';
  readonly tipoInternacao: '1' | '2' | '3' | '4' | '5';
  readonly regimeInternacao: '1' | '2' | '3';
  readonly motivoEncerramento: string;
  /**
   * Indicador de acidente (terminologia TISS 36: 0 trabalho, 1 trânsito, 2 outros, 9 não acidente), o da guia montada
   * ou o do atendimento; sem ele, 9. Só o resumo de internação o leva ao XML.
   */
  readonly indicadorAcidente?: '0' | '1' | '2' | '9';
  readonly profissional: ProfissionalTiss;
  readonly profissionalNome: string;
  readonly profissionalCodigo: string;
  /** true: a conta não tem executante com conselho, número, UF e CBO no cadastro, e a guia leva o padrão (D-XML-31). */
  readonly executantePadrao?: boolean;
  /** Os campos adicionais da operadora informados na guia (06-FAT linha 10), já no texto da observação (até 500). */
  readonly observacao?: string;
  /**
   * Fator de redução da guia (reducaoAcrescimo, duas casas) que leva ao total o desconto por volume e a franquia aplicados
   * na conta (06-FAT linha 19); sem abatimento, ausente (1.00).
   */
  readonly reducaoAcrescimo?: number;
  readonly itens: readonly ItemContaTiss[];
}

export interface DadosPrestador {
  readonly registroAns: string;
  readonly codigoPrestador: string;
  readonly cnes: string;
  readonly nome: string;
}

export interface DadosLoteTiss {
  readonly hospital: string;
  /** O ID do lote quando já gravado; 0 na montagem antes da gravação (a chave do XML é o convênio e o número). */
  readonly lote: number;
  readonly convenio: number;
  readonly numeroLote: string;
  readonly sequencial: string;
  readonly prestador: DadosPrestador;
  readonly contas: readonly ContaTiss[];
  /** Instante da transação (o do banco), para o cabeçalho. */
  readonly agora: Date;
}

/** O que o montador devolve ao adaptador: o lote só é gravado com o XSD válido (nada é gravado sem validar). */
export interface LoteMontado {
  readonly valido: boolean;
  readonly erros: readonly string[];
  readonly explicacao: readonly string[];
  readonly versao: string;
  readonly hashEpilogo: string;
  readonly hashArquivo: string;
  readonly bytes: number;
  readonly guias: number;
  readonly valor: number;
  /** Onde o XML foi guardado (S3 com Object Lock; memória nos testes) e a versão do objeto. */
  readonly chaveObjeto: string;
  readonly versaoObjeto: string | null;
}

export type MontadorLoteTiss = (d: DadosLoteTiss) => Promise<LoteMontado>;
