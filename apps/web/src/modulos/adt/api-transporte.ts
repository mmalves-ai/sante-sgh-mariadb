// Cliente das rotas do pedido de transporte do paciente (C1-066, 03-PEP linha 125): /api/internacao/transportes.
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const T = '/api/internacao/transportes';

const opcao = z.object({ id: z.number(), nome: z.string() });
export const esquemaOpcoesTransporte = z.object({
  meios: z.array(opcao.extend({ exigeAmbulancia: z.boolean() })),
  posicoes: z.array(opcao),
  ambulancias: z.array(opcao),
  setores: z.array(opcao),
  externos: z.array(opcao),
  motivos: z.array(opcao),
});
export type OpcoesTransporte = z.infer<typeof esquemaOpcoesTransporte>;

export const esquemaInternacaoTransporte = z.object({
  id: z.number(),
  numero: z.string(),
  paciente: z.number(),
  prontuario: z.string().nullable(),
  atendimento: z.number(),
  situacao: z.string(),
  setorAtual: z.number().nullable(),
  alta: z
    .object({
      id: z.number(),
      destino: z.string(),
      destinoExterno: z.number().nullable(),
      em: z.string().nullable(),
    })
    .nullable(),
  tipoSugerido: z.string(),
});
export type InternacaoTransporte = z.infer<typeof esquemaInternacaoTransporte>;

export const esquemaTransporte = z.object({
  id: z.number(),
  paciente: z.number(),
  prontuario: z.string().nullable(),
  internacao: z.number().nullable(),
  internacaoNumero: z.string().nullable(),
  tipo: z.string(),
  prioridade: z.string(),
  meio: z.number().nullable(),
  meioNome: z.string().nullable(),
  meioExigeAmbulancia: z.boolean(),
  ambulancia: z.number().nullable(),
  ambulanciaPlaca: z.string().nullable(),
  origemNome: z.string().nullable(),
  destinoNome: z.string().nullable(),
  condicao: z.string().nullable(),
  requerOxigenio: z.boolean(),
  requerMonitorizacao: z.boolean(),
  requerMaca: z.boolean(),
  acompanhanteNome: z.string().nullable(),
  solicitado: z.string(),
  previsto: z.string().nullable(),
  saida: z.string().nullable(),
  chegada: z.string().nullable(),
  retorno: z.string().nullable(),
  distanciaKm: z.number().nullable(),
  situacao: z.string(),
  motivoCancelamento: z.string().nullable(),
  observacao: z.string().nullable(),
  versao: z.number(),
});
export type Transporte = z.infer<typeof esquemaTransporte>;

const comId = z.object({ id: z.number().nullable() }).passthrough();

export interface PedidoTransporteEntrada {
  internacao: number;
  tipo: string;
  prioridade: string;
  meio: number | null;
  posicao: number | null;
  origemSetor: number | null;
  destinoSetor: number | null;
  destinoExterno: number | null;
  destinoDescricao: string | null;
  condicao: string | null;
  requerOxigenio: boolean;
  requerMonitorizacao: boolean;
  requerMaca: boolean;
  acompanhanteNome: string | null;
  previsto: string | null;
  observacao: string | null;
}

export const lerOpcoesTransporte = () => ler(`${T}/opcoes`, esquemaOpcoesTransporte);
export const lerInternacaoTransporte = (id: number) =>
  ler(`${T}/internacao/${id}`, esquemaInternacaoTransporte);
export const listarTransportes = (f: { situacao?: string; internacao?: number | null }) =>
  ler(`${T}${qs(f)}`, z.object({ itens: z.array(esquemaTransporte) }));
export const solicitarTransporte = (corpo: PedidoTransporteEntrada) =>
  enviar(T, corpo, comId, novaChave('transporte-solicitar'));
export const agendarTransporte = (
  id: number,
  corpo: { previsto: string; meio: number | null; ambulancia: number | null; versao: number },
) => enviar(`${T}/${id}/agendar`, corpo, comId, novaChave('transporte-agendar'));
export const iniciarTransporte = (id: number, corpo: { ambulancia: number | null; versao: number }) =>
  enviar(`${T}/${id}/iniciar`, corpo, comId, novaChave('transporte-iniciar'));
export const concluirTransporte = (id: number, corpo: { distanciaKm: number | null; versao: number }) =>
  enviar(`${T}/${id}/concluir`, corpo, comId, novaChave('transporte-concluir'));
export const cancelarTransporte = (id: number, corpo: { motivo: number | null; versao: number }) =>
  enviar(`${T}/${id}/cancelar`, corpo, comId, novaChave('transporte-cancelar'));
