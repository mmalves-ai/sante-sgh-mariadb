// Massa sintética de preços (M12; F2.2, lote 05-06): o lote marcado e a entrada de `preco.reajustar` montada a
// partir de itens que o chamador escolheu no banco do cliente de teste (pela porta própria de preços). PURO: nenhuma
// consulta aqui; a escolha dos itens e a prova do efeito ficam na integração do módulo de preços, sobre o MariaDB.
// Melhoria: sem escrita "por fora" para preparar recusa (o modelo recusa pelas restrições e pelo domínio) e sem a
//   regra de valor vigente reescrita em SQL: o vigente vem da porta própria.
// Melhoria: a entrada gerada é conferida pelo esquema do contrato (esquemaReajustar) no teste de unidade.
import type { ComponentesPreco, ReajustarEntrada } from '@sgh/contratos';

export const MARCA_M12 = 'SGH M12 SINTETICO';

let seq = 0;
/** Identificador de lote sintético único (até 40 caracteres). */
export const loteSintetico = (prefixo: string): string =>
  `${prefixo}-${Date.now().toString(36)}-${(seq++).toString(36)}`.slice(0, 40);

export interface ItemSintetico {
  readonly codigo: number;
  /** Data ISO da vigência atual do item; null quando o item ainda não tem vigência. */
  readonly vigencia: string | null;
  readonly valores: ComponentesPreco;
}

/** Entrada de `preco.reajustar` para os itens (percentual de 5% ou valores por arquivo). */
export function entradaReajuste(
  tabela: number,
  data: string,
  itens: readonly ItemSintetico[],
  modo: 'percentual' | 'arquivo',
  confirmacoes: { tabelaCompartilhada: boolean; percentualTabela: boolean } = {
    tabelaCompartilhada: false,
    percentualTabela: false,
  },
): ReajustarEntrada {
  return {
    tabela,
    data,
    lote: loteSintetico('repro'),
    parte: 1,
    partes: 1,
    modo,
    percentual: modo === 'percentual' ? 5 : null,
    origem: modo === 'arquivo' ? 'importacao' : 'reajuste',
    carga: null,
    justificativa: `${MARCA_M12}: reprodução do cenário de reajuste`,
    confirmacoes,
    itens: itens.map((i) => ({
      codigo: i.codigo,
      base: i.vigencia ? { vigencia: i.vigencia, valores: i.valores } : null,
      novos: {
        ...i.valores,
        ch: modo === 'percentual' ? Math.round(i.valores.ch * 1.05 * 100) / 100 : i.valores.ch + 1.2345,
      },
    })),
  };
}
