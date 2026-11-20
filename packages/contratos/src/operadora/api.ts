// Contratos da API da operadora própria na etapa F0 (M56; ficha, seções 4, 7 e 8): o retrato das chaves do módulo no
// estabelecimento da sessão (regra 1: tudo desligado por padrão) e a consulta dos catálogos da ANS úteis ao hospital
// (grupos do SIP, procedimentos por grupo do SIP com a vigência, classificação de procedimentos da ANS), só leitura e
// paginada por chave. As fatias F1 a F8 acrescentam os delas.
import { z } from 'zod';

export const SITUACOES_CHAVE_OPERADORA = ['desligada', 'ligada', 'aguardando-modulo'] as const;
export type SituacaoChaveOperadoraApi = (typeof SITUACOES_CHAVE_OPERADORA)[number];

const esquemaPrerequisito = z.object({ descricao: z.string(), situacao: z.string() });

export const esquemaChaveSituacaoOperadora = z.object({
  /** Chave em SGH_CFG_LIBERACAO (`operadora` ou `operadora.<recurso>`). */
  chave: z.string(),
  /** Fatia do roteiro (vazio na chave do módulo). */
  fatia: z.string().nullable(),
  titulo: z.string(),
  situacao: z.enum(SITUACOES_CHAVE_OPERADORA),
  /** Por que não vale (desligada, pré-requisito pendente, aguardando o módulo); null quando vale. */
  motivo: z.string().nullable(),
  prerequisitos: z.array(esquemaPrerequisito),
});
export type ChaveSituacaoOperadora = z.infer<typeof esquemaChaveSituacaoOperadora>;

export const esquemaSituacaoOperadora = z.object({
  modulo: esquemaChaveSituacaoOperadora,
  fatias: z.array(esquemaChaveSituacaoOperadora),
  /** Fatias ligadas que não valem porque o módulo está desligado. */
  aguardandoModulo: z.array(z.string()),
});
export type SituacaoOperadora = z.infer<typeof esquemaSituacaoOperadora>;

// ── Catálogos da ANS (só leitura) ────────────────────────────────────────────────────────────────────────

export const esquemaGrupoSip = z.object({ id: z.number().int(), nome: z.string() });
export type GrupoSip = z.infer<typeof esquemaGrupoSip>;
export const esquemaGruposSip = z.object({ itens: z.array(esquemaGrupoSip) });
export type GruposSip = z.infer<typeof esquemaGruposSip>;

/** Cursor da página seguinte dos procedimentos do SIP: `procedimento.grupo.AAAA-MM-DD` (a chave da tabela). */
export const FORMATO_CURSOR_SIP = /^\d{1,10}\.\d{1,3}\.\d{4}-\d{2}-\d{2}$/;

export const esquemaFiltroProcedimentosSip = z.object({
  grupo: z.coerce.number().int().min(0).max(999).optional(),
  /** Só os vigentes na data (AAAA-MM-DD). */
  vigentesEm: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Código do procedimento (busca exata, pelo início da chave). */
  procedimento: z.coerce.number().int().min(0).max(9_999_999_999).optional(),
  apos: z.string().regex(FORMATO_CURSOR_SIP).optional(),
});
export type FiltroProcedimentosSip = z.infer<typeof esquemaFiltroProcedimentosSip>;

export const esquemaProcedimentoSip = z.object({
  procedimento: z.number().int(),
  /** Nome do procedimento na terminologia TUSS do estabelecimento; null quando o código não está nela. */
  nome: z.string().nullable(),
  grupo: z.number().int(),
  vigenciaInicial: z.string().nullable(),
  /** Null: sem fim. */
  vigenciaFinal: z.string().nullable(),
});
export type ProcedimentoSip = z.infer<typeof esquemaProcedimentoSip>;
export const esquemaProcedimentosSip = z.object({
  itens: z.array(esquemaProcedimentoSip),
  proxima: z.string().nullable(),
});
export type ProcedimentosSip = z.infer<typeof esquemaProcedimentosSip>;

export const esquemaFiltroClassificacoesAns = z.object({
  apos: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  /** Código (só números: o código exato) ou trecho do nome (1 a 60 caracteres, sem diferença de maiúsculas). */
  busca: z.string().trim().min(1).max(60).optional(),
});
export type FiltroClassificacoesAns = z.infer<typeof esquemaFiltroClassificacoesAns>;
export const esquemaClassificacaoAns = z.object({ codigo: z.number().int(), nome: z.string() });
export type ClassificacaoAns = z.infer<typeof esquemaClassificacaoAns>;
export const esquemaClassificacoesAns = z.object({
  itens: z.array(esquemaClassificacaoAns),
  proxima: z.number().int().nullable(),
});
export type ClassificacoesAns = z.infer<typeof esquemaClassificacoesAns>;

/** Cursor dos procedimentos do SIP a partir da chave da última linha. */
export function cursorSip(c: { procedimento: number; grupo: number; vigenciaInicial: string }): string {
  return `${c.procedimento}.${c.grupo}.${c.vigenciaInicial}`;
}
export function lerCursorSip(
  s: string,
): { procedimento: number; grupo: number; vigenciaInicial: string } | null {
  if (!FORMATO_CURSOR_SIP.test(s)) return null;
  const [p, g, d] = s.split('.');
  return { procedimento: Number(p), grupo: Number(g), vigenciaInicial: d! };
}

/**
 * Permissões e rotas da etapa F0 (as fatias acrescentam as delas). Os catálogos da ANS pedem `catalogo.ans.ler`, que o
 * hospital também tem (D-ANS-HOSPITAL-56); a situação, a permissão dos domínios da operadora.
 */
export const ROTAS_OPERADORA_F0 = {
  situacao: { caminho: 'operadora/situacao', permissao: 'operadora.dominio.ler' },
  gruposSip: { caminho: 'operadora/ans/sip/grupos', permissao: 'catalogo.ans.ler' },
  procedimentosSip: { caminho: 'operadora/ans/sip/procedimentos', permissao: 'catalogo.ans.ler' },
  classificacoesAns: { caminho: 'operadora/ans/classificacoes', permissao: 'catalogo.ans.ler' },
} as const;
