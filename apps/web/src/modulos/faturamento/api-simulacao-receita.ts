// Cliente da simulação de cenários de receita sobre a produção real (F8, 01-ADM L120). A regra do cenário vem de
// @sgh/dominio-faturamento (a mesma da API), para a validação aparecer enquanto se digita; o servidor confere de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento/simulacao-receita';
const opcao = z.object({ id: z.number(), descricao: z.string() });

const esquemaPainel = z.object({
  cenarios: z.array(
    z.object({
      id: z.number(),
      nome: z.string(),
      objetivo: z.string(),
      descricao: z.string().nullable(),
      producaoInicio: z.string(),
      producaoFim: z.string(),
      situacao: z.string(),
      receitaBase: z.number().nullable(),
      receitaSimulada: z.number().nullable(),
      quantidadeAtendimentos: z.number().nullable(),
      processadoEm: z.string().nullable(),
    }),
  ),
  execucoes: z.array(
    z.object({
      id: z.number(),
      cenarioId: z.number(),
      solicitadoEm: z.string().nullable(),
      situacao: z.string(),
      dataReferencia: z.string(),
      tipo: z.string(),
      quantidadeItens: z.number(),
      quantidadeInconsistencias: z.number(),
      valorAtual: z.number(),
      valorSimulado: z.number(),
      diferenca: z.number(),
    }),
  ),
  opcoes: z.object({
    fontes: z.array(opcao),
    planos: z.array(opcao.extend({ fonteId: z.number() })),
    tabelas: z.array(opcao.extend({ fonteId: z.number().nullable() })),
  }),
});
export type PainelSimulacaoReceita = z.infer<typeof esquemaPainel>;

const somas = {
  quantidade: z.number(),
  valorAtual: z.number(),
  valorSimulado: z.number(),
  diferenca: z.number(),
};
const esquemaDetalhe = z.object({
  simulacao: z.object({
    id: z.number(),
    cenarioId: z.number(),
    cenario: z.string(),
    objetivo: z.string(),
    tipo: z.string(),
    periodoInicio: z.string(),
    periodoFim: z.string(),
    dataReferencia: z.string(),
    situacao: z.string(),
    solicitadoEm: z.string().nullable(),
    quantidadeItens: z.number(),
    quantidadeInconsistencias: z.number(),
    valorAtual: z.number(),
    valorSimulado: z.number(),
    diferenca: z.number(),
    percentual: z.number().nullable(),
  }),
  regras: z.array(
    z.object({
      id: z.number(),
      fonte: z.string(),
      plano: z.string().nullable(),
      fonteDestino: z.string().nullable(),
      tabelaDestino: z.string().nullable(),
      percentualAjuste: z.number().nullable(),
      conversoes: z.number(),
    }),
  ),
  porConvenio: z.array(
    z.object({ fonteId: z.number(), fonte: z.string(), fonteDestino: z.string().nullable(), ...somas }),
  ),
  porGrupo: z.array(z.object({ grupoId: z.number().nullable(), grupo: z.string(), ...somas })),
  porTipoAtendimento: z.array(z.object({ tipo: z.string().nullable(), ...somas })),
  itens: z.array(
    z.object({
      sequencia: z.number(),
      fonte: z.string(),
      codigo: z.string(),
      descricao: z.string(),
      tipo: z.string().nullable(),
      atendimentos: z.number(),
      ...somas,
    }),
  ),
  inconsistencias: z.array(
    z.object({
      sequencia: z.number(),
      motivo: z.string(),
      detalhe: z.string().nullable(),
      data: z.string().nullable(),
      codigoAtual: z.string().nullable(),
      descricaoAtual: z.string().nullable(),
      codigoDestino: z.string().nullable(),
      resolvida: z.boolean(),
    }),
  ),
});
export type DetalheSimulacaoReceita = z.infer<typeof esquemaDetalhe>;

const esquemaCriado = z.object({ id: z.number() }).passthrough();
const esquemaExecutado = z
  .object({
    id: z.number(),
    valorAtual: z.number(),
    valorSimulado: z.number(),
    diferenca: z.number(),
    situacao: z.string(),
  })
  .passthrough();

export const lerPainelSimulacaoReceita = (): Promise<PainelSimulacaoReceita> => ler(F, esquemaPainel);
export const lerSimulacaoReceita = (id: number): Promise<DetalheSimulacaoReceita> =>
  ler(`${F}/execucoes/${id}`, esquemaDetalhe);
export const criarCenarioReceita = (corpo: unknown, chave: string) =>
  enviar(`${F}/cenarios`, corpo, esquemaCriado, chave);
export const executarSimulacaoReceita = (cenarioId: number, dataReferencia: string, chave: string) =>
  enviar(`${F}/cenarios/${cenarioId}/execucoes`, { dataReferencia }, esquemaExecutado, chave);
