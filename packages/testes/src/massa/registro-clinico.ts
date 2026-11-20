// Massa e leituras de conferência do registro clínico (M22) para a integração na cópia (transação desfeita): o
// estado que o ROLLBACK tem de devolver (maiores chaves e contagens das tabelas do legado e das SGH_), o documento
// da trilha documental relido e descomprimido, o tamanho do texto formatado, a situação do rascunho (encadeado,
// arquivado, finalizado), a alteração feita pelo outro sistema (regra 11) e a suspensão pela metade (o que o
// gatilho do banco recusa). Só números e o XML do documento em memória.
import { inflateSync } from 'node:zlib';
import { decodificarCp1252, type Escritor } from '@sgh/legado';

const n = (v: unknown) => Number(v ?? NaN);

/**
 * O estado que o ROLLBACK tem de devolver: as maiores chaves das tabelas do legado que o registro clínico grava
 * (cabeçalho, respostas, conteúdo, trilha documental, rascunho e a trilha dupla), as contagens recentes das que não
 * têm chave gerada (respostas do rascunho, linhas da trilha dupla) e as contagens das tabelas SGH_ (prova,
 * versão, eventos, marca de origem do rascunho, trilha própria). Só números.
 */
export async function estadoRegistroClinico(e: Pick<Escritor, 'consultar'>): Promise<Record<string, number>> {
  const [x] = await e.consultar(
    `SELECT (SELECT MAX(ID_CABEVOL) FROM PRCABEVOL) C, (SELECT MAX(ID) FROM PREVOLPAC) L,
            (SELECT MAX(ID) FROM PRCONTEVOL) T, (SELECT MAX(ID) FROM PRASSINATURA_CAB) AC,
            (SELECT MAX(ID) FROM PRASSINATURA_DOC) D, (SELECT MAX(ID_CABEVOL) FROM PRCABEVOLTMP) R,
            (SELECT MAX(ID) FROM TBCABTRILHA) TC,
            (SELECT COUNT(*) FROM SGH_PEP_DOC) P, (SELECT COUNT(*) FROM SGH_PEP_DOC_EVENTO) V,
            (SELECT COUNT(*) FROM SGH_PEP_REG_VERSAO) RV, (SELECT COUNT(*) FROM SGH_PEP_FORM_VERSAO) FV,
            (SELECT COUNT(*) FROM SGH_PEP_RASCUNHO) SR, (SELECT MAX(ID) FROM SGH_TRILHA) ST
       FROM RDB$DATABASE`,
    [],
    { teto: 1, tempoMaximoMs: 60_000 },
  );
  const n0 = Object.fromEntries(Object.entries(x ?? {}).map(([k, v]) => [k, n(v)]));
  // As tabelas sem chave gerada: as linhas das últimas chaves (o que uma gravação desfeita deixaria).
  const [y] = await e.consultar(
    `SELECT (SELECT COUNT(*) FROM PREVOLPACTMP WHERE ID_CABEVOL > ?) RT,
            (SELECT COUNT(*) FROM TBLANTRILHASGH WHERE ID_TBCABTRILHA > ?) TL,
            (SELECT COUNT(*) FROM PRCABEVOLTMP WHERE ID_CABEVOL > ? AND (DATA_HORA_ARQUIVADO IS NOT NULL OR DATA_HORA_EXCLUSAO IS NOT NULL)) RF
       FROM RDB$DATABASE`,
    [(n0['R'] ?? 0) - 2_000, (n0['TC'] ?? 0) - 2_000, (n0['R'] ?? 0) - 2_000],
    { teto: 1, tempoMaximoMs: 60_000 },
  );
  return { ...n0, ...Object.fromEntries(Object.entries(y ?? {}).map(([k, v]) => [k, n(v)])) };
}

/** Alteração de uma resposta do registro como o outro sistema faria (o texto de uma linha), na transação. */
export function alterarComoOutroSistema(e: Escritor, registro: number): Promise<number> {
  return e.executar(
    `UPDATE PREVOLPAC SET RESPALFA = 'SINTETICO alterado pelo outro sistema'
      WHERE ID = (SELECT MIN(ID) FROM PREVOLPAC WHERE ID_CABEVOL = ?)`,
    [registro],
  );
}

/** Os eventos do documento na prova (SGH_PEP_DOC_EVENTO) e se o registro está suspenso. */
export async function eventosESuspensao(
  e: Escritor,
  hospital: string,
  registro: number,
): Promise<{ eventos: number; suspenso: boolean }> {
  const [x] = await e.consultar(
    `SELECT (SELECT COUNT(*) FROM SGH_PEP_DOC_EVENTO WHERE HOSPITAL = ? AND ID_PRCABEVOL = ?) EV,
            (SELECT IIF(DATA_HORA_SUSPENSAO IS NULL, 0, 1) FROM PRCABEVOL WHERE ID_CABEVOL = ?) S
       FROM RDB$DATABASE`,
    [hospital, registro, registro],
    { teto: 1 },
  );
  return { eventos: n(x?.['EV']), suspenso: n(x?.['S']) === 1 };
}

/** A situação da versão do rascunho (encadeado na anterior; arquivado ou excluído). */
export async function situacaoRascunho(
  e: Escritor,
  rascunho: number,
): Promise<{ anterior: number | null; arquivado: boolean; excluido: boolean }> {
  const [t] = await e.consultar(
    'SELECT ID_PRCABEVOLTMP A, DATA_HORA_ARQUIVADO Q, DATA_HORA_EXCLUSAO X FROM PRCABEVOLTMP WHERE ID_CABEVOL = ?',
    [rascunho],
    { teto: 1 },
  );
  return {
    anterior: t?.['A'] === null || t?.['A'] === undefined ? null : n(t['A']),
    arquivado: t?.['Q'] instanceof Date,
    excluido: t?.['X'] instanceof Date,
  };
}

/** O documento da trilha documental do registro (tipo 36): base64 → zlib → Windows-1252. */
export async function documentoDoRegistro(e: Escritor, registro: number): Promise<string> {
  const [d] = await e.consultar(
    `SELECT d.DOCUMENTO_ORIGINAL X FROM PRASSINATURA_CAB c JOIN PRASSINATURA_DOC d ON d.ID_PRASSINATURA_CAB = c.ID
      WHERE c.ID_TABELA = ? AND c.ID_PRTPASSINATURA = 36`,
    [registro],
    { teto: 1 },
  );
  const b64 = Buffer.from(await e.lerBlob(d?.['X'])).toString('latin1');
  return decodificarCp1252(inflateSync(Buffer.from(b64, 'base64')));
}

export async function bytesDoTextoFormatado(e: Escritor, registro: number): Promise<number> {
  const [x] = await e.consultar(
    'SELECT OCTET_LENGTH(EVOLUCAO) N FROM PRCONTEVOL WHERE ID_PRCABEVOL = ?',
    [registro],
    {
      teto: 1,
    },
  );
  return n(x?.['N']);
}

/** O rascunho finalizado fica marcado excluído (como o legado: 11.216 de 11.221 em 180 dias). */
export async function rascunhoFinalizado(e: Escritor, rascunho: number): Promise<boolean> {
  const [t] = await e.consultar(
    'SELECT DATA_HORA_EXCLUSAO A FROM PRCABEVOLTMP WHERE ID_CABEVOL = ?',
    [rascunho],
    {
      teto: 1,
    },
  );
  return t?.['A'] instanceof Date;
}

/** Só a data da suspensão, sem quem suspende nem a justificativa (o que o gatilho exige juntos). */
export function suspenderPelaMetade(e: Escritor, registro: number): Promise<number> {
  return e.executar('UPDATE PRCABEVOL SET DATA_HORA_SUSPENSAO = CURRENT_TIMESTAMP WHERE ID_CABEVOL = ?', [
    registro,
  ]);
}
