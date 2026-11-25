// F7 (09-AREA linha 76): a crítica da restrição de cobertura e da compatibilidade em TODO caminho que inclui item na
// conta (kit, exames do pedido, baixa do estoque, gás medicinal, orçamento aprovado, regras comerciais e de acordo,
// pacote, entrada da conta e transferência entre contas), e não só no lançamento manual.
// Decisão: o lançamento automático segue a mesma regra do manual. O bloqueio da fonte pagadora RECUSA a operação inteira
// ('cobertura-restrita', nada é gravado) e diz o que fazer: registrar a exceção do atendimento na tela de cobertura,
// que libera o item e fica na trilha. Item pendente de exceção dentro da conta não existe (seria item proibido cobrado).
// A prescrição continua só com aviso (o ato assistencial nunca é impedido); quem esbarra é a cobrança.
import { instanteParaDataHora } from '@sgh/contratos';
import type { ResultadoCobertura } from '@sgh/dominio-faturamento';
import type { TxOperacao } from '@sgh/nucleo';
import { conferirCoberturaNoLancamento } from './restricao-cobertura-propria.js';

/** O que o caminho automático sabe do item que vai incluir na conta. */
export interface ItemContaParaCobertura {
  readonly conta: number;
  readonly item: number;
  /** Instante (Date ou ISO) ou data-hora local "AAAA-MM-DD HH:MM[:SS]" do estabelecimento. */
  readonly realizado: Date | string;
  readonly quantidade: number;
  readonly valorTotal?: number | null;
  readonly setor?: number | null;
  readonly profissional?: number | null;
  readonly tabela?: number | null;
}

const LOCAL = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/;

/** Data e hora locais do lançamento, no fuso do estabelecimento. */
export function dataHoraDoRealizado(
  realizado: Date | string,
  fuso: string | undefined,
): { data: string; hora: string } {
  if (typeof realizado === 'string') {
    const m = LOCAL.exec(realizado.trim());
    if (m) return { data: m[1]!, hora: m[2]! };
    if (/^\d{4}-\d{2}-\d{2}$/.test(realizado.trim())) return { data: realizado.trim(), hora: '00:00' };
    return instanteParaDataHora(new Date(realizado).toISOString(), fuso);
  }
  return instanteParaDataHora(realizado.toISOString(), fuso);
}

/**
 * Confere a cobertura do item antes de incluí-lo na conta, na mesma transação. O bloqueio recusa; alerta e liberação
 * por exceção voltam (o caminho pode levá-los à memória do item).
 */
export async function criticarCoberturaDoItemConta(
  tx: TxOperacao,
  est: number,
  i: ItemContaParaCobertura,
): Promise<ResultadoCobertura | null> {
  const fat = await tx.uma<Record<string, unknown>>(
    `SELECT f.grupo_faturamento_id AS grupo, e.fuso_horario AS fuso
       FROM item_faturavel f JOIN estabelecimento e ON e.id = ?
      WHERE f.id = ?`,
    [est, i.item],
  );
  if (!fat) return null;
  const { data, hora } = dataHoraDoRealizado(
    i.realizado,
    typeof fat['fuso'] === 'string' && fat['fuso'] ? fat['fuso'] : undefined,
  );
  return conferirCoberturaNoLancamento(tx, est, i.conta, {
    itemId: i.item,
    grupoId: fat['grupo'] == null ? null : Number(fat['grupo']),
    tabelaId: i.tabela ?? null,
    data,
    hora,
    setorId: i.setor ?? null,
    profissionalId: i.profissional ?? null,
    quantidade: i.quantidade,
    valorTotal: i.valorTotal ?? null,
    justificado: false,
  });
}
