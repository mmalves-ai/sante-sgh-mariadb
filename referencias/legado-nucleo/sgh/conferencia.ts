// Leituras das telas do M04 (conferência de gravação): o estado dos triggers do catálogo no RDB$TRIGGERS e as
// provas pós-escrita recentes contadas na SGH_TRILHA (fonte compartilhada: qualquer processo que rode o
// executor grava a trilha na mesma transação da operação). Só no adaptador: apps/* não conhecem o banco.
// Nenhum valor de linha: nomes de trigger, nomes de operação e contagens.
import type { Leitor } from '../transacao.js';

export type EstadoTrigger = 'ativo' | 'inativo' | 'ausente';

const NOME_TRIGGER = /^[A-Z][A-Z0-9_$]{0,30}$/;

/** Estado dos triggers no banco (RDB$TRIGGERS: ativo, inativo ou ausente), em lotes de 100. */
export async function estadoDosTriggers(
  l: Leitor,
  nomes: readonly string[],
): Promise<Record<string, EstadoTrigger>> {
  const validos = nomes.filter((n) => NOME_TRIGGER.test(n));
  const r: Record<string, EstadoTrigger> = Object.fromEntries(validos.map((n) => [n, 'ausente' as const]));
  for (let i = 0; i < validos.length; i += 100) {
    const lote = validos.slice(i, i + 100);
    const linhas = await l.consultar(
      `SELECT TRIM(RDB$TRIGGER_NAME) N, RDB$TRIGGER_INACTIVE I FROM RDB$TRIGGERS WHERE RDB$TRIGGER_NAME IN (${lote.map(() => '?').join(', ')})`,
      lote,
      { teto: lote.length },
    );
    for (const x of linhas) r[String(x['N']).trim()] = Number(x['I'] ?? 0) === 1 ? 'inativo' : 'ativo';
  }
  return r;
}

/** Quantas linhas recentes da trilha entram na contagem (índice SGH_IDX_TRILHA_ULTIMA, sem varrer a tabela). */
export const ULTIMAS_LINHAS_TRILHA = 10_000;

/**
 * Provas pós-escrita confirmadas por operação nas últimas `ultimas` linhas da trilha do estabelecimento. A
 * operação desfeita pela prova não deixa linha (a trilha é gravada na mesma transação): as desfeitas e as
 * colisões são contadas pelo executor do processo (MetricasExecutor).
 */
export async function provasRecentes(
  l: Leitor,
  hospital: string,
  ultimas = ULTIMAS_LINHAS_TRILHA,
): Promise<Record<string, number>> {
  const n = Math.max(1, Math.min(Math.trunc(ultimas), 100_000));
  const linhas = await l.consultar(
    `SELECT t.OPERACAO, COUNT(*) N
       FROM (SELECT FIRST ${n} OPERACAO, RESULTADO FROM SGH_TRILHA WHERE HOSPITAL = ?
              ORDER BY HOSPITAL DESC, ID DESC) t
      WHERE t.RESULTADO = 'sucesso'
      GROUP BY t.OPERACAO`,
    [hospital],
    { teto: 1_000 },
  );
  return Object.fromEntries(linhas.map((x) => [String(x['OPERACAO'] ?? '').trim(), Number(x['N'] ?? 0)]));
}
