// Massa do vigia do bloco (M46, etapa 2; correção do quadro em tempo real): o outro sistema simulado remarca para hoje
// um agendamento passado, SEMPRE na transação desfeita da cópia (nunca confirmada). Nada de pessoa é lido: só o ID.
import type { Escritor } from '@sgh/legado';

/** Move o agendamento passado mais recente para hoje às 23:59 (na transação desfeita); false se não há nenhum. */
export async function moverAgendamentoParaHojePorFora(e: Escritor): Promise<boolean> {
  const [x] = await e.consultar(
    'SELECT FIRST 1 ID FROM CCAGENDA WHERE DATA_HORA < CAST(CURRENT_DATE AS TIMESTAMP) ORDER BY DATA_HORA DESC',
    [],
    { teto: 1 },
  );
  if (!x) return false;
  await e.executar(
    "UPDATE CCAGENDA SET DATA_HORA = CAST(CAST(CURRENT_DATE AS VARCHAR(10)) || ' 23:59:00' AS TIMESTAMP) WHERE ID = ?",
    [x['ID']],
  );
  return true;
}
