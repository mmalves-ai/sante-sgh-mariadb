// D-PROF-39: massa e leituras da integração do profissional do corpo clínico na cópia (sempre na transação desfeita da
// integração, ou READ ONLY): CPF e número de conselho livres, o CBO médico, as contagens que provam os gatilhos, o
// vínculo do login, a exclusão e o ROLLBACK. Só contagens e IDs (nenhum nome sai daqui).
import type { Escritor, Leitor } from '@sgh/legado';
import { cpfComDigitos } from './sintetica.js';

type L = Pick<Leitor, 'consultar'>;
const num = (v: unknown) => Number(v ?? 0);
async function n(l: L, sql: string, p: readonly unknown[] = []): Promise<number> {
  const [x] = await l.consultar(sql, p, { teto: 1 });
  return num(x?.['N']);
}

/** Contagem ou maior chave das tabelas que as operações do profissional tocam (iguais depois do ROLLBACK). */
export async function retratoDoProfissional(l: L): Promise<Record<string, number>> {
  const q: Record<string, string> = {
    TBPROFIS: 'SELECT COUNT(*) N FROM TBPROFIS',
    TBCBOPRO: 'SELECT COUNT(*) N FROM TBCBOPRO',
    HTPROFIS: 'SELECT MAX(ID) N FROM HTPROFIS',
    HTTBCBOPRO: 'SELECT MAX(ID) N FROM HTTBCBOPRO',
    TBMEDESP: 'SELECT COUNT(*) N FROM TBMEDESP',
    TBCBOPRO_TBCONVEN: 'SELECT COUNT(*) N FROM TBCBOPRO_TBCONVEN',
    TBUSERS: 'SELECT COUNT(*) N FROM TBUSERS',
    TBUSERS_TBPAPEL: 'SELECT COUNT(*) + COALESCE(SUM(ID_TBCBOPRO), 0) N FROM TBUSERS_TBPAPEL',
    TBPESSOA: 'SELECT COUNT(*) N FROM TBPESSOA',
    SGH_CAD_PROF_EVENTO: 'SELECT COUNT(*) N FROM SGH_CAD_PROF_EVENTO',
    SGH_HIST_EXCLUSAO: 'SELECT COUNT(*) N FROM SGH_HIST_EXCLUSAO',
  };
  const r: Record<string, number> = {};
  for (const [t, sql] of Object.entries(q)) r[t] = await n(l, sql);
  return r;
}

/** CPF sintético válido livre no profissional e na pessoa. */
export async function cpfLivreProfissional(l: L, semente: number): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const cpf = cpfComDigitos(String(910_000_000 + ((semente + i * 7919) % 89_999_999)).padStart(9, '0'));
    if (
      (await n(l, 'SELECT COUNT(*) N FROM TBPROFIS WHERE CNPJ_CPF = ?', [Number(cpf)])) === 0 &&
      (await n(l, 'SELECT COUNT(*) N FROM TBPESSOA WHERE CPF_CNPJ = ?', [cpf])) === 0
    )
      return cpf;
  }
  throw new Error('Nenhum CPF sintético livre.');
}

/** Número de conselho sintético livre (acima de 990 milhões). */
export async function numeroConselhoLivre(l: L): Promise<number> {
  for (let x = 990_000_000 + (Date.now() % 9_000_000); ; x++)
    if ((await n(l, 'SELECT COUNT(*) N FROM TBCBOPRO WHERE COD = ?', [x])) === 0) return x;
}

/** O CBO do médico clínico (225125). */
export async function cboMedicoClinico(l: L): Promise<number> {
  const [x] = await l.consultar("SELECT FIRST 1 ID FROM TBCBOSUS WHERE COD STARTING WITH '225125'", [], {
    teto: 1,
  });
  return num(x?.['ID']);
}

/** O número no conselho do registro. */
export const numeroDoRegistro = (l: L, registro: number) =>
  n(l, 'SELECT COD N FROM TBCBOPRO WHERE ID = ?', [registro]);

/** Outra ocupação de médico (CBO 225…, diferente de `exceto`): o mesmo CRM em duas ocupações. */
export async function cboMedicoOutro(l: L, exceto: number): Promise<number> {
  const [x] = await l.consultar(
    "SELECT FIRST 1 ID FROM TBCBOSUS WHERE COD STARTING WITH '225' AND COD <> '225125' AND ID <> ? ORDER BY COD",
    [exceto],
    { teto: 1 },
  );
  return num(x?.['ID']);
}

/**
 * Login único (só leitura, agregados): quantos logins ligados (papel 4 ativo), quantos profissionais com mais de um
 * registro real e quantos com logins DIFERENTES em registros diferentes (o dado herdado que a tela avisa).
 */
export async function medidaLoginUnico(
  l: L,
): Promise<{ logins: number; variosRegistros: number; variosLogins: number }> {
  return {
    logins: await n(
      l,
      "SELECT COUNT(DISTINCT up.USUARIO) N FROM TBUSERS_TBPAPEL up WHERE up.ID_TBPAPEL = 4 AND up.ATIVO = 'T' AND up.ID_TBCBOPRO IS NOT NULL",
      [],
    ),
    variosRegistros: await n(
      l,
      `SELECT COUNT(*) N FROM (SELECT c.ID_TBPROFIS FROM TBCBOPRO c JOIN TBCBOSUS b ON b.ID = c.ID_TBCBOSUS
          WHERE b.COD <> '000000' GROUP BY c.ID_TBPROFIS HAVING COUNT(*) > 1)`,
      [],
    ),
    variosLogins: await n(
      l,
      `SELECT COUNT(*) N FROM (SELECT c.ID_TBPROFIS FROM TBUSERS_TBPAPEL up JOIN TBCBOPRO c ON c.ID = up.ID_TBCBOPRO
          WHERE up.ID_TBPAPEL = 4 AND up.ATIVO = 'T' GROUP BY c.ID_TBPROFIS HAVING COUNT(DISTINCT up.USUARIO) > 1)`,
      [],
    ),
  };
}

/** Linhas mantidas pelo cadastro (CBO 000000) e retratos HTPROFIS do profissional. */
export async function efeitosDaInclusao(l: L, p: number): Promise<{ sombra: number; retratos: number }> {
  return {
    sombra: await n(
      l,
      "SELECT COUNT(*) N FROM TBCBOPRO c JOIN TBCBOSUS b ON b.ID = c.ID_TBCBOSUS WHERE c.ID_TBPROFIS = ? AND b.COD = '000000'",
      [p],
    ),
    retratos: await n(l, 'SELECT COUNT(*) N FROM HTPROFIS WHERE ID_TBPROFIS = ?', [p]),
  };
}

/** Um registro real de outro profissional sem login ligado. */
export async function registroDeOutroSemLogin(
  l: L,
  p: number,
): Promise<{ registro: number; profissional: number }> {
  const [x] = await l.consultar(
    `SELECT FIRST 1 c.ID, c.ID_TBPROFIS P FROM TBCBOPRO c JOIN TBCBOSUS b ON b.ID = c.ID_TBCBOSUS
      WHERE c.ID_TBPROFIS > 2 AND c.ID_TBPROFIS <> ? AND b.COD <> '000000'
        AND NOT EXISTS (SELECT 1 FROM TBUSERS_TBPAPEL u WHERE u.ID_TBCBOPRO = c.ID) ORDER BY c.ID DESC`,
    [p],
    { teto: 1 },
  );
  return { registro: num(x?.['ID']), profissional: num(x?.['P']) };
}

export const eventosDoLogin = (l: L, p: number) =>
  n(l, "SELECT COUNT(*) N FROM SGH_CAD_PROF_EVENTO WHERE ID_TBPROFIS = ? AND EVENTO STARTING WITH 'login-'", [
    p,
  ]);

/** Registros (inclusive o mantido pelo cadastro) ativos do profissional. */
export const registrosAtivos = (l: L, p: number) =>
  n(l, "SELECT COUNT(*) N FROM TBCBOPRO WHERE ID_TBPROFIS = ? AND COALESCE(ATIVO, 'T') <> 'F'", [p]);

/** O profissional real do atendimento mais recente (tem atos). */
export async function profissionalComAtos(l: L): Promise<number> {
  const [x] = await l.consultar(
    `SELECT FIRST 1 c.ID_TBPROFIS P FROM ATCABECATEND x JOIN TBCBOPRO c ON c.ID = x.ID_TBCBOPRO_ATENDIMENTO
      WHERE c.ID_TBPROFIS > 2 ORDER BY x.ID DESC`,
    [],
    { teto: 1 },
  );
  return num(x?.['P']);
}

export const profissionalExiste = (l: L, p: number) =>
  n(l, 'SELECT COUNT(*) N FROM TBPROFIS WHERE ID = ?', [p]);

/** O que sobra do profissional depois da exclusão (cadastro, registros, retratos e histórico do registro). */
export async function sobraDoProfissional(l: L, p: number): Promise<number> {
  return (
    (await n(l, 'SELECT COUNT(*) N FROM TBPROFIS WHERE ID = ?', [p])) +
    (await n(l, 'SELECT COUNT(*) N FROM TBCBOPRO WHERE ID_TBPROFIS = ?', [p])) +
    (await n(l, 'SELECT COUNT(*) N FROM HTPROFIS WHERE ID_TBPROFIS = ?', [p])) +
    (await n(l, 'SELECT COUNT(*) N FROM HTTBCBOPRO WHERE ID_TBPROFIS = ?', [p]))
  );
}

export async function pessoaDoProfissional(l: L, p: number): Promise<number> {
  const [x] = await l.consultar('SELECT ID_TBPESSOA P FROM TBPROFIS WHERE ID = ?', [p], { teto: 1 });
  return num(x?.['P']);
}
export const pessoaExiste = (l: L, id: number) => n(l, 'SELECT COUNT(*) N FROM TBPESSOA WHERE ID = ?', [id]);
export const retratosDeExclusao = (l: L) => n(l, 'SELECT COUNT(*) N FROM SGH_HIST_EXCLUSAO');
export const registrosNaUf = (l: L, p: number, uf: string) =>
  n(l, 'SELECT COUNT(*) N FROM TBCBOPRO WHERE ID_TBPROFIS = ? AND UF = ?', [p, uf]);

/**
 * O registro encerrado por fora (o programa anterior grava ATIVO 'F' no registro sem passar pelo Sante): todos os
 * registros do profissional ficam inativos, sem evento do Sante. Só na transação desfeita da integração.
 */
export async function encerrarRegistrosPorFora(e: Escritor, p: number): Promise<void> {
  await e.executar("UPDATE TBCBOPRO SET ATIVO = 'F' WHERE ID_TBPROFIS = ?", [p]);
}

/**
 * A trilha do legado ligada à SGH_TRILHA da gravação: o evento tipo 17 (gerenciamento de usuários, opção 5435) com o
 * usuário afetado (TBUSERS.ID_TBUSERS do login) no detalhe, como as gravações de acesso em TBUSERS_TBPAPEL. Contagem.
 */
export const eventoLegadoNoUsuario = (l: L, trilha: string | null, login: string) =>
  n(
    l,
    `SELECT COUNT(*) N FROM SGH_TRILHA t JOIN TBCABTRILHA c ON c.ID = t.ID_TBCABTRILHA
       JOIN TBLANTRILHASGH d ON d.ID_TBCABTRILHA = c.ID
      WHERE t.ID = ? AND c.ID_TBTPACAOAUDIT = 17 AND c.ID_TBOPCOES = 5435
        AND d.TABELA_CAMPO = 'TBUSERS.ID_TBUSERS'
        AND d.ID_TABELA = (SELECT ID_TBUSERS FROM TBUSERS WHERE NOME = ?)`,
    [trilha, login],
  );
