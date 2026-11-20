// SAME e arquivo (M21; ficha, seção 5 e regra 10): um lugar por vez (a localização é o destino do último movimento não
// excluído), o movimento não se apaga (exclusão lógica, como os 839 casos do legado), não se recebe o que não foi
// enviado (vira ocorrência), o descarte só com o aval da comissão de revisão de prontuários (Lei 13.787/2018: padrão
// "não eliminar") e a cobrança da devolução pelo prazo.
export interface MovimentoArquivo {
  readonly id: number;
  /** 1 Registro, 2 Saída, 3 Devolução, 4 Descarte, 5 Transferência, 6 Recebimento. */
  readonly operacao: number;
  readonly origem: number;
  readonly destino: number;
  /** Instante (ms). */
  readonly em: number;
  readonly excluido: boolean;
}

/** O último movimento válido (não excluído) da conta: a localização atual. */
export function localizacaoAtual(movs: readonly MovimentoArquivo[]): MovimentoArquivo | null {
  const validos = movs.filter((m) => !m.excluido).sort((a, b) => a.em - b.em || a.id - b.id);
  return validos.at(-1) ?? null;
}

export interface PedidoMovimento {
  readonly operacao: number;
  readonly setorOrigem: number;
  readonly setorDestino: number;
  readonly avalComissao?: string | null;
}

/** A regra 10 sobre a localização atual: o código e a mensagem da recusa, ou null. */
export function conferirMovimentoArquivo(
  atual: Pick<MovimentoArquivo, 'operacao' | 'origem' | 'destino'> | null,
  p: PedidoMovimento,
): { codigo: string; mensagem: string } | null {
  if (p.operacao === 4 && !p.avalComissao)
    return { codigo: 'sem-aval', mensagem: 'O descarte exige o aval da comissão de revisão de prontuários.' };
  if (p.operacao === 1)
    return atual ? { codigo: 'ja-registrado', mensagem: 'A conta já está registrada no arquivo.' } : null;
  if (!atual) return { codigo: 'sem-registro', mensagem: 'A conta ainda não foi registrada no arquivo.' };
  if (atual.operacao === 4) return { codigo: 'descartado', mensagem: 'A conta foi descartada.' };
  if (p.operacao === 6) {
    if (![2, 3, 5].includes(atual.operacao) || atual.destino !== p.setorDestino)
      return {
        codigo: 'nao-enviado',
        mensagem: 'O volume não foi enviado a este setor: registre a ocorrência.',
      };
    return null;
  }
  if (atual.destino !== p.setorOrigem)
    return { codigo: 'outro-lugar', mensagem: 'O volume está em outro setor: um lugar por vez.' };
  return null;
}

/** Só o último movimento válido se desfaz (exclusão lógica). */
export function podeExcluir(movs: readonly MovimentoArquivo[], id: number): boolean {
  return localizacaoAtual(movs)?.id === id;
}

/** O volume está fora do SAME além do prazo de devolução (dias desde a saída)? */
export function devolucaoAtrasada(
  atual: Pick<MovimentoArquivo, 'operacao' | 'destino' | 'em'> | null,
  setorSame: number,
  prazoDias: number,
  agora: number,
): boolean {
  if (!atual || atual.operacao === 4 || atual.destino === setorSame) return false;
  return agora - atual.em > prazoDias * 86_400_000;
}

/** A leitura do código de barras da etiqueta: o número da conta (só dígitos, até 12). */
export function contaDoCodigoDeBarras(lido: string): number | null {
  const d = lido.replace(/\D/g, '');
  if (d.length < 1 || d.length > 12) return null;
  const n = Number(d);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
