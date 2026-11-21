// Categoria do profissional (ficha do M11, regra 10; cap-06a §6.1; Anexo A): vem do CBO do registro
// (código da CBO), nunca da sigla do conselho (divergem em 481 de 2.095 registros). Médico: CBO começando em
// 225 (família 2251–2253 da CBO 2002). A atividade real é a da ocupação do profissional (T 1.949, F 144, nulo 2);
// A situação do profissional (O 758, F 109, E 4) só aparece com a legenda "a confirmar" (DP-46.1). As sentinelas
// (profissional IDs 1 e 2, ocupação do profissional IDs 1 e 488) ficam fora das listas.
import type { CategoriaProfissional } from '@sgh/contratos';

export const SENTINELAS_PROFISSIONAL: ReadonlySet<number> = new Set([1, 2]);
export const SENTINELAS_REGISTRO: ReadonlySet<number> = new Set([1, 488]);

/** Categoria pelo código CBO (6 dígitos, com ou sem traço). */
export function categoriaPorCbo(cbo: string | null | undefined): CategoriaProfissional {
  const c = String(cbo ?? '').replace(/\D+/g, '');
  if (c.length < 4) return 'outros';
  if (c.startsWith('225')) return 'medico';
  if (c.startsWith('2235') || c.startsWith('3222')) return 'enfermagem';
  if (c.startsWith('2232') || c.startsWith('3224')) return 'odontologia';
  if (c.startsWith('2234') || c.startsWith('3251')) return 'farmacia';
  if (
    c.startsWith('223') ||
    c.startsWith('224') ||
    c.startsWith('2236') ||
    c.startsWith('322') ||
    c.startsWith('324')
  )
    return 'outros-saude';
  return 'outros';
}

const PRIORIDADE: readonly CategoriaProfissional[] = [
  'medico',
  'enfermagem',
  'odontologia',
  'farmacia',
  'outros-saude',
  'outros',
];

/** Categoria do profissional: a dos registros ativos, na ordem de prioridade (o médico vence). */
export function categoriaDoProfissional(
  registros: readonly { readonly cbo: string | null; readonly ativo: boolean | null }[],
): CategoriaProfissional {
  const ativos = registros.filter((r) => r.ativo !== false);
  const base = ativos.length > 0 ? ativos : registros;
  const cats = new Set(base.map((r) => categoriaPorCbo(r.cbo)));
  return PRIORIDADE.find((c) => cats.has(c)) ?? 'outros';
}

/** Ocupação do profissional ativa: T ativo, F inativo, nulo desconhecido (2 registros). */
export function registroAtivo(valor: unknown): boolean | null {
  const v = String(valor ?? '').trim();
  return v === 'T' ? true : v === 'F' ? false : null;
}

/** O profissional está ativo se algum registro está (a situação do profissional é "a confirmar"). */
export function profissionalAtivo(registros: readonly { readonly ativo: boolean | null }[]): boolean {
  return registros.some((r) => r.ativo === true);
}

export function ehSentinelaProfissional(id: number): boolean {
  return SENTINELAS_PROFISSIONAL.has(id);
}
export function ehSentinelaRegistro(id: number): boolean {
  return SENTINELAS_REGISTRO.has(id);
}

/**
 * M15: filtro por categoria nas consultas (prefixos do CBO que entram e que saem), coerente com
 * `categoriaPorCbo`: um CBO entra na categoria exatamente quando casa um prefixo de `incluir` e nenhum de
 * `excluir` (sem `incluir`: todo CBO que não casa `excluir`).
 */
export function prefixosDaCategoria(c: CategoriaProfissional): {
  readonly incluir: readonly string[];
  readonly excluir: readonly string[];
} {
  switch (c) {
    case 'medico':
      return { incluir: ['225'], excluir: [] };
    case 'enfermagem':
      return { incluir: ['2235', '3222'], excluir: [] };
    case 'odontologia':
      return { incluir: ['2232', '3224'], excluir: [] };
    case 'farmacia':
      return { incluir: ['2234', '3251'], excluir: [] };
    case 'outros-saude':
      return {
        incluir: ['223', '224', '2236', '322', '324'],
        excluir: ['2235', '3222', '2232', '3224', '2234'],
      };
    case 'outros':
      return { incluir: [], excluir: ['225', '223', '224', '322', '324', '3251'] };
  }
}
