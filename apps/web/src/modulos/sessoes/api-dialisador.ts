// Reuso do dialisador na hemodiálise (03-PEP linha 146): os dialisadores em uso (sala de reprocessamento), a visão por
// paciente com o histórico, a abertura, o reprocessamento e as saídas de uso (a gravação vai com o CSRF e a
// Idempotency-Key).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const D = '/api/sessoes/dialisadores';
const esquemaReprocessamento = z.object({
  id: z.number(),
  sequencia: z.number(),
  reprocessadoEm: z.string(),
  volumeInicialMl: z.number().nullable(),
  volumeAtualMl: z.number().nullable(),
  testePreEnxague: z.string().nullable(),
  testePosEnxague: z.string().nullable(),
  metodo: z.string(),
  agente: z.string().nullable(),
  linhasDescartadas: z.boolean(),
  aprovado: z.boolean(),
  responsavel: z.string(),
  observacao: z.string().nullable(),
  situacao: z.enum(['valido', 'cancelado']),
  motivoCancelamento: z.string().nullable(),
  versao: z.number(),
});
export const esquemaDialisador = z.object({
  id: z.number(),
  paciente: z.number(),
  pacienteNome: z.string(),
  prontuario: z.number().nullable(),
  identificacao: z.string(),
  insumo: z.number().nullable(),
  modelo: z.string().nullable(),
  metodo: z.enum(['automatizado', 'manual', 'uso_unico']),
  volumeInicialMl: z.number().nullable(),
  limiteReusos: z.number(),
  reusosRealizados: z.number(),
  abertoEm: z.string(),
  fechadoEm: z.string().nullable(),
  situacao: z.enum(['em_uso', 'descartado', 'desativado']),
  motivo: z.string().nullable(),
  versao: z.number(),
  reprocessamentos: z.array(esquemaReprocessamento),
});
export type DialisadorLido = z.infer<typeof esquemaDialisador>;
export type ReprocessamentoLido = z.infer<typeof esquemaReprocessamento>;
const esquemaLista = z.object({ itens: z.array(esquemaDialisador) });
const esquemaAberto = z.object({ id: z.number(), limiteReusos: z.number() });
const esquemaReprocessado = z.object({
  id: z.number(),
  sequencia: z.number(),
  aprovado: z.boolean(),
  descartado: z.boolean(),
  ultimoReuso: z.boolean(),
  reusosRealizados: z.number(),
  reprovacoes: z.array(z.string()),
});
const esquemaId = z.object({ id: z.number() });

let sequencia = 0;
export function novaChaveDialisador(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `c1096.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export const lerDialisadoresEmUso = () => ler(`${D}/em-uso`, esquemaLista);
export const lerDialisadoresDoPaciente = (paciente: number) =>
  ler(`${D}/pacientes/${paciente}`, esquemaLista);
export const abrirDialisador = (corpo: unknown, chave: string) => enviar(D, corpo, esquemaAberto, chave);
export const reprocessarDialisador = (id: number, corpo: unknown, chave: string) =>
  enviar(`${D}/${id}/reprocessamentos`, corpo, esquemaReprocessado, chave);
export const descartarDialisador = (id: number, corpo: { motivo: string; versao: number }, chave: string) =>
  enviar(`${D}/${id}/descarte`, corpo, esquemaId, chave);
export const desativarDialisador = (id: number, corpo: { motivo: string; versao: number }, chave: string) =>
  enviar(`${D}/${id}/desativacao`, corpo, esquemaId, chave);
export const cancelarReprocessamento = (
  id: number,
  corpo: { motivo: string; versao: number },
  chave: string,
) => enviar(`${D}/reprocessamentos/${id}/cancelamento`, corpo, esquemaId, chave);
