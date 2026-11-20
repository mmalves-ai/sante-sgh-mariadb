// O outro sistema marcando por fora um horário da prescrição como NÃO ADMINISTRADO (integração do M48.2, sugestão
// automática), sempre na transação desfeita da integração: o UPDATE direto da PRCHKGERAL, como a tela de checagem do
// outro sistema faz, pelo cadastro profissional (TBCBOPRO) de uma conta real da cópia. Nenhuma receita do novo faz este
// comando; o login sai só em memória.
import { condicaoLoginDoProfissional, type Escritor } from '@sgh/legado';

/** Marca um horário pendente como não administrado há 2 horas (previsto há 3); devolve o horário e o login. */
export async function doseNaoAdministradaPorFora(e: Escritor): Promise<{ horario: number; login: string }> {
  const [h] = await e.consultar(
    `SELECT FIRST 1 k.ID FROM PRCHKGERAL k WHERE k.SITUACAO_CHECAGEM = 'P' AND k.ID_PRLANGERAL IS NOT NULL`,
    [],
    { teto: 1, tempoMaximoMs: 30_000 },
  );
  const [p] = await e.consultar(
    `SELECT FIRST 1 c.ID, TRIM(u.NOME) U FROM TBCBOPRO c JOIN TBPROFIS p ON p.ID = c.ID_TBPROFIS
       JOIN TBUSERS u ON ${condicaoLoginDoProfissional('p').replace(/\?/g, 'u.NOME')}
      WHERE COALESCE(c.ATIVO, 'T') <> 'F'`,
    [],
    { teto: 1, tempoMaximoMs: 30_000 },
  );
  const horario = Number(h?.['ID'] ?? 0);
  const login = String(p?.['U'] ?? '');
  if (horario <= 0 || login === '')
    throw new Error('A cópia não tem horário pendente ou profissional com login.');
  await e.executar(
    `UPDATE PRCHKGERAL SET SITUACAO_CHECAGEM = 'N', ID_TBCBOPRO_SITUACAO_CHECAGEM = ?,
        DATA_HORA_CHECAR = DATEADD(-3 HOUR TO CURRENT_TIMESTAMP),
        DATA_HORA_SITUACAO_CHECAGEM = DATEADD(-2 HOUR TO CURRENT_TIMESTAMP)
      WHERE ID = ?`,
    [Number(p?.['ID']), horario],
  );
  return { horario, login };
}
