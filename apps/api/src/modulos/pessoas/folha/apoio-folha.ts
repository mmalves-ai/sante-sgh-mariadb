// Apoio da folha deste lote: os tetos de linhas das listas, os dois auxiliares puros da integração (o mês de uma data
// e o de-para vigente numa data), o catálogo de rotinas e os tipos do lançamento dos títulos da folha. Os tipos das
// portas do cálculo e da folha ficam em tipos-folha.ts.
// Melhoria: vínculo sem centro de custo ou carga semanal é recusado com o motivo (422), nunca um zero fictício.
// Melhoria: o catálogo de rotinas é do produto (um só lugar para a porta própria e a de memória).
import { ErroOperacao } from '@sgh/nucleo';
import type {
  ApuracaoFolha,
  DestinoTituloFolha,
  IntegracaoFolhaLida,
  OrigemLancamentoFolha,
  RotinaIntegracaoFolha,
} from '@sgh/contratos';

/** Tetos de linhas das leituras das listas (o serviço avisa quando a lista bate no teto). */
export const TETO_RESCISOES_LISTA = 1_000;
export const TETO_DESLIGADOS = 1_000;
export const TETO_LOTES_FOLHA = 200;
export const TETO_VINCULOS_FOLHA = 20_000;
export const TETO_AFASTAMENTOS = 20_000;
export const TETO_FECHAMENTOS_FOLHA = 200;
export const TETO_FERIAS_LISTA = 2_000;
export const TETO_PROCESSOS_FOLHA = 200;
export const TETO_PLANTOES_REALIZADO = 2_000;

/** Lançamento dos títulos de uma competência da folha no contas a pagar. */
export interface LancamentoTitulosFolha {
  readonly id: number;
  readonly empresa: number;
  readonly origem: OrigemLancamentoFolha;
  readonly idOrigem: number;
  readonly apuracao: ApuracaoFolha;
  readonly periodo: string;
  readonly resumo: string;
  readonly titulos: number;
  readonly fatos: number;
  readonly liquido: number;
  readonly encargos: number;
  readonly total: number;
  readonly lancadoPor: string;
  readonly lancadoEm: string;
}

/** Título a pagar gerado por um lançamento da folha. */
export interface TituloFolhaLancado {
  readonly destino: DestinoTituloFolha;
  readonly rotina: number;
  readonly titulo: number;
  readonly credor: number;
  readonly documento: number;
  readonly vencimento: string;
  readonly valor: number;
  /** Baixado no contas a pagar. */
  readonly pago: boolean;
}

/** Primeiro e último dia do mês de uma data ISO. */
export function mesDaData(data: string): { de: string; ate: string } {
  const [a, m] = [Number(data.slice(0, 4)), Number(data.slice(5, 7))];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { de: `${a}-${mm}-01`, ate: `${a}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

/** O de-para de integração vigente numa data (o de início mais recente até a data). */
export function integracaoVigenteEm(
  vigencias: readonly IntegracaoFolhaLida[],
  data: string,
): IntegracaoFolhaLida | null {
  return (
    [...vigencias].sort((a, b) => b.inicio.localeCompare(a.inicio)).find((v) => v.inicio <= data) ?? null
  );
}

/**
 * As rotinas de integração da folha (o id é o de `ROTINA_DO_DESTINO`): o catálogo fixo do produto, com o agrupamento e
 * se a rotina gera título no financeiro e lançamento na contabilidade.
 */
export const ROTINAS_INTEGRACAO_FOLHA: readonly RotinaIntegracaoFolha[] = (
  [
    [1, 'Vale transporte', '', 1, 'Compras', true, true],
    [2, 'Vale refeição/ alimentação', '', 1, 'Compras', true, true],
    [3, 'Adiantamento', '', 2, 'Rotinas mensais', true, false],
    [4, 'Folha mensal', '', 2, 'Rotinas mensais', true, true],
    [5, 'Folha mensal', 'Consignado em Folha (Pagamento)', 2, 'Rotinas mensais', true, false],
    [6, 'Folha mensal', 'Contribuição sindical laboral (Pagamento)', 2, 'Rotinas mensais', true, false],
    [7, 'Folha mensal', 'Pensão alimentícia (Pagamento)', 2, 'Rotinas mensais', true, false],
    [8, 'Folha mensal', 'Provisão mensal de avos de férias', 2, 'Rotinas mensais', false, true],
    [9, 'Folha mensal', 'Provisão mensal de avos de 13º salário', 2, 'Rotinas mensais', false, true],
    [10, 'Folha mensal', 'Reversão de provisão de férias', 2, 'Rotinas mensais', false, true],
    [11, 'Férias', '', 3, 'Férias', true, false],
    [12, 'Rescisão', '', 4, 'Rescisão', true, true],
    [13, 'Rescisão complementar', '', 4, 'Rescisão', true, true],
    [14, '13º salário', '', 5, 'Outros', true, false],
    [15, 'Tributos', 'FGTS', 5, 'Outros', true, true],
    [16, 'Tributos', 'INSS', 5, 'Outros', true, false],
    [17, 'Tributos', 'INSS - Patronal', 5, 'Outros', true, true],
    [18, 'Tributos', 'IRRF', 5, 'Outros', true, false],
    [19, 'Tributos', 'PIS', 5, 'Outros', true, true],
  ] as const
).map(([id, nome, complemento, agrupamento, agrupamentoNome, financeiro, contabilidade]) => ({
  id,
  nome,
  complemento,
  agrupamento,
  agrupamentoNome,
  financeiro,
  contabilidade,
}));

/** Vínculos sem centro de custo no cadastro: recusa com a contagem e os ids (nunca um centro zero fictício). */
function recusaCadastro(faltam: readonly number[], oQue: string, uso: string): ErroOperacao {
  return new ErroOperacao(
    422,
    'cadastro-incompleto',
    'Cadastro do vínculo incompleto',
    `${faltam.length} vínculo(s) sem ${oQue} no cadastro (ids ${faltam.slice(0, 20).join(', ')}${faltam.length > 20 ? ', ...' : ''}): complete o cadastro antes ${uso}.`,
  );
}

/** A exportação e o cálculo rateiam por centro de custo: o vínculo sem centro é recusado com o motivo. */
export function exigirCentroCusto<T extends { readonly id: number; readonly centroCusto: number | null }>(
  vs: readonly T[],
  uso: string,
): (Omit<T, 'centroCusto'> & { readonly centroCusto: number })[] {
  const faltam = vs.filter((v) => v.centroCusto === null).map((v) => v.id);
  if (faltam.length) throw recusaCadastro(faltam, 'centro de custo', uso);
  return vs as unknown as (Omit<T, 'centroCusto'> & { readonly centroCusto: number })[];
}

/** O cálculo precisa do centro de custo e da carga semanal (base da hora): sem eles, recusa com o motivo. */
export function exigirCadastroDoCalculo<
  T extends {
    readonly id: number;
    readonly centroCusto: number | null;
    readonly cargaSemanal: number | null;
  },
>(
  vs: readonly T[],
): (Omit<T, 'centroCusto' | 'cargaSemanal'> & {
  readonly centroCusto: number;
  readonly cargaSemanal: number;
})[] {
  exigirCentroCusto(vs, 'do cálculo');
  const faltam = vs.filter((v) => v.cargaSemanal === null).map((v) => v.id);
  if (faltam.length) throw recusaCadastro(faltam, 'carga semanal', 'do cálculo');
  return vs as unknown as (Omit<T, 'centroCusto' | 'cargaSemanal'> & {
    readonly centroCusto: number;
    readonly cargaSemanal: number;
  })[];
}
