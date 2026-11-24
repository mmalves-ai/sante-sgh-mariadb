// Auxiliar comum dos testes de integração da API e do worker: limpeza da trilha de auditoria das massas sintéticas
// (banco próprio do cliente).
// Desde a cadeia por hash (SBIS-16, db/migracoes/00_NUCLEO/23_tabelas.sql), a cabeça da cadeia (trilha_cadeia) e o
// fecho diário (trilha_auditoria_fecho) apontam para linhas da trilha com ON DELETE RESTRICT, assim como a idempotência
// do executor (idempotencia_operacao), o evento de auditoria (evento_auditoria, com o alerta e o registro que apontam
// para ele) e a proposta de escrita da API (proposta_escrita_api): apagar a trilha antes deles dá o erro 1451. Este
// ajudante apaga na ordem das chaves (primeiro os dependentes; só então fecho, cabeça e linhas, para que uma falha no
// meio não deixe a cadeia pela metade) e SÓ dos estabelecimentos sintéticos que a massa criou: a cadeia é por
// estabelecimento, então a de qualquer outro estabelecimento (e a do escopo 0, dos eventos sem estabelecimento) fica
// intacta, sem elo apagado no meio. Antes de apagar, confere no information_schema que toda chave estrangeira para a
// trilha (e para o evento de auditoria) é tratada aqui; chave nova não tratada recusa, em vez de falhar pela metade.
import type { Escritor } from './transacao.js';

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
  const daTrilha = `JOIN trilha_auditoria t ON t.id = x.trilha_auditoria_id WHERE t.estabelecimento_id IN ${em}`;
  const doEvento = `JOIN evento_auditoria ea ON ea.id = x.evento_auditoria_id JOIN trilha_auditoria t ON t.id = ea.trilha_auditoria_id WHERE t.estabelecimento_id IN ${em}`;
  return [
    `DELETE x FROM evento_auditoria_alerta x ${doEvento}`,
    `DELETE x FROM evento_auditoria_registro x ${doEvento}`,
    `DELETE x FROM evento_auditoria x ${daTrilha}`,
    `DELETE x FROM proposta_escrita_api x ${daTrilha}`,
    `DELETE x FROM idempotencia_operacao x ${daTrilha}`,
    `DELETE FROM trilha_auditoria_fecho WHERE estabelecimento_id IN ${em}`,
    `DELETE FROM trilha_cadeia WHERE estabelecimento_id IN ${em}`,
    `DELETE FROM trilha_auditoria WHERE estabelecimento_id IN ${em}`,
  ];
}

/**
 * As chaves estrangeiras (tabela.coluna) para trilha_auditoria e para evento_auditoria que sqlLimparTrilha trata. Uma
 * chave nova para essas tabelas precisa entrar aqui e no SQL acima, ou a limpeza recusa (conferirChavesTratadas).
 */
export const CHAVES_TRATADAS: readonly string[] = [
  'evento_auditoria.trilha_auditoria_id',
  'evento_auditoria_alerta.evento_auditoria_id',
  'evento_auditoria_registro.evento_auditoria_id',
  'idempotencia_operacao.trilha_auditoria_id',
  'proposta_escrita_api.trilha_auditoria_id',
  'trilha_auditoria_fecho.primeiro_trilha_auditoria_id',
  'trilha_auditoria_fecho.ultimo_trilha_auditoria_id',
  'trilha_cadeia.primeiro_trilha_auditoria_id_dia',
  'trilha_cadeia.ultimo_trilha_auditoria_id',
];

const conferidos = new Set<string>();

/** Recusa (sem apagar nada) quando o banco tem chave para a trilha ou para o evento de auditoria fora de CHAVES_TRATADAS. */
export async function conferirChavesTratadas(e: Escritor): Promise<void> {
  // information_schema é lento sob carga: confere uma vez por banco em cada processo de teste.
  const [b] = await e.consultar<{ banco: string }>('SELECT DATABASE() AS banco');
  const banco = String(b?.banco ?? '');
  if (conferidos.has(banco)) return;
  const l = await e.consultar<{ tabela: string; coluna: string }>(
    `SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IN ('trilha_auditoria', 'evento_auditoria')`,
  );
  const faltam = [...new Set(l.map((x) => `${String(x.tabela)}.${String(x.coluna)}`))]
    .filter((c) => !CHAVES_TRATADAS.includes(c))
    .sort();
  if (faltam.length > 0) {
    throw new Error(
      `limparTrilhaDaMassa: chave(s) para a trilha não tratada(s) no ajudante: ${faltam.join(', ')}`,
    );
  }
  conferidos.add(banco);
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
 * Apaga a trilha de auditoria dos estabelecimentos sintéticos da massa na ordem das chaves: alerta e registro do evento
 * de auditoria, evento, proposta de escrita da API, idempotência, fecho diário, cabeça da cadeia e as linhas. Confere
 * antes que toda chave para a trilha é tratada. Devolve os ids limpos (vazio: nada a fazer).
 */
export async function limparTrilhaDaMassa(e: Escritor, alvo: EstabelecimentosDaMassa): Promise<number[]> {
  const ids = await resolver(e, alvo);
  if (ids.length === 0) return ids;
  await conferirChavesTratadas(e);
  for (const sql of sqlLimparTrilha(ids)) await e.executar(sql);
  return ids;
}
