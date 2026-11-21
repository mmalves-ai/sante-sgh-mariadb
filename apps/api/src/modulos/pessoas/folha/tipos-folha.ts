// Tipos de negócio da folha (lote com a folha externa, afastamento, cálculo, férias, rescisão, fechamento e
// obrigações): o que as portas da folha leem e gravam, em vocabulário neutro (booleano, data ISO, id numérico, número de
// negócio). Substituem os tipos de leitura e gravação do sistema de origem; nada de sim/não em letra, hora em quatro dígitos ou sentinela.
// Melhoria: centro de custo e carga semanal do vínculo são opcionais (o modelo não os exige), em vez de um zero fictício.
// Melhoria: o andamento do afastamento (previsto, em andamento, encerrado) sai da regra pura `situacaoDoAfastamento`, calculado
// na leitura; o banco guarda só o fato (ativo ou cancelado), nunca um estado que vence com o relógio.
import type {
  ApuracaoFolha,
  AvisoPrevio,
  LinhaCalculoFolha,
  ModalidadeRescisao,
  PapelLinhaFolha,
  ProcessoNoFechamento,
  SituacaoFechamentoFolha,
  SituacaoFerias,
  SituacaoObrigacao,
  SituacaoProcessoFolha,
  SituacaoRescisao,
  TipoEncargoFolha,
  TipoObrigacao,
  TipoProcessoFolha,
  TotaisCalculoFolha,
  TotaisFechamentoFolha,
  TotaisObrigacao,
} from '@sgh/contratos';

/** Item de domínio das listas da folha (código e rótulo). */
export interface ItemDominioFolha {
  readonly codigo: number;
  readonly rotulo: string;
}

/** Tipos de vínculo que entram na folha. */
export const TIPOS_VINCULO_DA_FOLHA = ['clt', 'estatutario', 'residente', 'estagiario'] as const;
export type TipoVinculoDaFolha = (typeof TIPOS_VINCULO_DA_FOLHA)[number];

/**
 * Regra pura: o tipo do vínculo na folha pela categoria do trabalhador (tabela 1 do eSocial) e pelo regime trabalhista.
 * 901 é estagiário e 902 é médico residente (bolsistas: sem FGTS, 13º nem férias CLT); empregado e agente público seguem o
 * regime (clt ou estatutário). As demais categorias (avulso, cessão, contribuinte individual, outros bolsistas) não entram
 * na folha de empregados: null.
 */
export function tipoVinculoDaFolha(
  categoria: string,
  grupo: string,
  regime: string,
): TipoVinculoDaFolha | null {
  if (categoria === '901') return 'estagiario';
  if (categoria === '902') return 'residente';
  if (grupo !== 'empregado' && grupo !== 'agente_publico') return null;
  return regime === 'estatutario' ? 'estatutario' : 'clt';
}

/** Grau de insalubridade (NR-15) em centésimos de ponto do salário mínimo, o padrão do contrato (GRAUS_INSALUBRIDADE). */
export function insalubridadeDoGrau(grau: string | null): number {
  switch (grau) {
    case 'minimo':
      return 1000;
    case 'medio':
      return 2000;
    case 'maximo':
      return 4000;
    default:
      return 0;
  }
}

/**
 * Regra pura: as competências (AAAA-MM) de `de` até `ate` (inclusive) que não estão em `cobertas`. Serve para recusar a
 * soma do FGTS depositado quando falta folha fechada de algum mês do contrato (por exemplo, os meses antes da virada).
 */
export function competenciasDescobertas(de: string, ate: string, cobertas: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let [a, m] = [Number(de.slice(0, 4)), Number(de.slice(5, 7))];
  const fim = ate.slice(0, 7);
  for (let k = 0; k < 1200; k++) {
    const comp = `${a}-${String(m).padStart(2, '0')}`;
    if (comp > fim) break;
    if (!cobertas.has(comp)) out.push(comp);
    m += 1;
    if (m > 12) [a, m] = [a + 1, 1];
  }
  return out;
}

/** Papéis das linhas que compõem o histórico (médias de férias, 13º e rescisão). */
export const PAPEIS_HISTORICO_FOLHA: readonly PapelLinhaFolha[] = [
  'salario',
  'faltas',
  'horaExtra50',
  'horaExtra100',
  'adicionalNoturno',
  'sobreaviso',
  'dsrVariaveis',
];

/** Catálogos oficiais usados pelas obrigações (SEFIP, CAGED e RAIS). */
export const CATALOGOS_OBRIGACOES = [
  'categoriasSefip',
  'movimentacoesSefip',
  'desligamentosCaged',
  'admissoesCaged',
  'vinculosRais',
  'desligamentosRais',
  'admissoesRais',
] as const;
export type CodigosCatalogosObrigacoes = Record<(typeof CATALOGOS_OBRIGACOES)[number], string[]>;

// ── Interface com a folha externa ────────────────────────────────────────────────────────────────────────────

/** Competência da folha do estabelecimento (a "remessa" que a folha externa recebe). */
export interface RemessaDaFolha {
  readonly id: number;
  /** Estabelecimento dono da folha. */
  readonly empresa: number;
  /** AAAA-MM. */
  readonly competencia: string;
  readonly numero: number | null;
  readonly tipoFolha: number;
  readonly inicioApuracao: string | null;
  readonly fimApuracao: string | null;
  readonly pagamento: string | null;
  readonly fechada: boolean;
}

export interface FiltroLotesDaFolha {
  readonly empresa?: number;
  readonly competencia?: string;
}

export interface LoteDaFolha {
  readonly id: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly sentido: 'exportado' | 'recebido';
  readonly loteExportado: number | null;
  readonly leiaute: string;
  readonly situacao: string;
  readonly colaboradores: number;
  readonly soma: number;
  /** JSON dos totais do conteúdo (sem dado pessoal). */
  readonly totais: string;
  /** JSON da conferência (sem dado pessoal), quando houver. */
  readonly divergencias: string | null;
  readonly resumo: string;
  readonly geradoEm: string;
  readonly geradoPor: string;
  readonly versao: number;
}

export interface LoteFolhaCompleto extends LoteDaFolha {
  /** JSON `[[vinculo, centroCusto], ...]` do exportado (só ids); null no recebido. */
  readonly vinculos: string | null;
}

export interface NovoLoteDaFolha {
  readonly id: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly sentido: 'exportado' | 'recebido';
  readonly loteExportado: number | null;
  readonly leiaute: string;
  readonly situacao: string;
  readonly colaboradores: number;
  readonly soma: number;
  readonly totais: string;
  readonly vinculos: string | null;
  readonly divergencias: string | null;
  readonly resumo: string;
  /** Instante local (AAAA-MM-DDTHH:MM:SS) da geração. */
  readonly geradoEm: string;
  readonly por: string;
}

export interface LinhaResumoDaFolha {
  readonly vinculo: number | null;
  readonly centroCusto: number | null;
  readonly rubrica: string;
  readonly valor: number;
  readonly vencimento: string | null;
}

export interface ResumoDaFolha {
  readonly vinculo: number | null;
  readonly centroCusto: number | null;
  readonly rubrica: string;
  readonly valor: number;
}

export interface VinculoDaFolha {
  readonly id: number;
  readonly cpfCifrado: string;
  readonly matricula: string | null;
  readonly tipo: string;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly centroCusto: number | null;
  readonly unidade: number | null;
  readonly profissional: number | null;
}

export interface ConselhoDoProfissional {
  readonly profissional: number;
  readonly sigla: string | null;
  readonly numero: number | null;
  readonly uf: string | null;
  /** A validade acompanhada pelo RH, quando houver. */
  readonly validade: string | null;
  readonly cbo: string | null;
}

export interface AfastamentoFolha {
  readonly id: number;
  readonly vinculo: number;
  readonly motivo: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly observacao: string | null;
  readonly situacao: 'ativo' | 'cancelado';
  readonly motivoCancelamento: string | null;
  readonly versao: number;
}

export interface FiltroAfastamentosFolha {
  readonly vinculo?: number;
  /** Os que tocam o período [de, ate]. */
  readonly de?: string;
  readonly ate?: string;
}

export interface NovoAfastamentoFolha {
  readonly vinculo: number;
  readonly motivo: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly observacao: string | null;
  /** Quem registrou (exibição); a auditoria usa o usuário da sessão. */
  readonly por: string;
}

export type AndamentoAfastamento = 'previsto' | 'em_andamento' | 'encerrado';

/** Regra pura: o andamento do afastamento no dia `hoje` (datas ISO AAAA-MM-DD). */
export function situacaoDoAfastamento(
  inicio: string,
  fim: string | null,
  hoje: string,
): AndamentoAfastamento {
  if (inicio > hoje) return 'previsto';
  if (fim !== null && fim < hoje) return 'encerrado';
  return 'em_andamento';
}

export interface RetornoParaTitulos {
  readonly id: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly sentido: string;
  readonly situacao: string;
  readonly liquido: number;
  readonly vencimentoLiquido: string | null;
  readonly encargos: readonly {
    readonly tipo: TipoEncargoFolha;
    readonly valor: number;
    readonly vencimento: string | null;
  }[];
  readonly proventos: readonly { readonly centroCusto: number | null; readonly proventos: number }[];
}

// ── Cálculo ────────────────────────────────────────────────────────────────────────────────────────────────

export interface VinculoDoCalculo {
  readonly id: number;
  readonly matricula: string | null;
  readonly tipo: string;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly centroCusto: number | null;
  /** Horas semanais do cargo; null quando o cargo não as informa. */
  readonly cargaSemanal: number | null;
}

export interface DependentesDoVinculo {
  readonly irrf: number;
  readonly salarioFamilia: number;
}

export interface SalarioDoVinculo {
  readonly id: number;
  readonly vinculo: number;
  readonly inicio: string;
  readonly salario: number;
  readonly insalubridade: number;
  readonly periculosidade: boolean;
  readonly motivo: string;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface NovoSalarioDoVinculo {
  readonly vinculo: number;
  readonly inicio: string;
  readonly salario: number;
  readonly insalubridade: number;
  readonly periculosidade: boolean;
  readonly motivo: string;
  readonly por: string;
}

export interface FiltroProcessosDaFolha {
  readonly empresa?: number;
  readonly competencia?: string;
  readonly situacao?: SituacaoProcessoFolha;
  readonly tipo?: TipoProcessoFolha;
  /** Deixa de fora um tipo (o recibo de férias para quem não consulta salário). */
  readonly semTipo?: TipoProcessoFolha;
  /** Deixa de fora vários tipos. */
  readonly semTipos?: readonly TipoProcessoFolha[];
  /** Competências de `competenciaDe` a `competenciaAte` (inclusive). */
  readonly competenciaDe?: string;
  readonly competenciaAte?: string;
}

export interface ProcessoDaFolha {
  readonly id: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly tipo: TipoProcessoFolha;
  readonly numero: number;
  readonly situacao: SituacaoProcessoFolha;
  /** Data de pagamento (13º e férias); null na folha mensal. */
  readonly pagamento: string | null;
  readonly totais: TotaisCalculoFolha;
  readonly foraDaFolha: number;
  readonly tabelaLegal: string;
  readonly parametros: string;
  readonly resumo: string;
  readonly calculadoPor: string;
  readonly calculadoEm: string;
  readonly situacaoPor: string | null;
  readonly situacaoEm: string | null;
  readonly motivo: string | null;
  readonly versao: number;
}

export interface NovoProcessoDaFolha {
  readonly empresa: number;
  readonly competencia: string;
  /** Ausente: `mensal` (sem pagamento). */
  readonly tipo?: TipoProcessoFolha;
  readonly pagamento?: string | null;
  readonly numero: number;
  readonly totais: TotaisCalculoFolha;
  readonly foraDaFolha: number;
  readonly tabelaLegal: string;
  readonly parametros: string;
  readonly resumo: string;
  readonly por: string;
}

export interface LinhaCalculoDoVinculo extends LinhaCalculoFolha {
  readonly vinculo: number;
  readonly centroCusto: number;
  readonly diasPagos: number;
}

export interface ResumoVinculoDoProcesso {
  readonly vinculo: number;
  readonly centroCusto: number;
  readonly diasPagos: number;
  readonly proventos: number;
  readonly descontos: number;
  readonly porPapel: Readonly<Partial<Record<PapelLinhaFolha, number>>>;
}

// ── Férias e 13º ─────────────────────────────────────────────────────────────────────────────────────────────

export type OrigemAdiantamentoDecimo = 'decimo1' | 'ferias';

export interface FeriasDoVinculo {
  readonly id: number;
  readonly vinculo: number;
  readonly empresa: number;
  readonly aquisitivoInicio: string;
  readonly aquisitivoFim: string;
  readonly inicio: string;
  readonly fim: string;
  readonly dias: number;
  readonly abono: number;
  readonly dobra: number;
  readonly adiantarDecimo: boolean;
  readonly pagamento: string;
  readonly situacao: SituacaoFerias;
  readonly processo: number | null;
  readonly motivo: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly situacaoPor: string | null;
  readonly situacaoEm: string | null;
  readonly versao: number;
}

export interface FiltroFeriasDaFolha {
  readonly vinculo?: number;
  readonly empresa?: number;
  /** Gozo que toca [de, ate]. */
  readonly de?: string;
  readonly ate?: string;
  readonly situacao?: SituacaoFerias;
}

export interface NovasFerias {
  readonly vinculo: number;
  readonly empresa: number;
  readonly aquisitivoInicio: string;
  readonly aquisitivoFim: string;
  readonly inicio: string;
  readonly fim: string;
  readonly dias: number;
  readonly abono: number;
  readonly dobra: number;
  readonly adiantarDecimo: boolean;
  readonly pagamento: string;
  readonly por: string;
}

export interface FeriasNaCompetencia {
  readonly ferias: number;
  readonly vinculo: number;
  readonly inicio: string;
  readonly fim: string;
  readonly processo: number;
  /** Competência do recibo (a do início do gozo). */
  readonly competencia: string;
  readonly baseInss: number;
  readonly inss: number;
}

export interface HistoricoDaFolha {
  readonly vinculo: number;
  readonly competencia: string;
  readonly papel: PapelLinhaFolha;
  readonly quantidade: number;
  readonly valor: number;
}

// ── Rescisão ───────────────────────────────────────────────────────────────────────────────────────────────

export interface VinculoDesligado {
  readonly vinculo: number;
  readonly matricula: string | null;
  readonly tipo: string;
  readonly admissao: string;
  readonly desligamento: string;
  readonly tipoRescisao: number | null;
  /** A rescisão em vigor; null: ainda não calculada. */
  readonly rescisao: number | null;
}

export interface TipoRescisaoDaFolha {
  readonly id: number;
  readonly nome: string;
  /** Código de saque do FGTS e causa do afastamento do tipo. */
  readonly saque: string | null;
  readonly causa: number | null;
}

export interface RescisaoDaFolha {
  readonly id: number;
  readonly vinculo: number;
  readonly empresa: number;
  readonly desligamento: string;
  readonly tipoRescisao: number | null;
  readonly modalidade: ModalidadeRescisao;
  readonly aviso: AvisoPrevio;
  readonly diasAviso: number;
  readonly diasIndenizados: number;
  readonly projecao: string;
  readonly termo: string | null;
  readonly saldoFgts: number;
  readonly saldoFgtsInformado: boolean;
  readonly multaFgts: number;
  readonly pagamento: string;
  readonly situacao: SituacaoRescisao;
  readonly processo: number;
  readonly motivo: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  readonly situacaoPor: string | null;
  readonly situacaoEm: string | null;
  readonly versao: number;
}

export interface FiltroRescisoesDaFolha {
  readonly vinculo?: number;
  readonly empresa?: number;
  /** Desligamentos de [de, ate]. */
  readonly de?: string;
  readonly ate?: string;
  readonly situacao?: SituacaoRescisao;
}

export interface NovaRescisaoDaFolha {
  readonly vinculo: number;
  readonly empresa: number;
  readonly desligamento: string;
  readonly tipoRescisao: number | null;
  readonly modalidade: ModalidadeRescisao;
  readonly aviso: AvisoPrevio;
  readonly diasAviso: number;
  readonly diasIndenizados: number;
  readonly projecao: string;
  readonly termo: string | null;
  readonly saldoFgts: number;
  readonly saldoFgtsInformado: boolean;
  readonly multaFgts: number;
  readonly pagamento: string;
  readonly processo: number;
  readonly por: string;
}

// ── Fechamento do período ───────────────────────────────────────────────────────────────────────────────────

export interface FechamentoDaFolha {
  readonly id: number;
  readonly empresa: number;
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  readonly numero: number;
  readonly situacao: SituacaoFechamentoFolha;
  readonly pagamento: string | null;
  readonly processos: readonly ProcessoNoFechamento[];
  readonly totais: TotaisFechamentoFolha;
  readonly resumo: string;
  readonly fechadoPor: string;
  readonly fechadoEm: string;
  readonly reabertoPor: string | null;
  readonly reabertoEm: string | null;
  readonly motivo: string | null;
  readonly versao: number;
}

export interface FiltroFechamentosDaFolha {
  readonly empresa?: number;
  readonly apuracao?: ApuracaoFolha;
  readonly periodo?: string;
  /** Os períodos do ano (os mensais AAAA-MM e o anual AAAA). */
  readonly ano?: string;
  readonly situacao?: SituacaoFechamentoFolha;
}

export interface NovoFechamentoDaFolha {
  readonly empresa: number;
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  readonly numero: number;
  readonly pagamento: string | null;
  readonly processos: readonly ProcessoNoFechamento[];
  readonly totais: TotaisFechamentoFolha;
  readonly resumo: string;
  readonly por: string;
}

export interface ItemRubricaDoProcesso {
  readonly vinculo: number;
  readonly tipo: 'provento' | 'desconto';
  readonly codigoRubrica: number;
  readonly valor: number;
}

// ── Obrigações ──────────────────────────────────────────────────────────────────────────────────────────────

export interface ObrigacaoDaFolha {
  readonly id: number;
  readonly empresa: number;
  readonly tipo: TipoObrigacao;
  readonly periodo: string;
  readonly numero: number;
  readonly situacao: SituacaoObrigacao;
  readonly leiaute: string;
  readonly leiauteConferido: boolean;
  readonly nomeArquivo: string;
  readonly tamanho: number;
  readonly resumo: string;
  readonly totais: TotaisObrigacao;
  readonly fechamentos: readonly number[];
  readonly geradoPor: string;
  readonly geradoEm: string;
  readonly protocolo: string | null;
  readonly entregueEm: string | null;
  readonly valorGuia: number | null;
  readonly acrescimos: number | null;
  readonly entreguePor: string | null;
  readonly entregaRegistrada: string | null;
  readonly motivo: string | null;
  readonly situacaoPor: string | null;
  readonly situacaoEm: string | null;
  readonly versao: number;
}

export interface FiltroObrigacoesDaFolha {
  readonly empresa?: number;
  readonly tipo?: TipoObrigacao;
  readonly periodo?: string;
  /** As competências do ano e o ano-base. */
  readonly ano?: string;
  readonly situacoes?: readonly SituacaoObrigacao[];
}

export interface NovaObrigacaoDaFolha {
  readonly empresa: number;
  readonly tipo: TipoObrigacao;
  readonly periodo: string;
  readonly numero: number;
  readonly leiaute: string;
  readonly leiauteConferido: boolean;
  readonly nomeArquivo: string;
  /** O arquivo já cifrado (texto). */
  readonly conteudoCifrado: string;
  readonly tamanho: number;
  readonly resumo: string;
  readonly totais: TotaisObrigacao;
  readonly fechamentos: readonly number[];
  readonly por: string;
}

export interface NovosParametrosObrigacoes {
  readonly empresa: number;
  readonly inicio: string;
  /** O JSON validado pelo contrato, sem empresa e início (que são colunas). */
  readonly dados: string;
  readonly por: string;
}
