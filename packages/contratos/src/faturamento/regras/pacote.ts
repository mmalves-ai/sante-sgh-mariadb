// Pacote (ficha do M30, regra 10; Anexo A; cap-06b §6.5): marca de pacote da conta C = conta por pacote (o total é o do pacote,
// menor que a soma dos itens); no item, S incluso no pacote, X excluído (cobrado fora); P, D e F "a confirmar"
// (DP-46.5). O novo confere a conta pacote contra o pacote vigente do contrato (SGH_FAT_PACOTE) sem mudar o cálculo.

export interface LegendaCodigo {
  readonly rotulo: string;
  readonly aConfirmar: boolean;
}

export function legendaPacoteConta(pacote: string | null | undefined): LegendaCodigo {
  switch ((pacote ?? '').trim().toUpperCase()) {
    case '':
    case 'N':
      return { rotulo: 'Sem pacote', aConfirmar: false };
    case 'C':
      return { rotulo: 'Conta por pacote', aConfirmar: false };
    case 'P':
    case 'D':
    case 'F':
      return { rotulo: `Pacote ${(pacote ?? '').trim().toUpperCase()} (a confirmar)`, aConfirmar: true };
    default:
      return { rotulo: `Código ${(pacote ?? '').trim()} (a confirmar)`, aConfirmar: true };
  }
}

export function legendaPacoteItem(pacote: string | null | undefined): LegendaCodigo {
  switch ((pacote ?? '').trim().toUpperCase()) {
    case '':
    case 'N':
      return { rotulo: 'Fora de pacote', aConfirmar: false };
    case 'S':
      return { rotulo: 'Incluso no pacote', aConfirmar: false };
    case 'X':
      return { rotulo: 'Excluído do pacote (cobrado à parte)', aConfirmar: false };
    default:
      return { rotulo: `Código ${(pacote ?? '').trim()} (a confirmar)`, aConfirmar: true };
  }
}

export const ehContaPacote = (pacote: string | null | undefined): boolean =>
  (pacote ?? '').trim().toUpperCase() === 'C';

export interface PacoteVigente {
  readonly valor: number;
  /** Códigos (procedimento ou item) incluídos no pacote. */
  readonly inclusos: readonly number[];
}

export interface ConferenciaPacote {
  readonly confere: boolean;
  readonly avisos: readonly string[];
}

/** Confere a conta pacote: o total contra o valor do pacote; item incluso fora do pacote e excluído dentro viram aviso. */
export function conferirContaPacote(
  conta: { readonly totalConta: number },
  itens: readonly { readonly codigo: number; readonly pacote: string | null }[],
  pacote: PacoteVigente | null,
): ConferenciaPacote {
  if (!pacote)
    return { confere: false, avisos: ['Nenhum pacote vigente cadastrado para conferir esta conta.'] };
  const avisos: string[] = [];
  if (Math.abs(conta.totalConta - pacote.valor) > 0.005)
    avisos.push(`O total da conta difere do valor do pacote (${pacote.valor.toFixed(2)}).`);
  const inclusos = new Set(pacote.inclusos);
  for (const i of itens) {
    const p = (i.pacote ?? '').trim().toUpperCase();
    if (inclusos.has(i.codigo) && p !== 'S')
      avisos.push(`O item ${i.codigo} é do pacote e foi cobrado à parte.`);
    if (!inclusos.has(i.codigo) && p === 'S')
      avisos.push(`O item ${i.codigo} está marcado como incluso, mas não é do pacote.`);
  }
  return { confere: avisos.length === 0, avisos };
}
