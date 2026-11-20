// Gravações "pelo outro sistema" do M23 (ficha, seção 10: leitura incremental de parecer e de liberação feitos pelo
// legado, simulados por SQL de teste na cópia), sempre na transação desfeita da integração. Só dados sintéticos: a
// cópia do pedido de parecer reaproveita os retratos e o profissional de um pedido existente, sem conteúdo.
import type { Escritor } from '@sgh/legado';

/** Um pedido de parecer novo, como o executável grava (cópia do cabeçalho de um pedido existente). */
export async function gravarPedidoDeParecerComoOLegado(e: Escritor, base: number): Promise<number> {
  return e.executar(
    `INSERT INTO PRCABEVOL (ID_CABEVOL, ID_HTATENDIMENTO, ID_HTPACIENTE, ID_EVOLUCAO, DATA_HORA_EVOLUCAO,
       ID_TBCBOPRO_EVOLUCAO, DATA_HORA_LANCAMENTO)
     SELECT 0, ID_HTATENDIMENTO, ID_HTPACIENTE, ID_EVOLUCAO, CURRENT_TIMESTAMP, ID_TBCBOPRO_EVOLUCAO, CURRENT_TIMESTAMP
       FROM PRCABEVOL WHERE ID_CABEVOL = ?`,
    [base],
  );
}

/** O valor de um resultado liberado alterado pelo outro sistema (a liberação lida pelo novo na leitura). */
export async function liberarValorComoOLegado(
  e: Escritor,
  resultado: number,
  valor: number,
): Promise<number> {
  return e.executar('UPDATE SIRES01 SET NUMERICO = ? WHERE ID = ?', [valor, resultado]);
}
