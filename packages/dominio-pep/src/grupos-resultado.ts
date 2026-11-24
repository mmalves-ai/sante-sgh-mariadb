// Grupos comparativos de resultados e filtro salvo do profissional (F3.3, linha 03-PEP L128).
// - Grupo comparativo: lista ordenada de exames (o exame inteiro ou um analito dele) que o hospital monta para ver
//   resultados lado a lado (ex.: "Função renal": creatinina, ureia, potássio). O cadastro recusa item repetido e item
//   redundante (o exame inteiro e um analito do mesmo exame no mesmo grupo).
// - Filtro salvo: escolhas do profissional para abrir os resultados (grupos, exames, período, escopo do atendimento,
//   só liberados, só os meus pedidos, mostrar pendentes). Um só padrão por profissional (aplicado ao abrir).
// - Comparativo: matriz analito × coleta, com a faixa de normalidade aplicada em cada célula (numérica do laudo ou a
//   do texto), o crítico (marca do laudo ou limite crítico do laudo) e a tendência por linha (subindo, descendo,
//   estável), na ordem do grupo. Nunca inventa faixa: sem faixa legível, a célula fica sem destaque.
import { type Faixa, faixaDoTexto, foraDaFaixa } from './resultados.js';

export const TIPOS_EXAME_GRUPO = ['laboratorio', 'imagem', 'outro'] as const;
export type TipoExameGrupo = (typeof TIPOS_EXAME_GRUPO)[number];
export const ESCOPOS_FILTRO = ['atual', 'todos'] as const;
export type EscopoFiltro = (typeof ESCOPOS_FILTRO)[number];

export const MAX_ITENS_GRUPO = 40;
export const MAX_DIAS_FILTRO = 3650;

export interface ErroGrupoResultado {
  readonly codigo: string;
  readonly campo: string;
  readonly mensagem: string;
}

export interface ItemGrupo {
  readonly exame: number;
  /** Analito do exame (vínculo exame × analito); nulo = todos os analitos do exame. */
  readonly exameAnalito: number | null;
  readonly rotulo: string | null;
}

export interface GrupoResultadoEntrada {
  readonly nome: string;
  readonly tipoExame: TipoExameGrupo;
  readonly itens: readonly ItemGrupo[];
}

export function validarGrupoResultado(g: GrupoResultadoEntrada): ErroGrupoResultado[] {
  const erros: ErroGrupoResultado[] = [];
  const nome = g.nome.trim();
  if (nome.length < 2 || nome.length > 100)
    erros.push({
      codigo: 'nome-invalido',
      campo: 'nome',
      mensagem: 'O nome do grupo tem de 2 a 100 letras.',
    });
  if (!(TIPOS_EXAME_GRUPO as readonly string[]).includes(g.tipoExame))
    erros.push({ codigo: 'tipo-invalido', campo: 'tipoExame', mensagem: 'Tipo de exame desconhecido.' });
  if (g.itens.length === 0)
    erros.push({
      codigo: 'grupo-vazio',
      campo: 'itens',
      mensagem: 'O grupo precisa de pelo menos um exame.',
    });
  if (g.itens.length > MAX_ITENS_GRUPO)
    erros.push({
      codigo: 'grupo-grande',
      campo: 'itens',
      mensagem: `O grupo aceita até ${MAX_ITENS_GRUPO} exames.`,
    });
  const vistos = new Set<string>();
  const inteiros = new Set(g.itens.filter((i) => i.exameAnalito === null).map((i) => i.exame));
  g.itens.forEach((i, n) => {
    const k = `${i.exame}|${i.exameAnalito ?? '*'}`;
    if (vistos.has(k))
      erros.push({
        codigo: 'item-repetido',
        campo: `itens.${n}`,
        mensagem: 'O mesmo exame aparece duas vezes no grupo.',
      });
    vistos.add(k);
    if (i.exameAnalito !== null && inteiros.has(i.exame))
      erros.push({
        codigo: 'item-redundante',
        campo: `itens.${n}`,
        mensagem: 'O exame inteiro já está no grupo: o analito dele é redundante.',
      });
    if (i.rotulo !== null && i.rotulo.trim().length > 60)
      erros.push({
        codigo: 'rotulo-longo',
        campo: `itens.${n}.rotulo`,
        mensagem: 'Rótulo com até 60 letras.',
      });
  });
  return erros;
}

export interface FiltroResultadoEntrada {
  readonly nome: string;
  readonly padrao: boolean;
  readonly escopo: EscopoFiltro;
  readonly incluirPendentes: boolean;
  readonly somenteLiberados: boolean;
  readonly somenteMeusPedidos: boolean;
  readonly periodoDias: number | null;
  readonly grupos: readonly number[];
  readonly exames: readonly number[];
}

export function validarFiltroResultado(f: FiltroResultadoEntrada): ErroGrupoResultado[] {
  const erros: ErroGrupoResultado[] = [];
  const nome = f.nome.trim();
  if (nome.length < 1 || nome.length > 80)
    erros.push({
      codigo: 'nome-invalido',
      campo: 'nome',
      mensagem: 'O nome do filtro tem de 1 a 80 letras.',
    });
  if (f.periodoDias !== null && (f.periodoDias < 1 || f.periodoDias > MAX_DIAS_FILTRO))
    erros.push({
      codigo: 'periodo-invalido',
      campo: 'periodoDias',
      mensagem: `O período vai de 1 a ${MAX_DIAS_FILTRO} dias.`,
    });
  if (new Set(f.grupos).size !== f.grupos.length || new Set(f.exames).size !== f.exames.length)
    erros.push({
      codigo: 'criterio-repetido',
      campo: 'grupos',
      mensagem: 'Grupo ou exame repetido no filtro.',
    });
  if (f.grupos.length + f.exames.length === 0)
    erros.push({
      codigo: 'filtro-vazio',
      campo: 'grupos',
      mensagem: 'Escolha pelo menos um grupo ou um exame.',
    });
  if (f.grupos.length > 20 || f.exames.length > 100)
    erros.push({
      codigo: 'filtro-grande',
      campo: 'exames',
      mensagem: 'O filtro aceita até 20 grupos e 100 exames.',
    });
  return erros;
}

/** Item que o comparativo mostra: o exame inteiro ou um analito (pelo id do analito), com o rótulo do cadastro. */
export interface ItemComparativo {
  readonly exame: number;
  readonly analito: number | null;
  readonly rotulo: string | null;
}

/** Um valor de analito de um resultado (o que o laudo traz). */
export interface ValorComparativo {
  readonly resultado: number;
  /** Momento da coleta ou leitura (texto local ordenável, "AAAA-MM-DDTHH:MM"). */
  readonly em: string;
  readonly exame: number;
  readonly analito: number;
  readonly nomeAnalito: string;
  readonly sequencia: number;
  readonly numero: number | null;
  readonly texto: string | null;
  readonly unidade: string | null;
  readonly refMin: number | null;
  readonly refMax: number | null;
  readonly refTexto: string | null;
  readonly critMin: number | null;
  readonly critMax: number | null;
  readonly critico: boolean;
  /** Resultado conferido ainda não liberado (só quando o filtro pede além dos liberados). */
  readonly preliminar: boolean;
}

export type SituacaoCelula = 'normal' | 'abaixo' | 'acima' | 'critico' | 'sem-faixa';
export type Tendencia = 'subindo' | 'descendo' | 'estavel';

export interface CelulaComparativo {
  readonly coluna: string;
  readonly resultado: number;
  readonly valor: string;
  readonly numero: number | null;
  readonly situacao: SituacaoCelula;
  readonly preliminar: boolean;
}

export interface LinhaComparativo {
  readonly exame: number;
  readonly analito: number;
  readonly rotulo: string;
  readonly unidade: string | null;
  readonly faixa: string | null;
  readonly celulas: readonly CelulaComparativo[];
  /** Tendência dos dois últimos valores liberados (o preliminar nunca entra). */
  readonly tendencia: Tendencia | null;
  /** Variação do último valor liberado sobre o anterior, em %, uma casa (nula sem dois números). */
  readonly variacao: number | null;
}

export interface Comparativo {
  /** Coletas em ordem cronológica (a última à direita). */
  readonly colunas: readonly string[];
  readonly linhas: readonly LinhaComparativo[];
  /** Células liberadas fora da faixa (o preliminar não conta). */
  readonly foraDaFaixa: number;
  /** Células liberadas críticas (o preliminar não conta). */
  readonly criticos: number;
}

/** Faixa da célula: a numérica do laudo; sem ela, a do texto impresso; sem nenhuma, nula (nunca inventa). */
export function faixaDoValor(v: Pick<ValorComparativo, 'refMin' | 'refMax' | 'refTexto'>): Faixa | null {
  if (v.refMin !== null || v.refMax !== null) return { min: v.refMin, max: v.refMax };
  return faixaDoTexto(v.refTexto);
}

export function situacaoDoValor(v: ValorComparativo): SituacaoCelula {
  const criticoPeloLimite =
    v.numero !== null &&
    ((v.critMin !== null && v.numero < v.critMin) || (v.critMax !== null && v.numero > v.critMax));
  if (v.critico || criticoPeloLimite) return 'critico';
  const faixa = faixaDoValor(v);
  if (v.numero === null || faixa === null) return 'sem-faixa';
  return foraDaFaixa(v.numero, faixa) ?? 'normal';
}

/** Tendência dos dois últimos números: variação abaixo de 5% conta como estável. */
export function tendenciaDe(numeros: readonly number[]): {
  tendencia: Tendencia | null;
  variacao: number | null;
} {
  if (numeros.length < 2) return { tendencia: null, variacao: null };
  const ant = numeros[numeros.length - 2]!;
  const ult = numeros[numeros.length - 1]!;
  const variacao = ant === 0 ? null : Math.round(((ult - ant) / Math.abs(ant)) * 1000) / 10;
  const relativa = ant === 0 ? (ult === 0 ? 0 : Infinity) : Math.abs((ult - ant) / ant);
  if (relativa < 0.05) return { tendencia: 'estavel', variacao };
  return { tendencia: ult > ant ? 'subindo' : 'descendo', variacao };
}

function textoFaixa(f: Faixa | null, unidade: string | null, impresso: string | null): string | null {
  if (impresso && impresso.trim()) return impresso.trim();
  if (!f) return null;
  const u = unidade ? ` ${unidade}` : '';
  if (f.min !== null && f.max !== null) return `${f.min} a ${f.max}${u}`;
  if (f.min !== null) return `acima de ${f.min}${u}`;
  return `até ${f.max}${u}`;
}

/**
 * Monta a matriz analito × coleta na ordem dos itens: o item "exame inteiro" abre os analitos do exame na ordem do
 * laudo; o item de um analito mostra só ele. Valor de exame fora dos itens não entra. Em cada coleta, um valor por
 * analito (a última versão liberada vale; repetição do mesmo resultado não duplica a célula).
 */
export function montarComparativo(
  itens: readonly ItemComparativo[],
  valores: readonly ValorComparativo[],
): Comparativo {
  const doGrupo = valores.filter((v) =>
    itens.some((i) => v.exame === i.exame && (i.analito === null || v.analito === i.analito)),
  );
  const colunas = [...new Set(doGrupo.map((v) => v.em))].sort();
  const linhas: LinhaComparativo[] = [];
  const usados = new Set<string>();
  let fora = 0;
  let criticos = 0;
  for (const item of itens) {
    const doItem = doGrupo.filter(
      (v) => v.exame === item.exame && (item.analito === null || v.analito === item.analito),
    );
    const analitos = [...new Map(doItem.map((v) => [v.analito, v])).values()].sort(
      (a, b) => a.sequencia - b.sequencia || a.nomeAnalito.localeCompare(b.nomeAnalito),
    );
    for (const a of analitos) {
      const chave = `${item.exame}|${a.analito}`;
      if (usados.has(chave)) continue;
      usados.add(chave);
      const porColuna = new Map<string, ValorComparativo>();
      for (const v of doItem.filter((x) => x.analito === a.analito)) {
        const ja = porColuna.get(v.em);
        if (!ja || v.resultado > ja.resultado) porColuna.set(v.em, v);
      }
      const celulas = colunas
        .filter((c) => porColuna.has(c))
        .map((c) => {
          const v = porColuna.get(c)!;
          const situacao = situacaoDoValor(v);
          // Contagens só do que foi liberado: valor preliminar aparece marcado, mas não conta.
          if (!v.preliminar && (situacao === 'abaixo' || situacao === 'acima')) fora += 1;
          if (!v.preliminar && situacao === 'critico') criticos += 1;
          return {
            coluna: c,
            resultado: v.resultado,
            valor: v.numero !== null ? String(v.numero) : (v.texto ?? ''),
            numero: v.numero,
            situacao,
            preliminar: v.preliminar,
          };
        });
      const ultimo = [...porColuna.values()].sort((x, y) => x.em.localeCompare(y.em)).at(-1)!;
      // Tendência e variação só sobre valores liberados: o preliminar (conferido, não liberado) não move a seta.
      const t = tendenciaDe(celulas.filter((c) => c.numero !== null && !c.preliminar).map((c) => c.numero!));
      linhas.push({
        exame: item.exame,
        analito: a.analito,
        rotulo:
          item.analito !== null && item.rotulo && item.rotulo.trim() ? item.rotulo.trim() : a.nomeAnalito,
        unidade: ultimo.unidade,
        faixa: textoFaixa(faixaDoValor(ultimo), ultimo.unidade, ultimo.refTexto),
        celulas,
        ...t,
      });
    }
  }
  return { colunas, linhas, foraDaFaixa: fora, criticos };
}

/** Os itens do comparativo a partir dos grupos (em ordem) e dos exames avulsos do filtro, sem repetir. */
export function itensDoFiltro(
  grupos: readonly (readonly ItemComparativo[])[],
  exames: readonly number[],
): ItemComparativo[] {
  const r: ItemComparativo[] = [];
  const vistos = new Set<string>();
  for (const i of [...grupos.flat(), ...exames.map((e) => ({ exame: e, analito: null, rotulo: null }))]) {
    const k = `${i.exame}|${i.analito ?? '*'}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    r.push(i);
  }
  return r;
}
