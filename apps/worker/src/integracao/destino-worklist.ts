// Lista de trabalho DICOM (05-SADT linha 20): a função vale para todos, sem chave de liberação (só a permissão do cargo na
// API). O que decide se o worker gera e envia itens é a CONFIGURAÇÃO DO DESTINO: um parceiro de integração ativo que
// recebe o evento da lista de trabalho (o PACS em produção; o simulador fora dela). Sem destino, nada é gerado nem
// enviado (dado do paciente nunca sai sem para onde ir); o modo e o endereço são os do cadastro do parceiro.
import { EVENTO_OUTBOX_MWL } from '@sgh/contratos';
import type { Leitor } from '@sgh/nucleo';
import { lerParceiros } from './porta-propria.js';

/** O parceiro que pode receber a lista de trabalho (o que a porta própria lê do cadastro). */
export interface ParceiroDoDestino {
  readonly ativo: boolean;
  readonly eventos: readonly string[];
}

/** Pura: existe destino configurado para a lista de trabalho (parceiro ativo com o evento da lista). */
export function worklistComDestino(parceiros: readonly ParceiroDoDestino[]): boolean {
  return parceiros.some((p) => p.ativo && p.eventos.includes(EVENTO_OUTBOX_MWL));
}

/** Lê o cadastro dos parceiros (do cliente inteiro) e confere o destino. */
export async function destinoDaWorklistConfigurado(l: Leitor): Promise<boolean> {
  return worklistComDestino(await lerParceiros(l));
}
