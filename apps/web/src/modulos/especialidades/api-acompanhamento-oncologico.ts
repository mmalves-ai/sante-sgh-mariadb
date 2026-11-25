// Cliente do acompanhamento do tumor e das reações do tratamento oncológico (03-PEP linha 111).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const E = '/api/especialidades/oncologia';
const nulo = <T extends z.ZodTypeAny>(t: T) => t.nullable();
const esquemaAcompanhamentoPaciente = z.object({
  acompanhamentos: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      tumor: nulo(z.number()),
      classificacao: z.string(),
      classificadoEm: nulo(z.string()),
      situacaoTumor: nulo(z.string()),
      resposta: nulo(z.string()),
      primeiroTratamentoEm: nulo(z.string()),
      recidivaEm: nulo(z.string()),
      obitoEm: nulo(z.string()),
      eventos: z.array(
        z.object({
          tipo: nulo(z.string()),
          operacao: z.string(),
          ocorridoEm: z.string(),
          observacao: nulo(z.string()),
        }),
      ),
    }),
  ),
  reacoes: z.array(
    z.object({
      id: z.number(),
      acompanhamento: z.number(),
      tratamento: nulo(z.number()),
      ciclo: nulo(z.number()),
      avaliadoEm: z.string(),
      categoria: z.string(),
      descricao: z.string(),
      grau: z.number(),
      evolucao: z.string(),
      conduta: nulo(z.string()),
      doseAjustada: z.boolean(),
      tratamentoSuspenso: z.boolean(),
    }),
  ),
});
export type AcompanhamentoPaciente = z.infer<typeof esquemaAcompanhamentoPaciente>;
export type AcompanhamentoLido = AcompanhamentoPaciente['acompanhamentos'][number];
const esquemaGravado = z.object({
  ok: z.boolean(),
  id: z.number(),
  mensagem: z.string(),
  versao: z.number().optional(),
  tipo: z.string().optional(),
});

export const lerAcompanhamentoOncologico = (reg: number) =>
  ler(`${E}/internacoes/${reg}/acompanhamento`, esquemaAcompanhamentoPaciente);
export const registrarAcompanhamentoOnco = (reg: number, corpo: unknown, chave: string) =>
  enviar(`${E}/registro/acompanhamentos?internacao=${reg}`, corpo, esquemaGravado, chave);
export const registrarReacaoOnco = (reg: number, corpo: unknown, chave: string) =>
  enviar(`${E}/registro/reacoes?internacao=${reg}`, corpo, esquemaGravado, chave);
