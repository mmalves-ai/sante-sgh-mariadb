// Formato `*.assinatura.json` (M03; cap-10 §10.4; convencoes.md §7). Descreve o que uma operação grava,
// SEM conteúdo de linha: tabelas, ação, número de linhas, colunas com a classe do valor e o formato,
// ligações entre as linhas e efeitos de trigger. IDs e datas entram pela classe, nunca pelo valor; valores
// só aparecem em `constante:` e `dominio:` de colunas de domínio (fora de colunas-pessoais.yaml).
// O esquema JSON versionado (tools/assinatura/esquema/assinatura.schema.json) é gerado deste Zod.
import { z } from 'zod';
import { TIPOS_DIFERENCA } from './resultado.js';

/** Classes de valor (convencoes.md §7). `dominio:` lista os valores separados por `|`. */
export const CLASSES_BASE = ['entrada', 'generator', 'carimbo-banco', 'vazio'] as const;
export const PREFIXOS_CLASSE = ['constante', 'copia', 'sentinela', 'dominio'] as const;
export const RE_CLASSE =
  /^(?:entrada|generator|carimbo-banco|vazio|constante:.{0,60}|copia:[A-Z0-9_$]{1,31}\.[A-Z0-9_$]{1,31}|sentinela:.{1,20}|dominio:.{0,4000})$/;

export type TipoClasse = (typeof CLASSES_BASE)[number] | (typeof PREFIXOS_CLASSE)[number];

/** Separa `dominio:A|B` em tipo e argumento. */
export function partesClasse(classe: string): { tipo: TipoClasse; arg: string | null } {
  const i = classe.indexOf(':');
  if (i < 0) return { tipo: classe as TipoClasse, arg: null };
  return { tipo: classe.slice(0, i) as TipoClasse, arg: classe.slice(i + 1) };
}

/** Valores de uma classe `dominio:`, na ordem gravada ('' é o texto vazio, gravado como `''`). */
export function valoresDominio(classe: string): string[] {
  const { tipo, arg } = partesClasse(classe);
  if (tipo !== 'dominio' || arg === null || arg === '') return [];
  return arg.split('|').map((v) => (v === "''" ? '' : v));
}

export const FORMATOS = [
  'HHMM',
  'HH:MM',
  'letra:T/F',
  'letra:S/N',
  'data',
  'timestamp',
  'hora',
  'numero',
  'texto',
  'blob',
] as const;
export type Formato = (typeof FORMATOS)[number];

const nomeObjeto = z.string().regex(/^[A-Z][A-Z0-9_$]{0,30}$/, 'nome de objeto do Firebird');
export const ACOES = ['INSERT', 'UPDATE', 'DELETE'] as const;

export const esquemaColunaAssinatura = z
  .object({
    classe: z.string().regex(RE_CLASSE, 'classe de valor'),
    formato: z.enum(FORMATOS).optional(),
    /** Código de baixa confiança (DP-46): legenda "a confirmar". */
    aConfirmar: z.boolean().optional(),
  })
  .strict();

export const esquemaTabelaAssinatura = z
  .object({
    tabela: nomeObjeto,
    acao: z.enum(ACOES),
    linhas: z.number().int().min(0),
    colunas: z.record(nomeObjeto, esquemaColunaAssinatura),
  })
  .strict();

export const esquemaLigacaoAssinatura = z
  .object({
    de: z.string().min(1),
    para: z.string().min(1),
    descricao: z.string().optional(),
  })
  .strict();

export const esquemaEfeitoTrigger = z
  .object({
    trigger: nomeObjeto,
    tabela: nomeObjeto,
    acao: z.enum(ACOES),
    linhas: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * Diferença aceita: só com decisão registrada (DP-nn ou ADR), data e papel de quem aceitou. Vale para UMA
 * diferença: o elemento, o tipo e os dois lados (esperado e obtido) têm de casar; outra diferença no mesmo
 * elemento continua defeito.
 */
export const esquemaDiferencaAceita = z
  .object({
    elemento: z.string().min(1),
    tipo: z.enum(TIPOS_DIFERENCA),
    esperado: z.string(),
    obtido: z.string(),
    motivo: z.string().min(1),
    decisao: z.string().regex(/^(?:DP-\d+(?:\.\d+)?|ADR \d{4})\b/, 'DP-nn ou ADR nnnn'),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD'),
    papel: z.string().min(3),
  })
  .strict();

export const ORIGENS_ASSINATURA = ['perfil', 'cenario-controlado', 'reproducao'] as const;

export const esquemaAssinatura = z
  .object({
    formato: z.literal(1),
    operacao: z.string().regex(/^[a-z]+\.[a-z][A-Za-z0-9]+$/, '<modulo>.<verboObjeto>'),
    cenario: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case'),
    origem: z.enum(ORIGENS_ASSINATURA),
    hospitais: z.array(z.string().regex(/^[a-z][a-z0-9]{0,9}$/)).min(1),
    /** Resumo da impressão digital do schema (M02) da cópia em que a assinatura nasceu. */
    impressaoSchema: z.string().nullable(),
    /** Janela da versão congelada (perfil) ou momento da captura, sem valor de linha. */
    janela: z.string().optional(),
    tabelas: z.array(esquemaTabelaAssinatura),
    ligacoes: z.array(esquemaLigacaoAssinatura),
    efeitosTrigger: z.array(esquemaEfeitoTrigger),
    /**
     * Passos de cada generator na operação (só os que andaram). Ausente: a referência não mede (perfil);
     * presente: a candidata tem de andar os mesmos generators, o mesmo número de passos.
     */
    generators: z.record(nomeObjeto, z.number().int().min(1)).optional(),
    diferencas_aceitas: z.array(esquemaDiferencaAceita),
  })
  .strict();

export type Assinatura = z.infer<typeof esquemaAssinatura>;
export type TabelaAssinatura = z.infer<typeof esquemaTabelaAssinatura>;
export type ColunaAssinatura = z.infer<typeof esquemaColunaAssinatura>;
export type DiferencaAceita = z.infer<typeof esquemaDiferencaAceita>;
