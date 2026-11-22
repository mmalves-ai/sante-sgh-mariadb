// Vocabulário do financeiro entre o contrato das telas (M32) e o modelo próprio: o que as telas mostram e mandam (letra
// do tipo de credor, código numérico da forma de pagamento, letra do tipo de movimento, classificação gerencial
// grupo.subgrupo.item, versão em texto) e o que o banco guarda (tipo_credor.natureza, baixa_titulo.forma_pagamento,
// movimento_bancario.natureza/tipo_origem, natureza_financeira.codigo, versao numérica). Funções puras, sem banco.
// Melhoria: a forma de pagamento é o vocabulário do modelo (dinheiro, pix, boleto…), com código só de tela; a
// classificação gerencial é a natureza financeira do cadastro (código "grupo.subgrupo.item"), não três números soltos.
import type { TipoCredor } from '@sgh/contratos/regras-financeiro';

/** Versão numérica do banco ↔ texto do contrato (o contrato pede no mínimo 10 caracteres). */
export const versaoTexto = (v: unknown): string => `v${String(Number(v ?? 1)).padStart(10, '0')}`;
export function versaoDoTexto(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^v0*(\d{1,9})$/.exec(t);
  return m ? Number(m[1]) : null;
}

/** Tipo de credor da tela ↔ código do cadastro tipo_credor e coluna do credor no título. */
export const CREDOR_DO_TIPO: Readonly<
  Record<
    TipoCredor,
    { codigo: string; coluna: 'empresa_fornecedora_id' | 'profissional_id' | 'colaborador_id' }
  >
> = {
  F: { codigo: 'fornecedor', coluna: 'empresa_fornecedora_id' },
  M: { codigo: 'medico', coluna: 'profissional_id' },
  E: { codigo: 'empresa_medica', coluna: 'empresa_fornecedora_id' },
  X: { codigo: 'folha', coluna: 'colaborador_id' },
  C: { codigo: 'colaborador', coluna: 'colaborador_id' },
  T: { codigo: 'tributos', coluna: 'empresa_fornecedora_id' },
};
const TIPO_DO_CODIGO: Readonly<Record<string, TipoCredor>> = Object.fromEntries(
  Object.entries(CREDOR_DO_TIPO).map(([t, d]) => [d.codigo, t as TipoCredor]),
);
/** Natureza do cadastro tipo_credor → tipo da tela (quando o código não é um dos conhecidos). */
const TIPO_DA_NATUREZA: Readonly<Record<string, TipoCredor>> = {
  fornecedor: 'F',
  medico: 'M',
  prestador: 'E',
  cooperativa: 'E',
  folha: 'X',
  tributo: 'T',
  adiantamento: 'C',
  outro: 'F',
};
export const tipoCredorDe = (codigo: unknown, natureza: unknown): TipoCredor =>
  TIPO_DO_CODIGO[String(codigo ?? '')] ?? TIPO_DA_NATUREZA[String(natureza ?? '')] ?? 'F';

/** Formas de pagamento do modelo (CHECK de baixa_titulo.forma_pagamento), com o código que a tela manda. */
export const FORMAS_PAGAMENTO = [
  { codigo: 1, forma: 'transferencia', nome: 'Transferência' },
  { codigo: 2, forma: 'pix', nome: 'Pix' },
  { codigo: 3, forma: 'boleto', nome: 'Boleto' },
  { codigo: 4, forma: 'debito_em_conta', nome: 'Débito em conta' },
  { codigo: 5, forma: 'cheque', nome: 'Cheque' },
  { codigo: 6, forma: 'dinheiro', nome: 'Dinheiro' },
  { codigo: 7, forma: 'cartao', nome: 'Cartão' },
] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number]['forma'];
export const formaDoCodigo = (c: number): FormaPagamento | null =>
  FORMAS_PAGAMENTO.find((f) => f.codigo === c)?.forma ?? null;
/** Meio de recebimento (forma_recebimento.meio) equivalente à forma de pagamento. */
export const MEIO_RECEBIMENTO: Readonly<Record<FormaPagamento, string>> = {
  transferencia: 'transferencia',
  pix: 'pix',
  boleto: 'boleto',
  debito_em_conta: 'debito_automatico',
  cheque: 'cheque',
  dinheiro: 'dinheiro',
  cartao: 'cartao_credito',
};

/** Tipo de movimento da tela ↔ código do tipo_lancamento_bancario e origem do movimento_bancario. */
export const MOVIMENTO_DO_TIPO: Readonly<
  Record<
    'O' | 'F' | 'T' | 'C' | 'D',
    { codigo: string; origem: 'tarifa' | 'fechamento_caixa' | 'transferencia' | 'manual' }
  >
> = {
  O: { codigo: 'tarifa', origem: 'tarifa' },
  F: { codigo: 'fechamento_caixa', origem: 'fechamento_caixa' },
  T: { codigo: 'transferencia', origem: 'transferencia' },
  C: { codigo: 'credito_avulso', origem: 'manual' },
  D: { codigo: 'debito_avulso', origem: 'manual' },
};
/** Tipos de lançamento bancário das baixas (pagamento e recebimento de título). */
export const LANCAMENTO_PAGAMENTO = 'pagamento_titulo';
export const LANCAMENTO_RECEBIMENTO = 'recebimento_titulo';

/** Letra da tela para um movimento lido (o que não nasceu na tesouraria é "S", outro). */
export function tipoDoMovimento(origem: unknown, natureza: unknown): string {
  switch (String(origem ?? '')) {
    case 'tarifa':
      return 'O';
    case 'fechamento_caixa':
      return 'F';
    case 'transferencia':
      return 'T';
    case 'manual':
      return String(natureza) === 'credito' ? 'C' : 'D';
    default:
      return 'S';
  }
}

/** Classificação gerencial da tela ↔ código da natureza financeira ("grupo.subgrupo.item"). */
export const codigoClassificacao = (c: { grupo: number; subgrupo: number; item: number }): string =>
  `${c.grupo}.${c.subgrupo}.${c.item}`;
export function classificacaoDoCodigo(
  codigo: unknown,
): { grupo: number; subgrupo: number; item: number } | null {
  const m = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/.exec(String(codigo ?? ''));
  return m ? { grupo: Number(m[1]), subgrupo: Number(m[2]), item: Number(m[3]) } : null;
}

/** Esfera do tributo → número do tipo na tela das retenções. */
export const TIPO_DA_ESFERA: Readonly<Record<string, number>> = { federal: 1, estadual: 2, municipal: 3 };

/** Situação da parcela a pagar do modelo → código de status da tela (0 em aberto, 1 baixado, 2 em borderô). */
export function statusDaParcela(situacao: unknown, emBordero: boolean): number {
  if (String(situacao) === 'paga' || String(situacao) === 'parcial') return 1;
  return emBordero ? 2 : 0;
}

/** Datas do banco (DATE/DATETIME) → "AAAA-MM-DD". */
export const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** Instante do banco → ISO completo. */
export const instanteIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? String(v) : null;
export const numero = (v: unknown): number => Number(v ?? 0) || 0;
export const numeroOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** Número de documento do contrato (inteiro) a partir do texto do banco; o que não é número vira 0. */
export const documentoNumerico = (v: unknown): number => {
  const n = Number(
    String(v ?? '')
      .replace(/\D/g, '')
      .slice(-9),
  );
  return Number.isSafeInteger(n) ? n : 0;
};
/** AAAA-MM → primeiro dia do mês. */
export const inicioDoMes = (ano: number, mes: number): string => `${ano}-${String(mes).padStart(2, '0')}-01`;
export const fimDoMes = (ano: number, mes: number): string => {
  const d = new Date(Date.UTC(ano, mes, 0));
  return d.toISOString().slice(0, 10);
};
