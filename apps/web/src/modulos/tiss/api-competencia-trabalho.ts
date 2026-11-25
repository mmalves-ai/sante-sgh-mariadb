// Cliente da competência de trabalho do faturista (06-FAT linha 32): a do usuário da sessão, por módulo, e o padrão
// que os filtros das telas do faturamento usam. A gravação vai com a Idempotency-Key (uma por intenção de gravar).
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export const esquemaCompetenciaTrabalho = z.object({
  modulo: z.string(),
  competencia: z.string().nullable(),
  periodoInicio: z.string().nullable(),
  periodoFim: z.string().nullable(),
  versao: z.number().nullable(),
  alteradaEm: z.string().nullable(),
  padrao: z.string(),
});
export type CompetenciaTrabalho = z.infer<typeof esquemaCompetenciaTrabalho>;

export interface PedidoCompetenciaTrabalho {
  modulo: string;
  competencia: string;
  periodoInicio: string | null;
  periodoFim: string | null;
  versao: number | null;
}

const URL = '/api/tiss/competencia-trabalho';

export const lerCompetenciaTrabalho = (modulo = 'fonte_pagadora') =>
  ler(`${URL}${qs({ modulo })}`, esquemaCompetenciaTrabalho);

export const gravarCompetenciaTrabalho = (corpo: PedidoCompetenciaTrabalho, chave: string) =>
  enviar(URL, corpo, z.object({ id: z.number(), versao: z.number(), competencia: z.string() }), chave);
