// Conferência cruzada (regra 6 da ficha do M15; cap-11 §11.1): na amostra estratificada, o registro lido das
// respostas estruturadas e montado pelo leitor tem de bater com o formulário gravado com o registro (XML) em
// 99,5% ou mais de título e valor. A comparação é por campo do XML com valor (seções e campos vazios não
// contam): o mesmo título normalizado com o mesmo valor normalizado. O resultado sai só em contagens.
import type { CampoFormulario, ItemResposta } from '@sgh/contratos';
import { textoDoValor } from './formulario.js';
import { respostasPlanas } from './respostas.js';

export const META_CONFERENCIA = 0.995;

/** Normalização da comparação: sem acento, minúscula, espaços e pontuação de fim unificados. */
export function normalizarComparacao(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\u00A0\s]+/g, ' ')
    .replace(/\s*([:;,.])\s*$/g, '')
    .replace(/\s*;\s*/g, ';')
    .trim();
}

/** As mesmas palavras, em qualquer ordem e com qualquer separador de item (lista marcada, texto em linhas). */
function mesmasPalavras(a: string, b: string): boolean {
  const bolsa = (s: string) =>
    s
      .replace(/[;\n|]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .sort()
      .join(' ');
  if (bolsa(a) === bolsa(b)) return true;
  // Número com a unidade de um lado só (o formulário mostra o número; a resposta guarda a unidade à parte).
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  return (
    /^-?\d/.test(curto) && longo.startsWith(`${curto} `) && /^\S{1,10}$/.test(longo.slice(curto.length + 1))
  );
}

export interface ResultadoConferencia {
  readonly comparados: number;
  readonly iguais: number;
  /** Título igual e valor diferente. */
  readonly valorDiferente: number;
  /** Campo do XML sem resposta estruturada de mesmo título. */
  readonly semPar: number;
  /** Campos fora da conta: perguntas que não gravam resposta estruturada (alergias: em outra parte). */
  readonly ignorados?: number;
}

/** Tipos de pergunta cujo valor não fica nas respostas estruturadas (as alergias vão a outra parte). */
export const TIPOS_FORA_DO_ESTRUTURADO: ReadonlySet<string> = new Set(['19', '23']);

/** Compara as respostas lidas com os campos do formulário gravado (só contagens). */
export function conferirRegistro(
  campos: readonly CampoFormulario[],
  respostas: readonly ItemResposta[],
  opcoes: { readonly ignorarTitulos?: ReadonlySet<string> } = {},
): ResultadoConferencia {
  const planas = respostasPlanas(respostas);
  const porTitulo = new Map<string, string[]>();
  for (const p of planas) {
    const t = normalizarComparacao(p.titulo);
    porTitulo.set(t, [...(porTitulo.get(t) ?? []), normalizarComparacao(p.valor)]);
  }
  let comparados = 0;
  let iguais = 0;
  let valorDiferente = 0;
  let semPar = 0;
  let ignorados = 0;
  const ignorar = new Set([...(opcoes.ignorarTitulos ?? [])].map(normalizarComparacao));
  for (const c of campos) {
    if (c.secao) continue;
    const valor = normalizarComparacao(textoDoValor(c.valor));
    if (!valor) continue;
    if (ignorar.has(normalizarComparacao(c.titulo)) || c.classe === 'TfRespAlergia') {
      ignorados++;
      continue;
    }
    comparados++;
    const candidatos = porTitulo.get(normalizarComparacao(c.titulo));
    if (!candidatos) {
      semPar++;
      continue;
    }
    if (candidatos.some((v) => v === valor || mesmasPalavras(v, valor))) iguais++;
    else valorDiferente++;
  }
  return { comparados, iguais, valorDiferente, semPar, ignorados };
}

export function somarConferencias(rs: readonly ResultadoConferencia[]): ResultadoConferencia {
  return rs.reduce(
    (a, r) => ({
      comparados: a.comparados + r.comparados,
      iguais: a.iguais + r.iguais,
      valorDiferente: a.valorDiferente + r.valorDiferente,
      semPar: a.semPar + r.semPar,
      ignorados: (a.ignorados ?? 0) + (r.ignorados ?? 0),
    }),
    { comparados: 0, iguais: 0, valorDiferente: 0, semPar: 0, ignorados: 0 },
  );
}

export function taxaIgualdade(r: ResultadoConferencia): number {
  return r.comparados === 0 ? 1 : r.iguais / r.comparados;
}

export const NOTA_DIVERGENTE =
  'difere do formulário gravado com o registro (leitura a confirmar): a referência é a aba "Como emitido"';

/**
 * Contorno da DP-28 (ficha do M15, seção 14): a resposta estruturada cujo valor difere do campo de mesmo título
 * no formulário gravado com o registro fica marcada "a confirmar"; o documento como emitido é a referência.
 */
export function marcarDivergencias(
  itens: readonly ItemResposta[],
  campos: readonly CampoFormulario[],
): { itens: ItemResposta[]; divergentes: number } {
  const porTitulo = new Map<string, string[]>();
  for (const c of campos) {
    if (c.secao) continue;
    const v = normalizarComparacao(textoDoValor(c.valor));
    if (!v) continue;
    const t = normalizarComparacao(c.titulo);
    porTitulo.set(t, [...(porTitulo.get(t) ?? []), v]);
  }
  let divergentes = 0;
  const marcar = (l: readonly ItemResposta[]): ItemResposta[] =>
    l.map((i) => {
      const filhos = marcar(i.itens);
      const xml = porTitulo.get(normalizarComparacao(i.titulo));
      const valor = normalizarComparacao(i.valores.join('; '));
      const difere =
        xml !== undefined && valor !== '' && !xml.some((v) => v === valor || mesmasPalavras(v, valor));
      if (difere) divergentes++;
      return { ...i, aConfirmar: difere ? (i.aConfirmar ?? NOTA_DIVERGENTE) : i.aConfirmar, itens: filhos };
    });
  return { itens: marcar(itens), divergentes };
}
