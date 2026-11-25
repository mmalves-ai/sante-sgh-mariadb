// Valores habituais da abertura do atendimento (02-REC linha 31): o que a pessoa da recepção costuma usar (unidade,
// centro de custo, convênio, especialidade) preenche a ficha do paciente sem atendimento anterior, ou o campo que a
// herança não trouxe. Dois escopos: o do estabelecimento (vale para todos) e o pessoal, que vence campo a campo.
import { z } from 'zod';
import { idBanco } from '../validacao/id-banco.js';

/** Os campos da ficha de abertura que aceitam valor habitual. */
export const CAMPOS_PADRAO_ABERTURA = [
  { campo: 'unidade', rotulo: 'Unidade' },
  { campo: 'centroCusto', rotulo: 'Centro de custo' },
  { campo: 'convenio', rotulo: 'Convênio' },
  { campo: 'especialidade', rotulo: 'Especialidade' },
] as const;
export type CampoPadraoAbertura = (typeof CAMPOS_PADRAO_ABERTURA)[number]['campo'];

const valor = idBanco.nullable().optional();

/**
 * atendimento.definirPadraoAbertura (estabelecimento) e atendimento.definirMeuPadraoAbertura (o usuário da sessão):
 * só os campos que mudam; nulo limpa o valor habitual do campo no escopo. `versao` é a da linha lida (0: o escopo
 * ainda não tem linha): controle otimista.
 */
export const esquemaDefinirPadraoAbertura = z
  .object({
    valores: z.object({ unidade: valor, centroCusto: valor, convenio: valor, especialidade: valor }).strict(),
    versao: z.number().int().min(0).max(4_000_000_000),
  })
  .strict()
  .refine((e) => Object.values(e.valores).some((v) => v !== undefined), 'Nada a alterar.');
export type DefinirPadraoAberturaEntrada = z.infer<typeof esquemaDefinirPadraoAbertura>;

const item = z.object({
  id: z.number(),
  rotulo: z.string(),
  /** Falso: o item foi inativado, suspenso ou excluído depois de escolhido (não preenche a ficha; vira aviso). */
  vale: z.boolean(),
});

/** A configuração dos valores habituais, por escopo, e o que está em vigor para a sessão. */
export const esquemaConfiguracaoPadraoAbertura = z.object({
  campos: z.array(
    z.object({
      campo: z.string(),
      rotulo: z.string(),
      estabelecimento: item.nullable(),
      pessoal: item.nullable(),
      emVigor: z
        .object({ id: z.number(), rotulo: z.string(), origem: z.enum(['usuario', 'estabelecimento']) })
        .nullable(),
    }),
  ),
  /** Versão da linha de cada escopo (0: ainda sem linha). */
  versaoEstabelecimento: z.number(),
  versaoPessoal: z.number(),
});
export type ConfiguracaoPadraoAbertura = z.infer<typeof esquemaConfiguracaoPadraoAbertura>;

/** O que os valores habituais preenchem na ficha (só o que a herança deixou vazio) e os avisos. */
export const esquemaPadraoAplicado = z.object({
  valores: z.record(z.string(), z.number()),
  origens: z.record(z.string(), z.enum(['usuario', 'estabelecimento'])),
  avisos: z.array(z.string()),
});
export type PadraoAplicado = z.infer<typeof esquemaPadraoAplicado>;
