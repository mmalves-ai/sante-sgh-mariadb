// F3.8, 07-FIN linha 76: renegociação de títulos a receber. O acordo troca as parcelas em aberto de UM devedor por um
// título novo, parcelado, com juros, multa e desconto; as parcelas originais ficam no histórico como renegociadas (nada
// se apaga) e o acordo guarda o saldo que cada uma levou. Regra pura: a tela mostra o mesmo plano antes de gravar.
import { centavos, type RecusaFinanceiro, recusaFin, TOLERANCIA } from './recusa.js';

/** O teto de parcelas de um acordo (o mesmo do título). */
export const PARCELAS_MAXIMAS_ACORDO = 360;
/** O motivo mínimo para desfazer um acordo (o histórico tem de dizer por quê). */
export const MOTIVO_DESFAZER_ACORDO_MINIMO = 5;

export interface ParcelaRenegociavel {
  readonly parcela: number;
  readonly titulo: number;
  /** Situação da parcela: aberta, parcial, recebida, cancelada, renegociada, protestada, perdida. */
  readonly situacao: string;
  /** Valor da parcela na emissão. */
  readonly valor: number;
  readonly saldo: number;
  /** Quem deve, numa chave comparável (tipo e id do devedor). */
  readonly devedor: string;
  /** A parcela está num encontro de contas que ainda aguarda aprovação. */
  readonly emEncontro: boolean;
}

export interface EntradaRenegociacao {
  /** Data do acordo (AAAA-MM-DD). */
  readonly dataAcordo: string;
  readonly parcelas: readonly ParcelaRenegociavel[];
  readonly juros: number;
  readonly multa: number;
  readonly desconto: number;
  readonly quantidadeParcelas: number;
  /** Vencimento da primeira parcela nova; as demais vencem no mesmo dia dos meses seguintes. */
  readonly primeiroVencimento: string;
}

export interface ItemRenegociado {
  readonly parcela: number;
  readonly titulo: number;
  readonly valorOriginal: number;
  readonly saldo: number;
  readonly juros: number;
  readonly multa: number;
  readonly desconto: number;
}

export interface ParcelaNovaDoAcordo {
  readonly sequencia: number;
  readonly vencimento: string;
  readonly valor: number;
}

export interface PlanoRenegociacao {
  /** Soma dos saldos levados ao acordo. */
  readonly valorOriginal: number;
  readonly juros: number;
  readonly multa: number;
  readonly desconto: number;
  /** Original + juros + multa − desconto: o valor do título novo. */
  readonly valorRenegociado: number;
  readonly itens: readonly ItemRenegociado[];
  readonly novas: readonly ParcelaNovaDoAcordo[];
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (d: string) => DATA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const dinheiro = (n: number) => Number.isFinite(n) && n >= 0;

/** Vencimentos mensais a partir do primeiro, no mesmo dia (o dia 31 cai no último dia dos meses mais curtos). */
export function vencimentosMensais(primeiro: string, quantidade: number): string[] {
  const [a, m, d] = primeiro.split('-').map(Number) as [number, number, number];
  return Array.from({ length: quantidade }, (_, i) => {
    const mes = m - 1 + i;
    const ano = a + Math.floor(mes / 12);
    const noAno = mes % 12;
    const ultimo = new Date(Date.UTC(ano, noAno + 1, 0)).getUTCDate();
    return `${ano}-${String(noAno + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
  });
}

/** Divide o total em partes proporcionais aos pesos, em centavos; a sobra do arredondamento vai à última parte. */
export function ratearEmCentavos(total: number, pesos: readonly number[]): number[] {
  const soma = pesos.reduce((x, p) => x + p, 0);
  if (pesos.length === 0) return [];
  let resto = centavos(total);
  return pesos.map((p, i) => {
    const parte = i === pesos.length - 1 ? resto : centavos(soma > 0 ? (total * p) / soma : 0);
    resto = centavos(resto - parte);
    return parte;
  });
}

/**
 * Monta o acordo: só parcelas com saldo em aberto, todas do mesmo devedor, nenhuma repetida nem presa num encontro de
 * contas pendente; o desconto não zera o acordo; as parcelas novas são iguais, com os centavos da divisão na última, e
 * vencem a partir de uma data que não é anterior à do acordo.
 */
export function planejarRenegociacao(e: EntradaRenegociacao): PlanoRenegociacao | RecusaFinanceiro {
  if (e.parcelas.length === 0)
    return recusaFin('sem-parcela', 'Escolha ao menos um título em aberto para renegociar.', ['titulos']);
  if (new Set(e.parcelas.map((p) => p.parcela)).size !== e.parcelas.length)
    return recusaFin('parcela-repetida', 'A mesma parcela foi escolhida duas vezes.', ['titulos']);
  if (e.parcelas.some((p) => !['aberta', 'parcial'].includes(p.situacao) || !(p.saldo > 0)))
    return recusaFin(
      'parcela-nao-renegociavel',
      'Só parcela com saldo em aberto entra no acordo: há título já recebido, cancelado ou renegociado. Releia a lista.',
      ['titulos'],
    );
  if (new Set(e.parcelas.map((p) => p.devedor)).size > 1)
    return recusaFin(
      'devedores-diferentes',
      'O acordo é de um devedor só: os títulos escolhidos são de devedores diferentes.',
      ['titulos'],
    );
  if (e.parcelas.some((p) => p.emEncontro))
    return recusaFin(
      'parcela-em-encontro',
      'Há parcela num encontro de contas que aguarda aprovação: conclua ou cancele o encontro antes.',
      ['titulos'],
    );
  if (!dinheiro(e.juros) || !dinheiro(e.multa) || !dinheiro(e.desconto))
    return recusaFin('valor-invalido', 'Juros, multa e desconto não podem ser negativos.', ['juros']);
  if (
    !Number.isInteger(e.quantidadeParcelas) ||
    e.quantidadeParcelas < 1 ||
    e.quantidadeParcelas > PARCELAS_MAXIMAS_ACORDO
  )
    return recusaFin(
      'parcelas-invalidas',
      `Informe de 1 a ${PARCELAS_MAXIMAS_ACORDO} parcelas para o acordo.`,
      ['quantidadeParcelas'],
    );
  if (!dataValida(e.dataAcordo) || !dataValida(e.primeiroVencimento))
    return recusaFin('data-invalida', 'Informe o vencimento da primeira parcela.', ['primeiroVencimento']);
  if (e.primeiroVencimento < e.dataAcordo)
    return recusaFin(
      'vencimento-passado',
      'A primeira parcela do acordo não pode vencer antes da data do acordo.',
      ['primeiroVencimento'],
    );
  const valorOriginal = centavos(e.parcelas.reduce((x, p) => x + p.saldo, 0));
  const juros = centavos(e.juros);
  const multa = centavos(e.multa);
  const desconto = centavos(e.desconto);
  const valorRenegociado = centavos(valorOriginal + juros + multa - desconto);
  if (valorRenegociado < TOLERANCIA)
    return recusaFin(
      'desconto-total',
      'O desconto não pode zerar o acordo: para perdoar a dívida inteira, registre a perda no título.',
      ['desconto'],
    );
  if (valorRenegociado < e.quantidadeParcelas * 0.01 - TOLERANCIA)
    return recusaFin('parcela-sem-valor', 'Há mais parcelas do que centavos no acordo.', [
      'quantidadeParcelas',
    ]);
  const saldos = e.parcelas.map((p) => p.saldo);
  const j = ratearEmCentavos(juros, saldos);
  const m = ratearEmCentavos(multa, saldos);
  const d = ratearEmCentavos(desconto, saldos);
  const itens = e.parcelas.map((p, i) => ({
    parcela: p.parcela,
    titulo: p.titulo,
    valorOriginal: centavos(p.valor),
    saldo: centavos(p.saldo),
    juros: j[i] ?? 0,
    multa: m[i] ?? 0,
    desconto: d[i] ?? 0,
  }));
  const cada = Math.floor((valorRenegociado * 100 + 1e-6) / e.quantidadeParcelas) / 100;
  const datas = vencimentosMensais(e.primeiroVencimento, e.quantidadeParcelas);
  const novas = datas.map((vencimento, i) => ({
    sequencia: i + 1,
    vencimento,
    valor:
      i === e.quantidadeParcelas - 1
        ? centavos(valorRenegociado - cada * (e.quantidadeParcelas - 1))
        : centavos(cada),
  }));
  return { valorOriginal, juros, multa, desconto, valorRenegociado, itens, novas };
}

export interface AcordoADesfazer {
  /** Situação do acordo: proposta, aceita, efetivada, quebrada, cancelada. */
  readonly situacao: string;
  /** Quanto já entrou no título novo do acordo. */
  readonly recebidoNoAcordo: number;
  /** Alguma parcela nova já foi renegociada de novo, protestada ou dada como perdida. */
  readonly parcelaNovaMovimentada: boolean;
  readonly motivo: string;
}

/**
 * Desfazer o acordo (lançado por engano ou recusado pelo devedor): só o efetivado e sem recebimento. As parcelas
 * originais voltam com o saldo que levaram, o título novo fica cancelado e o acordo fica no histórico, com o motivo.
 */
export function conferirDesfazerRenegociacao(a: AcordoADesfazer): RecusaFinanceiro | null {
  if (a.situacao !== 'efetivada')
    return recusaFin('acordo-nao-efetivado', 'Só o acordo efetivado pode ser desfeito: releia a lista.');
  if (a.recebidoNoAcordo > TOLERANCIA || a.parcelaNovaMovimentada)
    return recusaFin(
      'acordo-com-recebimento',
      'O acordo já teve parcela recebida ou movimentada: estorne o recebimento antes, ou faça um novo acordo com o saldo.',
    );
  if (a.motivo.trim().length < MOTIVO_DESFAZER_ACORDO_MINIMO)
    return recusaFin('motivo-obrigatorio', 'Diga o motivo de desfazer o acordo.', ['motivo']);
  return null;
}
