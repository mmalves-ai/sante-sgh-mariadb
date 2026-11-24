// Limpeza da trilha de auditoria das massas sintéticas dos testes de integração (banco próprio do cliente).
// Desde a cadeia por hash (SBIS-16, db/migracoes/00_NUCLEO/23_tabelas.sql), a cabeça da cadeia (trilha_cadeia) e o
// fecho diário (trilha_auditoria_fecho) apontam para linhas da trilha com ON DELETE RESTRICT, e a idempotência do
// executor (idempotencia_operacao.trilha_auditoria_id) também: apagar a trilha antes deles dá o erro 1451. Este
// ajudante apaga na ordem certa (fecho, cabeça, idempotência que aponta para a trilha, linhas) e SÓ dos estabelecimentos
// sintéticos que a massa criou: a cadeia é por estabelecimento, então a de qualquer outro estabelecimento (e a do
// escopo 0, dos eventos sem estabelecimento) fica intacta, sem elo apagado no meio.
import type { Escritor } from '@sgh/nucleo';

/** Os estabelecimentos sintéticos da massa: por id, pelos códigos ou pelo prefixo do código. */
export type EstabelecimentosDaMassa =
  | { readonly ids: readonly (number | null | undefined)[] }
  | { readonly codigos: readonly string[] }
  | { readonly prefixo: string };

/** Ids válidos (inteiros positivos, sem repetição); nulo, zero e indefinido saem (o escopo 0 nunca é limpo). */
export function idsDaMassa(ids: readonly (number | null | undefined)[]): number[] {
  return [...new Set(ids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))];
}

/**
 * Os comandos, na ordem, que apagam a trilha dos estabelecimentos `ids` (já validados por idsDaMassa). Para quem
 * executa SQL em texto (o cliente de linha de comando); quem tem o Escritor usa limparTrilhaDaMassa.
 */
export function sqlLimparTrilha(ids: readonly number[]): string[] {
  const lista = idsDaMassa(ids);
  if (lista.length === 0) return [];
  const em = `(${lista.join(', ')})`;
  return [
    `DELETE FROM trilha_auditoria_fecho WHERE estabelecimento_id IN ${em}`,
    `DELETE FROM trilha_cadeia WHERE estabelecimento_id IN ${em}`,
    `DELETE io FROM idempotencia_operacao io JOIN trilha_auditoria t ON t.id = io.trilha_auditoria_id WHERE t.estabelecimento_id IN ${em}`,
    `DELETE FROM trilha_auditoria WHERE estabelecimento_id IN ${em}`,
  ];
}

async function resolver(e: Escritor, alvo: EstabelecimentosDaMassa): Promise<number[]> {
  if ('ids' in alvo) return idsDaMassa(alvo.ids);
  if ('codigos' in alvo) {
    if (alvo.codigos.length === 0) return [];
    const m = alvo.codigos.map(() => '?').join(', ');
    const l = await e.consultar<{ id: number }>(
      `SELECT id FROM estabelecimento WHERE codigo IN (${m})`,
      alvo.codigos,
    );
    return idsDaMassa(l.map((x) => Number(x.id)));
  }
  if (!alvo.prefixo.trim()) throw new Error('limparTrilhaDaMassa: prefixo vazio apagaria a trilha de todos');
  const l = await e.consultar<{ id: number }>(
    "SELECT id FROM estabelecimento WHERE codigo LIKE CONCAT(?, '%')",
    [alvo.prefixo],
  );
  return idsDaMassa(l.map((x) => Number(x.id)));
}

/**
 * Apaga a trilha de auditoria dos estabelecimentos sintéticos da massa na ordem das chaves: fecho diário, cabeça da
 * cadeia, idempotência que aponta para a trilha e as linhas. Devolve os ids limpos (vazio: nada a fazer).
 */
export async function limparTrilhaDaMassa(e: Escritor, alvo: EstabelecimentosDaMassa): Promise<number[]> {
  const ids = await resolver(e, alvo);
  for (const sql of sqlLimparTrilha(ids)) await e.executar(sql);
  return ids;
}
