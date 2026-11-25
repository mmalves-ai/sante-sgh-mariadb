// F7, 07-FIN linha 110: apuração dos tributos que o hospital reteve dos prestadores e o DARF (Documento de Arrecadação de
// Receitas Federais) do recolhimento. A apuração junta o retido da competência por código de receita da Receita Federal
// (as parcelas impressas com a soma), o DARF sai da guia gravada com os campos numerados do modelo oficial (01 a 10) e o
// batimento confere o apurado contra a EFD-Reinf da competência (IRRF, contribuições sociais e INSS). A DCTFWeb não é
// transmitida pelo sistema: a Receita a monta pela Reinf, pelo eSocial e pelo MIT, e ela é confirmada no e-CAC; o
// produto entrega a Reinf, o DARF para conferência e o batimento dos totais. Regras puras, sem banco.
import { centavos, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';

const rec = (codigo: string, mensagem: string, campos: string[]): RecusaFinanceiro => ({
  codigo,
  mensagem,
  campos,
});

/** Código de receita do DARF: quatro dígitos (a variação, quando existe, não entra no campo 04). */
export const CODIGO_RECEITA_DARF = /^\d{4}$/;

/**
 * O código de receita da guia: o das retenções (todas iguais), senão o informado, senão o do tributo. Retenções com
 * códigos diferentes não cabem num DARF só, e o informado não pode contrariar o das retenções.
 */
export function receitaDoRecolhimento(
  retidos: readonly { readonly codigoReceita: string | null }[],
  informado: string | null,
  doTributo: string | null,
): { readonly codigo: string | null; readonly recusa: RecusaFinanceiro | null } {
  const proprios = [...new Set(retidos.map((r) => r.codigoReceita?.trim()).filter((c): c is string => !!c))];
  if (proprios.length > 1)
    return {
      codigo: null,
      recusa: rec(
        'receitas-distintas',
        `As retenções da competência têm códigos de receita diferentes (${proprios.join(', ')}): cada código vai num DARF.`,
        ['codigoReceita'],
      ),
    };
  const dado = informado?.trim() || null;
  const [proprio] = proprios;
  if (proprio && dado && dado !== proprio)
    return {
      codigo: null,
      recusa: rec(
        'receita-divergente',
        `As retenções foram lançadas com o código de receita ${proprio}; o informado (${dado}) não confere.`,
        ['codigoReceita'],
      ),
    };
  const codigo = proprio ?? dado ?? (doTributo?.trim() || null);
  if (codigo && !CODIGO_RECEITA_DARF.test(codigo))
    return {
      codigo: null,
      recusa: rec('receita-invalida', 'O código de receita do DARF tem quatro dígitos.', ['codigoReceita']),
    };
  return { codigo, recusa: null };
}

/** Período de apuração do retido mensal: o último dia da competência (AAAA-MM). */
export function periodoApuracao(competencia: string): string {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${competencia.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`;
}

export interface ItemApurado {
  readonly codigoReceita: string | null;
  readonly base: number;
  readonly valor: number;
}
export interface ParcelaReceita {
  readonly codigoReceita: string;
  readonly retencoes: number;
  readonly base: number;
  readonly valor: number;
}

/**
 * As parcelas da apuração por código de receita (o item sem código usa o da apuração), em ordem de código, com o total
 * conferível: a soma das parcelas é o total apurado.
 */
export function parcelasPorReceita(
  itens: readonly ItemApurado[],
  padrao: string,
): { readonly parcelas: readonly ParcelaReceita[]; readonly base: number; readonly total: number } {
  const grupos = new Map<string, { retencoes: number; base: number; valor: number }>();
  for (const i of itens) {
    const c = i.codigoReceita?.trim() || padrao;
    const g = grupos.get(c) ?? { retencoes: 0, base: 0, valor: 0 };
    g.retencoes += 1;
    g.base += i.base;
    g.valor += i.valor;
    grupos.set(c, g);
  }
  const parcelas = [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([codigoReceita, g]) => ({
      codigoReceita,
      retencoes: g.retencoes,
      base: centavos(g.base),
      valor: centavos(g.valor),
    }));
  return {
    parcelas,
    base: centavos(parcelas.reduce((s, p) => s + p.base, 0)),
    total: centavos(parcelas.reduce((s, p) => s + p.valor, 0)),
  };
}

export interface GuiaParaDarf {
  readonly razaoSocial: string;
  readonly cnpj: string | null;
  readonly competencia: string;
  readonly periodoApuracao: string | null;
  readonly codigoReceita: string | null;
  readonly referencia: string | null;
  readonly vencimento: string;
  readonly principal: number;
  readonly multa: number;
  readonly juros: number;
}
export interface CampoDarf {
  readonly numero: string;
  readonly rotulo: string;
  readonly valor: string;
}
export interface DocumentoDarf {
  readonly campos: readonly CampoDarf[];
  readonly total: number;
}

const reais = (v: number) =>
  centavos(v)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const cnpjFormatado = (c: string) =>
  `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12, 14)}`;

/**
 * O DARF da guia, com os campos numerados do modelo oficial: 01 nome, 02 período de apuração, 03 CNPJ, 04 código da
 * receita, 05 número de referência, 06 vencimento, 07 principal, 08 multa, 09 juros e 10 total (a soma das três
 * parcelas). Sem CNPJ do estabelecimento ou sem código de receita válido não há DARF.
 */
export function montarDarf(g: GuiaParaDarf): {
  readonly darf: DocumentoDarf | null;
  readonly recusa: RecusaFinanceiro | null;
} {
  const cnpj = (g.cnpj ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14)
    return {
      darf: null,
      recusa: rec('sem-cnpj', 'Cadastre o CNPJ do estabelecimento para emitir o DARF.', ['cnpj']),
    };
  if (!g.codigoReceita || !CODIGO_RECEITA_DARF.test(g.codigoReceita))
    return {
      darf: null,
      recusa: rec('receita-invalida', 'A guia não tem código de receita de quatro dígitos.', [
        'codigoReceita',
      ]),
    };
  if (g.principal <= 0 || g.multa < 0 || g.juros < 0)
    return {
      darf: null,
      recusa: rec('valor-invalido', 'O DARF precisa de valor principal positivo.', ['valor']),
    };
  const total = centavos(g.principal + g.multa + g.juros);
  const periodo = g.periodoApuracao ?? periodoApuracao(g.competencia);
  return {
    recusa: null,
    darf: {
      total,
      campos: [
        { numero: '01', rotulo: 'Nome', valor: g.razaoSocial },
        { numero: '02', rotulo: 'Período de apuração', valor: dataBr(periodo) },
        { numero: '03', rotulo: 'Número do CPF ou CNPJ', valor: cnpjFormatado(cnpj) },
        { numero: '04', rotulo: 'Código da receita', valor: g.codigoReceita },
        { numero: '05', rotulo: 'Número de referência', valor: g.referencia ?? '' },
        { numero: '06', rotulo: 'Data de vencimento', valor: dataBr(g.vencimento) },
        { numero: '07', rotulo: 'Valor do principal', valor: reais(g.principal) },
        { numero: '08', rotulo: 'Valor da multa', valor: reais(g.multa) },
        { numero: '09', rotulo: 'Valor dos juros e encargos', valor: reais(g.juros) },
        { numero: '10', rotulo: 'Valor total', valor: reais(total) },
      ],
    },
  };
}

/** Os grupos de valor da EFD-Reinf em que o retido de cada tributo é informado. */
export const GRUPOS_REINF = ['irrf', 'csrf', 'inss'] as const;
export type GrupoReinf = (typeof GRUPOS_REINF)[number];

/** O grupo da Reinf do tributo pela sigla (IR → irrf; PIS, COFINS, CSLL e CSRF → csrf; INSS → inss). */
export function grupoReinf(sigla: string): GrupoReinf | null {
  const s = sigla.toUpperCase();
  if (/INSS|CPRB/.test(s)) return 'inss';
  if (/CSRF|PIS|COFINS|CSLL|PCC/.test(s)) return 'csrf';
  if (/\bIR|IRRF|IRPJ/.test(s) || s.startsWith('IR') || s.endsWith('-IR')) return 'irrf';
  return null;
}

export interface LinhaBatimento {
  readonly grupo: GrupoReinf;
  readonly apurado: number;
  readonly reinf: number;
  readonly diferenca: number;
  readonly confere: boolean;
}

/**
 * Bate o retido apurado da competência (por tributo) com os totais dos eventos da Reinf (por grupo). Tributo sem
 * grupo na Reinf (ISS, por exemplo) fica fora e é devolvido à parte. A diferença é apurado menos Reinf.
 */
export function baterComReinf(
  apurado: readonly { readonly sigla: string; readonly valor: number }[],
  reinf: Readonly<Record<GrupoReinf, number>>,
): {
  readonly linhas: readonly LinhaBatimento[];
  readonly foraDaReinf: readonly string[];
  readonly confere: boolean;
} {
  const soma: Record<GrupoReinf, number> = { irrf: 0, csrf: 0, inss: 0 };
  const fora = new Set<string>();
  for (const a of apurado) {
    const g = grupoReinf(a.sigla);
    if (g) soma[g] += a.valor;
    else fora.add(a.sigla);
  }
  const linhas = GRUPOS_REINF.filter((g) => soma[g] !== 0 || reinf[g] !== 0).map((g) => {
    const ap = centavos(soma[g]);
    const re = centavos(reinf[g]);
    const diferenca = centavos(ap - re);
    return { grupo: g, apurado: ap, reinf: re, diferenca, confere: diferenca === 0 };
  });
  return { linhas, foraDaReinf: [...fora].sort(), confere: linhas.every((l) => l.confere) };
}
