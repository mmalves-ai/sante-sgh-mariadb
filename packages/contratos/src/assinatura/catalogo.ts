// Catálogo de operações de escrita (docs/operacoes/catalogo; convencoes.md §6; ADR 0004).
// Estados: especificada → referencia → verde → conferida → liberada | bloqueada, por estabelecimento.
// `estado` é um valor só (vale para todos os estabelecimentos configurados) ou um mapa por código.
// Regra 4 do M03: `conferida` exige registro de conferência na tela do SPDATA (chave-usuário);
// `liberada` exige, além disso, a autorização do dono registrada no ESTADO.md (convencoes.md §6).
import { z } from 'zod';

export const ESTADOS_OPERACAO = [
  'especificada',
  'referencia',
  'verde',
  'conferida',
  'liberada',
  'bloqueada',
] as const;
export type EstadoOperacao = (typeof ESTADOS_OPERACAO)[number];

export const ORIGENS_ESPECIFICACAO = ['sante-api', 'perfil-passivo', 'cenario-controlado'] as const;

const nomeObjeto = z.string().regex(/^[A-Z][A-Z0-9_$]{0,30}$/);
const codigoEstabelecimento = z.string().regex(/^[a-z][a-z0-9]{0,9}$/);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const esquemaLigacaoHipotese = z
  .object({
    de: nomeObjeto,
    para: nomeObjeto,
    /** Coluna de `de` → coluna de `para`. */
    colunas: z.record(nomeObjeto, nomeObjeto),
    /** `igual`: mesmos valores; `vizinho`: um inteiro a até `tolerancia` (IDs vizinhos). */
    tipo: z.enum(['igual', 'vizinho']).default('igual'),
    tolerancia: z.number().int().min(1).max(1000).optional(),
    descricao: z.string().optional(),
  })
  .strict();

export type LigacaoHipotese = z.infer<typeof esquemaLigacaoHipotese>;

export const esquemaConferencia = z
  .object({
    estabelecimento: codigoEstabelecimento,
    data,
    /** Papel de quem conferiu (nunca o nome): chave-usuário da área. */
    papel: z.string().min(3),
    /**
     * Onde está o registro: docs/marcos/Mnn/evidencias.md ou (M36) o registro de conferência
     * docs/operacoes/conferencias/<cod>/<operacao>.yaml.
     */
    evidencia: z
      .string()
      .regex(
        /^(?:docs\/marcos\/M\d{2}\/evidencias\.md|docs\/operacoes\/conferencias\/[a-z][a-z0-9]{0,9}\/[a-z]+\.[A-Za-z0-9]+\.yaml$)/,
      ),
  })
  .strict();

export const esquemaOperacaoCatalogo = z
  .object({
    nome: z.string().regex(/^[a-z]+\.[a-z][A-Za-z0-9]+$/),
    modulo: z.string().regex(/^[a-z]+$/),
    /** Grupo dono em packages/legado/src/<grupo> (convencoes.md §4). */
    grupo: z.string().regex(/^[a-z]+$/),
    descricao: z.string().min(1),
    tabelas_gravadas: z
      .array(
        z
          .object({
            tabela: nomeObjeto,
            acao: z.enum(['INSERT', 'UPDATE', 'DELETE']),
            nota: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
    triggers: z.array(z.object({ nome: nomeObjeto, tabela: nomeObjeto, efeito: z.string().min(1) }).strict()),
    /** Tabelas que os triggers gravam na operação (efeitos esperados; perfiladas junto). */
    tabelas_efeito: z
      .array(z.object({ tabela: nomeObjeto, acao: z.enum(['INSERT', 'UPDATE', 'DELETE']) }).strict())
      .default([]),
    o_que_o_novo_nao_faz: z.array(z.string().min(1)),
    origem_especificacao: z.enum(ORIGENS_ESPECIFICACAO),
    /** Arquivo de origem na sante-api (ref 01 §5), quando houver. */
    arquivo_origem: z.string().nullable(),
    ligacoes: z.array(esquemaLigacaoHipotese).default([]),
    cenarios_assinatura: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1),
    estado: z.union([z.enum(ESTADOS_OPERACAO), z.record(codigoEstabelecimento, z.enum(ESTADOS_OPERACAO))]),
    conferencias: z.array(esquemaConferencia).default([]),
    /** Linha de ESTADO.md › Autorizações (data e papel) que libera a operação, por estabelecimento. */
    autorizacoes: z
      .array(z.object({ estabelecimento: codigoEstabelecimento, data, papel: z.string().min(3) }).strict())
      .default([]),
    observacao: z.string().optional(),
    /**
     * M35 (ficha, critério de aceite): por que a operação não está em `verde` (ou acima) onde há cópia. Para as
     * receitas com `pendente` (POL-3, receita completa e desligada), o motivo é o `pendente` da receita.
     */
    motivo_estado: z.string().min(10).optional(),
  })
  .strict();

export type OperacaoCatalogo = z.infer<typeof esquemaOperacaoCatalogo>;

/** Estado da operação num estabelecimento (valor único vale para todos). */
export function estadoEm(op: Pick<OperacaoCatalogo, 'estado'>, estabelecimento: string): EstadoOperacao {
  if (typeof op.estado === 'string') return op.estado;
  return op.estado[estabelecimento] ?? 'especificada';
}

/** Estabelecimentos citados explicitamente no mapa de estados (vazio quando o estado é único). */
function estabelecimentosDoEstado(op: Pick<OperacaoCatalogo, 'estado'>): string[] {
  return typeof op.estado === 'string' ? [] : Object.keys(op.estado);
}

const EXIGE_CONFERENCIA: readonly EstadoOperacao[] = ['conferida', 'liberada'];

export const esquemaCatalogoOperacoes = z
  .object({
    formato: z.literal(1),
    operacoes: z.array(esquemaOperacaoCatalogo),
  })
  .strict()
  .superRefine((cat, ctx) => {
    const nomes = new Set<string>();
    cat.operacoes.forEach((op, i) => {
      if (nomes.has(op.nome))
        ctx.addIssue({ code: 'custom', path: ['operacoes', i, 'nome'], message: 'repetida' });
      nomes.add(op.nome);
      if (!op.nome.startsWith(`${op.modulo}.`)) {
        ctx.addIssue({ code: 'custom', path: ['operacoes', i, 'modulo'], message: 'nome fora do módulo' });
      }
      // Estado único vale para todos os estabelecimentos, e a conferência é de um só: a partir de
      // `conferida`, o estado tem de ser o mapa por código (cada estabelecimento com a sua conferência).
      if (typeof op.estado === 'string' && EXIGE_CONFERENCIA.includes(op.estado)) {
        ctx.addIssue({
          code: 'custom',
          path: ['operacoes', i, 'estado'],
          message: 'estado conferida/liberada só no mapa por estabelecimento ({ <cod>: <estado> })',
        });
      }
      const alvos = estabelecimentosDoEstado(op).filter((e) => EXIGE_CONFERENCIA.includes(estadoEm(op, e)));
      for (const alvo of alvos) {
        if (!op.conferencias.some((c) => c.estabelecimento === alvo)) {
          ctx.addIssue({
            code: 'custom',
            path: ['operacoes', i, 'conferencias'],
            message: `estado conferida/liberada sem registro de conferência na tela do legado (${alvo})`,
          });
        }
        if (estadoEm(op, alvo) === 'liberada' && !op.autorizacoes.some((a) => a.estabelecimento === alvo)) {
          ctx.addIssue({
            code: 'custom',
            path: ['operacoes', i, 'autorizacoes'],
            message: `estado liberada sem autorização do dono registrada (${alvo})`,
          });
        }
      }
    });
  });

export type CatalogoOperacoes = z.infer<typeof esquemaCatalogoOperacoes>;
