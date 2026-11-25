// Cliente da API do cadastro do laudo estruturado do exame (F3.5, 05-SADT linha 17): seções, medidas, faixas de
// referência e a fórmula da medida calculada.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const B = '/api/sadt/catalogo/laudo-estruturado';
const n = z.number();
const nn = n.nullable();
const txt = z.string();
const tn = txt.nullable();

const esquemaFaixa = z.object({
  id: n,
  versao: n,
  grandezaLaudoId: n,
  sexoId: nn,
  idadeMinimaDias: nn,
  idadeMaximaDias: nn,
  pesoMinimoKg: nn,
  pesoMaximoKg: nn,
  superficieCorporalMinima: nn,
  superficieCorporalMaxima: nn,
  referenciaMinima: nn,
  referenciaMaxima: nn,
  indexadaSuperficie: z.boolean(),
  referenciaTexto: tn,
  vigenciaInicio: txt,
  vigenciaFim: tn,
  ativo: z.boolean(),
});
const esquemaFormula = z.object({
  id: n,
  descricao: txt,
  expressao: txt,
  casasDecimais: nn,
  vigenciaInicio: txt,
  vigenciaFim: tn,
  variaveis: z.array(
    z.object({ identificador: txt, descricao: txt, fonte: txt, grandezaLaudoId: nn, dadoPaciente: tn }),
  ),
});
const esquemaGrandeza = z.object({
  id: n,
  versao: n,
  secaoLaudoEstruturadoId: nn,
  codigo: txt,
  sigla: tn,
  descricao: txt,
  unidadeResultadoId: nn,
  casasDecimais: nn,
  ordem: n,
  calculada: z.boolean(),
  obrigatoria: z.boolean(),
  ativo: z.boolean(),
  faixas: z.array(esquemaFaixa),
  formulas: z.array(esquemaFormula),
});
export const esquemaLaudoEstruturado = z.object({
  exameId: n,
  secoes: z.array(
    z.object({ id: n, versao: n, codigo: txt, nome: txt, sigla: tn, ordem: n, ativo: z.boolean() }),
  ),
  grandezas: z.array(esquemaGrandeza),
  sexos: z.array(z.object({ id: n, descricao: txt })),
  unidades: z.array(z.object({ id: n, simbolo: txt })),
});
export type LaudoEstruturado = z.infer<typeof esquemaLaudoEstruturado>;
export type GrandezaCadastro = z.infer<typeof esquemaGrandeza>;
export type FaixaCadastro = z.infer<typeof esquemaFaixa>;

const gravado = z.object({ id: n }).passthrough();

export const lerLaudoEstruturado = (exame: number) => ler(`${B}?exame=${exame}`, esquemaLaudoEstruturado);
export const gravarSecaoLaudo = (corpo: Record<string, unknown>, chave: string) =>
  enviar(`${B}/secoes`, corpo, gravado, chave);
export const gravarGrandezaLaudo = (corpo: Record<string, unknown>, chave: string) =>
  enviar(`${B}/grandezas`, corpo, gravado, chave);
export const gravarFaixaGrandeza = (corpo: Record<string, unknown>, chave: string) =>
  enviar(`${B}/faixas`, corpo, gravado, chave);
export const gravarFormulaGrandeza = (grandeza: number, corpo: Record<string, unknown>, chave: string) =>
  enviar(`${B}/grandezas/${grandeza}/formula`, corpo, gravado, chave);
