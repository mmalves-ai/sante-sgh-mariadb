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

/** `confirmarExclusaoEmMassa` (só Sincronizar): exclui o que o alerta de exclusão em massa reteve; quem pediu fica no
 * evento da fila. */
export const esquemaPedirExecucaoEntrada = z
  .object({ tipo: z.enum(TIPOS_EXECUCAO_CONECTOR), confirmarExclusaoEmMassa: z.boolean().optional() })
  .strict();
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

/** L10 (ADR 0007, item 22): relatório CURTO da execução. Só contagens, entidades de DESTINO e regras; nunca valores
 * nem nome da origem. `decisao`: a quem cabe resolver (`cliente`, `plataforma`) ou `informativa`. */
export const CLASSES_DECISAO_CONECTOR = ['cliente', 'plataforma', 'informativa'] as const;
const gravidadeConector = z.enum(['critica', 'alta', 'media', 'baixa']);
const inteiro = z.number().int();
export const esquemaRelatorioConector = z.object({
  versao: inteiro,
  totais: z.object({
    entidades: inteiro,
    conferidas: inteiro,
    registrosOrigem: inteiro,
    registrosDestino: inteiro,
    recusados: inteiro,
    /** Pendências abertas por LINHA da origem (os itens contados por tabela ficam em `tabelasAbertas`). */
    abertas: inteiro,
    /** Itens contados por TABELA (sem prova de não copiar, bloqueada): nunca somados a `abertas`. */
    tabelasAbertas: inteiro.optional(),
    criticas: inteiro,
    resolvidas: inteiro,
    decisoesCliente: inteiro,
  }),
  porRegra: z.array(
    z.object({
      entidade: z.string(),
      regra: z.string(),
      gravidade: gravidadeConector,
      abertas: inteiro,
      resolvidas: inteiro,
      /** `linha` (pendência por linha da origem) ou `tabela` (item contado por tabela). */
      unidade: z.enum(['linha', 'tabela']).optional(),
      decisao: z.enum(CLASSES_DECISAO_CONECTOR),
      acao: z.string(),
    }),
  ),
  decisoesCliente: z.array(
    z.object({
      regra: z.string(),
      gravidade: gravidadeConector,
      quantidade: inteiro,
      entidades: inteiro,
      acao: z.string(),
    }),
  ),
  naoCarregado: z.object({
    recusados: z.array(z.object({ entidade: z.string(), recusados: inteiro })),
    semMapa: z.object({ tabelas: inteiro, registros: inteiro }),
    bloqueadas: z.object({ tabelas: inteiro, registros: inteiro }),
    semCarga: z.array(
      z.object({
        causa: z.string(),
        tabelas: inteiro,
        registros: inteiro,
        provasConferidas: inteiro,
        provasFalhas: inteiro,
        semProva: inteiro,
      }),
    ),
  }),
  /** Prova de não copiar de cada tabela (ADR 0006, item 1), pelo destino onde a informação continua. */
  provas: z.array(
    z.object({
      destino: z.string(),
      causa: z.string(),
      tipo: z.string(),
      linhasOrigem: inteiro,
      iguais: inteiro,
      divergentes: inteiro,
      faltandoNoDestino: inteiro,
      sobrandoNoDestino: inteiro,
      conferido: z.boolean(),
    }),
  ),
  saidasExternas: inteiro,
  redeSemRotaExterna: z.boolean().nullable(),
});
export type RelatorioConector = z.infer<typeof esquemaRelatorioConector>;

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
  /** L9: resultado do Sincronizar (só contagens, tabela e id do destino e nomes de coluna; nunca valores). */
  sincronizar: z
    .object({
      atualizadas: z.number().int(),
      conflitos: z.number().int(),
      excluidas: z.number().int(),
      reativadas: z.number().int(),
      /** Linhas apagadas na origem cujo destino não tem exclusão lógica: seguem ativas, com pendência. */
      exclusoesSemSuporte: z.number().int().optional(),
      alertasExclusaoEmMassa: z.array(
        z.object({ entidade: z.string(), apagadas: z.number().int(), ativas: z.number().int() }),
      ),
      conflitosItens: z.array(
        z.object({ tabelaDestino: z.string(), idDestino: z.number().int(), colunas: z.array(z.string()) }),
      ),
    })
    .nullish(),
  relatorio: esquemaRelatorioConector.nullish(),
});
export type ExecucaoConector = z.infer<typeof esquemaExecucaoConector>;
export const esquemaListaExecucoes = z.object({ execucoes: z.array(esquemaExecucaoConector) });
export type ListaExecucoes = z.infer<typeof esquemaListaExecucoes>;

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
