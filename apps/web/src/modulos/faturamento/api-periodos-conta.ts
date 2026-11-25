// Cliente da conta parcial por período no faturamento (F3.7, 06-FAT linha 12): itens, valor e guias de cada período,
// o que ficou sem período e o total por competência; fechamento parcial e reabertura da faixa. As regras vêm de
// @sgh/dominio-faturamento (as mesmas da API), para a tela explicar na hora por que um período não fecha.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';
const qualquer = z.record(z.string(), z.unknown());
const faixa = z.object({ itens: z.number(), valor: z.number(), guias: z.array(z.number()) });
const periodo = faixa.extend({
  id: z.number(),
  sequencia: z.number(),
  inicio: z.string(),
  fim: z.string(),
  competencia: z.string(),
  tipoLancamentoId: z.number().nullable(),
  tipoLancamento: z.string().nullable(),
  fechado: z.boolean(),
  fechadoEm: z.string().nullable(),
  versao: z.number(),
});
const esquema = z.object({
  contaId: z.number(),
  situacao: z.string(),
  editavel: z.boolean(),
  periodos: z.array(periodo),
  semPeriodo: faixa,
  porCompetencia: z.array(faixa.extend({ competencia: z.string() })),
});
export type FaturamentoPorPeriodo = z.infer<typeof esquema>;

export const lerFaturamentoPorPeriodo = (conta: number) =>
  ler(`${F}/contas/${conta}/faturamento-por-periodo`, esquema);
export const fecharPeriodo = (id: number, versao: number, chave: string) =>
  enviar(`${F}/periodos-conta/${id}/fechamento`, { versao }, qualquer, chave);
export const reabrirPeriodo = (id: number, versao: number, motivo: string, chave: string) =>
  enviar(`${F}/periodos-conta/${id}/reabertura`, { versao, motivo }, qualquer, chave);
