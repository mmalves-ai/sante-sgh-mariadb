// O outro sistema "por fora" no painel de migração (integração do M37), sempre na transação desfeita da integração:
// a conexão de um usuário sintético num módulo (a tabela de conexões guarda só a ÚLTIMA por usuário e módulo; o outro
// sistema a regrava a cada login) e a senha emitida no balcão (como o check-in da recepção grava). Nenhuma receita do
// novo faz estes comandos; nada sai da transação.
import type { Escritor } from '@sgh/legado';

/** O outro sistema registra a conexão do login no módulo (a última, `segundos` depois de agora). */
export async function outroSistemaConecta(
  e: Escritor,
  login: string,
  modulo: number,
  segundos = 0,
): Promise<void> {
  const n = await e.executar(
    'UPDATE TBSGHCONEXAO SET DATA_ULTIMA_CONEXAO = DATEADD(? SECOND TO CURRENT_TIMESTAMP) WHERE USUARIO = ? AND MODULO = ?',
    [segundos, login, modulo],
  );
  if (n === 0)
    await e.executar(
      'INSERT INTO TBSGHCONEXAO (MODULO, USUARIO, DATA_ULTIMA_CONEXAO) VALUES (?, ?, DATEADD(? SECOND TO CURRENT_TIMESTAMP))',
      [modulo, login, segundos],
    );
}

/** O outro sistema emite uma senha no balcão (a linha do dia, sem atendimento ligado; o número escolhido pelo teste). */
export async function outroSistemaEmiteSenha(e: Escritor, usuario: string, numero: number): Promise<number> {
  const [g] = await e.consultar('SELECT FIRST 1 ID FROM TBGERASENHA ORDER BY ID', [], { teto: 1 });
  if (!g) throw new Error('Nenhum gerador de senha na cópia.');
  const s = await e.executarRetornando(
    'INSERT INTO TBSENHAATEND (ID, ID_TBGERASENHA, SENHA, USUARIO) VALUES (0, ?, ?, ?) RETURNING ID',
    [Number(g['ID']), numero, usuario],
  );
  return Number(s['ID']);
}

/** As primeiras opções ativas do menu (só os IDs, em memória). */
export async function opcoesAtivas(e: Escritor, n: number): Promise<number[]> {
  const linhas = await e.consultar(
    `SELECT FIRST ${Math.trunc(n)} ID FROM TBOPCOES WHERE ATIVO = 'T' ORDER BY ID`,
    [],
    {
      teto: n,
    },
  );
  return linhas.map((x) => Number(x['ID']));
}

/** As opções que o grupo tem hoje (só os IDs). */
export async function opcoesDoGrupo(e: Escritor, grupo: string): Promise<number[]> {
  const linhas = await e.consultar(
    'SELECT ID_TBOPCOES FROM TBPERUSU WHERE GRUPO = ? ORDER BY ID_TBOPCOES',
    [grupo],
    {
      teto: 2_000,
    },
  );
  return linhas.map((x) => Number(x['ID_TBOPCOES']));
}
