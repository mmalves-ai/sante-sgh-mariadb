// Respostas das telas do repasse médico (M33; ficha, seções 4 e 7). Só códigos, valores e estados: nada de CPF, conta
// bancária ou nome de paciente (o item pendente leva o número da conta, do atendimento e do prontuário; o nome fica na
// tela da conta, com a permissão dela). Valores em reais (duas casas) e a memória de cálculo com as parcelas, para a tela
// mostrar a conta de cada valor (o médico vê a regra e a conta).
import type { ProporRegraRepasseEntrada } from './entradas.js';
import type { RegraRepasse } from './modelo.js';
import type {
  BaseCalculoRepasse,
  EstadoApuracao,
  EstadoVersaoRegra,
  PendenciaApuracao,
} from './vocabulario.js';

export interface OpcaoRepasse {
  readonly codigo: number;
  readonly rotulo: string;
}

/** Estado de gravação das telas (liberação da chave `repasse` e passo 0 de cada operação). */
export interface GravacaoRepasse {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly operacoes: Readonly<Record<string, { readonly ligada: boolean; readonly motivo: string | null }>>;
}

export interface ApoioRepasse {
  readonly hoje: string;
  readonly empresas: readonly OpcaoRepasse[];
  readonly eventos: readonly OpcaoRepasse[];
  readonly convenios: readonly OpcaoRepasse[];
  /** Parâmetros resolvidos (repasse.basePadrao, meta do dourado e a origem do valor: padrão "a aprovar" ou definido). */
  readonly basePadrao: BaseCalculoRepasse;
  readonly metaDouradoPct: number;
  readonly metaAAprovar: boolean;
  readonly rpaConfigurado: boolean;
  readonly gravacao: GravacaoRepasse;
}

export interface ListaRegrasRepasse {
  readonly regras: readonly RegraRepasse[];
  /** Último ID da página (keyset): null quando acabou. */
  readonly depoisDe: number | null;
  /** Regras já usadas em apuração gravada (no novo não mudam; regra 3). */
  readonly usadas: readonly number[];
}

export interface VersaoRegraResposta {
  readonly id: number;
  readonly estado: EstadoVersaoRegra;
  readonly proposta: ProporRegraRepasseEntrada;
  readonly autor: string;
  readonly propostaEm: string;
  readonly decididaPor: string | null;
  readonly decididaEm: string | null;
  readonly justificativaDecisao: string | null;
  /** Id da regra depois da inclusão aprovada. */
  readonly regraIncluida: number | null;
  readonly simulada: boolean;
}

export interface RegraIgnoradaResposta {
  readonly regra: number;
  readonly motivo: string;
}

/** Memória de cálculo de um item (SGH_REP_MEMORIA_CALCULO), com as parcelas da conta. */
export interface MemoriaItemResposta {
  readonly item: number;
  readonly beneficiario: number | null;
  readonly regra: number | null;
  readonly dimensoes: readonly string[];
  readonly ignoradas: readonly RegraIgnoradaResposta[];
  readonly base: BaseCalculoRepasse | null;
  readonly baseValor: number;
  readonly percentual: number;
  readonly valorFixo: number;
  readonly valorSemAdicional: number;
  readonly adicional: { readonly tipo: string; readonly percentual: number } | null;
  readonly valor: number;
  readonly pendencia: PendenciaApuracao | null;
  /** A conta escrita: "R$ 1.000,00 × 18,5000% = R$ 185,00". */
  readonly conta: string;
}

/** Referência de negócio do item pendente: o que a tela de contas já mostra, para chegar ao item e corrigi-lo. */
export interface ReferenciaItemPendente {
  /** Id da conta (o link da tela de contas). */
  readonly conta: number;
  readonly contaNumero: string;
  readonly atendimento: string;
  /** Número do prontuário do paciente (o nome fica na tela da conta). */
  readonly prontuario: string;
  readonly procedimento: string;
  readonly procedimentoDescricao: string;
  /** AAAA-MM-DD HH:MM, hora local. */
  readonly realizadoEm: string | null;
  /** Nome do profissional executante; null quando o item está sem executante. */
  readonly profissional: string | null;
}

export interface ItemPendenteApuracaoResposta extends MemoriaItemResposta {
  readonly referencia: ReferenciaItemPendente;
}

/** Página de itens pendentes da apuração (GET /repasse/apuracoes/:id/pendentes), filtrável pelo motivo. */
export interface PendentesApuracaoResposta {
  readonly apuracao: number;
  readonly motivo: PendenciaApuracao | null;
  readonly pagina: number;
  readonly tamanho: number;
  /** Total de pendentes no filtro (todas as páginas). */
  readonly total: number;
  readonly itens: readonly ItemPendenteApuracaoResposta[];
}

export interface SimulacaoRepasseResposta {
  readonly memoria: MemoriaItemResposta;
  readonly regrasConsideradas: number;
}

export interface BeneficiarioApuracao {
  readonly prestador: number;
  readonly itens: number;
  readonly base: number;
  readonly valor: number;
}

/** Quantos itens pendentes a resposta da apuração traz (o resto pela rota paginada). */
export const ITENS_PENDENTES_NA_APURACAO = 20;

export interface ApuracaoResposta {
  /** SGH_REP_APURACAO.ID; null quando o período não tem apuração no novo. */
  readonly id: number | null;
  readonly empresa: number;
  readonly competencia: string;
  /** Quem tem a apuração do período (regra 10). */
  readonly sistema: 'novo' | 'outro-sistema' | 'nenhum';
  readonly estado: EstadoApuracao | null;
  /** Apuração do novo só em simulação (repasse.integrarItens não liberada: ordem de corte). */
  readonly simulacao: boolean;
  readonly apuradoPor: string | null;
  readonly conferidoPor: string | null;
  readonly aprovadoPor: string | null;
  readonly itens: number;
  readonly comRepasse: number;
  readonly pendentes: number;
  readonly pendenciasPorMotivo: Readonly<Record<string, number>>;
  readonly base: number;
  readonly valor: number;
  /** Parcelas do total (a soma é `valor`). */
  readonly porBeneficiario: readonly BeneficiarioApuracao[];
  /**
   * Os primeiros itens pendentes (até ITENS_PENDENTES_NA_APURACAO), com a memória de cálculo, o motivo e a referência
   * da conta; o total é `pendentes`, e a lista inteira, paginada e por motivo, vem de GET /repasse/apuracoes/:id/pendentes.
   */
  readonly itensPendentes: readonly ItemPendenteApuracaoResposta[];
  /** Lançamentos do outro sistema no período (quando o período é dele). */
  readonly lancamentosOutroSistema: number;
  readonly aviso: string | null;
}

export interface DemonstrativoResposta {
  readonly apuracao: number;
  readonly empresa: number;
  readonly competencia: string;
  readonly prestador: number;
  readonly estado: EstadoApuracao;
  readonly itens: readonly MemoriaItemResposta[];
  readonly base: number;
  readonly valor: number;
}

export interface LancamentoRepasseResposta {
  readonly id: number;
  readonly tipo: 'M' | 'E';
  readonly prestador: number;
  readonly data: string | null;
  readonly evento: number;
  readonly eventoRotulo: string;
  readonly valor: number;
  readonly origem: string;
  readonly emRpa: number | null;
  /** O registro do médico ligado ao lançamento (o estorno herda; ninguém digita o código interno). */
  readonly registro: number | null;
  /** Lançamento original quando este é o estorno (SGH_REP_ESTORNO). */
  readonly estornaDe: number | null;
}

/** Um médico da busca das telas do repasse (nome e conselho; devolve o código do prestador e o registro). */
export interface PrestadorRepasseResposta {
  readonly prestador: number;
  readonly registro: number;
  readonly nome: string;
  readonly conselho: string;
}

export interface RetencoesRpaResposta {
  readonly bruto: number;
  readonly baseInss: number;
  readonly inss: number;
  readonly baseIrrf: number;
  readonly irrf: number;
  readonly iss: number;
  readonly liquido: number;
  /** A conta escrita: bruto − INSS − IRRF − ISS = líquido. */
  readonly conta: string;
}

export interface RpaResposta {
  readonly id: number;
  readonly serie: string;
  readonly numero: number;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly emissao: string | null;
  readonly tipo: string;
  readonly prestador: number;
  readonly situacao: string;
  readonly lancamentos: number;
  readonly valor: number;
  /** Título a pagar que nasceu com o RPA (id do título). */
  readonly titulo: number | null;
}

export interface PreviaRpaResposta {
  readonly prestador: number;
  readonly lancamentos: readonly number[];
  readonly retencoes: RetencoesRpaResposta;
  readonly documento: 'rpa' | 'demonstrativo';
  /** De onde vieram as retenções: o dado fiscal do cadastro do profissional vigente hoje, ou a regra geral. */
  readonly origemFiscal?: 'dado-fiscal' | 'regra-geral';
  /** A conta principal do profissional, mascarada (banco, agência, final da conta ou tipo da chave); null: sem conta. */
  readonly destinoPagamento?: string | null;
}

export interface ResultadoRepasse {
  readonly ok: true;
  readonly mensagem: string;
  readonly ids: Readonly<Record<string, number | string | boolean | null>>;
  readonly repetida: boolean;
}

export interface ExtratoRepasseResposta {
  /** Os códigos de prestador do próprio usuário (vínculo usuário → profissional); vazio: sem vínculo. */
  readonly prestadores: readonly number[];
  /** A competência filtrada (AAAA-MM), ou null: os últimos 12 meses. */
  readonly competencia: string | null;
  readonly lancamentos: readonly LancamentoRepasseResposta[];
  readonly rpas: readonly RpaResposta[];
  readonly total: number;
  /** Adiantamentos ao médico (só consulta: regra 11). */
  readonly adiantamentos: number;
}

/** A conta do próprio médico nas apurações da competência (só os itens dele; regra 12). */
export interface ContaDoMedicoResposta {
  readonly competencia: string;
  readonly demonstrativos: readonly DemonstrativoResposta[];
}

/** Indicador do cap-06b §6.7, com as parcelas impressas. */
export interface IndicadorRepasse {
  readonly codigo: string;
  readonly rotulo: string;
  readonly valor: number | null;
  readonly unidade: '%' | 'dias' | 'itens' | 'R$';
  readonly parcelas: string;
}
