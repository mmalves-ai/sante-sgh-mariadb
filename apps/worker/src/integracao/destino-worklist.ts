// Lista de trabalho DICOM (05-SADT linha 20): a função vale para todos, sem chave de liberação (só a permissão do cargo na
// API). O que decide se o worker gera e envia itens é a CONFIGURAÇÃO DO DESTINO DE CADA ESTABELECIMENTO: o parâmetro
// `pacs.parceiroWorklist` do estabelecimento diz qual parceiro de integração recebe a lista de trabalho dele, e esse
// parceiro precisa estar ativo e assinar o evento da lista (o PACS em produção; o simulador fora dela). O parceiro é do
// cliente inteiro, mas o destino é por estabelecimento: a modalidade do hospital A nunca recebe paciente do hospital B.
// Sem destino no estabelecimento, nada é gerado nem enviado (dado do paciente nunca sai sem para onde ir).
import { EVENTO_OUTBOX_MWL, PARAMETRO_PARCEIRO_WORKLIST } from '@sgh/contratos';
import type { Leitor } from '@sgh/nucleo';
import { idDoEstabelecimento, valorDoParametro } from '../clientes-worker.js';
import { lerParceiros } from './porta-propria.js';

/** O parceiro que pode receber a lista de trabalho (o que a porta própria lê do cadastro). */
export interface ParceiroDoDestino {
  readonly codigo: string;
  readonly ativo: boolean;
  readonly eventos: readonly string[];
}

/**
 * Pura: o código do parceiro que recebe a lista de trabalho do estabelecimento, ou null. Vale só o parceiro configurado
 * no estabelecimento, ativo e com o evento da lista; nenhum outro parceiro do cliente serve de destino.
 */
export function destinoDaWorklist(
  parceiros: readonly ParceiroDoDestino[],
  configurado: string | null,
): string | null {
  const alvo = (configurado ?? '').trim();
  if (!alvo) return null;
  const p = parceiros.find((x) => x.codigo === alvo);
  return p && p.ativo && p.eventos.includes(EVENTO_OUTBOX_MWL) ? p.codigo : null;
}

/** O parceiro configurado (parâmetro do estabelecimento), sem conferir o cadastro; null sem valor. */
export async function parceiroConfiguradoNoEstabelecimento(
  l: Leitor,
  cod: string,
  agora: Date,
): Promise<string | null> {
  const id = await idDoEstabelecimento(l, cod);
  if (id === null) return null;
  const v = await valorDoParametro(
    l,
    PARAMETRO_PARCEIRO_WORKLIST,
    // O parâmetro é só do nível do estabelecimento (sem valor da rede): o cliente não entra na escolha.
    { cliente: '', estabelecimento: { id, codigo: cod } },
    agora,
  );
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** O destino da lista de trabalho no estabelecimento: o parceiro configurado nele, ativo e com o evento; senão null. */
export async function destinoDaWorklistNoEstabelecimento(
  l: Leitor,
  cod: string,
  agora: Date,
): Promise<string | null> {
  const configurado = await parceiroConfiguradoNoEstabelecimento(l, cod, agora);
  if (!configurado) return null;
  return destinoDaWorklist(await lerParceiros(l), configurado);
}
