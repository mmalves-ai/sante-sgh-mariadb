// Cliente dos parâmetros e das preferências do faturista (F3.7, 06-FAT linha 38). As regras de validação vêm de
// @sgh/dominio-faturamento (as mesmas da API), para o erro aparecer enquanto se escolhe; o servidor confere de novo.
import { TELAS_INICIAIS_FATURISTA } from '@sgh/dominio-faturamento';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';

const esquemaParametros = z.object({
  parametros: z.object({
    rotinaDiaria: z.boolean(),
    rotinaDiariaHora: z.number(),
    prazoRecursoGlosaDias: z.number(),
    fechamentoDiaLimite: z.number(),
  }),
  preferencias: z.object({
    telaInicial: z.enum(TELAS_INICIAIS_FATURISTA),
    itensPorPagina: z.number(),
    agruparPorPaciente: z.boolean(),
  }),
  catalogo: z.array(
    z.object({
      chave: z.string(),
      tipo: z.enum(['booleano', 'inteiro', 'lista']),
      padrao: z.string(),
      minimo: z.number().optional(),
      maximo: z.number().optional(),
      opcoes: z.array(z.string()).optional(),
      preferencia: z.boolean(),
    }),
  ),
});
export type ParametrosFaturamentoTela = z.infer<typeof esquemaParametros>;

const esquemaGravado = z.object({ usuario: z.string(), gravados: z.string() }).passthrough();

export const lerParametrosFaturamento = () => ler(`${F}/parametros`, esquemaParametros);

/** Grava as preferências da própria conta (chave faturamento.preferencia.* → valor em texto). */
export const gravarPreferenciasFaturista = (preferencias: Record<string, string>, chave: string) =>
  enviar(`${F}/preferencias`, { preferencias }, esquemaGravado, chave);
