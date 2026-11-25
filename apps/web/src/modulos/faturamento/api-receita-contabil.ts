// Cliente da integração contábil da receita (06-FAT L37, C2-103): eventos contábeis apurados das contas (previsão,
// fechamento por ciclo, reabertura, glosa, glosa aceita, recurso acatado, desconto, recebido e estorno da baixa), as
// pendências (o fato que não virou evento, com o motivo) e as divergências (o contabilizado que difere do apurado
// agora). A apuração refaz a conta pelos fatos e é idempotente pela chave do fato.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento/receita-contabil';

const esquemaEvento = z.object({
  id: z.number(),
  chave: z.string(),
  tipoAcao: z.string(),
  dataReferencia: z.string(),
  dataLancamento: z.string(),
  valor: z.number(),
  situacao: z.string(),
  contaId: z.number().nullable(),
  contaNumero: z.string().nullable(),
  itemId: z.number().nullable(),
  debito: z.string(),
  credito: z.string(),
});

const esquemaOcorrencia = z.object({
  id: z.number(),
  tipo: z.string(),
  chave: z.string(),
  fato: z.string(),
  motivo: z.string(),
  valor: z.number().nullable(),
  dataReferencia: z.string().nullable(),
  situacao: z.string(),
  resolvidaEm: z.string().nullable(),
  contaId: z.number().nullable(),
  contaNumero: z.string().nullable(),
  itemId: z.number().nullable(),
});

const esquemaPainel = z.object({
  regrasAtivas: z.number(),
  eventos: z.array(esquemaEvento),
  ocorrencias: z.array(esquemaOcorrencia),
});

const esquemaApurado = z
  .object({
    conta: z.number(),
    incluidos: z.number(),
    cancelados: z.number(),
    pendencias: z.number(),
    divergencias: z.number(),
  })
  .passthrough();

export type PainelReceitaContabil = z.infer<typeof esquemaPainel>;
export type EventoReceitaContabil = z.infer<typeof esquemaEvento>;
export type OcorrenciaReceitaContabil = z.infer<typeof esquemaOcorrencia>;
export type ApuracaoReceitaContabil = z.infer<typeof esquemaApurado>;
export type SituacaoEventoContabil = '' | 'pendente' | 'contabilizado' | 'cancelado';

export function lerPainelReceitaContabil(
  conta: number | null,
  situacao: SituacaoEventoContabil,
): Promise<PainelReceitaContabil> {
  const q = new URLSearchParams();
  if (conta) q.set('conta', String(conta));
  if (situacao) q.set('situacao', situacao);
  const s = q.toString();
  return ler(s ? `${F}?${s}` : F, esquemaPainel);
}

export const apurarReceitaContabil = (conta: number, chave: string): Promise<ApuracaoReceitaContabil> =>
  enviar(`${F}/apurar`, { conta }, esquemaApurado, chave);
