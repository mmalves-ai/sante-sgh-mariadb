// Regra 14 do M32 (cap-06b §6.8; Anexo A §A.6): o movimento bancário com domínio fechado e as mesmas letras.
// MFLANCTO.TIPO_TRF: O 18.902 (outros: tarifas, aplicações) · I 9.753 (importado do extrato) · F 5.048 (fechamento de
// caixa) · vazio 2.512 (crédito não identificado) · T 95 (transferência) · C 65 · D 9 (crédito e débito avulsos) · S 1.
// I, T, C e D com a legenda "a confirmar" até a DP-46.4. O novo grava O, F, T, C e D; o crédito não identificado vai
// para a fila SGH_FIN_CREDITO_PENDENTE até a atribuição.
import { recusaFin, type RecusaFinanceiro } from './recusa.js';

export const TIPOS_MOVIMENTO_GRAVADOS = ['O', 'F', 'T', 'C', 'D'] as const;
export type TipoMovimento = (typeof TIPOS_MOVIMENTO_GRAVADOS)[number];

export const ROTULO_TIPO_MOVIMENTO: Readonly<Record<string, string>> = {
  O: 'Outros (tarifas, aplicações)',
  F: 'Fechamento de caixa',
  T: 'Transferência (a confirmar)',
  C: 'Crédito avulso (a confirmar)',
  D: 'Débito avulso (a confirmar)',
  I: 'Importado do extrato (a confirmar)',
  '': 'Crédito não identificado',
  S: 'Outro (visto 1 vez)',
};

export const CENARIO_DO_TIPO: Readonly<Record<TipoMovimento, string>> = {
  O: 'tarifa',
  F: 'fechamento-caixa',
  T: 'transferencia',
  C: 'credito-avulso',
  D: 'debito-avulso',
};

export const ehTipoMovimento = (t: string): t is TipoMovimento =>
  (TIPOS_MOVIMENTO_GRAVADOS as readonly string[]).includes(t);

export interface MovimentoInformado {
  readonly tipo: string;
  /** Conta que recebe (crédito: o dinheiro entra), TBCTABAN.ID. */
  readonly contaCredito: number | null;
  /** Conta que paga (débito: o dinheiro sai), TBCTABAN.ID. */
  readonly contaDebito: number | null;
  readonly valor: number;
  readonly historico: string;
}

/**
 * Quais contas cada tipo usa (visão do extrato: a conta de crédito é a que recebe; o crédito não identificado do outro
 * sistema está todo na conta de crédito, 2.511 de 2.512): T e F movimentam as duas, diferentes; C exige a que recebe;
 * D exige a debitada; O (tarifas, aplicações) uma ou as duas (a aplicação tem contrapartida). A contrapartida opcional
 * de C e D existe no perfil (C: 60 de 65 com a conta de débito) e é aceita.
 */
export function conferirMovimento(m: MovimentoInformado): RecusaFinanceiro | null {
  if (!ehTipoMovimento(m.tipo))
    return recusaFin('tipo-movimento-invalido', 'Escolha um tipo de movimento da lista.', ['tipo']);
  if (!(m.valor > 0)) return recusaFin('valor-obrigatorio', 'Informe o valor do movimento.', ['valor']);
  if (!m.historico.trim()) return recusaFin('historico-obrigatorio', 'Informe o histórico.', ['historico']);
  const cre = m.contaCredito ?? 0;
  const dev = m.contaDebito ?? 0;
  if (cre && dev && cre === dev)
    return recusaFin('mesma-conta', 'A conta que recebe e a debitada são a mesma.', ['contaCredito']);
  if (m.tipo === 'T' || m.tipo === 'F') {
    if (!cre || !dev)
      return recusaFin('contas-obrigatorias', 'Informe a conta de origem e a de destino.', [
        'contaCredito',
        'contaDebito',
      ]);
    return null;
  }
  if (m.tipo === 'C' && !cre)
    return recusaFin('conta-obrigatoria', 'Informe a conta que recebe o crédito.', ['contaCredito']);
  if (m.tipo === 'D' && !dev)
    return recusaFin('conta-obrigatoria', 'Informe a conta debitada.', ['contaDebito']);
  if (!cre && !dev)
    return recusaFin('uma-conta', 'Informe ao menos a conta movimentada.', ['contaCredito', 'contaDebito']);
  return null;
}

/** As contas do movimento estão no escopo do usuário (MFCTAUSU; regra 15)? */
export function contasNoEscopo(
  m: Pick<MovimentoInformado, 'contaCredito' | 'contaDebito'>,
  escopo: readonly number[] | null,
): boolean {
  if (escopo === null) return true;
  return [m.contaCredito, m.contaDebito].every((c) => !c || escopo.includes(c));
}

/** Efeito do movimento no saldo de uma conta: + crédito, − débito. */
export function efeitoNoSaldo(
  m: { contaCredito: number | null; contaDebito: number | null; valor: number },
  conta: number,
): number {
  return (m.contaCredito === conta ? m.valor : 0) - (m.contaDebito === conta ? m.valor : 0);
}
