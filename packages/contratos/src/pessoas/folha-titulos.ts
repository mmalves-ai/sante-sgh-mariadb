// Integração da folha com o financeiro e o contábil, fatia F8 (M53.9; ficha do M53, seções 4 a 8, regras 6, 10 e 11):
// o de-para de cada destino da folha (líquido, encargos) para o credor e a classificação gerencial do contas a pagar, a
// prévia dos títulos de um período fechado (folha calculada) ou de um retorno conferido (folha externa), o lançamento
// pelos cenários `origem-folha` e `origem-encargo` de `financeiro.criarTituloPagar` e os fatos contábeis por centro de
// custo (o custo de pessoal que o M54 consome pela fila). Valores em CENTAVOS inteiros (o título grava reais).
//
// Destinos e rotinas: cada destino é uma rotina de integração do cadastro de rotinas da folha (`FPINTROTINA`: 4 folha
// mensal, 6 contribuição sindical, 11 férias, 12 rescisão, 14 13º salário, 15 FGTS, 16 INSS, 17 INSS patronal, 18
// IRRF). As rotinas que o cadastro marca "integra ao financeiro" viram título; as que marca "integra à contabilidade",
// fato contábil com `contabiliza` (D-ROTINA-539).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import type { ApuracaoFolha } from './folha-periodicos.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const id = z.coerce.number().int().positive();
const smallint = z.coerce.number().int().min(0).max(32_767);
const inteiroPositivo = z.number().int().positive().max(2_147_483_647);

/** Os destinos da folha que viram título a pagar (um título por destino e vencimento). */
export const DESTINOS_TITULO_FOLHA = [
  'liquido-mensal',
  'liquido-ferias',
  'liquido-rescisao',
  'liquido-decimo',
  'inss',
  'inss-patronal',
  'fgts',
  'irrf',
  'sindical',
] as const;
export type DestinoTituloFolha = (typeof DESTINOS_TITULO_FOLHA)[number];

/** A rotina de integração (`FPINTROTINA.ID`) de cada destino. */
export const ROTINA_DO_DESTINO: Readonly<Record<DestinoTituloFolha, number>> = {
  'liquido-mensal': 4,
  'liquido-ferias': 11,
  'liquido-rescisao': 12,
  'liquido-decimo': 14,
  inss: 16,
  'inss-patronal': 17,
  fgts: 15,
  irrf: 18,
  sindical: 6,
};

/** Cenário de `financeiro.criarTituloPagar` de cada destino: o líquido é `origem-folha`; o resto, `origem-encargo`. */
export const cenarioDoDestino = (d: DestinoTituloFolha): 'origem-folha' | 'origem-encargo' =>
  d.startsWith('liquido-') ? 'origem-folha' : 'origem-encargo';

/** As rotinas que a fatia usa; as demais do cadastro (vales, provisões, PIS) aparecem só na lista do de-para. */
export const ROTINAS_TITULO_FOLHA: readonly number[] = [...new Set(Object.values(ROTINA_DO_DESTINO))].sort(
  (a, b) => a - b,
);

/** `FPINTROTINA.PERMITE_INTEGRAR_*`: 2 = sim, 1 = não (as provisões integram só à contabilidade). */
export const INTEGRA_SIM = 2;

/** Origem do lançamento: o período fechado da folha calculada (F6) ou o retorno conferido da folha externa (F0). */
export const ORIGENS_LANCAMENTO_FOLHA = ['fechamento', 'interface'] as const;
export type OrigemLancamentoFolha = (typeof ORIGENS_LANCAMENTO_FOLHA)[number];

/** Natureza do fato contábil: o provento (despesa de salário) ou o encargo da empresa (INSS patronal, RAT, terceiros, FGTS). */
export const NATUREZAS_FATO_FOLHA = ['provento', 'encargo'] as const;
export type NaturezaFatoFolha = (typeof NATUREZAS_FATO_FOLHA)[number];

/** Teto de títulos por lançamento (destinos × vencimentos; as férias e as rescisões do mês têm datas próprias). */
export const TETO_TITULOS_LANCAMENTO_FOLHA = 60;
/** Teto de fatos por lançamento (centros de custo × rotinas × naturezas). */
export const TETO_FATOS_LANCAMENTO_FOLHA = 1_500;

/** Classificação gerencial do título (`TBITEDES`), como o contas a pagar usa. */
export const esquemaClassificacaoFolha = z
  .object({ grupo: smallint, subgrupo: smallint, item: smallint })
  .strict()
  .refine((c) => c.grupo > 0, { message: 'Escolha a classificação gerencial.' });

/**
 * O de-para de um destino: credor (`TBFORNEC.COD`), classificação gerencial e o vencimento (dia do mês, no mês do
 * período ou no seguinte). O líquido vence na data de pagamento da folha (o vencimento do de-para não vale para ele).
 */
export const esquemaDestinoIntegracaoFolha = z
  .object({
    destino: z.enum(DESTINOS_TITULO_FOLHA),
    credor: inteiroPositivo,
    classificacao: esquemaClassificacaoFolha,
    diaVencimento: z.number().int().min(1).max(31),
    mesesDepois: z.number().int().min(0).max(1),
    /** Conta contábil sugerida ao M54 (o plano de contas é dele); vazio sem sugestão. */
    contaContabil: textoCp1252(20).default(''),
  })
  .strict();
export type DestinoIntegracaoFolha = z.infer<typeof esquemaDestinoIntegracaoFolha>;

/** Grava uma vigência do de-para da empresa (cada vigência é completa: os destinos que faltam ficam sem de-para). */
export const esquemaGravarIntegracaoFolha = z
  .object({
    empresa: smallint,
    inicio: data,
    destinos: z
      .array(esquemaDestinoIntegracaoFolha)
      .min(1)
      .max(DESTINOS_TITULO_FOLHA.length)
      .superRefine((ds, ctx) => {
        const vistos = new Set<string>();
        for (const [i, d] of ds.entries()) {
          if (vistos.has(d.destino))
            ctx.addIssue({ code: 'custom', path: [i, 'destino'], message: 'Destino repetido.' });
          vistos.add(d.destino);
        }
      }),
  })
  .strict();
export type GravarIntegracaoFolhaEntrada = z.infer<typeof esquemaGravarIntegracaoFolha>;

/** O que a prévia e o lançamento recebem: a origem e, no lançamento, o resumo da prévia e as datas confirmadas. */
export const esquemaPreviaTitulosFolha = z
  .object({ empresa: smallint, origem: z.enum(ORIGENS_LANCAMENTO_FOLHA), id })
  .strict();
export type PreviaTitulosFolhaEntrada = z.infer<typeof esquemaPreviaTitulosFolha>;

export const esquemaVencimentoConfirmado = z
  .object({ chave: z.string().min(3).max(40), vencimento: data })
  .strict();

export const esquemaLancarTitulosFolha = z
  .object({
    empresa: smallint,
    origem: z.enum(ORIGENS_LANCAMENTO_FOLHA),
    id,
    /** SHA-256 do plano que a pessoa conferiu na prévia: o plano mudou, o lançamento é recusado. */
    resumo: z.string().regex(/^[0-9a-f]{64}$/),
    emissao: data,
    /** Vencimentos ajustados na prévia (por chave do título); os outros ficam os sugeridos. */
    vencimentos: z.array(esquemaVencimentoConfirmado).max(TETO_TITULOS_LANCAMENTO_FOLHA).default([]),
  })
  .strict();
export type LancarTitulosFolhaEntrada = z.infer<typeof esquemaLancarTitulosFolha>;

export const esquemaFiltroLancamentosFolha = z
  .object({ empresa: smallint, ano: z.coerce.number().int().min(2000).max(2100) })
  .strict();
export type FiltroLancamentosFolha = z.infer<typeof esquemaFiltroLancamentosFolha>;

/** As origens que a tela oferece para a prévia: os períodos fechados e os retornos da folha externa do ano. */
export const esquemaFiltroOrigensFolha = esquemaFiltroLancamentosFolha;
export type FiltroOrigensFolha = FiltroLancamentosFolha;

export const esquemaFiltroCustoPessoal = z
  .object({ empresa: smallint, periodo: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/) })
  .strict();
export type FiltroCustoPessoal = z.infer<typeof esquemaFiltroCustoPessoal>;

// ── Respostas ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Um título do plano (ou lançado). `chave` = destino + vencimento, única no lançamento. */
export interface TituloFolhaPlanejado {
  readonly chave: string;
  readonly destino: DestinoTituloFolha;
  readonly rotina: number;
  readonly cenario: 'origem-folha' | 'origem-encargo';
  readonly credor: number | null;
  readonly classificacao: { readonly grupo: number; readonly subgrupo: number; readonly item: number } | null;
  readonly documento: number;
  readonly valor: number;
  readonly vencimento: string;
  readonly referente: string;
}

/** Um fato contábil da folha: o custo de pessoal por centro de custo e rotina (fila do M54). */
export interface FatoContabilFolha {
  readonly rotina: number;
  readonly centroCusto: number;
  readonly natureza: NaturezaFatoFolha;
  readonly contabiliza: boolean;
  readonly valor: number;
}

/**
 * Pendências que barram o lançamento (a tela traduz por `folha.integracao.pendencia.<codigo>`):
 * - origem-nao-fechada: o período não está fechado (ou foi reaberto);
 * - lote-divergente: o retorno da folha externa não está conferido;
 * - ja-lancado: o período (ou o retorno) já tem títulos lançados;
 * - sem-de-para: um destino com valor sem credor ou classificação no de-para vigente;
 * - rotina-sem-financeiro: a rotina do destino não integra ao financeiro no cadastro de rotinas;
 * - encargo-sem-destino: o retorno da folha externa tem encargo "outro", sem rotina;
 * - soma-divergente: a soma dos títulos não fecha com o líquido mais os encargos;
 * - sem-titulos: nada a lançar (todos os valores zero);
 * - vencimento-antes-da-emissao: um vencimento confirmado antes da emissão.
 */
export const PENDENCIAS_TITULOS_FOLHA = [
  'origem-nao-fechada',
  'lote-divergente',
  'ja-lancado',
  'sem-de-para',
  'rotina-sem-financeiro',
  'encargo-sem-destino',
  'soma-divergente',
  'sem-titulos',
  'vencimento-antes-da-emissao',
] as const;
export type PendenciaTitulosFolha = (typeof PENDENCIAS_TITULOS_FOLHA)[number];

export interface PendenciaTituloFolha {
  readonly codigo: PendenciaTitulosFolha;
  readonly destino: DestinoTituloFolha | null;
}

/** Avisos (não barram): título no contas a pagar com o mesmo credor e classificação no mês, lançado por outro caminho. */
export interface AvisoTituloFolha {
  readonly codigo: 'possivel-lancamento-manual';
  readonly destino: DestinoTituloFolha;
  readonly titulos: number;
}

export interface ParcelaContaFolha {
  readonly rotulo: string;
  readonly valor: number;
}

export interface PreviaTitulosFolha {
  readonly empresa: number;
  readonly origem: OrigemLancamentoFolha;
  readonly id: number;
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  readonly titulos: readonly TituloFolhaPlanejado[];
  readonly fatos: readonly FatoContabilFolha[];
  /** A conta impressa: "líquido R$ x + INSS R$ y + … = R$ total" (regra da seção 5: parcelas impressas). */
  readonly conta: string;
  readonly parcelas: readonly ParcelaContaFolha[];
  readonly total: number;
  /** Líquido + encargos da origem, que a soma dos títulos tem de igualar. */
  readonly esperado: number;
  readonly pendencias: readonly PendenciaTituloFolha[];
  readonly avisos: readonly AvisoTituloFolha[];
  readonly resumo: string;
  readonly podeLancar: boolean;
}

export interface TituloFolhaLancado extends TituloFolhaPlanejado {
  readonly titulo: number;
  /** Situação no contas a pagar: em aberto ou pago (relido do título). */
  readonly pago: boolean;
}

export interface LancamentoFolha {
  readonly id: number;
  readonly empresa: number;
  readonly origem: OrigemLancamentoFolha;
  readonly idOrigem: number;
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  readonly resumo: string;
  readonly total: number;
  readonly liquido: number;
  readonly encargos: number;
  readonly titulos: readonly TituloFolhaLancado[];
  readonly fatos: number;
  readonly lancadoPor: string;
  readonly lancadoEm: string;
}

export interface ListaLancamentosFolha {
  readonly itens: readonly Omit<LancamentoFolha, 'titulos'>[];
}

export interface ResultadoLancamentoFolha {
  readonly lancamento: LancamentoFolha;
  readonly conta: string;
}

/** Vigência do de-para lida (a vigente e as anteriores). */
export interface IntegracaoFolhaLida {
  readonly id: number;
  readonly empresa: number;
  readonly inicio: string;
  readonly destinos: readonly (DestinoIntegracaoFolha & { readonly rotina: number })[];
  readonly criadoPor: string;
  readonly criadoEm: string;
}

/** Uma rotina do cadastro de rotinas da folha (`FPINTROTINA`) com o agrupamento (`FPINTAGRUP`). */
export interface RotinaIntegracaoFolha {
  readonly id: number;
  readonly nome: string;
  readonly complemento: string;
  readonly agrupamento: number;
  readonly agrupamentoNome: string;
  readonly financeiro: boolean;
  readonly contabilidade: boolean;
}

export interface ApoioIntegracaoFolha {
  readonly empresas: readonly { readonly codigo: number; readonly nome: string }[];
  readonly rotinas: readonly RotinaIntegracaoFolha[];
  readonly destinos: readonly { readonly destino: DestinoTituloFolha; readonly rotina: number }[];
  /** De-para sugerido pelo perfil do contas a pagar (classificação apenas; o credor é escolha do DP). */
  readonly sugestao: readonly {
    readonly destino: DestinoTituloFolha;
    readonly classificacao: { readonly grupo: number; readonly subgrupo: number; readonly item: number };
  }[];
  readonly vigente: IntegracaoFolhaLida | null;
  /** As classificações gerenciais ativas do contas a pagar (a escolha do de-para, com busca). */
  readonly classificacoes: readonly ClassificacaoFolha[];
  /** O nome dos credores do de-para vigente (a busca de outros é `credores`). */
  readonly credores: readonly CredorFolha[];
  /** O dia de hoje no servidor (AAAA-MM-DD): o ano e o período que a tela sugere, a emissão dos títulos. */
  readonly hoje: string;
}

export interface ClassificacaoFolha {
  readonly grupo: number;
  readonly subgrupo: number;
  readonly item: number;
  readonly nome: string;
}

/** Um credor do contas a pagar (só código e nome). */
export interface CredorFolha {
  readonly codigo: number;
  readonly nome: string;
}

export interface ListaCredoresFolha {
  readonly itens: readonly CredorFolha[];
}

/** A busca de credores do de-para: parte do nome ou o código (ao menos 2 caracteres). */
export const esquemaBuscaCredoresFolha = z.object({ termo: z.string().trim().min(2).max(60) }).strict();
export type BuscaCredoresFolha = z.infer<typeof esquemaBuscaCredoresFolha>;

/** Custo de pessoal por centro de custo (proventos + encargos da empresa), somado dos fatos dos lançamentos. */
export interface CustoPessoalCentro {
  readonly centroCusto: number;
  readonly proventos: number;
  readonly encargos: number;
  readonly total: number;
}

export interface CustoPessoalPeriodo {
  readonly empresa: number;
  readonly periodo: string;
  readonly centros: readonly CustoPessoalCentro[];
  readonly total: number;
  readonly lancamentos: number;
}

/** Uma origem possível de lançamento (sem valores: a prévia é que monta e confere). */
export interface OrigemTitulosFolha {
  readonly origem: OrigemLancamentoFolha;
  readonly id: number;
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  /** Fechamento: o número do fechamento do período; retorno: o número do lote. */
  readonly numero: number;
  /** Fechamento: fechada/reaberta; retorno: conferido/divergente/lancado (a situação do lote). */
  readonly situacao: string;
  /** O lançamento já feito desta origem (ou nulo). */
  readonly lancamento: number | null;
}

export interface ListaOrigensFolha {
  readonly itens: readonly OrigemTitulosFolha[];
}

/** Evento da outbox que avisa o M54 do custo de pessoal do lançamento (carga só com IDs e códigos). */
export const EVENTO_CUSTO_PESSOAL_FOLHA = 'PESSOAS_FOLHA_CUSTO_PESSOAL';

/** Recusas do lançamento (`folha.erro.<codigo>` na tela). */
export const RECUSAS_TITULOS_FOLHA = [
  'titulos-com-pendencias',
  'plano-mudou',
  'folha-repetida',
  'sem-de-para',
] as const;
export type RecusaTitulosFolha = (typeof RECUSAS_TITULOS_FOLHA)[number];
