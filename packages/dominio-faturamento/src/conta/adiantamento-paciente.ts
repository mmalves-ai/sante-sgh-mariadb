// F3.7 (06-FAT linha 39): adiantamento e caução do paciente particular e a conta corrente dele. Regras puras:
// - o recebimento (valor, forma, comprovante eletrônico, vedação da caução na urgência pela Lei 12.653/2012);
// - a aplicação do saldo na conta do paciente, do adiantamento mais antigo para o mais novo, sem passar do saldo
//   nem do que a conta ainda deve;
// - a devolução do saldo não usado (favorecido, valor até o saldo);
// - a situação do adiantamento pelo saldo;
// - o extrato da conta corrente do paciente (créditos e débitos em ordem, com o saldo corrido).
// Nada é apagado: o estorno de uma aplicação devolve o valor ao saldo e fica marcado.

export const TIPOS_ADIANTAMENTO = ['adiantamento', 'caucao'] as const;
export type TipoAdiantamento = (typeof TIPOS_ADIANTAMENTO)[number];

export const FORMAS_ADIANTAMENTO = [
  'dinheiro',
  'pix',
  'cartao_credito',
  'cartao_debito',
  'transferencia',
  'cheque',
] as const;
export type FormaAdiantamento = (typeof FORMAS_ADIANTAMENTO)[number];

export type SituacaoAdiantamento = 'ativo' | 'aplicado_parcial' | 'aplicado' | 'devolvido' | 'cancelado';

const r2 = (x: number) => Math.round(x * 100) / 100;

export interface EntradaAdiantamento {
  readonly tipo: TipoAdiantamento;
  readonly valor: number;
  readonly forma: FormaAdiantamento;
  readonly parcelas: number;
  readonly comprovante: string | null;
  /** Conector de Pix e cartão ligado (fora de produção, o simulado). Sem ele, o comprovante é digitado. */
  readonly conectorEletronico: boolean;
  readonly atendimentoUrgencia: boolean;
  readonly declaracaoVoluntaria: boolean;
  readonly pagadorNome: string | null;
  readonly pagadorCpf: string | null;
  readonly pacienteEhPagador: boolean;
}

/** Erros por campo do recebimento do adiantamento (vazio: pode gravar). */
export function validarAdiantamento(e: EntradaAdiantamento): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!(e.valor > 0)) erros['valor'] = 'Informe um valor maior que zero.';
  else if (r2(e.valor) !== e.valor) erros['valor'] = 'O valor tem no máximo duas casas decimais.';
  if (!Number.isInteger(e.parcelas) || e.parcelas < 1 || e.parcelas > 99)
    erros['parcelas'] = 'As parcelas vão de 1 a 99.';
  else if (e.parcelas > 1 && e.forma !== 'cartao_credito')
    erros['parcelas'] = 'Só o cartão de crédito é parcelado.';
  const eletronico = e.forma === 'pix' || e.forma.startsWith('cartao');
  if (eletronico && !e.conectorEletronico && !e.comprovante?.trim())
    erros['comprovante'] = 'Sem o conector de Pix e cartão, digite o comprovante da transação.';
  if (e.forma === 'transferencia' && !e.comprovante?.trim())
    erros['comprovante'] = 'Informe o identificador da transferência.';
  // Lei 12.653/2012: a caução não pode ser exigida como condição do atendimento de urgência ou emergência.
  if (e.tipo === 'caucao' && e.atendimentoUrgencia && !e.declaracaoVoluntaria)
    erros['declaracaoVoluntaria'] =
      'Na urgência, a caução só é aceita como depósito voluntário do pagante: registre a declaração.';
  if (!e.pacienteEhPagador && !e.pagadorNome?.trim())
    erros['pagadorNome'] = 'Informe quem pagou, quando não é o paciente.';
  if (e.pagadorCpf !== null && !/^\d{11}$/.test(e.pagadorCpf)) erros['pagadorCpf'] = 'O CPF tem 11 dígitos.';
  return erros;
}

/** A situação do adiantamento pelo saldo (cancelado e devolvido vêm da operação, não do saldo). */
export function situacaoPeloSaldo(valor: number, saldo: number, devolvido: boolean): SituacaoAdiantamento {
  if (saldo <= 0) return devolvido ? 'devolvido' : 'aplicado';
  if (saldo >= valor) return 'ativo';
  return devolvido ? 'devolvido' : 'aplicado_parcial';
}

export interface SaldoAdiantamento {
  readonly id: number;
  readonly saldo: number;
  readonly recebidoEm: string;
  readonly situacao: SituacaoAdiantamento;
  /** Já aplicado nesta conta (a aplicação é uma por adiantamento e conta; a nova soma na mesma linha). */
  readonly jaNaConta: boolean;
}

export interface PlanoAplicacao {
  readonly erros: Record<string, string>;
  readonly parcelas: readonly { readonly adiantamento: number; readonly valor: number }[];
  readonly total: number;
}

/**
 * Plano de uso do saldo do paciente na conta: do adiantamento mais antigo para o mais novo, até o valor pedido (ou
 * até o que a conta ainda deve, quando não se pede valor). Recusa conta paga e valor acima do saldo ou da dívida.
 */
export function planejarAplicacao(
  saldos: readonly SaldoAdiantamento[],
  devidoNaConta: number,
  valorPedido: number | null,
  escolhidos: readonly number[] | null = null,
): PlanoAplicacao {
  const erros: Record<string, string> = {};
  const usaveis = saldos
    .filter((s) => s.saldo > 0 && (s.situacao === 'ativo' || s.situacao === 'aplicado_parcial'))
    .filter((s) => escolhidos === null || escolhidos.includes(s.id))
    .sort((a, b) => (a.recebidoEm < b.recebidoEm ? -1 : a.recebidoEm > b.recebidoEm ? 1 : a.id - b.id));
  const disponivel = r2(usaveis.reduce((t, s) => t + s.saldo, 0));
  if (escolhidos !== null) {
    const fora = escolhidos.filter((id) => !usaveis.some((s) => s.id === id));
    if (fora.length) erros['adiantamentos'] = 'Há adiantamento escolhido sem saldo ou de outro paciente.';
  }
  if (!(devidoNaConta > 0)) erros['conta'] = 'A conta não tem valor em aberto.';
  if (disponivel <= 0) erros['adiantamentos'] ??= 'O paciente não tem saldo de adiantamento.';
  if (valorPedido !== null) {
    if (!(valorPedido > 0)) erros['valor'] = 'Informe um valor maior que zero.';
    else if (valorPedido > disponivel) erros['valor'] = `O saldo disponível é ${disponivel.toFixed(2)}.`;
    else if (valorPedido > devidoNaConta)
      erros['valor'] = `A conta deve ${devidoNaConta.toFixed(2)}: não se aplica mais que isso.`;
  }
  if (Object.keys(erros).length) return { erros, parcelas: [], total: 0 };
  let falta = r2(valorPedido ?? Math.min(disponivel, devidoNaConta));
  const parcelas: { adiantamento: number; valor: number }[] = [];
  for (const s of usaveis) {
    if (falta <= 0) break;
    const v = r2(Math.min(s.saldo, falta));
    parcelas.push({ adiantamento: s.id, valor: v });
    falta = r2(falta - v);
  }
  return { erros, parcelas, total: r2(parcelas.reduce((t, p) => t + p.valor, 0)) };
}

export interface EntradaDevolucao {
  readonly saldo: number;
  readonly situacao: SituacaoAdiantamento;
  readonly valor: number;
  readonly favorecidoNome: string;
  readonly favorecidoCpf: string | null;
  readonly forma: FormaAdiantamento;
  readonly chavePix: string | null;
  readonly motivo: string;
}

/** Erros por campo da devolução do saldo ao paciente (vazio: pode gravar). */
export function validarDevolucao(e: EntradaDevolucao): Record<string, string> {
  const erros: Record<string, string> = {};
  if (e.situacao === 'cancelado' || e.situacao === 'devolvido' || e.situacao === 'aplicado')
    erros['adiantamento'] = 'O adiantamento não tem saldo a devolver.';
  if (!(e.valor > 0)) erros['valor'] = 'Informe um valor maior que zero.';
  else if (e.valor > e.saldo) erros['valor'] = `O saldo a devolver é ${e.saldo.toFixed(2)}.`;
  if (!e.favorecidoNome.trim()) erros['favorecidoNome'] = 'Informe a quem o valor é devolvido.';
  if (e.favorecidoCpf !== null && !/^\d{11}$/.test(e.favorecidoCpf))
    erros['favorecidoCpf'] = 'O CPF tem 11 dígitos.';
  if (e.forma === 'pix' && !e.chavePix?.trim()) erros['chavePix'] = 'A devolução por Pix pede a chave.';
  if (e.forma.startsWith('cartao'))
    erros['forma'] = 'A devolução sai em dinheiro, Pix, transferência ou cheque.';
  if (!e.motivo.trim()) erros['motivo'] = 'Informe o motivo da devolução.';
  return erros;
}

export type TipoLancamentoCorrente =
  'adiantamento' | 'caucao' | 'aplicacao' | 'estorno_aplicacao' | 'devolucao';

export interface LancamentoCorrente {
  readonly tipo: TipoLancamentoCorrente;
  readonly data: string;
  readonly valor: number;
  readonly referencia: string;
  readonly adiantamento: number;
}

export interface LinhaExtrato extends LancamentoCorrente {
  readonly credito: number;
  readonly debito: number;
  readonly saldo: number;
}

/** O extrato da conta corrente do paciente: crédito (recebido, estorno), débito (aplicado, devolvido), saldo corrido. */
export function extratoContaCorrente(lancamentos: readonly LancamentoCorrente[]): {
  readonly linhas: readonly LinhaExtrato[];
  readonly creditos: number;
  readonly debitos: number;
  readonly saldo: number;
} {
  const ordem = [...lancamentos].sort((a, b) =>
    a.data < b.data ? -1 : a.data > b.data ? 1 : a.adiantamento - b.adiantamento,
  );
  let saldo = 0;
  let creditos = 0;
  let debitos = 0;
  const linhas = ordem.map((l) => {
    const credito = l.tipo === 'aplicacao' || l.tipo === 'devolucao' ? 0 : r2(l.valor);
    const debito = credito ? 0 : r2(l.valor);
    creditos = r2(creditos + credito);
    debitos = r2(debitos + debito);
    saldo = r2(saldo + credito - debito);
    return { ...l, credito, debito, saldo };
  });
  return { linhas, creditos, debitos, saldo };
}
