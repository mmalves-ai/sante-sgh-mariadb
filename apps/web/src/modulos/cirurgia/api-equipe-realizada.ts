// Cliente da equipe realizada do ato cirúrgico (F3.4, 04-CC linha 95): /api/cirurgia/atos/:id/equipe. A equipe
// membro a membro (função, profissional, procedimento, entrada, saída, minutos e percentual) e a ponte que leva a
// equipe de cada procedimento ao item da conta da mesma internação (o repasse lê o participante do item).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const base = (ato: number) => `/api/cirurgia/atos/${ato}/equipe`;

const esquemaEquipe = z.object({
  ato: z.number(),
  numero: z.string(),
  atendimento: z.number(),
  entradaSala: z.string().nullable(),
  saidaSala: z.string().nullable(),
  procedimentos: z.array(z.object({ id: z.number(), sequencia: z.number(), descricao: z.string() })),
  membros: z.array(
    z.object({
      participante: z.number(),
      funcao: z.string(),
      funcaoDescricao: z.string(),
      profissional: z.number(),
      profissionalNome: z.string().nullable(),
      procedimentoAto: z.number().nullable(),
      procedimentoDescricao: z.string().nullable(),
      principal: z.boolean(),
      entrada: z.string().nullable(),
      saida: z.string().nullable(),
      minutos: z.number(),
      percentual: z.number().nullable(),
    }),
  ),
  /** Só os itens que recebem equipe (procedimento ou honorário, vivos, de conta editável). */
  itensConta: z.array(
    z.object({ id: z.number(), conta: z.string(), descricao: z.string(), situacao: z.string() }),
  ),
  itensContaCortados: z.boolean(),
});
export type EquipeRealizada = z.infer<typeof esquemaEquipe>;

const esquemaLevada = z.object({
  id: z.number(),
  itens: z.array(
    z.object({
      procedimento: z.number(),
      item: z.number(),
      incluidos: z.number(),
      foraDaVaga: z.array(z.object({ profissional: z.number(), funcaoCobranca: z.number() })),
    }),
  ),
});
export type EquipeLevada = z.infer<typeof esquemaLevada>;

export const lerEquipeRealizada = (ato: number) => ler(base(ato), esquemaEquipe);

export const levarEquipeParaConta = (ato: number, itens: { procedimento: number; item: number }[]) =>
  enviar(`${base(ato)}/conta`, { itens }, esquemaLevada, novaChave('equipe-conta'));
