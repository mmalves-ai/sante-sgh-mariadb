// Escritor que só grava em tabela SGH_ (M06): recusa procedimento, bloco PSQL e DDL; toda escrita em tabela
// sem o prefixo SGH_ é recusada antes de chegar ao banco. M11: também o executor o usa para as gravações SGH_
// derivadas na mesma transação da operação (índice de busca do cadastro).
import { type Escritor, repassarEsperaCurta } from '../transacao.js';

const ESCRITA =
  /^\s*(?:INSERT\s+INTO|UPDATE(?:\s+OR\s+INSERT\s+INTO)?|DELETE\s+FROM|MERGE\s+INTO)\s+"?([A-Za-z0-9_$]+)"?/i;

/** Escritor que só grava em tabela SGH_ (e recusa procedimento, bloco PSQL e DDL). */
export function somenteSgh(e: Escritor): Escritor {
  const conferir = (sql: string) => {
    const alvo = ESCRITA.exec(sql)?.[1]?.toUpperCase();
    if (!alvo || !alvo.startsWith('SGH_'))
      throw new Error('Transação SGH_: só inclusão ou alteração em tabela SGH_ (nunca tabela do legado).');
  };
  return {
    hospital: e.hospital,
    consultar: (sql, p, o) => e.consultar(sql, p, o),
    lerBlob: (b) => e.lerBlob(b),
    async executar(sql, p = []) {
      conferir(sql);
      return e.executar(sql, p);
    },
    async executarRetornando(sql, p = []) {
      conferir(sql);
      return e.executarRetornando(sql, p);
    },
    ...repassarEsperaCurta(e, conferir),
  };
}
