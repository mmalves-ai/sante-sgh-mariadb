// Vigilância diária de gravação em produção (ficha do M38, campo 1 e campo 9; cap-14 §14.2.6). Regras puras, sem
// banco nem disco: a partir da referência vigente da operação e da ESTRUTURA de uma gravação já feita (por coluna,
// só "preenchida" e "confere com a classe da referência", calculados no banco; nenhum valor sai do banco), monta as
// diferenças no mesmo vocabulário do comparador do M03 (tools/assinatura/src/comparador.ts) e, com a amostra e o
// resumo de onda0.ts, a linha do dia de SGH_CFG_COEX_VIGIA.
//
// O que a vigilância confere de uma gravação já confirmada: as tabelas, o número de linhas, o conjunto de colunas
// preenchidas e a classe das colunas cujo valor a referência fixa (constante, sentinela, domínio e cópia de outra
// coluna). Generators, efeitos de trigger e formato só se medem na hora da gravação: continuam provados pelo
// `assinatura:testar` (cenários) e pela prova pós-escrita do executor (D-VIGIA-38).
import {
  type Assinatura,
  type Diferenca,
  type DiferencaAceita,
  partesClasse,
  type ResultadoVigia,
  valoresDominio,
} from '@sgh/contratos';
import { alertasDaVigia, amostrarGravacoes, resumirVigia } from './onda0.js';

/** O que o banco devolve de uma coluna de uma linha gravada: nunca o valor. */
export interface ColunaEstrutura {
  readonly preenchida: boolean;
  /**
   * A coluna confere com o valor que a classe da referência fixa (constante, sentinela, domínio ou cópia);
   * null quando a classe não fixa valor (entrada, generator, carimbo do banco, vazio).
   */
  readonly confere: boolean | null;
}

export interface TabelaEstrutura {
  readonly tabela: string;
  readonly acao: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Uma entrada por linha gravada pela operação nesta tabela. */
  readonly linhas: readonly Readonly<Record<string, ColunaEstrutura>>[];
}

export interface EstruturaGravacao {
  readonly tabelas: readonly TabelaEstrutura[];
}

/** O que o leitor do banco tem de comparar numa coluna: o valor esperado vai como parâmetro, nunca volta. */
export type ComparacaoColuna =
  | { readonly tipo: 'nenhuma' }
  | { readonly tipo: 'igual'; readonly valores: readonly string[] }
  | { readonly tipo: 'copia'; readonly tabela: string; readonly coluna: string };

/** Para cada coluna da referência, a comparação que o leitor faz no banco (sem trazer o valor). */
export function comparacoesDaReferencia(
  ref: Assinatura,
  tabela: string,
): Readonly<Record<string, ComparacaoColuna>> {
  const t = ref.tabelas.find((x) => x.tabela === tabela);
  const r: Record<string, ComparacaoColuna> = {};
  for (const [col, c] of Object.entries(t?.colunas ?? {})) {
    const { tipo, arg } = partesClasse(c.classe);
    if (tipo === 'constante' || tipo === 'sentinela')
      r[col] = { tipo: 'igual', valores: [arg === "''" ? '' : (arg ?? '')] };
    else if (tipo === 'dominio') r[col] = { tipo: 'igual', valores: valoresDominio(c.classe) };
    else if (tipo === 'copia') {
      const [ot, oc] = (arg ?? '').split('.');
      r[col] = { tipo: 'copia', tabela: ot ?? '', coluna: oc ?? '' };
    } else r[col] = { tipo: 'nenhuma' };
  }
  return r;
}

const aceitaPor = (aceitas: readonly DiferencaAceita[], d: Omit<Diferenca, 'aceita'>) =>
  aceitas.some(
    (a) =>
      a.elemento === d.elemento && a.tipo === d.tipo && a.esperado === d.esperado && a.obtido === d.obtido,
  );

/**
 * Diferenças de UMA gravação contra a referência (o mesmo caminho de elemento do comparador: `T:ACAO`,
 * `T:ACAO.linhas`, `T:ACAO.colunas.C`). `obtido` nunca leva valor: `preenchida`, `vazia` ou `outro-valor`.
 * Só a diferença exata de `diferencas_aceitas` da referência passa como aceita.
 */
export function diferencasDaGravacao(ref: Assinatura, g: EstruturaGravacao): Diferenca[] {
  const brutas: Omit<Diferenca, 'aceita'>[] = [];
  const chave = (t: { tabela: string; acao: string }) => `${t.tabela}:${t.acao}`;
  const obtidas = new Map(g.tabelas.map((t) => [chave(t), t]));
  for (const t of ref.tabelas) {
    const k = chave(t);
    const o = obtidas.get(k);
    if (!o || o.linhas.length === 0) {
      if (t.linhas > 0)
        brutas.push({ tipo: 'tabela', elemento: k, esperado: `${t.linhas} linha(s)`, obtido: 'ausente' });
      continue;
    }
    if (o.linhas.length !== t.linhas)
      brutas.push({
        tipo: 'linhas',
        elemento: `${k}.linhas`,
        esperado: String(t.linhas),
        obtido: String(o.linhas.length),
      });
    const nomes = [
      ...new Set([...Object.keys(t.colunas), ...o.linhas.flatMap((l) => Object.keys(l))]),
    ].sort();
    for (const col of nomes) {
      const e = t.colunas[col];
      const esperadaPreenchida = e !== undefined && e.classe !== 'vazio';
      const tipoEsperado = e ? partesClasse(e.classe).tipo : null;
      const el = `${k}.colunas.${col}`;
      // A diferença conta uma vez por coluna, mesmo com várias linhas divergentes.
      const preenchidas = o.linhas.map((l) => l[col]?.preenchida ?? false);
      if (preenchidas.some((p) => p !== esperadaPreenchida)) {
        const sentinela = tipoEsperado === 'sentinela';
        brutas.push({
          tipo: sentinela ? 'classe' : 'colunas',
          elemento: el,
          esperado: e?.classe ?? 'ausente',
          obtido: esperadaPreenchida ? 'vazia' : 'preenchida',
        });
        continue;
      }
      if (!esperadaPreenchida || !e) continue;
      if (o.linhas.some((l) => l[col]?.confere === false))
        brutas.push({ tipo: 'classe', elemento: el, esperado: e.classe, obtido: 'outro-valor' });
    }
  }
  for (const [k, o] of obtidas) {
    if (ref.tabelas.some((t) => chave(t) === k) || o.linhas.length === 0) continue;
    brutas.push({ tipo: 'tabela', elemento: k, esperado: 'ausente', obtido: `${o.linhas.length} linha(s)` });
  }
  return brutas.map((d) => ({ ...d, aceita: aceitaPor(ref.diferencas_aceitas, d) }));
}

/**
 * Cenário de referência de cada evento da trilha do legado (auditoria.registrarEventoLegado, ficha do M06): a
 * vigilância compara cada evento com o cenário do seu tipo. Bloqueio (8) e desbloqueio (9) vêm do mesmo cenário,
 * que grava os dois; por evento, a referência é de uma linha (`referenciaPorEvento`).
 */
export const CENARIO_DO_TIPO_EVENTO: Readonly<Record<number, string>> = {
  1: 'consulta-res',
  6: 'login-ok',
  7: 'login-falho',
  8: 'bloqueio-sessao',
  9: 'bloqueio-sessao',
  10: 'fim-sessao',
};

/** A referência de um cenário reduzida a um evento (uma linha por tabela gravada pelo evento). */
export function referenciaPorEvento(ref: Assinatura): Assinatura {
  return { ...ref, tabelas: ref.tabelas.map((t) => ({ ...t, linhas: Math.min(t.linhas, 1) })) };
}

/** Uma gravação do novo no dia: o ID legado da linha principal e a referência que vale para ela. */
export interface GravacaoDoDia {
  readonly id: string;
  /** Cenário de referência (null: o evento é de um tipo sem cenário, o que já é divergência na onda 0). */
  readonly cenario: string | null;
}

export interface DepsVigiaDoDia {
  readonly hospital: string;
  readonly data: string;
  readonly operacao: string;
  readonly tamanho: number;
  /** As gravações do novo no dia (pela SGH_TRILHA), com o cenário de cada uma. */
  readonly gravacoes: readonly GravacaoDoDia[];
  /** Referências vigentes por cenário (as `*.assinatura.json` da operação). */
  readonly referencias: Readonly<Record<string, Assinatura>>;
  /** Lê do banco a estrutura de uma gravação, com as comparações da referência (nenhum valor volta). */
  readonly lerEstrutura: (id: string, ref: Assinatura) => Promise<EstruturaGravacao>;
  /** M39: a comparação da operação (a da onda 1 confere só a estrutura imutável); sem ela, a do M38. */
  readonly comparar?: (ref: Assinatura, g: EstruturaGravacao) => Diferenca[];
}

/** Diferença sintética de um evento sem cenário de referência: o tipo do evento fora do vocabulário da onda. */
function semCenario(tabela: string): Diferenca {
  return {
    tipo: 'classe',
    elemento: `${tabela}:INSERT.colunas.ID_TBTPACAOAUDIT`,
    esperado: `dominio:${Object.keys(CENARIO_DO_TIPO_EVENTO).join('|')}`,
    obtido: 'outro-valor',
    aceita: false,
  };
}

/**
 * Um dia de uma operação: sorteia a amostra (determinística pela semente `<hospital>:<data>:<operacao>`), lê a
 * estrutura de cada gravação sorteada, compara com a referência do seu cenário e resume. Gravações no dia e amostra
 * vazia nunca acontecem juntas (risco 4 do preparo): `tamanho` 0 com gravações é recusado.
 */
export async function vigiarDia(d: DepsVigiaDoDia): Promise<ResultadoVigia> {
  if (d.gravacoes.length > 0 && d.tamanho < 1)
    throw new RangeError('amostra vazia com gravações no dia: o dia pareceria limpo sem estar');
  const porId = new Map(d.gravacoes.map((g) => [g.id, g]));
  const ids = amostrarGravacoes(
    d.gravacoes.map((g) => g.id),
    d.tamanho,
    `${d.hospital}:${d.data}:${d.operacao}`,
  );
  const gravacoes: Diferenca[][] = [];
  for (const id of ids) {
    const g = porId.get(id);
    const ref = g?.cenario ? d.referencias[g.cenario] : undefined;
    if (!ref) {
      gravacoes.push([semCenario(Object.values(d.referencias)[0]?.tabelas[0]?.tabela ?? 'DESCONHECIDO')]);
      continue;
    }
    const porEvento = referenciaPorEvento(ref);
    const comparar = d.comparar ?? diferencasDaGravacao;
    gravacoes.push(comparar(porEvento, await d.lerEstrutura(id, porEvento)));
  }
  return resumirVigia({ hospital: d.hospital, data: d.data, operacao: d.operacao, gravacoes });
}

export interface DepsVigiaHospital {
  readonly hospital: string;
  readonly data: string;
  readonly tamanho: number;
  /** Operações `liberada` no hospital (catálogo efetivo). */
  readonly operacoes: readonly string[];
  /** A operação tem localizador das gravações (senão: `semLocalizador`, nunca dia limpo). */
  readonly localizavel: (operacao: string) => boolean;
  /**
   * M39: o motivo de a operação ficar fora da amostra estrutural (só altera linha viva; D-VIGIA-39), ou null. Ela
   * aparece em `foraDaAmostra`, com o motivo: nunca dia limpo, nunca "sem localizador".
   */
  readonly foraDaAmostra?: (operacao: string) => string | null;
  readonly gravacoesDoDia: (operacao: string) => Promise<readonly GravacaoDoDia[]>;
  readonly referencias: (operacao: string) => Readonly<Record<string, Assinatura>>;
  readonly lerEstrutura: (operacao: string, id: string, ref: Assinatura) => Promise<EstruturaGravacao>;
  /** Grava a linha do dia (SGH_CFG_COEX_VIGIA); ausente no ensaio. */
  readonly gravar?: (r: ResultadoVigia) => Promise<unknown>;
  /** M39: a comparação de cada operação (a da onda 1, só a estrutura imutável); sem ela, a do M38. */
  readonly comparar?: (
    operacao: string,
  ) => ((ref: Assinatura, g: EstruturaGravacao) => Diferenca[]) | undefined;
}

export interface ResultadoVigiaHospital {
  readonly resultados: readonly ResultadoVigia[];
  readonly semLocalizador: readonly string[];
  /** M39: operações liberadas fora da amostra estrutural, com o motivo (provadas pela reexecução). */
  readonly foraDaAmostra: readonly { readonly operacao: string; readonly motivo: string }[];
  /** Alertas diretos (cap-14 §14.6, divergência de assinatura): um por operação com divergência. */
  readonly alertas: readonly string[];
}

/**
 * Um dia de um hospital (o job diário e `pnpm assinatura:vigiar`): cada operação liberada, com localizador, tem a
 * amostra comparada e a linha do dia gravada; a operação liberada sem localizador volta em `semLocalizador`.
 */
export async function vigiarHospitalDia(d: DepsVigiaHospital): Promise<ResultadoVigiaHospital> {
  const resultados: ResultadoVigia[] = [];
  const semLocalizador: string[] = [];
  const foraDaAmostra: { operacao: string; motivo: string }[] = [];
  for (const operacao of [...d.operacoes].sort()) {
    if (!d.localizavel(operacao)) {
      const motivo = d.foraDaAmostra?.(operacao) ?? null;
      if (motivo) foraDaAmostra.push({ operacao, motivo });
      else semLocalizador.push(operacao);
      continue;
    }
    const r = await vigiarDia({
      hospital: d.hospital,
      data: d.data,
      operacao,
      tamanho: d.tamanho,
      gravacoes: await d.gravacoesDoDia(operacao),
      referencias: d.referencias(operacao),
      lerEstrutura: (id, ref) => d.lerEstrutura(operacao, id, ref),
      ...(d.comparar?.(operacao) ? { comparar: d.comparar(operacao)! } : {}),
    });
    if (d.gravar) await d.gravar(r);
    resultados.push(r);
  }
  return { resultados, semLocalizador, foraDaAmostra, alertas: alertasDaVigia(resultados) };
}
