// Ligação da ferramenta de BI ao data mart pseudonimizado (01-ADM L115; F8): a análise ad hoc (tabela dinâmica, cubo,
// filtros salvos pelo usuário) é feita na ferramenta de BI, que lê os arquivos publicados SÓ PARA LEITURA; o produto
// não guarda análises (minimização, LGPD art. 6º, III). Roteiro: docs/implantacao/ligacao-bi-data-mart.md.
//   - `abrirParaBi`: abre o arquivo em somente leitura (a escrita é recusada pelo SQLite) e recusa o arquivo com coluna
//     identificadora (nome, documento, contato, endereço, nascimento, texto clínico, identificador cru) ou sem o
//     registro da carga (arquivo pela metade ou de outra origem);
//   - `conferirLigacaoBi`: o mesmo, devolvendo as tabelas que a ferramenta de BI enxerga e os problemas (só nomes).
// Melhoria: a conferência é a mesma regra do verificador da carga (colunasIdentificadoras), aplicada ao arquivo que a
// ferramenta de BI de fato abre, não só ao esquema declarado.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { colunasIdentificadoras } from '@sgh/dominio-relatorio/datamart';

export interface ConferenciaLigacaoBi {
  readonly tabelas: readonly string[];
  readonly problemas: readonly string[];
}

function tabelasDoArquivo(db: DatabaseSync): { nome: string; colunas: Record<string, 'texto'> }[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => ({
    nome: t.name,
    colunas: Object.fromEntries(
      (db.prepare('SELECT name FROM pragma_table_info(?)').all(t.name) as { name: string }[]).map((c) => [
        c.name,
        'texto' as const,
      ]),
    ),
  }));
}

function conferir(db: DatabaseSync): ConferenciaLigacaoBi {
  const tabelas = tabelasDoArquivo(db);
  const problemas = colunasIdentificadoras(tabelas);
  if (!tabelas.some((t) => t.nome === 'carga')) problemas.push('arquivo sem o registro da carga');
  else if (Number((db.prepare('SELECT COUNT(*) AS n FROM carga').get() as { n: number }).n) === 0)
    problemas.push('registro da carga vazio');
  return { tabelas: tabelas.map((t) => t.nome), problemas };
}

/** A conferência do arquivo como a ferramenta de BI o veria (aberto só para leitura). */
export function conferirLigacaoBi(arquivo: string): ConferenciaLigacaoBi {
  if (!existsSync(arquivo)) return { tabelas: [], problemas: ['arquivo do data mart inexistente'] };
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    return conferir(db);
  } finally {
    db.close();
  }
}

/** Abre o arquivo para a ferramenta de BI: só leitura, e só se nenhuma coluna identificadora estiver nele. */
export function abrirParaBi(arquivo: string): DatabaseSync {
  if (!existsSync(arquivo)) throw new Error('arquivo do data mart inexistente');
  const db = new DatabaseSync(arquivo, { readOnly: true });
  const c = conferir(db);
  if (c.problemas.length > 0) {
    db.close();
    throw new Error(`data mart recusado para o BI: ${c.problemas.join(', ')}`);
  }
  return db;
}
