// 02-REC linha 33: contrato do cadastro da estrutura da recepção pela tela: os pontos de recepção, os guichês de
// cada um e os serviços de senha (os botões do totem e do balcão, com o grupo de prioridade legal e a posição).
// Vocabulário neutro: booleano, número, código do grupo. As regras de negócio (unicidade, formato, o que impede
// desativar) moram em @sgh/dominio-recepcao (estrutura.ts); aqui só a forma do pedido e da resposta.
import { z } from 'zod';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const versao = z.number().int().positive();
const textoOuNulo = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v.trim() === '' ? null : v.trim()));

export const esquemaIncluirPontoRecepcao = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    textoSenha: textoOuNulo(500),
  })
  .strict();
export const esquemaAlterarPontoRecepcao = esquemaIncluirPontoRecepcao.extend({ versao }).strict();

export const esquemaIncluirGuicheRecepcao = z
  .object({ numero: z.number().int(), descricao: textoOuNulo(150) })
  .strict();
export const esquemaAlterarGuicheRecepcao = esquemaIncluirGuicheRecepcao.extend({ versao }).strict();

export const esquemaIncluirServicoSenha = z
  .object({
    prefixo: z
      .string()
      .trim()
      .min(1)
      .max(3)
      .transform((v) => v.toUpperCase()),
    descricao: z.string().trim().min(1).max(150),
    tipo: z.string().min(1).max(30),
    prioritaria: z.boolean(),
    grupoPrioridade: z.string().min(1).max(30).nullable(),
    limiteDia: z.number().int().nullable(),
    ordemBotao: z.number().int().nullable(),
  })
  .strict();
export const esquemaAlterarServicoSenha = esquemaIncluirServicoSenha.extend({ versao }).strict();

/** Ativar ou desativar um item da estrutura (nunca apagar); desativar pede o motivo. */
export const esquemaSituacaoEstrutura = z
  .object({ ativo: z.boolean(), motivo: textoOuNulo(200), versao })
  .strict()
  .refine((v) => v.ativo || (v.motivo !== null && v.motivo.length >= 5), { path: ['motivo'] });

export type IncluirPontoRecepcao = z.infer<typeof esquemaIncluirPontoRecepcao>;
export type AlterarPontoRecepcao = z.infer<typeof esquemaAlterarPontoRecepcao>;
export type IncluirGuicheRecepcao = z.infer<typeof esquemaIncluirGuicheRecepcao>;
export type AlterarGuicheRecepcao = z.infer<typeof esquemaAlterarGuicheRecepcao>;
export type IncluirServicoSenha = z.infer<typeof esquemaIncluirServicoSenha>;
export type AlterarServicoSenha = z.infer<typeof esquemaAlterarServicoSenha>;
export type SituacaoEstrutura = z.infer<typeof esquemaSituacaoEstrutura>;

export const esquemaGuicheDaEstrutura = z.object({
  id,
  numero: z.number().int(),
  descricao: z.string().nullable(),
  ativo: z.boolean(),
  /** O guichê está aberto agora (alguém o ocupa). */
  aberto: z.boolean(),
  versao,
});
export const esquemaServicoDaEstrutura = z.object({
  id,
  prefixo: z.string(),
  descricao: z.string(),
  /** geral (abre atendimento), diverso (serviços diversos) ou outro tipo já cadastrado, que a tela preserva. */
  tipo: z.string(),
  prioritaria: z.boolean(),
  grupoPrioridade: z.string().nullable(),
  limiteDia: z.number().int().nullable(),
  ordemBotao: z.number().int().nullable(),
  ativo: z.boolean(),
  versao,
});
export const esquemaPontoDaEstrutura = z.object({
  id,
  codigo: z.string(),
  descricao: z.string(),
  textoSenha: z.string().nullable(),
  ativo: z.boolean(),
  versao,
  guiches: z.array(esquemaGuicheDaEstrutura),
  /** Já na ordem dos botões (posição, depois o nome). */
  servicos: z.array(esquemaServicoDaEstrutura),
});
export const esquemaEstruturaRecepcao = z.object({
  pontos: z.array(esquemaPontoDaEstrutura),
  gruposPrioridade: z.array(z.object({ codigo: z.string(), descricao: z.string() })),
});
export type GuicheDaEstrutura = z.infer<typeof esquemaGuicheDaEstrutura>;
export type ServicoDaEstrutura = z.infer<typeof esquemaServicoDaEstrutura>;
export type PontoDaEstrutura = z.infer<typeof esquemaPontoDaEstrutura>;
export type EstruturaRecepcao = z.infer<typeof esquemaEstruturaRecepcao>;

export const esquemaEstruturaGravada = z.object({ ok: z.literal(true), id, mensagem: z.string() });
export type EstruturaGravada = z.infer<typeof esquemaEstruturaGravada>;
