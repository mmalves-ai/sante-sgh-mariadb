// F3.8, 07-FIN linha 63: alterar o título a pagar ainda não pago. Regra pura (sem banco).
// Prática de mercado: o campo descritivo (referente, observação) muda sem tocar na aprovação; o que muda o compromisso
// (credor, documento, série, emissão, valor, parcelas, retenções, centro de custo) cancela as aprovações já dadas e
// reabre a alçada, com a justificativa e a trilha do antes e do depois. Título com baixa, em borderô ou abatido por nota
// não se altera: desfaça a baixa, retire do borderô ou cancele a nota antes. A parcela prorrogada não muda de vencimento
// por aqui (o histórico da prorrogação é que manda).
import {
  conferirParcelas,
  type ParcelaInformada,
  recusaFin,
  type RecusaFinanceiro,
} from '@sgh/contratos/regras-financeiro';

export interface RetencaoTituloAlteravel {
  readonly tributo: number;
  readonly valor: number;
}

export interface ParcelaTituloAlteravel extends ParcelaInformada {
  /** A parcela já foi prorrogada (há passo no histórico da prorrogação). */
  readonly prorrogada: boolean;
}

/** O título como está no banco, na forma que a regra precisa. */
export interface TituloPagarAlteravel {
  /** Situação do título: aberto, pago_parcial, pago, cancelado... */
  readonly situacao: string;
  /** Soma do que já foi pago nas parcelas. */
  readonly pago: number;
  /** Parcelas do título em borderô ainda ativo. */
  readonly bordero: number;
  /** Notas de crédito ou débito aplicadas ao título (mudam o saldo). */
  readonly notasAplicadas: number;
  /** Decisões de aprovação vigentes (não canceladas) do título. */
  readonly aprovacoes: number;
  readonly credor: number;
  readonly documento: string;
  readonly serie: string;
  readonly emissao: string;
  readonly valorDocumento: number;
  readonly centroCusto: number | null;
  readonly referente: string;
  readonly observacao: string;
  readonly parcelas: readonly ParcelaTituloAlteravel[];
  readonly retencoes: readonly RetencaoTituloAlteravel[];
}

/** O pedido de alteração: só os campos que vêm mudam (os ausentes ficam como estão). */
export interface AlteracaoTituloPagar {
  readonly credor?: number | undefined;
  readonly documento?: string | undefined;
  readonly serie?: string | undefined;
  readonly emissao?: string | undefined;
  readonly valorDocumento?: number | undefined;
  readonly centroCusto?: number | null | undefined;
  readonly referente?: string | undefined;
  readonly observacao?: string | undefined;
  readonly parcelas?: readonly ParcelaInformada[] | undefined;
  readonly retencoes?: readonly RetencaoTituloAlteravel[] | undefined;
  readonly justificativa?: string | undefined;
}

export const CAMPOS_DESCRITIVOS_TITULO = ['referente', 'observacao'] as const;
export const CAMPOS_MATERIAIS_TITULO = [
  'credor',
  'documento',
  'serie',
  'emissao',
  'valorDocumento',
  'parcelas',
  'retencoes',
  'centroCusto',
] as const;
export type CampoAlteravelTitulo =
  (typeof CAMPOS_DESCRITIVOS_TITULO)[number] | (typeof CAMPOS_MATERIAIS_TITULO)[number];

/** A justificativa mínima quando a alteração reabre a alçada. */
export const JUSTIFICATIVA_ALTERACAO_MINIMA = 5;

export interface PlanoAlteracaoTitulo {
  readonly ok: true;
  /** Todos os campos que mudam, na ordem da lista. */
  readonly campos: readonly CampoAlteravelTitulo[];
  /** Os campos que mudam o compromisso. */
  readonly materiais: readonly CampoAlteravelTitulo[];
  /** Cancela as aprovações vigentes e o título volta à alçada. */
  readonly reabreAlcada: boolean;
  /** O título como fica. */
  readonly depois: Omit<
    TituloPagarAlteravel,
    'situacao' | 'pago' | 'bordero' | 'notasAplicadas' | 'aprovacoes' | 'parcelas'
  > & { readonly parcelas: readonly ParcelaInformada[] };
}

const c = (v: number) => Math.round(v * 100);
const mesmaLista = <T>(a: readonly T[], b: readonly T[], chave: (x: T) => string) =>
  a.length === b.length && a.every((x, i) => chave(x) === chave(b[i] as T));
const chaveParcela = (p: ParcelaInformada) => `${p.parcela}|${p.vencimento}|${c(p.valor)}`;
const chaveRetencao = (r: RetencaoTituloAlteravel) => `${r.tributo}|${c(r.valor)}`;

/**
 * Confere e planeja a alteração do título a pagar. Recusa o título que não está em aberto, que tem baixa, que está em
 * borderô ou que foi abatido por nota; recusa o pedido que nada muda, as parcelas que não somam o valor, as retenções
 * acima do valor, a mudança de vencimento de parcela prorrogada e a falta de justificativa quando a alteração reabre
 * a alçada de um título já aprovado (no todo ou em parte).
 */
export function planejarAlteracaoTituloPagar(
  atual: TituloPagarAlteravel,
  pedido: AlteracaoTituloPagar,
): { readonly ok: false; readonly recusa: RecusaFinanceiro } | PlanoAlteracaoTitulo {
  const nao = (codigo: string, mensagem: string, campos?: readonly string[]) =>
    ({ ok: false, recusa: recusaFin(codigo, mensagem, campos) }) as const;
  if (!['aberto', 'vencido', 'bloqueado'].includes(atual.situacao))
    return nao('titulo-nao-alteravel', 'Só o título em aberto se altera.');
  if (atual.pago > 0)
    return nao('titulo-com-baixa', 'O título já tem pagamento: desfaça a baixa antes de alterar.');
  if (atual.bordero > 0)
    return nao('titulo-em-bordero', 'O título está num borderô: retire-o do borderô antes de alterar.');
  if (atual.notasAplicadas > 0)
    return nao(
      'titulo-com-nota',
      'O título foi abatido ou acrescido por nota: cancele a nota antes de alterar.',
    );

  const depois = {
    credor: pedido.credor ?? atual.credor,
    documento: (pedido.documento ?? atual.documento).trim(),
    serie: (pedido.serie ?? atual.serie).trim().toUpperCase(),
    emissao: pedido.emissao ?? atual.emissao,
    valorDocumento: pedido.valorDocumento ?? atual.valorDocumento,
    centroCusto: pedido.centroCusto === undefined ? atual.centroCusto : pedido.centroCusto,
    referente: (pedido.referente ?? atual.referente).trim(),
    observacao: (pedido.observacao ?? atual.observacao).trim(),
    parcelas:
      pedido.parcelas ??
      atual.parcelas.map(({ parcela, vencimento, valor }) => ({ parcela, vencimento, valor })),
    retencoes: pedido.retencoes ?? atual.retencoes,
  };
  const mudou: Record<CampoAlteravelTitulo, boolean> = {
    credor: depois.credor !== atual.credor,
    documento: depois.documento !== atual.documento.trim(),
    serie: depois.serie !== atual.serie.trim().toUpperCase(),
    emissao: depois.emissao !== atual.emissao,
    valorDocumento: c(depois.valorDocumento) !== c(atual.valorDocumento),
    centroCusto: depois.centroCusto !== atual.centroCusto,
    referente: depois.referente !== atual.referente.trim(),
    observacao: depois.observacao !== atual.observacao.trim(),
    parcelas: !mesmaLista(depois.parcelas, atual.parcelas, chaveParcela),
    retencoes: !mesmaLista(depois.retencoes, atual.retencoes, chaveRetencao),
  };
  const campos = [...CAMPOS_MATERIAIS_TITULO, ...CAMPOS_DESCRITIVOS_TITULO].filter((k) => mudou[k]);
  if (campos.length === 0) return nao('sem-alteracao', 'Nada mudou no título.');
  if (!depois.documento) return nao('documento-obrigatorio', 'Informe o documento.', ['documento']);
  if (mudou.valorDocumento && !pedido.parcelas)
    return nao('parcelas-do-valor', 'Ao mudar o valor, informe as parcelas que somam o valor novo.', [
      'parcelas',
    ]);
  const p = conferirParcelas(depois.parcelas, depois.valorDocumento, depois.emissao);
  if (p) return { ok: false, recusa: p };
  if (new Set(depois.retencoes.map((r) => r.tributo)).size !== depois.retencoes.length)
    return nao('retencao-repetida', 'O mesmo tributo aparece duas vezes nas retenções.', ['retencoes']);
  if (depois.retencoes.some((r) => !(r.valor > 0)))
    return nao('retencao-invalida', 'A retenção tem de ter valor maior que zero.', ['retencoes']);
  if (c(depois.retencoes.reduce((x, r) => x + r.valor, 0)) > c(depois.valorDocumento))
    return nao('retencao-acima-do-documento', 'As retenções passam do valor do documento.', ['retencoes']);
  for (const a of atual.parcelas) {
    if (!a.prorrogada) continue;
    const n = depois.parcelas.find((x) => x.parcela === a.parcela);
    if (!n || n.vencimento !== a.vencimento)
      return nao(
        'parcela-prorrogada',
        `A parcela ${a.parcela} foi prorrogada: o vencimento dela segue o histórico da prorrogação.`,
        ['parcelas'],
      );
  }
  const materiais = CAMPOS_MATERIAIS_TITULO.filter((k) => mudou[k]);
  const reabreAlcada = materiais.length > 0 && atual.aprovacoes > 0;
  if (reabreAlcada && (pedido.justificativa ?? '').trim().length < JUSTIFICATIVA_ALTERACAO_MINIMA)
    return nao(
      'justificativa-obrigatoria',
      'O título já tem aprovação: diga por que muda (a alteração cancela as aprovações e reabre a alçada).',
      ['justificativa'],
    );
  return { ok: true, campos, materiais, reabreAlcada, depois };
}
