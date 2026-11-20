// O outro sistema gravando por fora na internação (integração do M21), sempre na transação desfeita da integração:
// tenta abrir um segundo período de leito sem fechar o primeiro (o gatilho do período recusa). Nenhuma receita do novo
// faz este comando.
import type { Escritor } from '@sgh/legado';

/** O segundo período aberto da mesma internação, que o gatilho do banco recusa: devolve o erro do banco. */
export async function outroSistemaAbreSegundoPeriodo(e: Escritor, reg: number): Promise<unknown> {
  try {
    await e.executar(
      `INSERT INTO RICTRLOC (REG, BLOCO, ACOMOD, LEITO, ENTRADA, HORAENT, SAIDA, HORASAI, ID_TBTIPOACOMOD)
       SELECT REG, BLOCO, ACOMOD, LEITO, ENTRADA, HORAENT, SAIDA, HORASAI, ID_TBTIPOACOMOD FROM RICTRLOC
        WHERE REG = ? AND SAIDA = DATE '1899-12-30'`,
      [reg],
    );
    return null;
  } catch (x) {
    return x;
  }
}

/**
 * O outro sistema não conhece o estado do leito no novo: durante a gravação dele, o bloqueio do novo fica fora de vista
 * (`FIM_EM` preenchido) e volta logo depois (`reabrir`). Só tabela SGH_, na transação desfeita da integração.
 */
export async function estadoDoNovoFora(e: Escritor, id: number, reabrir = false): Promise<void> {
  await e.executar(
    `UPDATE SGH_INT_LEITO_ESTADO SET FIM_EM = ${reabrir ? 'NULL' : 'CURRENT_TIMESTAMP'}
      WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
    [String(id)],
  );
}

/**
 * A solicitação de limpeza como o outro sistema a deixa (a alta dada lá): sem etapa e sem o estado de higienização no
 * novo. Tira o que a receita do novo gravou em SGH_ para a mesma solicitação, na transação desfeita da integração.
 */
export async function limpezaComoDoOutroSistema(
  e: Escritor,
  hospital: string,
  solicitacao: number,
  leito: { bloco: string; acomodacao: string; leito: string },
): Promise<void> {
  await e.executar('DELETE FROM SGH_HOT_LIMPEZA_ETAPA WHERE HOSPITAL = ? AND ID_CHSOLICITLIMP = ?', [
    hospital,
    solicitacao,
  ]);
  await e.executar(
    `DELETE FROM SGH_INT_LEITO_ESTADO WHERE HOSPITAL = ? AND BLOCO = ? AND ACOMOD = ? AND LEITO = ?
      AND ESTADO = 'higienizacao'`,
    [hospital, leito.bloco, leito.acomodacao, leito.leito],
  );
}

/**
 * M44 (regra 12): o outro sistema não conhece a reserva do NIR: durante a gravação dele, a reserva vigente fica fora de
 * vista (cancelada, sem a chave do leito) e volta logo depois, ativa com a chave (`reabrir`). Só tabela SGH_, na
 * transação desfeita da integração.
 */
export async function reservaDoNovoFora(
  e: Escritor,
  reserva: number,
  chaveLeito: string,
  reabrir = false,
): Promise<void> {
  await e.executar(
    reabrir
      ? `UPDATE SGH_INT_RESERVA_LEITO SET SITUACAO = 'ativa', VIGENTE = ? WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`
      : `UPDATE SGH_INT_RESERVA_LEITO SET SITUACAO = 'cancelada', VIGENTE = NULL
          WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
    reabrir ? [chaveLeito, String(reserva)] : [String(reserva)],
  );
}
