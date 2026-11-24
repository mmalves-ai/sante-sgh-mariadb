// F8, 07-FIN linha 69: encontro de contas entre o que o hospital paga e o que recebe do MESMO parceiro (o fornecedor
// que também é devedor, identificado pelo mesmo CNPJ ou CPF). Regra pura.
// Desenho: o usuário escolhe o parceiro e vê, numa tela só, as parcelas em aberto dos dois lados; marca as que entram
// e o sistema calcula na hora o valor compensado (o menor dos dois totais), distribui pelo vencimento mais antigo do
// lado maior e mostra o saldo líquido que continua em aberto. A proposta vai à aprovação de OUTRA pessoa (segregação),
// que aprova e efetiva num clique: as baixas dos dois lados saem na mesma transação. Nada é apagado: o cancelamento
// guarda o motivo, e a parcela compensada guarda o vínculo com o item do encontro.
import { type RecusaFinanceiro, recusaFin } from '@sgh/contratos/regras-financeiro';

export type NaturezaEncontro = 'pagar' | 'receber';

export interface ParcelaEncontro {
  readonly natureza: NaturezaEncontro;
  readonly parcela: number;
  /** Situação da parcela (aberta, parcial, paga, recebida, cancelada...). */
  readonly situacao: string;
  readonly saldo: number;
  readonly vencimento: string;
  /** CNPJ ou CPF do parceiro dono da parcela (só dígitos). */
  readonly documento: string;
  /** A parcela já está noutro encontro pendente (aguardando aprovação ou aprovado). */
  readonly emOutroEncontro: boolean;
}

export interface ItemPlanejadoEncontro {
  readonly natureza: NaturezaEncontro;
  readonly parcela: number;
  readonly sequencia: number;
  readonly valorCompensado: number;
  /** Saldo da parcela depois da compensação. */
  readonly saldoDepois: number;
}

export interface PlanoEncontro {
  readonly totalPagar: number;
  readonly totalReceber: number;
  /** Total a receber menos total a pagar: o que continua em aberto a favor (positivo) ou contra (negativo). */
  readonly saldoLiquido: number;
  /** O valor que se compensa de cada lado. */
  readonly compensado: number;
  readonly itens: readonly ItemPlanejadoEncontro[];
}

const centavos = (v: number) => Math.round(v * 100) / 100;
const so = (d: string) => d.replace(/\D/g, '');
const ABERTA = new Set(['aberta', 'parcial']);

/** Planeja o encontro: confere o parceiro e as parcelas e distribui o valor compensado. */
export function planejarEncontroContas(e: {
  readonly documentoParceiro: string;
  readonly parcelas: readonly ParcelaEncontro[];
}): RecusaFinanceiro | PlanoEncontro {
  const doc = so(e.documentoParceiro);
  if (doc.length !== 11 && doc.length !== 14)
    return recusaFin(
      'parceiro-sem-documento',
      'O parceiro precisa de CNPJ ou CPF para o encontro de contas.',
      ['parceiro'],
    );
  const vistos = new Set<string>();
  for (const p of e.parcelas) {
    const chave = `${p.natureza}:${p.parcela}`;
    if (vistos.has(chave))
      return recusaFin('parcela-repetida', 'A mesma parcela foi marcada duas vezes.', ['parcelas']);
    vistos.add(chave);
    if (so(p.documento) !== doc)
      return recusaFin(
        'parceiro-diferente',
        'Só entram parcelas do mesmo parceiro (mesmo CNPJ ou CPF) dos dois lados.',
        ['parcelas'],
      );
    if (!ABERTA.has(p.situacao) || !(p.saldo > 0))
      return recusaFin('parcela-fechada', 'Há parcela já quitada, cancelada ou sem saldo: releia.', [
        'parcelas',
      ]);
    if (p.emOutroEncontro)
      return recusaFin('parcela-em-outro-encontro', 'Há parcela já incluída noutro encontro pendente.', [
        'parcelas',
      ]);
  }
  const pagar = e.parcelas.filter((p) => p.natureza === 'pagar');
  const receber = e.parcelas.filter((p) => p.natureza === 'receber');
  if (pagar.length === 0 || receber.length === 0)
    return recusaFin(
      'encontro-sem-dois-lados',
      'Marque ao menos uma parcela a pagar e uma a receber do parceiro.',
      ['parcelas'],
    );
  const totalPagar = centavos(pagar.reduce((s, p) => s + p.saldo, 0));
  const totalReceber = centavos(receber.reduce((s, p) => s + p.saldo, 0));
  const compensado = Math.min(totalPagar, totalReceber);
  const distribuir = (lado: readonly ParcelaEncontro[]) => {
    let resta = compensado;
    return [...lado]
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.parcela - b.parcela)
      .map((p) => {
        const v = centavos(Math.min(p.saldo, resta));
        resta = centavos(resta - v);
        return { p, v };
      })
      .filter((x) => x.v > 0);
  };
  const itens: ItemPlanejadoEncontro[] = [...distribuir(pagar), ...distribuir(receber)].map((x, i) => ({
    natureza: x.p.natureza,
    parcela: x.p.parcela,
    sequencia: i + 1,
    valorCompensado: x.v,
    saldoDepois: centavos(x.p.saldo - x.v),
  }));
  return {
    totalPagar,
    totalReceber,
    saldoLiquido: centavos(totalReceber - totalPagar),
    compensado,
    itens,
  };
}

export type SituacaoEncontro = 'rascunho' | 'aguardando_aprovacao' | 'aprovado' | 'efetivado' | 'cancelado';

/** Aprovar e efetivar: só o pendente, e nunca por quem propôs. */
export function conferirAprovacaoEncontro(e: {
  readonly situacao: string;
  readonly propostoPor: number | null;
  readonly aprovador: number;
}): RecusaFinanceiro | null {
  if (e.situacao !== 'aguardando_aprovacao' && e.situacao !== 'aprovado')
    return recusaFin('encontro-nao-pendente', 'O encontro de contas não está pendente de aprovação: releia.');
  if (e.propostoPor !== null && e.propostoPor === e.aprovador)
    return recusaFin('aprovador-igual-proponente', 'Quem propôs o encontro de contas não pode aprová-lo.');
  return null;
}

/** Cancelar: só o que não foi efetivado, com motivo (o efetivado se desfaz por estorno das baixas). */
export function conferirCancelamentoEncontro(e: {
  readonly situacao: string;
  readonly motivo: string;
}): RecusaFinanceiro | null {
  if (e.situacao === 'efetivado' || e.situacao === 'cancelado')
    return recusaFin('encontro-fechado', 'O encontro de contas já foi efetivado ou cancelado.');
  if (e.motivo.trim().length < 5)
    return recusaFin('motivo-obrigatorio', 'Diga o motivo do cancelamento.', ['motivo']);
  return null;
}
