// Tipos de negócio da porta dos custos hospitalares (M54, etapas 4 e 5; F2.2): o que a porta lê e grava, em
// vocabulário neutro (ids numéricos, valores em centavos e quantidades em centésimos, datas ISO). As regras ficam em
// @sgh/dominio-custos; a forma da tela, em @sgh/contratos (custos/estrutura e custos/apuracao).
import type { ContextoNucleo, LinhaTrilha } from '@sgh/nucleo';

/** Contexto da porta: o estabelecimento da sessão (código e, quando conhecido, o id) e o usuário (id do banco). */
export interface ContextoCustos {
  readonly rede: string;
  /** Código do estabelecimento da sessão. */
  readonly hospital: string;
  /** Id do estabelecimento (null/ausente: a porta própria resolve pelo código). */
  readonly estabelecimento?: number | null;
  readonly usuario?: number | null;
  readonly correlacao?: string;
}

/** Linha da trilha que acompanha uma gravação (o estabelecimento, o usuário e a correlação vêm do contexto). */
export type TrilhaCustos = Omit<LinhaTrilha, 'ocorridoEm'>;

/** Contexto do núcleo de uma gravação (para a porta própria montar o Executor). */
export type ContextoGravacaoCustos = ContextoNucleo;

// ── Estrutura de custos e estatísticas (etapa 4) ─────────────────────────────────────────────────────────────────

export interface ClassificacaoCentroCadastrada {
  readonly classe: string;
  readonly ordemRateio: number | null;
  /** Código da estatística do catálogo (ESTATISTICAS_CUSTO) que reparte o custo do centro. */
  readonly criterio: string | null;
  /** Id da unidade de mensuração (unidade_mensuracao_custo). */
  readonly unidadeMensuracao: number | null;
  readonly observacao: string | null;
  /** Versão do centro de custo (a trava otimista da classificação). */
  readonly versao: number;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
}

export interface CentroCustoCadastrado {
  readonly id: number;
  readonly codigo: number;
  readonly nome: string;
  readonly sigla: string | null;
  readonly ativo: boolean;
  /** Marca de produtivo do cadastro (null quando o cadastro não a tem: a sugestão vem do nome). */
  readonly produtivoCadastro: boolean | null;
  readonly classificacao: ClassificacaoCentroCadastrada | null;
}

export interface DominiosCustos {
  readonly tiposDado: { id: number; nome: string }[];
  readonly unidades: { codigo: number; nome: string }[];
  readonly gruposExportacao: { id: number; nome: string; ativo: boolean }[];
}

export interface GrupoFonteEstatistica {
  readonly cdc: number | null;
  readonly quantidade: number;
}

/** As fontes da coleta de uma competência, agregadas no banco (a forma que @sgh/dominio-custos recebe). */
export interface FontesEstatistica {
  readonly censo: { readonly grupos: GrupoFonteEstatistica[]; readonly diasFechados: number };
  readonly internacoes: GrupoFonteEstatistica[];
  readonly cirurgias: { cdc: number | null; duracao: string | null; n: number }[];
  readonly exames: GrupoFonteEstatistica[];
  readonly requisicoes: GrupoFonteEstatistica[];
  readonly colaboradores: { centro: number; n: number; horas: number }[];
  readonly leitos: GrupoFonteEstatistica[];
}

export interface EstatisticaRegistrada {
  readonly id: number;
  /** "AAAA-MM". */
  readonly competencia: string;
  readonly centro: number;
  readonly codigo: string;
  /** Quantidade em centésimos. */
  readonly cent: number;
  readonly origem: 'coletada' | 'manual';
  readonly fonte: string;
  readonly estimada: boolean;
  readonly tipoDado: 1 | 2;
  readonly idColeta: number | null;
  readonly observacao: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

export interface ColetaRegistrada {
  readonly id: number;
  readonly competencia: string;
  /** Resumo por fonte (JSON só com contagens). */
  readonly resumo: string;
  readonly linhas: number;
  readonly duracaoMs: number;
  readonly coletadaPor: string;
  readonly coletadaEm: string;
}

export interface ClassificacaoParaGravar {
  readonly centro: number;
  readonly classe: 'produtivo' | 'auxiliar' | 'administrativo';
  readonly ordemRateio: number | null;
  readonly criterio: string | null;
  readonly unidadeMensuracao: number | null;
  readonly observacao: string | null;
  /** A versão lida (null: o centro ainda não tinha classificação). */
  readonly versao: number | null;
}

export interface LinhaEstatisticaParaGravar {
  readonly centro: number;
  readonly codigo: string;
  readonly cent: number;
  readonly fonte: string;
  readonly estimada: boolean;
  readonly tipoDado: 1 | 2;
}

export interface ColetaParaGravar {
  readonly competencia: string;
  readonly linhas: readonly LinhaEstatisticaParaGravar[];
  readonly resumo: string;
  readonly duracaoMs: number;
}

export interface LancamentoEstatisticaParaGravar {
  readonly competencia: string;
  readonly centro: number;
  readonly codigo: string;
  readonly cent: number;
  readonly tipoDado: 1 | 2;
  readonly observacao: string | null;
}

// ── Apuração do custo do mês (etapa 5) ───────────────────────────────────────────────────────────────────────────

/** Tamanho da página das contas de uma apuração. */
export const TAMANHO_PAGINA_CONTAS = 50;

export interface GrupoCusteio {
  readonly cdc: number | null;
  readonly centavos: number;
  readonly linhas: number;
}

export interface ItemContaCusteio {
  readonly conta: number;
  readonly numero: number;
  readonly tipoConta: string | null;
  readonly convenio: number | null;
  readonly procedimento: string | null;
  readonly cdc: number | null;
  readonly bruta: number;
  readonly glosa: number;
  readonly recurso: number;
}

export interface FontesCusteio {
  readonly materiais: GrupoCusteio[];
  readonly atipicas: GrupoCusteio[];
  /** Devoluções ao estoque da competência, por centro (descontadas dos materiais), sem as das saídas atípicas. */
  readonly devolucoes: GrupoCusteio[];
  /** Devoluções das saídas atípicas (fora do custo direto, como a saída). */
  readonly devolucoesAtipicas: GrupoCusteio[];
  readonly despesas: GrupoCusteio[];
  readonly pessoal: { centro: number | null; centavos: number; linhas: number }[];
  readonly itensConta: ItemContaCusteio[];
  readonly contasFechadas: number;
  /** Passou do teto de grupos conta × centro (a apuração recusa: não se apura com conta faltando). */
  readonly truncado: boolean;
}

export interface PeriodoCusteio {
  readonly ano: number;
  readonly mes: number;
  readonly inicio: string;
  readonly fim: string;
  readonly competencia: string;
  /** Limite do valor de uma linha de saída, em centavos. */
  readonly limiteLinhaCentavos: number;
}

export interface CodigosExportacao {
  readonly centros: { id: number; codigoApurasus: string | null; unidade: number | null }[];
  readonly unidades: { codigo: number; codigoApurasus: string | null }[];
}

export interface ApuracaoCustosRegistrada {
  readonly id: number;
  readonly competencia: string;
  readonly situacao: 'apurada' | 'aprovada' | 'substituida';
  readonly versao: number;
  readonly parcial: boolean;
  readonly rotuloParcial: string | null;
  readonly limiteLinha: number;
  readonly custoProdutivos: number;
  readonly totais: string;
  readonly completude: string;
  readonly pendencias: string;
  readonly impressao: string;
  readonly justificativa: string | null;
  readonly duracaoMs: number;
  readonly apuradaPor: string;
  readonly apuradaEm: string;
  readonly aprovadaPor: string | null;
  readonly aprovadaEm: string | null;
}

export interface LinhaCentroApuracao {
  readonly centro: number;
  readonly codigo: number;
  readonly nome: string;
  readonly classe: string;
  readonly ordemRateio: number | null;
  readonly criterio: string | null;
  readonly pessoal: number;
  readonly materiais: number;
  readonly despesas: number;
  readonly despesasGerais: number;
  readonly diretoTotal: number;
  readonly recebidoTotal: number;
  /** JSON [[centro de origem, centavos], ...]. */
  readonly recebidos: string;
  readonly repassado: number;
  readonly naoRateado: number;
  readonly custoFinal: number;
  readonly baseCriterioCent: number | null;
  readonly producaoCodigo: string | null;
  readonly producaoCent: number | null;
  readonly custoUnitario: number | null;
  readonly receita: number;
}

export interface CustoContaApuracao {
  readonly conta: number;
  readonly numero: number;
  readonly tipoConta: string | null;
  readonly convenio: number | null;
  readonly procedimento: string | null;
  readonly receitaBruta: number;
  readonly glosa: number;
  readonly recurso: number;
  readonly receitaLiquida: number;
  readonly custo: number;
  readonly margem: number;
  /** JSON [[centro, centavos, grupo], ...]. */
  readonly parcelas: string;
  readonly prontuario: number | null;
}

export interface FiltroContasCusto {
  readonly convenio?: number | undefined;
  readonly procedimento?: string | undefined;
  readonly numero?: number | undefined;
  readonly prontuario?: number | undefined;
  readonly negativas: boolean;
  readonly pagina: number;
}

export interface GrupoResultadoApurado {
  readonly chave: string | null;
  readonly contas: number;
  readonly receitaBruta: number;
  readonly glosa: number;
  readonly recurso: number;
  readonly receitaLiquida: number;
  readonly custo: number;
  readonly margem: number;
}

export interface LinhaCentroParaGravar {
  readonly centro: number;
  readonly codigo: number;
  readonly nome: string;
  readonly classe: string;
  readonly ordemRateio: number | null;
  readonly criterio: string | null;
  readonly pessoal: number;
  readonly materiais: number;
  readonly despesas: number;
  readonly despesasGerais: number;
  readonly diretoTotal: number;
  readonly recebidoTotal: number;
  readonly recebidos: readonly (readonly [number, number])[];
  readonly repassado: number;
  readonly naoRateado: number;
  readonly custoFinal: number;
  readonly baseCriterioCent: number | null;
  readonly producaoCodigo: string | null;
  readonly producaoCent: number | null;
  readonly custoUnitario: number | null;
  readonly receita: number;
}

export interface ContaParaGravar {
  readonly conta: number;
  readonly numero: number;
  readonly tipoConta: string | null;
  readonly convenio: number | null;
  readonly procedimento: string | null;
  readonly receitaBruta: number;
  readonly glosa: number;
  readonly recurso: number;
  readonly receitaLiquida: number;
  readonly custo: number;
  readonly margem: number;
  readonly parcelas: readonly (readonly [number, number, number])[];
}

export interface ApuracaoParaGravar {
  readonly competencia: string;
  /** A apuração vigente lida (null: a competência ainda não tinha), que a nova substitui. */
  readonly substitui: { readonly id: number; readonly versao: number } | null;
  readonly rotuloParcial: string | null;
  readonly limiteLinha: number;
  readonly custoProdutivos: number;
  /** JSON (só valores e contagens). */
  readonly totais: string;
  readonly completude: string;
  readonly pendencias: string;
  readonly impressao: string;
  readonly justificativa: string | null;
  readonly duracaoMs: number;
  readonly linhas: readonly LinhaCentroParaGravar[];
  readonly contas: readonly ContaParaGravar[];
}
