// Contratos do orçamento empresarial (M54, etapa 7: fatia F7; ficha, seções 4, 6, 7 e 8, regra 14; manual m23): o
// orçamento anual por centro de custo e item, com versões e aprovação, comparado com o realizado do mesmo banco.
//   - Linha do orçamento: centro de custo (id; 0 = o hospital inteiro, sem centro) × natureza × item gerencial
//     (grupo, subgrupo, item) × 12 meses, em centavos (inteiros; nenhum arredondamento de ponto flutuante).
//   - Naturezas: `despesa` (a apropriação gerencial dos documentos a pagar), `receita` (a dos títulos a receber) e
//     `consumo` (as saídas de estoque valorizadas pelo custo médio, por centro de custo de destino; sem item
//     gerencial: grupo, subgrupo e item = 0).
//   - Realizado pela competência (a data de emissão do documento; o ano e o mês do consumo). Sem centro de custo no
//     documento, o realizado de despesa e receita vai ao centro pelo rateio do documento e, sem rateio, fica "sem
//     centro" (centro 0), com a parcela impressa.
//   - Desvio = realizado − orçado (absoluto) e desvio ÷ orçado (percentual, nulo com orçado 0); favorável quando a
//     despesa ou o consumo ficam abaixo do orçado e a receita acima. Todo total vem com as parcelas.
// Nada aqui toca tabela do outro sistema: o orçamento fica em SGH_ORC_* (script 0549); o realizado é só leitura.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const NATUREZAS_ORCAMENTO = ['despesa', 'receita', 'consumo'] as const;
export type NaturezaOrcamento = (typeof NATUREZAS_ORCAMENTO)[number];

export const ROTULOS_NATUREZA_ORCAMENTO: Readonly<Record<NaturezaOrcamento, string>> = {
  despesa: 'Despesa',
  receita: 'Receita',
  consumo: 'Consumo de estoque',
};

export const DESCRICOES_NATUREZA_ORCAMENTO: Readonly<Record<NaturezaOrcamento, string>> = {
  despesa: 'Despesas dos documentos a pagar, pelo item gerencial da classificação.',
  receita: 'Receitas dos títulos a receber, pelo item gerencial da classificação.',
  consumo: 'Saídas de estoque valorizadas pelo custo médio, pelo centro de custo de destino.',
};

export const SITUACOES_VERSAO_ORCAMENTO = ['rascunho', 'aprovado', 'substituido', 'descartado'] as const;
export type SituacaoVersaoOrcamento = (typeof SITUACOES_VERSAO_ORCAMENTO)[number];

export const ROTULOS_SITUACAO_VERSAO_ORCAMENTO: Readonly<Record<SituacaoVersaoOrcamento, string>> = {
  rascunho: 'Em elaboração',
  aprovado: 'Aprovado (vigente)',
  substituido: 'Substituído por versão mais nova',
  descartado: 'Descartado',
};

/** Centro "sem centro de custo" (o hospital inteiro): o realizado sem rateio cai aqui. */
export const CENTRO_SEM_CENTRO_ORCAMENTO = 0;
/** Teto de linhas de uma versão (centro × natureza × item; 99 centros × ~530 itens cabem com folga no uso real). */
export const TETO_LINHAS_ORCAMENTO = 5000;
/** Teto de linhas gravadas numa só chamada (a grade grava o que mudou). */
export const TETO_LINHAS_POR_GRAVACAO = 2000;
/** Teto de um valor mensal em centavos (R$ 99 bilhões; BIGINT no banco). */
export const TETO_CENTAVOS_MES = 9_999_999_999_999;
export const MESES_ORCAMENTO = 12;

const centavosMes = z
  .number()
  .int('Valor em centavos (inteiro).')
  .min(0, 'O valor orçado não pode ser negativo.')
  .max(TETO_CENTAVOS_MES, 'Valor acima do teto.');

const anoOrcamento = z.number().int().min(2000).max(2099);
const empresa = z.number().int().min(1).max(32_767);
const versaoLida = z.number().int().min(0);

/** A chave de uma linha (centro × natureza × item). */
export const esquemaChaveLinha = z.object({
  centro: z.number().int().min(0).max(2_147_483_647),
  natureza: z.enum(NATUREZAS_ORCAMENTO),
  grupo: z.number().int().min(0).max(2_147_483_647),
  subgrupo: z.number().int().min(0).max(2_147_483_647),
  item: z.number().int().min(0).max(2_147_483_647),
});
export type ChaveLinhaOrcamento = z.infer<typeof esquemaChaveLinha>;

export const esquemaLinhaOrcamento = esquemaChaveLinha.extend({
  meses: z.array(centavosMes).length(MESES_ORCAMENTO, 'Informe os 12 meses.'),
  observacao: textoCp1252(200).nullable().default(null),
});
export type LinhaOrcamentoEntrada = z.infer<typeof esquemaLinhaOrcamento>;

/** Bases de uma versão nova: vazia, cópia de uma versão, ou o realizado do ano anterior com um ajuste percentual. */
export const esquemaCriarVersaoOrcamento = z.object({
  ano: anoOrcamento,
  empresa: empresa.default(1),
  descricao: textoCp1252(120).pipe(z.string().trim().min(3, 'Descreva a versão (ao menos 3 letras).')),
  base: z
    .discriminatedUnion('tipo', [
      z.object({ tipo: z.literal('vazio') }),
      z.object({ tipo: z.literal('versao'), id: z.number().int().positive() }),
      z.object({
        tipo: z.literal('realizado'),
        /** Ajuste sobre o realizado do ano anterior, em centésimos de ponto percentual (500 = +5,00%). */
        ajusteCentesimos: z.number().int().min(-10_000).max(100_000).default(0),
      }),
    ])
    .default({ tipo: 'vazio' }),
});
export type CriarVersaoOrcamento = z.infer<typeof esquemaCriarVersaoOrcamento>;

export const esquemaGravarLinhas = z.object({
  versao: versaoLida,
  /** As linhas que mudaram; a linha com os 12 meses zerados sai da versão. */
  linhas: z
    .array(esquemaLinhaOrcamento)
    .min(1, 'Nada a gravar.')
    .max(TETO_LINHAS_POR_GRAVACAO, `No máximo ${TETO_LINHAS_POR_GRAVACAO} linhas por gravação.`),
});
export type GravarLinhasOrcamento = z.infer<typeof esquemaGravarLinhas>;

export const esquemaAprovarOrcamento = z.object({
  versao: versaoLida,
  observacao: textoCp1252(400).nullable().default(null),
});
export type AprovarOrcamento = z.infer<typeof esquemaAprovarOrcamento>;

export const esquemaDescartarOrcamento = z.object({
  versao: versaoLida,
  motivo: textoCp1252(400).pipe(z.string().trim().min(5, 'Diga por que a versão é descartada.')),
});
export type DescartarOrcamento = z.infer<typeof esquemaDescartarOrcamento>;

const numeroQuery = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,4}$/u, 'Número inválido.')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const esquemaConsultaOrcamentos = z.object({
  ano: numeroQuery(2000, 2099).optional(),
});

export const esquemaConsultaComparativo = z.object({
  /** Até que mês (1 a 12) acumula; sem ele, o ano inteiro. */
  mesAte: numeroQuery(1, 12).optional(),
  /** Visão: linha a linha (centro × item), por centro ou por item. */
  visao: z.enum(['linha', 'centro', 'item']).default('linha'),
  /** Recorte por centro de custo (id; 0 é o "sem centro"); sem ele, todos. */
  centro: z
    .string()
    .regex(/^\d{1,10}$/u, 'Centro de custo inválido.')
    .transform(Number)
    .pipe(z.number().int().min(0).max(2_147_483_647))
    .optional(),
  /** Recorte por item gerencial (grupo.subgrupo.item); sem ele, todos. O consumo de estoque não tem item gerencial. */
  item: z
    .string()
    .regex(/^\d{1,10}\.\d{1,10}\.\d{1,10}$/u, 'Item gerencial inválido (grupo.subgrupo.item).')
    .optional(),
});
export type ConsultaComparativo = z.infer<typeof esquemaConsultaComparativo>;

/** Cabeçalho de uma versão do orçamento. */
export interface OrcamentoVersao {
  readonly id: number;
  readonly empresa: number;
  readonly ano: number;
  readonly numero: number;
  readonly descricao: string;
  readonly situacao: SituacaoVersaoOrcamento;
  readonly base: string;
  readonly linhas: number;
  /** Total orçado no ano, em centavos, com as parcelas por natureza. */
  readonly totalCentavos: number;
  readonly totaisPorNatureza: Readonly<Record<NaturezaOrcamento, number>>;
  readonly versao: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly alteradoPor: string;
  readonly alteradoEm: string;
  readonly aprovadoPor: string | null;
  readonly aprovadoEm: string | null;
  readonly observacaoAprovacao: string | null;
  readonly descartadoPor: string | null;
  readonly motivoDescarte: string | null;
}

export interface LinhaOrcamento extends ChaveLinhaOrcamento {
  readonly meses: readonly number[];
  readonly totalCentavos: number;
  readonly observacao: string | null;
}

export interface OrcamentoDetalhe {
  readonly orcamento: OrcamentoVersao;
  readonly linhas: readonly LinhaOrcamento[];
  /** Quem pode o quê nesta versão (rascunho editável; aprovação por outra pessoa). */
  readonly acoes: {
    readonly editar: boolean;
    readonly aprovar: boolean;
    readonly descartar: boolean;
    /** Por que não pode aprovar (null: pode). */
    readonly motivoSemAprovar: string | null;
  };
}

export interface ItemGerencialOrcamento {
  readonly grupo: number;
  readonly subgrupo: number;
  readonly item: number;
  readonly nome: string;
  readonly grupoNome: string;
  /** R receita, D despesa (classificação do grupo); a natureza da linha segue a do grupo. */
  readonly natureza: 'despesa' | 'receita';
  readonly ativo: boolean;
}

export interface CentroOrcamento {
  readonly id: number;
  readonly codigo: number;
  readonly nome: string;
  readonly ativo: boolean;
}

/** Os parâmetros do orçamento do banco (linha única), só mostrados. */
export interface ParametrosOrcamentoLidos {
  readonly anoInicial: number | null;
  readonly mesInicial: number | null;
  /** Digita o centro de custo no lançamento (DIG_CDC T/F). */
  readonly digitaCentro: boolean | null;
  /** O regime gravado (sem valor no pc); o realizado do Sante é pela competência. */
  readonly regime: string | null;
}

export interface ApoioOrcamento {
  readonly naturezas: readonly { codigo: NaturezaOrcamento; rotulo: string; descricao: string }[];
  readonly centros: readonly CentroOrcamento[];
  readonly itens: readonly ItemGerencialOrcamento[];
  readonly parametros: ParametrosOrcamentoLidos;
  readonly chaveLigada: boolean;
  readonly acoes: { readonly editar: boolean; readonly aprovar: boolean };
}

/** Uma parcela de um total (o que soma). */
export interface ParcelaTotalOrcamento {
  readonly rotulo: string;
  readonly centavos: number;
}

export interface LinhaComparativo extends ChaveLinhaOrcamento {
  readonly rotuloCentro: string;
  readonly rotuloItem: string;
  readonly orcadoCentavos: number;
  readonly realizadoCentavos: number;
  readonly desvioCentavos: number;
  /** Desvio ÷ orçado × 100, com 2 casas (null: orçado zero). */
  readonly desvioPercentual: number | null;
  readonly favoravel: boolean;
  /** Realizado sem linha no orçamento (não orçado). */
  readonly naoOrcado: boolean;
  readonly orcadoMeses: readonly number[];
  readonly realizadoMeses: readonly number[];
}

export interface TotalComparativo {
  readonly natureza: NaturezaOrcamento;
  readonly orcadoCentavos: number;
  readonly realizadoCentavos: number;
  readonly desvioCentavos: number;
  readonly desvioPercentual: number | null;
  readonly favoravel: boolean;
  /** As parcelas do orçado e do realizado (uma por linha mostrada). */
  readonly parcelasOrcado: readonly ParcelaTotalOrcamento[];
  readonly parcelasRealizado: readonly ParcelaTotalOrcamento[];
}

export interface ComparativoOrcamento {
  readonly orcamento: OrcamentoVersao;
  readonly mesAte: number;
  readonly visao: 'linha' | 'centro' | 'item';
  /** O recorte aplicado (null: todos); os totais e as parcelas são os do recorte. */
  readonly centro: number | null;
  readonly item: string | null;
  readonly linhas: readonly LinhaComparativo[];
  readonly totais: readonly TotalComparativo[];
  /** O realizado de despesa e receita sem rateio por centro (vai ao "sem centro"), por natureza. */
  readonly realizadoSemCentroCentavos: Readonly<Record<'despesa' | 'receita', number>>;
  /** Avisos (realizado ainda incompleto, item sem cadastro, documento com rateio que não fecha 100%). */
  readonly avisos: readonly string[];
  readonly lidoEm: string;
}

/** O realizado lido do banco, por mês (1 a 12), antes da comparação. */
export interface RealizadoOrcamentoLido {
  readonly natureza: NaturezaOrcamento;
  readonly centro: number;
  readonly grupo: number;
  readonly subgrupo: number;
  readonly item: number;
  readonly mes: number;
  readonly centavos: number;
}

export const ROTULO_SEM_CENTRO = 'Sem centro de custo (hospital inteiro)';
export const ROTULO_CONSUMO_ITEM = 'Consumo de estoque (custo médio)';
