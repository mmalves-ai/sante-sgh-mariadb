// Cliente dos complementos da conta e da guia (F3.7, 06-FAT linhas 10 e 12): período da conta parcial, segurado na
// conta e campo adicional da operadora na guia. As regras vêm de @sgh/dominio-faturamento (a mesma da API), para a
// validação aparecer enquanto se digita; o servidor confere de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';
const qualquer = z.record(z.string(), z.unknown());

const periodo = z.object({
  id: z.number(),
  sequencia: z.number(),
  inicio: z.string(),
  fim: z.string(),
  competencia: z.string(),
  tipoLancamentoId: z.number().nullable(),
  tipoLancamento: z.string().nullable(),
  versao: z.number(),
});
export type Periodo = z.infer<typeof periodo>;
const sugestao = z
  .object({
    inicio: z.string(),
    fim: z.string(),
    competencia: z.string(),
    tipoLancamentoId: z.number().nullable(),
  })
  .nullable();
const esquemaPeriodos = z.object({
  contaId: z.number(),
  situacao: z.string(),
  editavel: z.boolean(),
  inicioConta: z.string(),
  fimConta: z.string().nullable(),
  periodos: z.array(periodo),
  sugestao,
});
export type PeriodosConta = z.infer<typeof esquemaPeriodos>;

const segurado = z.object({
  id: z.number().nullable(),
  sequencia: z.number().nullable(),
  coberturaPacienteId: z.number().nullable(),
  titularCoberturaId: z.number().nullable(),
  numeroCarteira: z.string(),
  validadeCarteira: z.string().nullable(),
  matriculaFuncional: z.string().nullable(),
  cargo: z.string().nullable(),
  padraoFuncional: z.string().nullable(),
  classeFuncional: z.string().nullable(),
  unidadeAdministrativa: z.string().nullable(),
  parentescoTitular: z.string().nullable(),
  numeroOrdem: z.string().nullable(),
  versao: z.number().nullable(),
});
export type Segurado = z.infer<typeof segurado>;
const esquemaSegurado = z.object({
  contaId: z.number(),
  editavel: z.boolean(),
  gravado: z.boolean(),
  substituidos: z.number(),
  segurado,
});
export type SeguradoConta = z.infer<typeof esquemaSegurado>;

const opcao = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  ativo: z.boolean(),
  opcaoPaiId: z.number().nullable(),
  versao: z.number().optional(),
});
const atributo = z.object({
  id: z.number(),
  codigo: z.string(),
  rotulo: z.string(),
  tipoDado: z.enum(['texto', 'numero', 'data', 'booleano', 'opcao']),
  tipoGuia: z.string().nullable(),
  obrigatorio: z.boolean(),
  tamanhoMaximo: z.number().nullable(),
  dependeDeId: z.number().nullable(),
  ativo: z.boolean(),
  ordem: z.number(),
  versao: z.number().optional(),
  opcoes: z.array(opcao),
});
export type AtributoGuia = z.infer<typeof atributo>;
const valor = z.object({
  atributoId: z.number(),
  opcaoId: z.number().nullable(),
  texto: z.string().nullable(),
});
const esquemaGuia = z.object({
  guia: z.object({
    id: z.number(),
    tipoGuia: z.string(),
    situacao: z.string(),
    fontePagadoraId: z.number(),
    contaId: z.number(),
    numero: z.string(),
  }),
  editavel: z.boolean(),
  campos: z.array(atributo),
  valores: z.array(valor),
  faltam: z.array(z.string()),
});
export type AtributosDaGuia = z.infer<typeof esquemaGuia>;

export const lerPeriodos = (conta: number) => ler(`${F}/contas/${conta}/periodos`, esquemaPeriodos);
export const incluirPeriodo = (
  conta: number,
  p: { inicio: string; fim: string; competencia?: string | null; tipoLancamentoId?: number | null },
  chave: string,
) => enviar(`${F}/contas/${conta}/periodos`, p, qualquer, chave);
export const retirarPeriodo = (id: number, versao: number, motivo: string, chave: string) =>
  enviar(`${F}/periodos-conta/${id}/retirada`, { versao, motivo }, qualquer, chave);

export const lerSegurado = (conta: number) => ler(`${F}/contas/${conta}/segurado`, esquemaSegurado);
export const gravarSegurado = (conta: number, s: Segurado, chave: string) =>
  enviar(`${F}/contas/${conta}/segurado`, s, qualquer, chave);

export const lerAtributosFonte = (fonte: number) =>
  ler(`${F}/fontes/${fonte}/atributos-guia`, z.array(atributo));
export const gravarAtributoFonte = (fonte: number, a: Record<string, unknown>, chave: string) =>
  enviar(`${F}/fontes/${fonte}/atributos-guia`, a, qualquer, chave);
export const lerAtributosGuia = (guia: number) => ler(`${F}/guias/${guia}/atributos`, esquemaGuia);
export const gravarAtributosGuia = (guia: number, valores: z.infer<typeof valor>[], chave: string) =>
  enviar(`${F}/guias/${guia}/atributos`, { valores }, qualquer, chave);

const esquemaGuiasConta = z.object({
  contaId: z.number(),
  fontePagadoraId: z.number(),
  guias: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      tipoGuia: z.string(),
      situacao: z.string(),
      fontePagadoraId: z.number(),
      campos: z.number(),
      faltam: z.array(z.string()),
    }),
  ),
});
export type GuiasAtributosConta = z.infer<typeof esquemaGuiasConta>;
/** As guias TISS da conta com os obrigatórios da operadora que faltam em cada uma. */
export const lerGuiasAtributosConta = (conta: number) =>
  ler(`${F}/contas/${conta}/guias-atributos`, esquemaGuiasConta);
