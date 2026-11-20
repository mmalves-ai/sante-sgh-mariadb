// O outro sistema gravando por fora no atendimento (integração do M20), sempre na transação desfeita da integração:
// o balcão altera a observação da ficha (o gatilho recarimba DATA_HORA_ULTIMA_ATUALIZACAO, como na alteração do
// outro sistema) e alguém tenta trocar o código de um leito de observação (o gatilho do leito recusa: a chave natural
// do mapa de leitos não muda). Nenhuma receita do novo faz estes comandos.
import type { Escritor } from '@sgh/legado';

/** O outro sistema altera a mesma ficha (a observação), depois de a tela do novo ter lido o carimbo. */
export async function outroSistemaAlteraAFicha(e: Escritor, reg: number): Promise<void> {
  const k = await e.executar("UPDATE RECADATE SET OBS = 'ALTERADA NO BALCAO (M20 SINTETICO)' WHERE REG = ?", [
    reg,
  ]);
  if (k !== 1) throw new Error('Ficha não alterada pelo outro sistema simulado.');
}

/** A troca do código de um leito de observação, que o gatilho do banco recusa: devolve o erro do banco. */
export async function outroSistemaTrocaOCodigoDoLeito(e: Escritor): Promise<unknown> {
  try {
    await e.executar("UPDATE RELEITO SET COD_LEITO = 'Z9' WHERE ID = (SELECT MIN(ID) FROM RELEITO)", []);
    return null;
  } catch (x) {
    return x;
  }
}
