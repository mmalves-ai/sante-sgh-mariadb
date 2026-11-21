// Painel de onboarding de clientes da plataforma (F4 L3; ADR 0003 itens 4 a 9): criar cliente, vincular o arquivo de
// origem, Importar/Sincronizar e acompanhar o progresso e a conciliação. Só administrador da plataforma. O que volta
// é agregado: contagens por entidade de destino, pendências por gravidade; nunca valores de linha nem nomes da origem.
import { z } from 'zod';

export const ESTADOS_EXECUCAO_CONECTOR = [
  'fila',
  'abrindo',
  'lendo',
  'gravando',
  'conciliando',
  'concluida',
  'falhou',
  'cancelada',
] as const;
export type EstadoExecucaoConector = (typeof ESTADOS_EXECUCAO_CONECTOR)[number];
export const ESTADOS_EXECUCAO_ATIVOS: readonly EstadoExecucaoConector[] = [
  'fila',
  'abrindo',
  'lendo',
  'gravando',
  'conciliando',
];
export const TIPOS_EXECUCAO_CONECTOR = ['importar', 'sincronizar'] as const;

export const esquemaCodigoCliente = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

export const esquemaCriarClienteEntrada = z
  .object({
    codigo: esquemaCodigoCliente,
    nome: z.string().trim().min(1).max(150),
    cnpj: z
      .string()
      .regex(/^[0-9]{14}$/)
      .nullish(),
  })
  .strict();
export type CriarClienteEntrada = z.infer<typeof esquemaCriarClienteEntrada>;

/** Caminho RELATIVO à pasta autorizada do conector: sem barra inicial, sem "..", terminado em .fdb. */
export const esquemaVincularOrigemEntrada = z
  .object({
    arquivo: z
      .string()
      .min(5)
      .max(255)
      .regex(/^[^/\\][^\\\0]*\.fdb$/i)
      .refine((s) => !s.split('/').includes('..'), 'caminho com ..'),
  })
  .strict();
export type VincularOrigemEntrada = z.infer<typeof esquemaVincularOrigemEntrada>;

export const esquemaPedirExecucaoEntrada = z.object({ tipo: z.enum(TIPOS_EXECUCAO_CONECTOR) }).strict();
export type PedirExecucaoEntrada = z.infer<typeof esquemaPedirExecucaoEntrada>;

export const esquemaConciliacaoEntidade = z.object({
  entidade: z.string(),
  registrosOrigem: z.number().int(),
  registrosDestino: z.number().int(),
  recusados: z.number().int(),
  conferido: z.boolean(),
});
export type ConciliacaoEntidade = z.infer<typeof esquemaConciliacaoEntidade>;

export const esquemaPendenciaResumo = z.object({
  entidade: z.string(),
  regra: z.string(),
  gravidade: z.enum(['critica', 'alta', 'media', 'baixa']),
  quantidade: z.number().int(),
});

export const esquemaExecucaoConector = z.object({
  id: z.number().int(),
  tipo: z.enum(TIPOS_EXECUCAO_CONECTOR),
  estado: z.enum(ESTADOS_EXECUCAO_CONECTOR),
  etapa: z.string().nullable(),
  percentual: z.number(),
  motivoFalha: z.string().nullable(),
  solicitadoEm: z.string().nullable(),
  iniciadoEm: z.string().nullable(),
  concluidoEm: z.string().nullable(),
  registrosLidos: z.number().int().nullable(),
  arquivoInalterado: z.boolean().nullable(),
  entidades: z.array(esquemaConciliacaoEntidade),
  pendencias: z.object({
    total: z.number().int(),
    criticas: z.number().int(),
    porRegra: z.array(esquemaPendenciaResumo),
  }),
});
export type ExecucaoConector = z.infer<typeof esquemaExecucaoConector>;

export const esquemaClienteOnboarding = z.object({
  id: z.number().int(),
  codigo: z.string(),
  nome: z.string(),
  situacao: z.string(),
  origemDados: z.string(),
  origem: z
    .object({
      arquivo: z.string(),
      tamanhoBytes: z.number(),
      sha256: z.string(),
      vinculadoEm: z.string().nullable(),
    })
    .nullable(),
  ultimaExecucao: esquemaExecucaoConector.nullable(),
});
export type ClienteOnboarding = z.infer<typeof esquemaClienteOnboarding>;
export const esquemaListaClientesOnboarding = z.object({ clientes: z.array(esquemaClienteOnboarding) });
export type ListaClientesOnboarding = z.infer<typeof esquemaListaClientesOnboarding>;

export const esquemaOrigemDisponivel = z.object({
  arquivo: z.string(),
  tamanhoBytes: z.number().nullable(),
  aceito: z.boolean(),
  motivo: z.string().nullable(),
});
export type OrigemDisponivel = z.infer<typeof esquemaOrigemDisponivel>;
export const esquemaListaOrigens = z.object({ origens: z.array(esquemaOrigemDisponivel) });
export type ListaOrigens = z.infer<typeof esquemaListaOrigens>;

export const esquemaClienteCriado = z.object({
  codigo: z.string(),
  banco: z.string(),
  tabelas: z.number().int(),
});
export type ClienteCriado = z.infer<typeof esquemaClienteCriado>;
export const esquemaOrigemVinculada = z.object({
  arquivo: z.string(),
  tamanhoBytes: z.number(),
  sha256: z.string(),
});
export type OrigemVinculada = z.infer<typeof esquemaOrigemVinculada>;
export const esquemaExecucaoPedida = z.object({ execucao: z.number().int() });
export type ExecucaoPedida = z.infer<typeof esquemaExecucaoPedida>;
