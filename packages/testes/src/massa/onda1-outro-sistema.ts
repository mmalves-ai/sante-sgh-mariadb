// Escritas fora do executor da integração do M39 (onda 1), sempre na transação DESFEITA da integração:
//   - a tentativa de gravar em SGH_CFG_COEX_LIGAR o que o contrato já recusa (o item calculado, o cumprido sem data),
//     para provar que o CHECK do banco também recusa;
//   - o outro sistema simulado esvaziando uma coluna imutável de uma gravação do novo (a gravação adulterada que a
//     vigilância diária tem de apontar).
// Nomes de tabela e coluna conferidos pelo padrão do Firebird; nenhum valor de linha volta.
import type { Escritor } from '@sgh/legado';

const NOME = /^[A-Z][A-Z0-9_]{0,30}$/;

/** INSERT direto em SGH_CFG_COEX_LIGAR (passando por fora do contrato), para o CHECK do banco recusar. */
export function gravarItemLigarPorFora(
  e: Escritor,
  hospital: string,
  item: string,
  situacao: string,
  em: string | null,
): Promise<number> {
  return e.executar(
    `INSERT INTO SGH_CFG_COEX_LIGAR (HOSPITAL, SETOR, ITEM, SITUACAO, EVIDENCIA, EM, ALTERADO_POR)
     VALUES (?, 'agendamento', ?, ?, 'ata 1', CAST(CAST(? AS VARCHAR(10)) AS DATE), 'SGH.TESTE')`,
    [hospital, item, situacao, em],
  );
}

/** O outro sistema simulado esvazia a coluna de uma linha (pela chave); devolve as linhas afetadas. */
export function outroSistemaEsvaziaColuna(
  e: Escritor,
  tabela: string,
  coluna: string,
  chave: string,
  id: number,
): Promise<number> {
  if (![tabela, coluna, chave].every((x) => NOME.test(x))) throw new Error('nome de estrutura inválido');
  return e.executar(`UPDATE ${tabela} SET "${coluna}" = NULL WHERE ${chave} = ?`, [id]);
}
