// Cliente do reajuste da operadora além do anual digitado (08-SGO L96, C1-086): índice com vigência (o teto da ANS),
// regra por sinistralidade com faixas, agrupamento do coletivo pequeno (RN ANS 565/2022) e reajuste do coletivo grande
// pela sinistralidade. Respostas validadas aqui; Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/reajustes-coletivos';
const n = z.number();
const tn = z.string().nullable();
const gravado = z.object({ id: n, versao: n }).passthrough();
const problema = z.object({ codigo: z.string(), campo: z.string(), detalhe: z.string() });

export const TIPOS_INDICE = ['teto_individual_ans', 'economico', 'proprio'] as const;
export const esquemaIndice = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  descricao: z.string(),
  tipo: z.enum(TIPOS_INDICE),
  vigenciaInicio: z.string(),
  vigenciaFim: tn,
  percentual: n,
  protocolo: tn,
});
export type Indice = z.infer<typeof esquemaIndice>;
const esquemaFaixa = z.object({ de: n, ate: n.nullable(), percentual: n });
export type Faixa = z.infer<typeof esquemaFaixa>;
export const esquemaRegra = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  descricao: z.string(),
  base: z.enum(['sinistralidade', 'mensalidade']),
  meses: n,
  meta: n.nullable(),
  vigenciaInicio: z.string(),
  vigenciaFim: tn,
  ativo: z.boolean(),
  faixas: z.array(esquemaFaixa),
});
export type Regra = z.infer<typeof esquemaRegra>;
export const esquemaContrato = z.object({
  id: n,
  numero: z.string(),
  operadora: n,
  situacao: z.string(),
  inicio: z.string(),
  mesReajuste: n,
  tipoContratacao: n,
  vidas: n,
});
export type ContratoColetivo = z.infer<typeof esquemaContrato>;
export const esquemaAgrupamento = z.object({
  id: n,
  versao: n,
  descricao: z.string(),
  vigencia: z.string(),
  limiteVidas: n,
  contratos: n,
  vidas: n,
  percentual: n.nullable(),
  dataAplicacao: tn,
  situacao: z.enum(['aberto', 'calculado', 'aplicado', 'cancelado']),
  memoria: tn,
  reajustes: n,
});
export type Agrupamento = z.infer<typeof esquemaAgrupamento>;
export const esquemaMembro = z.object({
  id: n,
  contrato: n,
  numero: z.string(),
  mesReajuste: n,
  vidas: n,
  reajustado: z.boolean(),
});
export type Membro = z.infer<typeof esquemaMembro>;
export const esquemaPrevia = z.object({
  contrato: n,
  regra: n,
  receita: n,
  despesa: n,
  meses: n,
  valorApurado: n,
  faixa: esquemaFaixa.nullable(),
  percentual: n.nullable(),
  memoria: z.string(),
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
  problemas: z.array(problema),
  problemasContrato: z.array(problema),
});
export type Previa = z.infer<typeof esquemaPrevia>;

export const lerIndices = () => ler(`${A}/indices`, z.array(esquemaIndice));
export const gravarIndice = (corpo: Omit<Indice, 'id' | 'versao'>) =>
  enviar(`${A}/indices`, corpo, gravado, novaChave('reaj-indice'));
export const lerRegras = (op: number) => ler(`${A}/${op}/regras`, z.array(esquemaRegra));
export const gravarRegra = (op: number, corpo: Omit<Regra, 'id' | 'versao' | 'ativo'>) =>
  enviar(`${A}/${op}/regras`, corpo, gravado, novaChave('reaj-regra'));
export const lerContratosColetivos = (op: number) => ler(`${A}/${op}/contratos`, z.array(esquemaContrato));
export const lerAgrupamentos = (op: number) => ler(`${A}/${op}/agrupamentos`, z.array(esquemaAgrupamento));
export const criarAgrupamento = (
  op: number,
  corpo: { descricao: string; vigencia: string; limiteVidas: number },
) => enviar(`${A}/${op}/agrupamentos`, corpo, gravado, novaChave('reaj-agrupamento'));
export const lerMembros = (id: number) => ler(`${A}/agrupamentos/${id}/contratos`, z.array(esquemaMembro));
export const calcularAgrupamento = (
  id: number,
  corpo: { versao: number; regra: number | null; percentual: number | null; justificativa: string | null },
) => enviar(`${A}/agrupamentos/${id}/calculo`, corpo, gravado, novaChave('reaj-calculo'));
export const aplicarAgrupamento = (id: number, corpo: { versao: number; competencia: string }) =>
  enviar(`${A}/agrupamentos/${id}/aplicacao`, corpo, gravado, novaChave('reaj-aplicacao'));
export const cancelarAgrupamento = (id: number, corpo: { versao: number; motivo: string }) =>
  enviar(`${A}/agrupamentos/${id}/cancelamento`, corpo, gravado, novaChave('reaj-cancelamento'));
export const lerPrevia = (contrato: number, competencia: string, regra: number) =>
  ler(
    `${A}/contratos/${contrato}/previa?competencia=${encodeURIComponent(competencia)}&regra=${regra}`,
    esquemaPrevia,
  );
export const reajustarPorSinistralidade = (contrato: number, corpo: { competencia: string; regra: number }) =>
  enviar(`${A}/contratos/${contrato}/sinistralidade`, corpo, gravado, novaChave('reaj-sinistralidade'));
