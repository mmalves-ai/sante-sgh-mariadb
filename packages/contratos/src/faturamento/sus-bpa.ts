// Faturamento SUS próprio, etapa 2 (ficha do M51, seções 4, 5, 7 e 8): BPA consolidado (BPA-C) e individualizado (BPA-I)
// da competência no leiaute do BPA-Mag, o validador de compatibilidade da SIGTAP e os médicos solicitantes SUS. Construído
// completo e DESLIGADO por estabelecimento (DP-35: CNES sem SUS; a chave `faturamento.susBpa` com o pré-requisito do
// contrato, POL-3). Nenhuma entrada nem resposta carrega documento de pessoa: a tela recebe chaves, códigos e contagens;
// o CNS e o nome do paciente só existem no arquivo guardado.
import { z } from 'zod';
import { esquemaCompetenciaSus } from './sus.js';

/** Os dois registros do BPA-Mag: consolidado (02) e individualizado (03). */
export const TIPOS_LINHA_BPA = ['c', 'i'] as const;
export type TipoLinhaBpa = (typeof TIPOS_LINHA_BPA)[number];

const versao = z.string().min(10).max(40);

/** faturamento.gerarBpa: a competência BPA aberta, criticada, sem bloqueante e na versão que a tela leu. */
export const esquemaGerarBpa = z.object({ competencia: esquemaCompetenciaSus, versao }).strict();
export type GerarBpaEntrada = z.infer<typeof esquemaGerarBpa>;

/** As linhas do BPA gerado (paginação no servidor; sem dado pessoal). */
export const esquemaFiltroLinhasBpa = z
  .object({
    arquivo: z.coerce.number().int().positive(),
    tipo: z.enum(TIPOS_LINHA_BPA).optional(),
    /** Começo do código SIGTAP (filtro por procedimento). */
    procedimento: z
      .string()
      .regex(/^\d{2,10}$/)
      .optional(),
    pagina: z.coerce.number().int().min(0).default(0),
    porPagina: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();
export type FiltroLinhasBpa = z.infer<typeof esquemaFiltroLinhasBpa>;

/** Uma linha do BPA como a tela lista (folha, sequência, procedimento, CBO, idade e quantidade; a origem por chave). */
export const esquemaLinhaBpaLida = z.object({
  id: z.number().int(),
  tipo: z.enum(TIPOS_LINHA_BPA),
  folha: z.number().int(),
  sequencia: z.number().int(),
  procedimento: z.string(),
  cbo: z.string(),
  idade: z.number().int().nullable(),
  quantidade: z.number().int(),
  /** Data do atendimento (só no BPA-I; AAAA-MM-DD). */
  data: z.string().nullable(),
  conta: z.number().int().nullable(),
  atendimento: z.number().int().nullable(),
});
export type LinhaBpaLida = z.infer<typeof esquemaLinhaBpaLida>;

export const esquemaPaginaLinhasBpa = z.object({
  itens: z.array(esquemaLinhaBpaLida),
  total: z.number().int(),
  /** Contagem e soma das quantidades por tipo (o resumo da tela e da trilha). */
  porTipo: z.record(z.string(), z.object({ linhas: z.number().int(), quantidade: z.number().int() })),
});
export type PaginaLinhasBpa = z.infer<typeof esquemaPaginaLinhasBpa>;

/** Busca de médico solicitante no cadastro geral: conselho ou nome, 2 a 60 caracteres. */
export const esquemaBuscaMedicoSolicitante = z.object({ termo: z.string().trim().min(2).max(60) }).strict();
export type BuscaMedicoSolicitante = z.infer<typeof esquemaBuscaMedicoSolicitante>;

/** Um médico solicitante do cadastro geral: número do conselho, nome, UF, CBO e situação. */
export const esquemaMedicoSolicitanteAchado = z.object({
  id: z.number().int(),
  conselho: z.number().int(),
  nome: z.string(),
  uf: z.string().nullable(),
  cbo: z.string().nullable(),
  ativo: z.boolean(),
});
export type MedicoSolicitanteAchado = z.infer<typeof esquemaMedicoSolicitanteAchado>;
