// W0-02 / D-CRUD-SNAP (REGRAS-CRUD.md; matriz de governança, "Convivência com o legado que apaga", itens 1 e 6): o
// RETRATO da linha inteira antes de toda exclusão física que o Sante faz numa tabela do legado de categoria protegida.
// Reutiliza a SGH_HIST_EXCLUSAO genérica da D-PROF-39 (0114_cad_profissional_evento.sql: uma tabela para todas, com a
// tabela e a chave da linha; LINHA em JSON ASCII), só inclusão e sem restrição que possa falhar (só NOT NULL de colunas
// que o motor sempre preenche), NA MESMA TRANSAÇÃO da exclusão: desfeita a exclusão (gatilho do legado que recusa,
// vínculo concorrente), o retrato some junto — nunca fica retrato órfão. Diferente do retrato da D-PROF-39, o BLOB entra
// (base64, pelo `serializarLinha` do "Login como"): a linha é reconstituível inteira.
//
// O registro do EVENTO (SGH_CRUD_EVENTO, 1170_crud_evento.sql) leva o motivo e o valor anterior da exclusão e da
// reativação (a SGH_TRILHA da mesma transação leva quem, quando, a estação e o id do registro).
import { jsonAscii, serializarLinha } from '../como.js';
import type { Linha } from '../driver.js';
import type { Escritor, Leitor } from '../transacao.js';

export interface RetratoLinha {
  readonly tabela: string;
  /** Chave da linha como texto (o código exposto do domínio; composta com "|"), até 120. */
  readonly chave: string;
  /** A linha inteira, serializada (data ISO, BLOB e bytes em base64, inteiro grande como texto). */
  readonly linha: Record<string, unknown>;
}

const NOME = /^[A-Z][A-Z0-9_$]{0,30}$/;

/** Lê a linha inteira (SELECT *) pela cláusula da chave e a serializa (com os BLOBs). */
export async function retratarLinha(
  l: Pick<Leitor, 'consultar' | 'lerBlob'>,
  tabela: string,
  condicao: string,
  parametros: readonly unknown[],
  chave: string,
): Promise<RetratoLinha | null> {
  if (!NOME.test(tabela)) throw new Error('Tabela inválida.');
  const [linha] = await l.consultar(`SELECT * FROM ${tabela} WHERE ${condicao}`, parametros, { teto: 1 });
  if (!linha) return null;
  return { tabela, chave: chave.slice(0, 120), linha: await serializarLinha(linha as Linha, l) };
}

/**
 * Revisão do W0-02 (D-CRUD-SNAP com `exclusao.proprias`): as linhas FILHAS que a FK em CASCADE leva junto com a linha
 * principal, retratadas inteiras ANTES do DELETE (uma por linha, com a chave primária da filha como texto). O teto
 * protege a transação: acima dele, nada é apagado (a exclusão é recusada por quem chama).
 */
export async function retratarFilhas(
  l: Pick<Leitor, 'consultar' | 'lerBlob'>,
  tabela: string,
  colunas: readonly string[],
  valores: readonly unknown[],
  chavePrimaria: readonly string[],
  teto: number,
): Promise<RetratoLinha[] | null> {
  if (!NOME.test(tabela) || colunas.some((c) => !NOME.test(c)) || chavePrimaria.some((c) => !NOME.test(c)))
    throw new Error('Tabela inválida.');
  if (valores.some((v) => v === null || v === undefined)) return [];
  const linhas = await l.consultar(
    `SELECT * FROM ${tabela} WHERE ${colunas.map((c) => `${c} = ?`).join(' AND ')}`,
    valores,
    { teto: teto + 1 },
  );
  if (linhas.length > teto) return null;
  const r: RetratoLinha[] = [];
  for (const x of linhas) {
    const chave = (chavePrimaria.length ? chavePrimaria : colunas)
      .map((c) => (x[c] === null || x[c] === undefined ? '' : String(x[c]).trim()))
      .join('|');
    r.push({ tabela, chave: chave.slice(0, 120), linha: await serializarLinha(x as Linha, l) });
  }
  return r;
}

/** Grava o retrato na SGH_HIST_EXCLUSAO (só inclusão; na transação de quem chama). */
export async function gravarRetrato(
  es: Pick<Escritor, 'executar'>,
  r: RetratoLinha,
  quem: {
    readonly hospital: string;
    readonly operacao: string;
    readonly motivo: string;
    readonly usuario: string;
  },
): Promise<void> {
  const n = await es.executar(
    `INSERT INTO SGH_HIST_EXCLUSAO (ID, HOSPITAL, OPERACAO, TABELA, CHAVE, LINHA, MOTIVO, EXCLUIDO_POR)
     VALUES (NEXT VALUE FOR SGH_GEN_HIST_EXCLUSAO, ?, ?, ?, ?, ?, ?, ?)`,
    [
      quem.hospital,
      quem.operacao.slice(0, 80),
      r.tabela,
      r.chave,
      Buffer.from(jsonAscii(r.linha), 'ascii'),
      quem.motivo.slice(0, 200),
      quem.usuario.slice(0, 31),
    ],
  );
  if (n !== 1) throw new Error('SGH_HIST_EXCLUSAO: o retrato não foi gravado.');
}

/**
 * O evento registrado (revisão do W0-02: também a alteração — com o texto longo anterior — e a inativação, para a trilha
 * levar o motivo e o valor anterior de toda mudança feita pelo motor do CRUD genérico).
 */
export type EventoCrud = 'excluido' | 'reativado' | 'alterado' | 'inativado';

/** Grava o evento (motivo e valor anterior) na SGH_CRUD_EVENTO (só inclusão; na transação de quem chama). */
export async function gravarEventoCrud(
  es: Pick<Escritor, 'executar'>,
  ev: {
    readonly hospital: string;
    readonly operacao: string;
    readonly recurso: string;
    readonly evento: EventoCrud;
    readonly tabela: string;
    readonly chave: string;
    readonly motivo: string;
    readonly valorAnterior: Readonly<Record<string, unknown>> | null;
    readonly idempotencia: string;
    readonly estacao: string | null;
    readonly usuario: string;
  },
): Promise<void> {
  const n = await es.executar(
    `INSERT INTO SGH_CRUD_EVENTO (ID, HOSPITAL, OPERACAO, RECURSO, EVENTO, TABELA, CHAVE, MOTIVO, VALOR_ANTERIOR,
       IDEMPOTENCIA, ESTACAO, CRIADO_POR)
     VALUES (NEXT VALUE FOR SGH_GEN_CRUD_EVENTO, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ev.hospital,
      ev.operacao.slice(0, 80),
      ev.recurso.slice(0, 80),
      ev.evento,
      ev.tabela,
      ev.chave.slice(0, 120),
      ev.motivo.slice(0, 200),
      ev.valorAnterior === null ? null : Buffer.from(jsonAscii(ev.valorAnterior), 'ascii'),
      ev.idempotencia.slice(0, 80),
      ev.estacao === null ? null : ev.estacao.slice(0, 80),
      ev.usuario.slice(0, 31),
    ],
  );
  if (n !== 1) throw new Error('SGH_CRUD_EVENTO: o evento não foi gravado.');
}
