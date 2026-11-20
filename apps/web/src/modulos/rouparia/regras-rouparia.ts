// Regras de tela da rouparia e lavanderia (M55, fatia F2): o formulário do movimento vira o corpo do pedido só com os
// campos que o tipo aceita, a mesma conferência do servidor roda antes de gravar (a tela avisa cedo; o servidor decide),
// a prévia da conferência do retorno com o envio, as cotas que mudaram e a formatação de kg e de reais.
import {
  EXIGENCIAS_MOVIMENTO_ROUPA,
  esquemaRegistrarMovimentoRoupa,
  type CotaRoupa,
  type ConferenciaRetornoRoupa,
  type ItemMovimentoRoupa,
  type Lavanderia,
  type MotivoPerdaRoupa,
  type MovimentoRoupa,
  type PecaRoupa,
  type RegistrarMovimentoRoupaEntrada,
  type TipoMovimentoRoupa,
} from '@sgh/contratos';
import {
  conferirMovimentoRoupa,
  conferirRetornoRoupa,
  normalizarMovimentoRoupa,
} from '@sgh/dominio-hotelaria';

/** Uma linha de peças do formulário (a quantidade como a pessoa digitou). */
export interface LinhaPeca {
  peca: number | null;
  quantidade: string | number;
}

export interface FormMovimentoRoupa {
  tipo: TipoMovimentoRoupa;
  data: string | null;
  centroCusto: number | null;
  remessa: number | null;
  peso: string;
  linhas: LinhaPeca[];
  lavanderia: Lavanderia | null;
  fornecedor: number | null;
  motivoPerda: MotivoPerdaRoupa | null;
  observacao: string;
}

export function formVazio(
  tipo: TipoMovimentoRoupa = 'coleta',
  data: string | null = null,
): FormMovimentoRoupa {
  return {
    tipo,
    data,
    centroCusto: null,
    remessa: null,
    peso: '',
    linhas: [{ peca: null, quantidade: '' }],
    lavanderia: null,
    fornecedor: null,
    motivoPerda: null,
    observacao: '',
  };
}

/**
 * Número digitado com vírgula ou ponto ("12,5" ou "12.5"); vazio ou inválido vira null. Aceita número também: o
 * v-model de `<input type="number">` já entrega número.
 */
export function numeroDoTexto(s: string | number | null | undefined): number | null {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = (s ?? '').trim().replace(/\s/g, '');
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** As linhas preenchidas (peça escolhida e quantidade inteira); as vazias saem. */
export function itensDasLinhas(linhas: readonly LinhaPeca[]): ItemMovimentoRoupa[] {
  const r: ItemMovimentoRoupa[] = [];
  for (const l of linhas) {
    const q = numeroDoTexto(l.quantidade);
    if (l.peca === null && q === null) continue;
    if (l.peca === null || q === null) continue;
    r.push({ peca: l.peca, quantidade: Math.trunc(q) });
  }
  return r;
}

/** O que o tipo pede, para a tela mostrar e esconder os campos. */
export function camposDoTipo(tipo: TipoMovimentoRoupa) {
  const x = EXIGENCIAS_MOVIMENTO_ROUPA[tipo];
  return {
    setor: x.setor !== 'proibido',
    setorObrigatorio: x.setor === 'obrigatorio',
    pesoObrigatorio: x.peso === 'obrigatorio',
    pecasObrigatorias: x.pecas === 'obrigatorio',
    remessa: x.remessa,
    lavanderia: x.lavanderia,
    motivo: x.motivo,
  };
}

export type ResultadoMontagem =
  | { readonly ok: true; readonly corpo: RegistrarMovimentoRoupaEntrada }
  | { readonly ok: false; readonly mensagens: readonly string[] };

export interface ContextoTelaRouparia {
  readonly hoje: string;
  readonly pecas: readonly PecaRoupa[];
  readonly setores: readonly { readonly codigo: number; readonly ativo: boolean }[];
  /** O envio escolhido no retorno (relido pela tela). */
  readonly remessa?: Pick<MovimentoRoupa, 'tipo' | 'situacao' | 'data'> | null;
}

/** Monta o corpo do pedido e roda a conferência do servidor antes de gravar. */
export function montarMovimento(
  f: FormMovimentoRoupa,
  chave: string,
  c: ContextoTelaRouparia,
): ResultadoMontagem {
  const peso = numeroDoTexto(f.peso);
  if (String(f.peso).trim() && peso === null)
    return { ok: false, mensagens: ['Peso inválido: use números, como 12,5.'] };
  const bruto = {
    chave,
    tipo: f.tipo,
    data: f.data ?? c.hoje,
    centroCusto: f.centroCusto,
    remessa: f.remessa,
    pesoKg: peso,
    itens: itensDasLinhas(f.linhas),
    lavanderia: f.lavanderia,
    fornecedor: f.fornecedor,
    motivoPerda: f.motivoPerda,
    observacao: f.observacao.trim() || null,
  };
  const x = EXIGENCIAS_MOVIMENTO_ROUPA[f.tipo];
  const ajustado = {
    ...bruto,
    centroCusto: x.setor === 'proibido' ? null : bruto.centroCusto,
    remessa: x.remessa ? bruto.remessa : null,
    lavanderia: x.lavanderia ? bruto.lavanderia : null,
    fornecedor: x.lavanderia && bruto.lavanderia === 'terceirizada' ? bruto.fornecedor : null,
    motivoPerda: x.motivo ? bruto.motivoPerda : null,
  };
  const p = esquemaRegistrarMovimentoRoupa.safeParse(ajustado);
  if (!p.success) return { ok: false, mensagens: [...new Set(p.error.issues.map((i) => i.message))] };
  const corpo = normalizarMovimentoRoupa(p.data);
  const recusas = conferirMovimentoRoupa(corpo, {
    hoje: c.hoje,
    pecasAtivas: new Set(c.pecas.filter((y) => y.ativa).map((y) => y.id)),
    setoresAtivos: new Set(c.setores.filter((y) => y.ativo).map((y) => y.codigo)),
    remessa: x.remessa ? (c.remessa ?? null) : null,
    fornecedorExiste: true,
  });
  if (recusas.length) return { ok: false, mensagens: recusas.map((r) => r.mensagem) };
  return { ok: true, corpo };
}

/** A prévia da conferência do retorno com o envio (a mesma conta do servidor), ou null sem peso. */
export function previaRetorno(
  envio: Pick<MovimentoRoupa, 'pesoKg' | 'itens'> | null,
  f: Pick<FormMovimentoRoupa, 'peso' | 'linhas'>,
  toleranciaPct: number,
): ConferenciaRetornoRoupa | null {
  const peso = numeroDoTexto(f.peso);
  if (!envio || peso === null || peso <= 0) return null;
  return conferirRetornoRoupa(
    { pesoKg: envio.pesoKg ?? 0, itens: envio.itens },
    { pesoKg: peso, itens: itensDasLinhas(f.linhas) },
    toleranciaPct,
  );
}

/** As cotas que mudaram no setor (a quantidade digitada diferente da gravada; vazio conta como zero). */
export function cotasAlteradas(
  centroCusto: number,
  valores: Readonly<Record<number, string | number>>,
  atuais: readonly CotaRoupa[],
): { peca: number; quantidade: number }[] | { erro: string } {
  const gravada = new Map(
    atuais.filter((c) => c.centroCusto === centroCusto).map((c) => [c.peca, c.quantidade]),
  );
  const r: { peca: number; quantidade: number }[] = [];
  for (const [chave, texto] of Object.entries(valores)) {
    const peca = Number(chave);
    const q = String(texto).trim() === '' ? 0 : numeroDoTexto(texto);
    if (q === null || q < 0 || !Number.isInteger(q) || q > 9999)
      return { erro: 'A cota é um número inteiro de 0 a 9999.' };
    if (q !== (gravada.get(peca) ?? 0)) r.push({ peca, quantidade: q });
  }
  return r.sort((a, b) => a.peca - b.peca);
}

/** O kit precisa de composição; a peça comum não tem. As linhas viram a composição do contrato. */
export function composicaoDasLinhas(linhas: readonly LinhaPeca[]): { peca: number; quantidade: number }[] {
  return itensDasLinhas(linhas).filter((i) => i.quantidade > 0);
}

export const fmtKg = (n: number | null): string =>
  n === null
    ? '—'
    : `${(Math.round(n * 1000) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`;

export const fmtReais = (centavos: number | null): string =>
  centavos === null ? '—' : (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const fmtNumero = (n: number | null, casas = 2): string =>
  n === null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: casas });

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
export const dataCurta = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;

/** Instante ISO → "DD/MM HH:MM" (o relógio do servidor, sem fuso do navegador). */
export const instanteCurto = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`
    : iso;

/** "AAAA-MM-DD" menos `dias`. */
export const menosDias = (iso: string, dias: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

export function nomeDe<T extends { readonly nome: string }>(
  lista: readonly T[],
  chave: (x: T) => number,
  valor: number | null,
): string {
  if (valor === null) return '—';
  return lista.find((x) => chave(x) === valor)?.nome ?? `#${valor}`;
}

/** As peças do movimento em texto ("Lençol × 10, Fronha × 4"). */
export function itensTexto(itens: readonly ItemMovimentoRoupa[], pecas: readonly PecaRoupa[]): string {
  if (itens.length === 0) return '—';
  return itens.map((i) => `${nomeDe(pecas, (p) => p.id, i.peca)} × ${i.quantidade}`).join(', ');
}

/** Pode cancelar agora? (o servidor confere de novo o prazo e a versão). */
export function podeCancelar(
  m: Pick<MovimentoRoupa, 'situacao' | 'tipo' | 'em'>,
  agora: string,
  horas: number,
): boolean {
  if (m.situacao === 'cancelado') return false;
  if (m.tipo === 'envio' && m.situacao === 'retornado') return false;
  const passou = (Date.parse(agora) - Date.parse(m.em)) / 3_600_000;
  return Number.isFinite(passou) ? passou <= horas : true;
}
