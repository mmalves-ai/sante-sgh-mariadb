// Cópia e renovação (regra 3 da ficha do M24; cap-05b §5.7): copiar a anterior, inclusive feita no outro sistema,
// nunca copia sem confirmação item a item; a origem é relida na gravação: item suspenso depois da abertura da tela
// não é copiado (o usuário é avisado); item cuja regra de alerta mudou desde a prescrição de origem é reavaliado.

export interface ItemDeOrigem {
  readonly id: number;
  readonly ativo: boolean;
  /** Versões das regras de alerta vigentes quando o item foi prescrito (vazio: feito no outro sistema). */
  readonly versoesRegras: Readonly<Record<string, number>>;
}

export interface Revisao {
  /** Itens confirmados que seguem para a prescrição nova. */
  readonly copiar: readonly number[];
  /** Itens confirmados que mudaram na origem depois da abertura da tela (suspensos): não copiados, com aviso. */
  readonly mudaramNaOrigem: readonly number[];
  /** Itens confirmados com regra de alerta mais nova que a da origem: reavaliar antes de assinar. */
  readonly reavaliar: readonly number[];
}

export function revisarCopia(
  confirmados: readonly number[],
  vistosNaTela: readonly ItemDeOrigem[],
  relidos: readonly ItemDeOrigem[],
  regrasVigentes: Readonly<Record<string, number>>,
): Revisao {
  const copiar: number[] = [];
  const mudaram: number[] = [];
  const reavaliar: number[] = [];
  const naTela = new Map(vistosNaTela.map((x) => [x.id, x]));
  const agora = new Map(relidos.map((x) => [x.id, x]));
  for (const id of new Set(confirmados)) {
    const antes = naTela.get(id);
    const depois = agora.get(id);
    if (!antes || !depois) {
      mudaram.push(id);
      continue;
    }
    if (antes.ativo !== depois.ativo || !depois.ativo) {
      mudaram.push(id);
      continue;
    }
    copiar.push(id);
    const mudouRegra = Object.entries(regrasVigentes).some(
      ([codigo, v]) => (depois.versoesRegras[codigo] ?? 0) < v,
    );
    if (mudouRegra) reavaliar.push(id);
  }
  return { copiar, mudaramNaOrigem: mudaram, reavaliar };
}

/** Classe da coluna do item copiado: mantido igual copia a origem; alterado é entrada (regra da assinatura). */
export function classeDoItemCopiado(alterado: boolean, coluna: string): string {
  return alterado ? 'entrada' : `copia:prescricao_item.${coluna}`;
}
