// Cliente das rotas da apuração dos indicadores obrigatórios de internação (01-REL L112):
// GET/POST /api/relatorios/indicadores-internacao/apuracao (apuracao-indicadores.controller.ts). O POST vai com CSRF e
// Idempotency-Key; a resposta traz a contagem do que foi incluído, atualizado ou mantido e as apurações gravadas.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/relatorios/indicadores-internacao/apuracao';

const esquemaApuracao = z.object({
  codigo: z.string(),
  nome: z.string(),
  competencia: z.string(),
  numerador: z.number().nullable(),
  denominador: z.number().nullable(),
  valor: z.number().nullable(),
  valorMeta: z.number().nullable(),
  situacaoMeta: z.string(),
  situacao: z.string(),
  dadosAte: z.string().nullable(),
});
export type ApuracaoIndicador = z.infer<typeof esquemaApuracao>;

const esquemaLidas = z.object({ competencia: z.string(), apuracoes: z.array(esquemaApuracao) });
export type ApuracoesLidas = z.infer<typeof esquemaLidas>;

const esquemaApurado = esquemaLidas.extend({
  incluidas: z.number(),
  atualizadas: z.number(),
  mantidasFechadas: z.number(),
  semMudanca: z.number(),
});
export type ResultadoApuracao = z.infer<typeof esquemaApurado>;

export const lerApuracoesInternacao = (competencia: string): Promise<ApuracoesLidas> =>
  ler(`${B}?competencia=${encodeURIComponent(competencia)}`, esquemaLidas);

export const apurarIndicadoresInternacao = (competencia: string): Promise<ResultadoApuracao> =>
  enviar(B, { competencia }, esquemaApurado, novaChave('apuracao-internacao'));
