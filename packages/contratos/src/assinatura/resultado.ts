// Relatório de `pnpm assinatura:testar` (tools/assinatura/resultados/<data>/<operacao>.json) e o que a tela
// "Testes de assinatura de dados" lê. Sem valores de linha: só classes, contagens e nomes de estrutura.
import { z } from 'zod';
import { ESTADOS_OPERACAO } from './catalogo.js';

/** Tipos de diferença do comparador (M03, seção 1 da ficha). */
export const TIPOS_DIFERENCA = [
  'tabela',
  'acao',
  'linhas',
  'colunas',
  'classe',
  'formato',
  'ligacao',
  'efeito-trigger',
  'generator',
] as const;
export type TipoDiferenca = (typeof TIPOS_DIFERENCA)[number];

export const esquemaDiferenca = z
  .object({
    tipo: z.enum(TIPOS_DIFERENCA),
    /** Caminho estável do elemento (ex.: `marcacao_horario.colunas.paciente_id`). */
    elemento: z.string().min(1),
    esperado: z.string(),
    obtido: z.string(),
    /** Coberta por `diferencas_aceitas` da referência (com decisão registrada). */
    aceita: z.boolean(),
  })
  .strict();
export type Diferenca = z.infer<typeof esquemaDiferenca>;

export const RESULTADOS_CENARIO = ['verde', 'diferencas', 'sem-referencia', 'sem-executor'] as const;

export const esquemaResultadoCenario = z
  .object({
    cenario: z.string(),
    resultado: z.enum(RESULTADOS_CENARIO),
    diferencas: z.array(esquemaDiferenca),
  })
  .strict();

export const esquemaResultadoOperacao = z
  .object({
    formato: z.literal(1),
    operacao: z.string(),
    hospital: z.string(),
    executadoEm: z.string(),
    /**
     * M36 (regra 4): resumo da impressão digital do schema da cópia em que a reprodução rodou (M02). Ausente nos
     * relatórios anteriores ao M36; o `conferencia:verificar` exige que case com a do registro e a homologada.
     */
    impressaoSchema: z
      .string()
      .regex(/^[0-9a-f]{16,128}$/)
      .nullable()
      .optional(),
    cenarios: z.array(esquemaResultadoCenario),
  })
  .strict();
export type ResultadoOperacao = z.infer<typeof esquemaResultadoOperacao>;

export const esquemaPainelAssinaturas = z
  .object({
    estabelecimentos: z.array(z.string()),
    operacoes: z.array(
      z
        .object({
          nome: z.string(),
          modulo: z.string(),
          descricao: z.string(),
          origem: z.string(),
          cenarios: z.array(z.string()),
          estados: z.record(z.string(), z.enum(ESTADOS_OPERACAO)),
          /** Última execução por estabelecimento (código → resumo); estabelecimento sem execução fica fora. */
          ultimasExecucoes: z.record(
            z.string(),
            z
              .object({
                executadoEm: z.string(),
                resultado: z.enum(RESULTADOS_CENARIO),
                diferencasPorTipo: z.record(z.string(), z.number().int().min(0)),
                /**
                 * M36: as diferenças não aceitas lado a lado (esperado na referência × obtido na reprodução), até
                 * 20 por estabelecimento; só classes e nomes de estrutura.
                 */
                detalhes: z
                  .array(
                    z
                      .object({
                        cenario: z.string(),
                        tipo: z.enum(TIPOS_DIFERENCA),
                        elemento: z.string(),
                        esperado: z.string(),
                        obtido: z.string(),
                      })
                      .strict(),
                  )
                  .max(20)
                  .optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type PainelAssinaturas = z.infer<typeof esquemaPainelAssinaturas>;
