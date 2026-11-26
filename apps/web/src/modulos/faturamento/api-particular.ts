// Cliente do adiantamento, caução e conta corrente do paciente (06-FAT linha 39) e do modelo de orçamento padrão
// (06-FAT linha 40). As regras vêm de @sgh/dominio-faturamento (a mesma da API), para a validação aparecer enquanto se
// digita; o servidor confere de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';
const qualquer = z.record(z.string(), z.unknown());

const esquemaContaCorrente = z.object({
  paciente: z.object({ id: z.number(), nome: z.string() }),
  saldo: z.number(),
  adiantamentos: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      tipo: z.string(),
      recebidoEm: z.string(),
      valor: z.number(),
      saldo: z.number(),
      situacao: z.string(),
      forma: z.string(),
      urgencia: z.boolean(),
      voluntaria: z.boolean(),
      disponivel: z.number(),
    }),
  ),
  devolucoesPendentes: z.array(
    z.object({
      id: z.number(),
      adiantamento: z.number(),
      numero: z.string(),
      valor: z.number(),
      forma: z.string(),
      favorecido: z.string(),
      motivo: z.string(),
      solicitadoEm: z.string(),
      solicitanteId: z.number().nullable(),
      solicitante: z.string(),
      /** Identificador da transação já trazido no pedido (fora do dinheiro, sem ele a aprovação o pede). */
      comprovante: z.string().nullable().default(null),
    }),
  ),
  aplicacoes: z.array(
    z.object({
      id: z.number(),
      adiantamento: z.number(),
      contaId: z.number().nullable(),
      conta: z.string(),
      aplicadoEm: z.string(),
      valor: z.number(),
      estornado: z.boolean(),
      motivoEstorno: z.string().nullable(),
    }),
  ),
  contasAbertas: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      situacao: z.string(),
      total: z.number(),
      devido: z.number(),
    }),
  ),
  atendimentos: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      entradaEm: z.string().nullable(),
      situacao: z.string(),
      urgencia: z.boolean(),
    }),
  ),
  extrato: z.object({
    linhas: z.array(
      z.object({
        tipo: z.string(),
        data: z.string(),
        referencia: z.string(),
        credito: z.number(),
        debito: z.number(),
        saldo: z.number(),
      }),
    ),
    creditos: z.number(),
    debitos: z.number(),
    saldo: z.number(),
  }),
});
export type ContaCorrente = z.infer<typeof esquemaContaCorrente>;

export const lerContaCorrente = (paciente: number) =>
  ler(`${F}/pacientes/${paciente}/conta-corrente`, esquemaContaCorrente);
export const receberAdiantamento = (corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/adiantamentos`, corpo, qualquer, chave);
export const aplicarAdiantamento = (conta: number, valor: number | null, chave: string) =>
  enviar(`${F}/contas/${conta}/adiantamentos`, { valor }, qualquer, chave);
export const estornarAplicacao = (aplicacao: number, motivo: string, chave: string) =>
  enviar(`${F}/aplicacoes-adiantamento/${aplicacao}/estorno`, { motivo }, qualquer, chave);
export const devolverAdiantamento = (adiantamento: number, corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/adiantamentos/${adiantamento}/devolucoes`, corpo, qualquer, chave);
/** A aprovação do pedido de devolução por outra pessoa (quem pediu é recusado pelo servidor). */
/** Aprova a devolução pedida por outra pessoa; fora do dinheiro, com o identificador da transação (Pix, TED etc.). */
export const aprovarDevolucao = (devolucao: number, comprovante: string | null, chave: string) =>
  enviar(`${F}/devolucoes-adiantamento/${devolucao}/aprovacao`, { comprovante }, qualquer, chave);
export const cancelarDevolucao = (devolucao: number, motivo: string, chave: string) =>
  enviar(`${F}/devolucoes-adiantamento/${devolucao}/cancelamento`, { motivo }, qualquer, chave);

const esquemaModelos = z.array(
  z.object({
    id: z.number(),
    codigo: z.string(),
    descricao: z.string(),
    procedimentoId: z.number(),
    procedimento: z.string(),
    acomodacaoId: z.number(),
    acomodacao: z.string(),
    valorFechado: z.number().nullable(),
    validadeDias: z.number().nullable(),
    itens: z.number(),
  }),
);
export type ModeloOrcamento = z.infer<typeof esquemaModelos>[number];
const esquemaPrevia = z.object({
  fonte: z.number().nullable(),
  linhas: z.array(
    z.object({
      sequencia: z.number(),
      tipo: z.string(),
      itemId: z.number().nullable(),
      funcaoId: z.number().nullable(),
      quantidade: z.number(),
      unitario: z.number(),
      total: z.number(),
      valorPacote: z.number().nullable(),
    }),
  ),
  bruto: z.number(),
  administracao: z.number(),
  acrescimo: z.number(),
  total: z.number(),
  semPreco: z.array(z.number()),
  validadeDias: z.number(),
});
export type PreviaModelo = z.infer<typeof esquemaPrevia>;

export const lerModelos = () => ler(`${F}/modelos-orcamento`, esquemaModelos);
/** A prévia com os valores digitados na hora para as linhas sem preço (o total muda enquanto se digita). */
export const lerPrevia = (modelo: number, precos: Readonly<Record<string, number>> = {}) => {
  const p = Object.entries(precos)
    .filter(([, v]) => Number.isFinite(v) && v >= 0)
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
  return ler(
    `${F}/modelos-orcamento/${modelo}/previa${p ? `?precos=${encodeURIComponent(p)}` : ''}`,
    esquemaPrevia,
  );
};
const opcao = z.object({ id: z.number(), codigo: z.string(), descricao: z.string() });
const esquemaOpcoes = z.object({
  acomodacoes: z.array(opcao),
  funcoes: z.array(opcao.extend({ percentual: z.number().nullable() })),
  itens: z.array(opcao),
});
export type OpcoesModelo = z.infer<typeof esquemaOpcoes>;
export const lerOpcoesModelo = (termo = '') =>
  ler(`${F}/modelos-orcamento/opcoes?termo=${encodeURIComponent(termo)}`, esquemaOpcoes);
export const cadastrarModelo = (corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/modelos-orcamento`, corpo, qualquer, chave);
export const inativarModelo = (modelo: number, motivo: string, chave: string) =>
  enviar(`${F}/modelos-orcamento/${modelo}/inativacao`, { motivo }, qualquer, chave);
export const gerarOrcamento = (modelo: number, corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/modelos-orcamento/${modelo}/orcamentos`, corpo, qualquer, chave);
