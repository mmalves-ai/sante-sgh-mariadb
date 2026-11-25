// Regras do montador pela apresentação da fonte pagadora (06-FAT linha 30, padrão TISS 4.x). Tudo puro, sem banco:
//   - identificação do contratado: pelo código na operadora (padrão), pelo CNPJ ou pelo CPF, conferidos pelo dígito;
//     o XML usa o elemento da escolha do padrão (codigoPrestadorNaOperadora, cnpjContratado/CNPJ, cpfContratado/CPF);
//   - numeração da guia do prestador: a guia sem número recebe o próximo da série (prefixo + sequência com zeros, até
//     20 caracteres, o tamanho do padrão); número repetido no lote é recusado;
//   - quebra do resumo de internação por datas de corte: cada parte leva só os itens do seu período, as datas da parte
//     e o tipo de faturamento do padrão (1 parcial nas primeiras, 2 final na última; sem quebra, a conta fica como está);
//   - SP/SADT por prestador ou por data: uma guia por executante (a chave vem da conta) ou por dia de execução.
// As partes recebem o número da guia com o sufixo da parte; o total das partes é o total da conta (nada some nem dobra).
import type { ContaTiss, ItemContaTiss } from '@sgh/contratos';

export type TipoIdentificacaoContratado = 'codigo' | 'cnpj' | 'cpf';
export interface IdentificacaoContratado {
  readonly tipo: TipoIdentificacaoContratado;
  readonly valor: string;
}

const digitos = (s: string) => s.replace(/\D/g, '');

/** CPF com os dois dígitos verificadores (módulo 11); sequência repetida não vale. */
export function cpfValido(s: string): boolean {
  const d = digitos(s);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** CNPJ numérico com os dois dígitos verificadores (pesos 5..2, 9..2). */
export function cnpjValido(s: string): boolean {
  const d = digitos(s);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s2, p, i) => s2 + p * Number(d[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/**
 * A identificação do contratado na guia e no cabeçalho. Sem documento escolhido, vale o código na operadora (o da
 * regra da fonte, senão o do cadastro do prestador). Devolve o erro em português quando não fecha.
 */
export function identificacaoContratado(
  escolha: TipoIdentificacaoContratado,
  codigoNaOperadora: string,
  documento: string | null,
): { identificacao: IdentificacaoContratado | null; erro: string | null } {
  if (escolha === 'codigo') {
    const c = codigoNaOperadora.trim();
    if (!c || c.length > 14)
      return { identificacao: null, erro: 'O código do contratado na operadora tem de 1 a 14 caracteres.' };
    return { identificacao: { tipo: 'codigo', valor: c }, erro: null };
  }
  const d = digitos(documento ?? '');
  if (escolha === 'cnpj' && !cnpjValido(d))
    return {
      identificacao: null,
      erro: 'O CNPJ do contratado não confere (14 dígitos e dígito verificador).',
    };
  if (escolha === 'cpf' && !cpfValido(d))
    return {
      identificacao: null,
      erro: 'O CPF do contratado não confere (11 dígitos e dígito verificador).',
    };
  return { identificacao: { tipo: escolha, valor: d }, erro: null };
}

// ── Numeração ──────────────────────────────────────────────────────────────────────────────────────

export interface SerieNumeracao {
  readonly prefixo: string;
  /** O próximo número da série (inteiro positivo). */
  readonly proximo: number;
  /** Quantos dígitos a sequência leva (com zeros à esquerda). */
  readonly largura: number;
}

export const TAMANHO_NUMERO_GUIA = 20;

/**
 * Dá número às guias que não têm (na ordem do lote) e devolve o próximo da série. Recusa o número repetido no lote e
 * a série que passa dos 20 caracteres do padrão.
 */
export function numerarGuias<T extends { readonly numeroGuia: string }>(
  guias: readonly T[],
  serie: SerieNumeracao,
): { guias: T[]; proximo: number; erros: string[] } {
  const erros: string[] = [];
  if (!Number.isInteger(serie.proximo) || serie.proximo < 1)
    erros.push('O próximo número da série é inteiro positivo.');
  let n = serie.proximo;
  const saida = guias.map((g) => {
    if (g.numeroGuia.trim()) return g;
    const numero = `${serie.prefixo}${String(n++).padStart(serie.largura, '0')}`;
    if (numero.length > TAMANHO_NUMERO_GUIA)
      erros.push(
        `O número ${numero} passa de ${TAMANHO_NUMERO_GUIA} caracteres: encurte o prefixo ou a largura.`,
      );
    return { ...g, numeroGuia: numero };
  });
  const vistos = new Set<string>();
  for (const g of saida) {
    if (vistos.has(g.numeroGuia)) erros.push(`O número de guia ${g.numeroGuia} se repete no lote.`);
    vistos.add(g.numeroGuia);
  }
  return { guias: saida, proximo: n, erros: [...new Set(erros)] };
}

// ── Quebra de guias ────────────────────────────────────────────────────────────────────────────────

const sufixado = (numero: string, parte: number, partes: number): string => {
  if (partes === 1 || !numero) return numero;
  const suf = `-${parte}`;
  return `${numero.slice(0, TAMANHO_NUMERO_GUIA - suf.length)}${suf}`;
};

/**
 * Quebra o resumo de internação nas datas de corte (o corte é o último dia da parte). Parte sem item não sai. A
 * primeira parte começa no início da internação e a última termina na alta; as do meio, à meia-noite do corte.
 */
export function quebrarResumoInternacao(conta: ContaTiss, cortes: readonly string[]): ContaTiss[] {
  if (conta.tipoGuia !== 3) return [conta];
  const limites = [...new Set(cortes)].filter((c) => c >= conta.inicio.data && c < conta.fim.data).sort();
  if (!limites.length) return [conta];
  const faixas: { de: string | null; ate: string | null }[] = [];
  let de: string | null = null;
  for (const c of limites) {
    faixas.push({ de, ate: c });
    de = c;
  }
  faixas.push({ de, ate: null });
  const partes = faixas
    .map((f) => ({
      f,
      itens: conta.itens.filter(
        (i) => (f.de === null || i.data > f.de) && (f.ate === null || i.data <= f.ate),
      ),
    }))
    .filter((p) => p.itens.length > 0);
  if (partes.length <= 1) return [conta];
  const proximoDia = (d: string) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return partes.map((p, k) => {
    const ultima = k === partes.length - 1;
    return {
      ...conta,
      numeroGuia: sufixado(conta.numeroGuia, k + 1, partes.length),
      inicio: p.f.de === null ? conta.inicio : { data: proximoDia(p.f.de), hora: '00:00:00' },
      fim: p.f.ate === null ? conta.fim : { data: p.f.ate, hora: '23:59:59' },
      tipoFaturamento: ultima ? '2' : '1',
      itens: p.itens,
    };
  });
}

/**
 * As datas de corte do resumo quebrado por período: a cada `dias` dias desde a entrada (o corte é o último dia de cada
 * parte), só as que ficam antes da alta. Dias fora de 1 a 366 não quebram.
 */
export function cortesPorPeriodo(inicio: string, fim: string, dias: number): string[] {
  if (!Number.isInteger(dias) || dias < 1 || dias > 366) return [];
  const base = Date.parse(`${inicio}T00:00:00Z`);
  const cortes: string[] = [];
  for (let k = 1; k <= 400; k++) {
    const d = new Date(base + (k * dias - 1) * 86_400_000).toISOString().slice(0, 10);
    if (d >= fim) break;
    cortes.push(d);
  }
  return cortes;
}

export type CriterioSpSadt = 'prestador' | 'data';

/**
 * Separa a SP/SADT: uma guia por executante (a chave de cada item vem da conta, na mesma ordem; sem chave, fica com o
 * executante da conta) ou por dia de execução. Uma chave só: a conta fica como está.
 */
export function separarSpSadt(
  conta: ContaTiss,
  criterio: CriterioSpSadt,
  executantes: readonly (string | number | null)[] = [],
): ContaTiss[] {
  if (conta.tipoGuia !== 2) return [conta];
  const chave = (i: ItemContaTiss, k: number) =>
    criterio === 'data' ? i.data : String(executantes[k] ?? 'conta');
  const grupos = new Map<string, ItemContaTiss[]>();
  conta.itens.forEach((i, k) => {
    const c = chave(i, k);
    grupos.set(c, [...(grupos.get(c) ?? []), i]);
  });
  if (grupos.size <= 1) return [conta];
  const ordem = [...grupos.keys()];
  if (criterio === 'data') ordem.sort();
  return ordem.map((c, k) => {
    const itens = grupos.get(c) ?? [];
    const datas = itens.map((i) => i.data).sort();
    return {
      ...conta,
      numeroGuia: sufixado(conta.numeroGuia, k + 1, ordem.length),
      ...(criterio === 'data'
        ? {
            inicio: { ...conta.inicio, data: datas[0] ?? conta.inicio.data },
            fim: { ...conta.fim, data: datas.at(-1) ?? conta.fim.data },
          }
        : {}),
      itens,
    };
  });
}

/** Total da conta em centavos (para conferir que a quebra não some nem dobra valor). */
export const centavosDaConta = (c: ContaTiss): number =>
  c.itens.reduce((s, i) => s + Math.round(i.quantidade * i.valorUnitario * 100), 0);
