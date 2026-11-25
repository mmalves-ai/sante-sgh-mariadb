// Cliente dos aditivos e do cancelamento do contrato de plano (08-SGO linha 94, F7, C2-108) sobre as rotas
// `operadora/complementar/contratos*`, `aditivos/:id/assinar` e `cancelamentos/*`. Respostas validadas aqui (zod).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/operadora/complementar';
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const gravado = z.object({ id: z.number() });

export const esquemaContratoResumo = z.object({
  id: z.number(),
  numero: z.string(),
  situacao: z.string(),
  inicio: data,
  fim: data.nullable(),
  contratacao: z.string(),
});
export type ContratoResumo = z.infer<typeof esquemaContratoResumo>;
export const esquemaPainelContrato = z.object({
  contrato: esquemaContratoResumo,
  ofertas: z.array(
    z.object({
      id: z.number(),
      plano: z.number(),
      nomePlano: z.string(),
      tabela: z.number(),
      nomeTabela: z.string(),
      inicio: data,
      fim: data.nullable(),
      vidas: z.number(),
    }),
  ),
  planos: z.array(z.object({ id: z.number(), nome: z.string() })),
  tabelas: z.array(z.object({ id: z.number(), nome: z.string() })),
  motivos: z.array(
    z.object({ id: z.number(), descricao: z.string(), exigeNotificacao: z.boolean(), temBaixa: z.boolean() }),
  ),
});
export type PainelContrato = z.infer<typeof esquemaPainelContrato>;
const esquemaAditivo = z.object({
  id: z.number(),
  sequencia: z.number(),
  tipo: z.string(),
  efeito: data,
  assinatura: data.nullable(),
  situacao: z.string(),
  descricao: z.string(),
});
export type AditivoContrato = z.infer<typeof esquemaAditivo>;
const esquemaCancelamento = z.object({
  id: z.number(),
  protocolo: z.string(),
  solicitante: z.string(),
  dataEfeito: data,
  situacao: z.string(),
});
export type CancelamentoContrato = z.infer<typeof esquemaCancelamento>;

export const buscarContratos = (numero: string) =>
  ler(`${C}/contratos?numero=${encodeURIComponent(numero)}`, z.array(esquemaContratoResumo));
export const lerPainelContrato = (id: number) => ler(`${C}/contratos/${id}/painel`, esquemaPainelContrato);
export const lerAditivos = (id: number) => ler(`${C}/contratos/${id}/aditivos`, z.array(esquemaAditivo));
export const lerCancelamentos = (id: number) =>
  ler(`${C}/contratos/${id}/cancelamentos`, z.array(esquemaCancelamento));

export interface NovoAditivo {
  tipo: string;
  assinatura: string | null;
  efeito: string;
  planoAnterior: number | null;
  planoNovo: number | null;
  valorAnterior: number | null;
  valorNovo: number | null;
  novaVigenciaFim: string | null;
  descricao: string;
  tabelaPreco: number | null;
}
export const registrarAditivo = (contrato: number, corpo: NovoAditivo) =>
  enviar(`${C}/contratos/${contrato}/aditivos`, corpo, gravado, novaChave('ope-adt'));
export const assinarAditivo = (id: number, assinatura: string) =>
  enviar(`${C}/aditivos/${id}/assinar`, { assinatura }, gravado, novaChave('ope-adt-ass'));

export interface NovoCancelamento {
  motivo: number;
  solicitante: string;
  dataEfeito: string | null;
  diasAtraso: number | null;
  avisoRecebimento: string | null;
  avisoEntregueEm: string | null;
  observacao: string | null;
  valorCredito: number | null;
}
export const solicitarCancelamento = (contrato: number, corpo: NovoCancelamento) =>
  enviar(`${C}/contratos/${contrato}/cancelamentos`, corpo, gravado, novaChave('ope-can'));
export const efetivarCancelamento = (id: number) =>
  enviar(`${C}/cancelamentos/${id}/efetivar`, {}, gravado, novaChave('ope-can-ef'));
export const desistirCancelamento = (id: number, motivo: string) =>
  enviar(`${C}/cancelamentos/${id}/desistir`, { motivo }, gravado, novaChave('ope-can-de'));
