// Cliente da consulta de elegibilidade (F3.9, 08-INTG L128 (31)): visão por paciente, consulta e resposta da operadora.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const E = '/api/tiss/elegibilidade';
let seq = 0;
const chave = (r: string) => `f395e.${r}.${Date.now().toString(36)}.${(seq++).toString(36)}`;

const esquemaPaciente = z.object({
  coberturas: z.array(
    z.object({
      id: z.number(),
      fontePagadora: z.string(),
      carteira: z.string().nullable(),
      validade: z.string().nullable(),
      ultimaElegibilidadeEm: z.string().nullable(),
      ultimaAprovada: z.boolean().nullable(),
    }),
  ),
  consultas: z.array(
    z.object({
      id: z.number(),
      fontePagadora: z.string(),
      carteira: z.string(),
      situacao: z.string(),
      solicitadaEm: z.string(),
      respondidaEm: z.string().nullable(),
      motivoNegativa: z.string().nullable(),
      codigoValidacao: z.string().nullable(),
      por: z.string().nullable(),
      versao: z.number(),
      // C2-070: saiu pelo serviço web da operadora (o retorno é lido, não digitado).
      pelaOperadora: z.boolean().default(false),
    }),
  ),
});
export type ElegibilidadePaciente = z.infer<typeof esquemaPaciente>;
const resultado = z.object({
  id: z.number(),
  situacao: z.string(),
  reaproveitada: z.boolean().optional(),
  enviada: z.boolean().optional(),
  aguardando: z.boolean().optional(),
});

export const lerElegibilidade = (paciente: number) => ler(`${E}/pacientes/${paciente}`, esquemaPaciente);
export const consultarElegibilidade = (cobertura: number) =>
  enviar(E, { cobertura }, resultado, chave('consultar'));
export const responderElegibilidade = (id: number, corpo: unknown) =>
  enviar(`${E}/${id}/resposta`, corpo, resultado, chave('responder'));
/** C2-070: lê o retorno do serviço web da operadora e grava a resposta (na fila, nada muda). */
export const lerRetornoElegibilidade = (id: number) =>
  enviar(`${E}/${id}/retorno`, {}, resultado, chave('retorno'));
