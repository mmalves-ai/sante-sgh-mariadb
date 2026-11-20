// Massa e leituras dos testes de integração do estoque (M28), sempre na transação desfeita da cópia: o usuário do
// estoque sem escopo, as releituras do documento gravado pelo executor (cabeçalho, itens, custo do item), a trava do
// item por outro terminal e o "outro sistema" que desfaz a consolidação e zera o estoque por fora, para o gatilho
// recusar. Só IDs e números; nenhum valor de pessoa.
import type { Escritor, Leitor } from '@sgh/legado';

type L = Pick<Leitor, 'consultar'>;
type E = Pick<Escritor, 'consultar' | 'executar'>;
const num = (v: unknown) => Number(v ?? NaN);

/** A competência do relógio do banco (a dos documentos que os testes gravam). */
const COMPETENCIA = 'EXTRACT(YEAR FROM CURRENT_DATE) AND {c}.MES = EXTRACT(MONTH FROM CURRENT_DATE)';
const daCompetencia = (c: string) => `${c}.ANO = ${COMPETENCIA.replace('{c}', c)}`;

/**
 * O retrato fora da transação, do que os testes gravam e o ROLLBACK tem de desfazer: os cabeçalhos (maior ID) e as
 * linhas da competência corrente (itens da saída e da devolução, os lotes de cada um, os itens da requisição), o
 * saldo e o valor dos itens da massa (GEITENS, GEARMLOC e GESALDOS da competência, a soma dos lotes em GEVALMEM),
 * as linhas SGH_ do estoque e a trilha dos operadores sintéticos. Só contagens e números, filtrados pela chave.
 */
export async function retratoEstoque(l: L, itens: readonly number[] = []): Promise<Record<string, number>> {
  const um = async (sql: string, ps: unknown[] = []) => {
    const [x] = await l.consultar(sql, ps, { teto: 1, tempoMaximoMs: 120_000 });
    return num(x?.['N']);
  };
  const r: Record<string, number> = {
    gecadsai: await um('SELECT MAX(ID) N FROM GECADSAI'),
    gecaddev: await um('SELECT MAX(ID) N FROM GECADDEV'),
    gelansai: await um(`SELECT COUNT(*) N FROM GELANSAI l WHERE ${daCompetencia('l')}`),
    gelansaireq: await um(`SELECT COUNT(*) N FROM GELANSAIREQ q WHERE ${daCompetencia('q')}`),
    gelandev: await um(
      `SELECT COUNT(*) N FROM GELANDEV d JOIN GECADDEV c ON c.ID = d.ID_GECADDEV WHERE ${daCompetencia('c')}`,
    ),
    gerasvalsaidlote: await um(
      `SELECT COUNT(*) N FROM GERASVALSAIDLOTE r JOIN GELANSAI l ON l.ID_GELANSAI = r.ID_GELANSAI
        WHERE ${daCompetencia('l')}`,
    ),
    gerasvaldevlote: await um(
      `SELECT COUNT(*) N FROM GERASVALDEVLOTE r JOIN GELANDEV d ON d.ID_GELANDEV = r.ID_GELANDEV
         JOIN GECADDEV c ON c.ID = d.ID_GECADDEV WHERE ${daCompetencia('c')}`,
    ),
    sghOcorrencia: await um('SELECT COUNT(*) N FROM SGH_SUP_DOC_OCORRENCIA'),
    sghEnvio: await um('SELECT COUNT(*) N FROM SGH_SUP_TRANSF_ETAPA'),
    sghEnvioItem: await um('SELECT COUNT(*) N FROM SGH_SUP_TRANSF_ITEM'),
    sghPonto: await um('SELECT COUNT(*) N FROM SGH_SUP_PONTO_PEDIDO'),
    trilhaSintetica: await um(
      "SELECT COUNT(*) N FROM SGH_TRILHA WHERE DIA >= CURRENT_DATE AND UPPER(USUARIO) STARTING WITH 'SGH.M04.'",
    ),
  };
  for (const it of itens) {
    const [g] = await l.consultar('SELECT ESTOQUE, TOTAL, VLRMED FROM GEITENS WHERE COD = ?', [it], {
      teto: 1,
    });
    r[`estoque:${it}`] = num(g?.['ESTOQUE']);
    r[`total:${it}`] = num(g?.['TOTAL']);
    r[`vlrmed:${it}`] = num(g?.['VLRMED']);
    r[`armloc:${it}`] = await um(
      `SELECT COALESCE(SUM(a.QTDE), 0) N FROM GEARMLOC a WHERE a.ITEM = ? AND ${daCompetencia('a')}`,
      [it],
    );
    r[`saldos:${it}`] = await um(
      `SELECT COALESCE(SUM(s.QTDE), 0) N FROM GESALDOS s WHERE s.ITEM = ? AND ${daCompetencia('s')}`,
      [it],
    );
    r[`valmem:${it}`] = await um('SELECT COALESCE(SUM(QTDE), 0) N FROM GEVALMEM WHERE ITEM = ?', [it]);
  }
  return r;
}

/** Uma requisição aberta (não consolidada) já gravada na cópia, de um dos locais dados: a chave, o local e os itens. */
export async function requisicaoAberta(
  l: L,
  locais: readonly number[],
): Promise<{
  ano: number;
  mes: number;
  doc: number;
  local: number;
  cdc: number;
  itens: { seq: number; item: number }[];
} | null> {
  const [c] = await l.consultar(
    `SELECT FIRST 1 c.ANO, c.MES, c.DOC, c.ARM, c.CDC FROM GECADSAI c
      WHERE c.REQUISICAO = 'T' AND c.CONSOL = 'F' AND c.DEST = 2 AND c.ARM IN (${locais.map(() => '?').join(', ')})
      ORDER BY c.ID DESC`,
    [...locais],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!c) return null;
  const chave = { ano: num(c['ANO']), mes: num(c['MES']), doc: num(c['DOC']) };
  const ls = await l.consultar(
    'SELECT SEQ, ITEM FROM GELANSAI WHERE ANO = ? AND MES = ? AND DOC = ? ORDER BY SEQ',
    [chave.ano, chave.mes, chave.doc],
    { teto: 300 },
  );
  return {
    ...chave,
    local: num(c['ARM']),
    cdc: num(c['CDC']),
    itens: ls.map((x) => ({ seq: num(x['SEQ']), item: num(x['ITEM']) })),
  };
}

/** Outro terminal segura o cabeçalho da saída (WITH LOCK), na transação dele (sempre desfeita). */
export async function travarCabecalho(e: L, chave: { ano: number; mes: number; doc: number }): Promise<void> {
  await e.consultar(
    'SELECT ID FROM GECADSAI WHERE ANO = ? AND MES = ? AND DOC = ? WITH LOCK',
    [chave.ano, chave.mes, chave.doc],
    { teto: 1 },
  );
}

/** A observação gravada no cabeçalho da saída (para a ida e volta do CP1252). */
export async function observacaoDaSaida(e: L, id: number): Promise<string> {
  const [c] = await e.consultar('SELECT OBS FROM GECADSAI WHERE ID = ?', [id], { teto: 1 });
  return String(c?.['OBS'] ?? '');
}

/** O usuário do estoque sem nenhum local (o cadastro existe, o escopo não). */
export async function usuarioEstoqueSemEscopo(e: E, login: string): Promise<void> {
  await e.executar('INSERT INTO GEUSERS (USUARIO, NOME) VALUES (?, ?)', [login, 'USUARIO SINTETICO']);
}

export async function estoqueDoItem(e: L, item: number): Promise<number> {
  const [g] = await e.consultar('SELECT ESTOQUE FROM GEITENS WHERE COD = ?', [item], { teto: 1 });
  return num(g?.['ESTOQUE']);
}

/** O cabeçalho da saída pelo ID e os itens (consolidação, número e o custo médio posto pelo gatilho). */
export async function saidaGravada(e: L, id: number) {
  const [c] = await e.consultar('SELECT CONSOL, DOC, ANO, MES FROM GECADSAI WHERE ID = ?', [id], { teto: 1 });
  const chave = { ano: num(c?.['ANO']), mes: num(c?.['MES']), doc: num(c?.['DOC']) };
  const ls = await e.consultar(
    'SELECT ID_GELANSAI, CONSOL, VLRMED FROM GELANSAI WHERE ANO = ? AND MES = ? AND DOC = ?',
    [chave.ano, chave.mes, chave.doc],
    { teto: 10 },
  );
  return {
    chave,
    consolidado: String(c?.['CONSOL']),
    itens: ls.map((l) => ({
      id: num(l['ID_GELANSAI']),
      consolidado: String(l['CONSOL']),
      vlrmed: num(l['VLRMED']),
    })),
  };
}

/** Outro terminal segura a linha do item (WITH LOCK), na transação dele (sempre desfeita). */
export async function travarItem(e: L, item: number): Promise<void> {
  await e.consultar('SELECT COD FROM GEITENS WHERE COD = ? WITH LOCK', [item], { teto: 1 });
}

/**
 * O "outro sistema" por fora, sobre um documento ainda não consolidado (a requisição nasce com CONSOL='F'): zera o
 * estoque do item na empresa e consolida o item; o gatilho do item recusa por falta de saldo (a exceção sobe crua para
 * o teste traduzir).
 */
export async function consolidarSemEstoque(
  e: E,
  chave: { ano: number; mes: number; doc: number },
  item: number,
): Promise<void> {
  await e.executar('UPDATE GEITENS SET ESTOQUE = 0 WHERE COD = ?', [item]);
  await e.executar("UPDATE GELANSAI SET CONSOL = 'T' WHERE ANO = ? AND MES = ? AND DOC = ? AND ITEM = ?", [
    chave.ano,
    chave.mes,
    chave.doc,
    item,
  ]);
}
