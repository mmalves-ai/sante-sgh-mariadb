// Lote de trabalho da bancada (F3.5, 05-SADT linha 8): os lotes do dia com a fila fora de lote de cada bancada, abrir,
// fechar e imprimir.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const B = '/api/sadt/lotes-trabalho';
const n = z.number();
const txt = z.string();

const esquemaLote = z.object({
  id: n,
  numero: txt,
  bancada: n,
  bancadaNome: txt,
  data: txt,
  situacao: z.enum(['aberto', 'em_processamento', 'fechado', 'cancelado']),
  analista: n.nullable(),
  analistaNome: txt.nullable(),
  abertoEm: txt,
  fechadoEm: txt.nullable(),
  impressoEm: txt.nullable(),
  itens: z.array(
    z.object({
      id: n,
      exame: n,
      sequencia: n,
      posicaoSuporte: txt.nullable(),
      situacao: z.enum(['pendente', 'processado', 'retido', 'repetir', 'cancelado']),
      motivo: txt.nullable(),
      exameNome: txt,
      paciente: txt,
      amostra: txt.nullable(),
      urgente: z.boolean(),
    }),
  ),
});
export type LoteDeTrabalho = z.infer<typeof esquemaLote>;

const esquemaLotesDoDia = z.object({
  lotes: z.array(esquemaLote),
  /** Quantos exames em análise cada bancada tem fora de lote (o que o próximo lote leva). */
  fila: z.array(z.object({ bancada: n, foraDeLote: n })),
});
export type LotesDoDia = z.infer<typeof esquemaLotesDoDia>;

export const lerLotes = (data: string): Promise<LotesDoDia> =>
  ler(`${B}?data=${encodeURIComponent(data)}`, esquemaLotesDoDia);

export const abrirLote = (bancada: number, chave: string): Promise<LoteDeTrabalho> =>
  enviar(`${B}/abrir`, { bancada }, esquemaLote, chave);

export const fecharLote = (lote: number, chave: string): Promise<LoteDeTrabalho> =>
  enviar(`${B}/fechar`, { lote }, esquemaLote, chave);

export const imprimirLote = (lote: number, chave: string): Promise<LoteDeTrabalho> =>
  enviar(`${B}/imprimir`, { lote }, esquemaLote, chave);
