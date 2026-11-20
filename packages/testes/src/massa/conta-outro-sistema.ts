// O "outro sistema" por fora sobre a conta do paciente (M30; integração na cópia, sempre na transação desfeita): a
// alteração qualquer da conta (que recarimba DATA_HORA_ULTIMA_ATUALIZACAO pelo gatilho), para o fechamento concorrente,
// e o efeito que some depois da gravação (a situação volta), para a prova pós-escrita falhar. Só IDs; nada confirmado.
import type { Escritor } from '@sgh/legado';

/** Uma alteração sem mudar valor (o gatilho SGHI_BU recarimba a conta). */
export async function mexerNaContaPorFora(e: Escritor, conta: number): Promise<void> {
  await e.executar('UPDATE FCCTAEXT SET OCORRENCIA = OCORRENCIA WHERE ID = ?', [conta]);
}

/** O efeito da gravação some (a conta volta a aberta), como se o banco não tivesse gravado. */
export async function desfazerFechamentoPorFora(e: Escritor, conta: number): Promise<void> {
  await e.executar("UPDATE FCCTAEXT SET FECHADA = 'N' WHERE ID = ?", [conta]);
}
