// Transferência da conta inteira, por lote, estorno, cobertura no destino e sugestão a partir da troca de convênio
// (F3.7, 06-FAT linha 14). Complementa a transferência de itens (conta/movimentos: validarTransferencia):
// - a conta inteira (ou a parte realizada desde um dia) vai para uma conta aberta do paciente ou para uma conta nova,
//   aberta na hora na nova fonte pagadora (e plano), com o mesmo atendimento e período;
// - por lote: várias contas do paciente (as parciais da quebra por período, por exemplo) de uma vez, tudo ou nada;
// - a cobertura no destino: item sem preço vigente nas tabelas da fonte e do plano de destino não tem cobertura lá; a
//   transferência só segue com o aceite explícito e a justificativa (vai para a trilha);
// - o estorno desfaz a transferência sem apagar nada: o item da conta de destino fica "estornado", o da origem volta
//   a "lancado" e a transferência fica "estornada", com autor, data e motivo;
// - a troca de convênio registrada na internação só SUGERE a transferência (ADR 0002: sem disparo automático).
import { contaEditavel } from './complementos.js';
import { SITUACOES_ITEM_TRANSFERIVEL } from './movimentos.js';

const MIN_MOTIVO = 5;
const motivoValido = (m: string | null | undefined) => (m ?? '').trim().length >= MIN_MOTIVO;
const transferivel = (s: string) => (SITUACOES_ITEM_TRANSFERIVEL as readonly string[]).includes(s);

// ── Destino novo: abrir a conta na nova fonte pagadora ─────────────────────────────────────────────────

export interface ContaParaAbrirDestino {
  readonly situacao: string;
  readonly fontePagadora: number;
  readonly plano: number | null;
}

export interface DestinoNovo {
  readonly fontePagadora: number;
  readonly plano: number | null;
  /** Fonte dona do plano escolhido (nulo sem plano ou plano não encontrado). */
  readonly fonteDoPlano: number | null;
  readonly fonteAtiva: boolean;
  readonly planoAtivo: boolean;
}

/** Confere a abertura da conta de destino na nova fonte pagadora (ou no novo plano da mesma fonte). */
export function validarDestinoNovo(origem: ContaParaAbrirDestino, d: DestinoNovo): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!contaEditavel(origem.situacao))
    erros['origem'] = 'A conta de origem não está aberta: reabra-a para tirar itens dela.';
  if (!d.fonteAtiva) erros['fontePagadoraId'] = 'A fonte pagadora de destino não está ativa.';
  if (d.plano !== null) {
    if (d.fonteDoPlano !== d.fontePagadora)
      erros['planoId'] = 'O plano escolhido não é da fonte pagadora de destino.';
    else if (!d.planoAtivo) erros['planoId'] = 'O plano escolhido não está ativo.';
  }
  if (d.fontePagadora === origem.fontePagadora && (d.plano ?? null) === (origem.plano ?? null))
    erros['fontePagadoraId'] = 'A conta já é desta fonte pagadora e deste plano: escolha outro destino.';
  return erros;
}

// ── Conta inteira ─────────────────────────────────────────────────────────────────────────────────────

export interface ItemDaConta {
  readonly id: number;
  readonly situacao: string;
  /** Dia em que foi realizado (AAAA-MM-DD). */
  readonly realizado: string | null;
}

/**
 * Os itens que mudam de conta na transferência da conta inteira: os lançados ou conferidos, e só os realizados desde
 * o dia dado (a troca de convênio no meio da internação leva só a parte de depois dela).
 */
export function itensDaContaInteira(itens: readonly ItemDaConta[], desde: string | null = null): number[] {
  return itens
    .filter((i) => transferivel(i.situacao))
    .filter((i) => !desde || !i.realizado || i.realizado.slice(0, 10) >= desde.slice(0, 10))
    .map((i) => i.id);
}

// ── Cobertura no destino ──────────────────────────────────────────────────────────────────────────────

export interface CoberturaItem {
  readonly id: number;
  /** Há preço vigente para o item, no dia em que foi realizado, nas tabelas da conta, do plano ou da fonte de destino. */
  readonly precoNoDestino: boolean;
}

/**
 * Item sem preço no destino não tem cobertura lá: a transferência só segue com o aceite explícito e a justificativa
 * (o item vai com o valor de origem e a memória diz isso). Devolve os sem cobertura e as recusas.
 */
export function avaliarCoberturaDestino(
  itens: readonly CoberturaItem[],
  aceitarSemCobertura: boolean,
  justificativa: string | null | undefined,
): { semCobertura: number[]; erros: Record<string, string> } {
  const semCobertura = itens.filter((i) => !i.precoNoDestino).map((i) => i.id);
  const erros: Record<string, string> = {};
  if (semCobertura.length && !aceitarSemCobertura)
    erros['cobertura'] =
      `${semCobertura.length} item(ns) sem preço na fonte ou no plano de destino: confirme a transferência sem cobertura ou deixe-os na conta.`;
  else if (semCobertura.length && !motivoValido(justificativa))
    erros['justificativaCobertura'] =
      'Justifique a transferência dos itens sem cobertura (ao menos 5 letras).';
  return { semCobertura, erros };
}

// ── Lote ──────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_CONTAS_LOTE = 100;

/** Lote de contas: ao menos uma, sem repetir, até o teto, com motivo. */
export function validarLote(contas: readonly number[], motivo: string): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!contas.length) erros['contas'] = 'Escolha ao menos uma conta.';
  else if (new Set(contas).size !== contas.length) erros['contas'] = 'Conta repetida no lote.';
  else if (contas.length > MAX_CONTAS_LOTE) erros['contas'] = `No máximo ${MAX_CONTAS_LOTE} contas por lote.`;
  if (!motivoValido(motivo)) erros['motivo'] = 'Informe o motivo (ao menos 5 letras).';
  return erros;
}

// ── Estorno ───────────────────────────────────────────────────────────────────────────────────────────

export interface TransferenciaParaEstorno {
  readonly situacao: string;
  readonly contaOrigemSituacao: string;
  readonly contaDestinoSituacao: string;
  /** Situação de cada item da conta de destino nascido da transferência. */
  readonly itensDestino: readonly string[];
  /** Situação de cada item de origem. */
  readonly itensOrigem: readonly string[];
}

/** O estorno só desfaz o que ainda está como a transferência deixou, com as duas contas abertas. */
export function validarEstornoTransferencia(
  t: TransferenciaParaEstorno,
  motivo: string,
): Record<string, string> {
  const erros: Record<string, string> = {};
  if (t.situacao !== 'efetivada') erros['transferencia'] = 'A transferência já foi estornada.';
  else {
    if (!contaEditavel(t.contaOrigemSituacao))
      erros['origem'] = 'A conta de origem não está aberta: reabra-a para receber os itens de volta.';
    if (!contaEditavel(t.contaDestinoSituacao))
      erros['destino'] = 'A conta de destino não está aberta: reabra-a para tirar os itens dela.';
    if (t.itensDestino.some((s) => !transferivel(s)))
      erros['itens'] =
        'Há item na conta de destino que já foi glosado, estornado ou transferido de novo: desfaça isso antes.';
    if (t.itensOrigem.some((s) => s !== 'transferido'))
      erros['itens'] = 'Há item de origem que não está mais como transferido.';
  }
  if (!motivoValido(motivo)) erros['motivo'] = 'Informe o motivo do estorno (ao menos 5 letras).';
  return erros;
}

// ── Sugestão a partir da troca de convênio da internação ─────────────────────────────────────────────

export interface TrocaDeConvenio {
  /** Dia da troca (AAAA-MM-DD). */
  readonly dia: string;
  readonly novaFonte: number | null;
  readonly novoPlano: number | null;
}

export interface ContaParaSugestao {
  readonly fontePagadora: number;
  readonly plano: number | null;
  readonly situacao: string;
}

export interface SugestaoTransferencia {
  readonly fontePagadora: number;
  readonly plano: number | null;
  readonly desde: string;
  readonly itens: number[];
}

/**
 * A última troca de convênio da internação vale a partir do dia dela: se a conta aberta é de outra fonte (ou de outro
 * plano), sugere levar os itens realizados desde a troca para a fonte nova. Só sugere: quem decide é o faturamento.
 */
export function sugerirTransferenciaPorTroca(
  conta: ContaParaSugestao,
  trocas: readonly TrocaDeConvenio[],
  itens: readonly ItemDaConta[],
): SugestaoTransferencia | null {
  if (!contaEditavel(conta.situacao)) return null;
  const validas = trocas
    .filter((x) => x.novaFonte !== null)
    .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
  const ultima = validas[validas.length - 1];
  if (!ultima) return null;
  const mesmaFonte = ultima.novaFonte === conta.fontePagadora;
  const mesmoPlano = ultima.novoPlano === null || ultima.novoPlano === conta.plano;
  if (mesmaFonte && mesmoPlano) return null;
  const desde = ultima.dia.slice(0, 10);
  const ids = itensDaContaInteira(itens, desde);
  if (!ids.length) return null;
  return {
    fontePagadora: ultima.novaFonte!,
    plano: ultima.novoPlano,
    desde,
    itens: ids,
  };
}
