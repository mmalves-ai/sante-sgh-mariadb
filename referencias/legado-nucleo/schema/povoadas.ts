// Tabelas do legado com linhas (matriz de cobertura, M08, regra 11): catálogo RDB$ (tabelas do usuário,
// sem visões nem tabelas SGH_) e uma consulta FIRST 1 por tabela, em READ ONLY, fora da requisição. Só os
// nomes saem; nenhum dado de linha.
import type { Leitor } from '../transacao.js';

const NOME = /^[A-Z][A-Z0-9_$]{0,30}$/;

export async function tabelasPovoadas(l: Leitor): Promise<string[]> {
  const tabelas = await l.consultar(
    `SELECT TRIM(RDB$RELATION_NAME) T FROM RDB$RELATIONS
      WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NULL AND RDB$RELATION_NAME NOT STARTING WITH 'SGH_'
      ORDER BY 1`,
    [],
    { teto: 10_000 },
  );
  const r: string[] = [];
  for (const t of tabelas) {
    const nome = String(t['T']);
    if (!NOME.test(nome)) continue;
    const [x] = await l.consultar(`SELECT FIRST 1 1 U FROM ${nome}`, [], { teto: 1, tempoMaximoMs: 30_000 });
    if (x) r.push(nome);
  }
  return r;
}

/**
 * M14 (levantamento do lote): linhas de uma tabela, com teto de tempo (só a contagem sai). Para as tabelas
 * grandes quem chama usa a contagem da matriz e nunca chama esta função.
 */
export async function contarLinhas(l: Leitor, tabela: string, tempoMaximoMs = 60_000): Promise<number> {
  if (!NOME.test(tabela)) throw new Error('Nome de tabela inválido.');
  const [x] = await l.consultar(`SELECT COUNT(*) N FROM ${tabela}`, [], { teto: 1, tempoMaximoMs });
  const n = x?.['N'];
  return typeof n === 'bigint' ? Number(n) : Number(n ?? 0);
}

/**
 * M14: valor atual dos generators (GEN_ID com passo 0: só lê, não anda), para avisar o generator perto do
 * fim do tipo da chave (as reproduções avançam o generator, que não volta no ROLLBACK).
 */
export async function valorAtualGenerators(
  l: Leitor,
  nomes: readonly string[],
): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const g of nomes) {
    if (!NOME.test(g)) throw new Error('Nome de generator inválido.');
    const [x] = await l.consultar(`SELECT GEN_ID(${g}, 0) V FROM RDB$DATABASE`, [], { teto: 1 });
    const v = x?.['V'];
    r[g] = typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
  }
  return r;
}
