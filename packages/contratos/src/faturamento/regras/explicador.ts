// "Explicar preço" (ficha do M30, regra 8; cap-11 §11.3): o caminho do preço reconstruído em modo somente leitura, a
// partir das colunas do item (UNIT_C, VLR_CH, VLR_COP, VLR_FILME, PERC, PERC_E, FORMULA) e das tabelas do contrato,
// numa ordem fixa: contrato, item, faturabilidade, base (VALOR → PORTE CBHPM → CH → referência de mat/med → diária ou
// taxa → digitado), modificadores, pacote, arredondamento; termina em "confere" ou "diferença de R$ x, regra não
// identificada". Nunca altera o item. As regras que o outro sistema guarda no programa (vias, horário, PMC ou PF) usam o
// padrão de mercado do parâmetro (POL-1, DP-33) e, divergindo, aparecem como alerta.
import { centavos, quatroCasas, reaisTexto } from './recusa.js';
import type { GrupoItem } from './tipo-item.js';

export const ETAPAS_EXPLICACAO = [
  'contrato',
  'item',
  'faturabilidade',
  'base',
  'modificadores',
  'pacote',
  'arredondamento',
  'comparacao',
] as const;
export type EtapaExplicacao = (typeof ETAPAS_EXPLICACAO)[number];

export type ModeloBase = 'valor' | 'porte' | 'ch' | 'referencia' | 'diaria' | 'digitado';

/** O que o outro sistema gravou no item (as colunas lidas). */
export interface ItemGravado {
  readonly grupo: GrupoItem;
  readonly data: string;
  readonly quantidade: number;
  readonly unitario: number;
  readonly valor: number;
  readonly ch: number;
  readonly cop: number;
  readonly filme: number;
  readonly perc: number;
  readonly percE: number;
  readonly formula: number | null;
  readonly pacote: string | null;
  readonly codigo: number;
}

/** O que o contrato diz na data-base (lido das tabelas do contrato pelo adaptador). */
export interface BaseContrato {
  readonly convenio: number;
  readonly tabela: number | null;
  readonly nomeTabela: string | null;
  readonly vigencia: string | null;
  /** Valor por componente (TBVLRTHM: VALOR_CH, VALOR_CO, VALOR_FILME), modelo VALOR. */
  readonly valores?: { readonly ch: number; readonly co: number; readonly filme: number } | null;
  /** Modelo PORTE CBHPM: o valor do porte e a fração. */
  readonly porte?: { readonly codigo: string; readonly valor: number; readonly fracao: number } | null;
  /** Modelo CH: a quantidade de CH do item e o índice do convênio. */
  readonly ch?: { readonly quantidade: number; readonly indice: number } | null;
  /** Filme em m² e o índice do filme do convênio. */
  readonly filme?: { readonly m2: number; readonly indice: number } | null;
  /** UCO (custo operacional) e o índice. */
  readonly cop?: { readonly uco: number; readonly indice: number } | null;
  /** Referência de mat/med (TBVLRMEM: VALOR) e, quando houver, PMC e PF do Brasíndice. */
  readonly referencia?: {
    readonly valor: number;
    readonly pmc: number | null;
    readonly pf: number | null;
  } | null;
  /** Diária ou taxa (TBVLRDTH: VALOR). */
  readonly diaria?: { readonly valor: number } | null;
}

export interface PassoExplicacao {
  readonly ordem: number;
  readonly etapa: EtapaExplicacao;
  readonly texto: string;
  readonly valor?: number;
}

export interface Explicacao {
  readonly passos: readonly PassoExplicacao[];
  readonly modelo: ModeloBase;
  readonly calculado: number | null;
  readonly gravado: number;
  readonly confere: boolean;
  readonly diferenca: number;
  readonly conclusao: string;
  /** A causa agregada da reprodução (ex.: "sem-vigencia", "modificador", "digitado"). */
  readonly causa:
    | 'confere'
    | 'sem-vigencia'
    | 'digitado'
    | 'modificador'
    | 'pacote'
    | 'arredondamento'
    | 'nao-identificada';
}

const n2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Os candidatos do modificador percentual do item (padrão de mercado; POL-1): sem, acréscimo, redução (via). */
function candidatosModificador(base: number, perc: number): { texto: string; valor: number }[] {
  const c = [{ texto: 'sem modificador percentual', valor: base }];
  if (perc > 0) {
    c.push({ texto: `acréscimo de ${n2(perc)}% do item`, valor: base * (1 + perc / 100) });
    if (perc < 100)
      c.push({ texto: `${n2(perc)}% do valor (via de acesso ou participação)`, valor: (base * perc) / 100 });
  }
  return c;
}

/** Explica o preço do item gravado: reconstrói, compara e conclui. Nunca altera o item (função pura). */
export function explicarPreco(
  item: ItemGravado,
  contrato: BaseContrato | null,
  faturabilidade: readonly string[] = [],
): Explicacao {
  const passos: PassoExplicacao[] = [];
  const p = (etapa: EtapaExplicacao, texto: string, valor?: number) =>
    passos.push({ ordem: passos.length + 1, etapa, texto, ...(valor === undefined ? {} : { valor }) });
  p(
    'contrato',
    contrato?.tabela
      ? `Convênio ${contrato.convenio}, tabela ${contrato.nomeTabela ?? contrato.tabela}${contrato.vigencia ? `, vigência de ${contrato.vigencia}` : ''}; data-base ${item.data.slice(0, 10)}.`
      : `Convênio ${contrato?.convenio ?? '?'}: sem tabela de preço vigente na data-base ${item.data.slice(0, 10)}.`,
  );
  p('item', `Item ${item.codigo}, quantidade ${n2(item.quantidade)}.`);
  p('faturabilidade', faturabilidade.length ? faturabilidade.join(' ') : 'Sem aviso de faturabilidade.');
  const fim = (modelo: ModeloBase, calculado: number | null, causa: Explicacao['causa']): Explicacao => {
    const gravado = item.unitario;
    const diferenca =
      (calculado === null ? centavos(item.valor) : centavos((calculado - gravado) * item.quantidade)) + 0;
    const confere = calculado !== null && Math.abs(diferenca) < 0.01;
    const conclusao = confere
      ? 'Confere com o valor gravado no item.'
      : calculado === null
        ? 'Diferença não explicada: regra não identificada (o valor pode ter sido digitado).'
        : `Diferença de ${reaisTexto(Math.abs(diferenca))}, regra não identificada.`;
    p(
      'comparacao',
      `Gravado no item: unitário ${n2(gravado)}, total ${n2(item.valor)} → ${confere ? 'confere' : 'não confere'}.`,
      gravado,
    );
    return {
      passos,
      modelo,
      calculado,
      gravado,
      confere,
      diferenca,
      conclusao,
      causa: confere ? 'confere' : causa,
    };
  };

  // Pacote: item incluso fica a zero (o preço vai para a linha do pacote).
  const noPacote = (item.pacote ?? '').trim().toUpperCase() === 'S';

  // Base, na cascata validada nos dados.
  let modelo: ModeloBase = 'digitado';
  let base: number | null = null;
  let componentes: { ch: number; cop: number; filme: number } | null = null;
  if (item.grupo === 'matmed') {
    if (contrato?.referencia) {
      modelo = 'referencia';
      base = contrato.referencia.valor;
      p('base', `Referência de mat/med: ${n2(base)} por unidade.`, base);
    }
  } else if (item.grupo === 'diarias-taxas') {
    if (contrato?.diaria) {
      modelo = 'diaria';
      base = contrato.diaria.valor;
      p('base', `Diária ou taxa da tabela: ${n2(base)}.`, base);
    }
  } else if (contrato?.valores && contrato.valores.ch + contrato.valores.co + contrato.valores.filme > 0) {
    modelo = 'valor';
    const filme = contrato.filme ? contrato.filme.m2 * contrato.filme.indice : contrato.valores.filme;
    componentes = { ch: contrato.valores.ch, cop: contrato.valores.co, filme };
    base = componentes.ch + componentes.cop + componentes.filme;
    p(
      'base',
      `Valor da tabela: honorário ${n2(componentes.ch)}, custo operacional ${n2(componentes.cop)}, filme ${n2(componentes.filme)}.`,
      base,
    );
  } else if (contrato?.porte && contrato.porte.valor > 0) {
    modelo = 'porte';
    const ch = contrato.porte.valor * contrato.porte.fracao;
    const cop = contrato.cop ? contrato.cop.uco * contrato.cop.indice : 0;
    const filme = contrato.filme ? contrato.filme.m2 * contrato.filme.indice : 0;
    componentes = { ch, cop, filme };
    base = ch + cop + filme;
    p(
      'base',
      `Porte ${contrato.porte.codigo} (${n2(contrato.porte.valor)} × fração ${n2(contrato.porte.fracao)}) + custo operacional ${n2(cop)} + filme ${n2(filme)}.`,
      base,
    );
  } else if (contrato?.ch && contrato.ch.quantidade > 0) {
    modelo = 'ch';
    const ch = contrato.ch.quantidade * contrato.ch.indice;
    const filme = contrato.filme ? contrato.filme.m2 * contrato.filme.indice : 0;
    componentes = { ch, cop: 0, filme };
    base = ch + filme;
    p(
      'base',
      `${n2(contrato.ch.quantidade)} CH × índice ${n2(contrato.ch.indice)} + filme ${n2(filme)}.`,
      base,
    );
  }
  if (base === null) {
    p('base', 'Sem preço de tabela vigente para o item: valor digitado ou regra não identificada.');
    p('modificadores', 'Não se aplica.');
    p('pacote', noPacote ? 'Item incluso no pacote.' : 'Não se aplica.');
    p('arredondamento', 'Não se aplica.');
    if (noPacote && item.unitario === 0) return fim('digitado', 0, 'pacote');
    return fim('digitado', null, 'digitado');
  }

  // Modificadores: o percentual do item (o outro sistema guarda o resultado; o caminho é o candidato que confere).
  const cand = candidatosModificador(base, item.perc);
  let escolhido = cand[0]!;
  for (const c of cand)
    if (
      Math.abs(quatroCasas(c.valor) - item.unitario) < Math.abs(quatroCasas(escolhido.valor) - item.unitario)
    )
      escolhido = c;
  p('modificadores', `Modificador: ${escolhido.texto}.`, escolhido.valor);

  if (noPacote) {
    p('pacote', 'Item incluso no pacote: o valor vai para a linha do pacote (zero no item).', 0);
    p('arredondamento', 'Não se aplica.');
    return fim(modelo, item.unitario === 0 ? 0 : quatroCasas(escolhido.valor), 'pacote');
  }
  p('pacote', 'Não se aplica.');

  // Arredondamento: componentes com 2 casas, unitário com 4.
  let unit: number;
  if (componentes && escolhido.valor === base) {
    unit = centavos(componentes.ch) + centavos(componentes.cop) + centavos(componentes.filme);
    p(
      'arredondamento',
      `Componentes com 2 casas: ${n2(centavos(componentes.ch))} + ${n2(centavos(componentes.cop))} + ${n2(centavos(componentes.filme))}.`,
      unit,
    );
  } else {
    unit = quatroCasas(escolhido.valor);
    p(
      'arredondamento',
      `Unitário com 4 casas: ${n2(unit)}; total ${n2(centavos(unit * item.quantidade))}.`,
      unit,
    );
  }
  const causa: Explicacao['causa'] =
    Math.abs(unit - item.unitario) <= 0.0101
      ? 'arredondamento'
      : item.perc > 0
        ? 'modificador'
        : 'nao-identificada';
  return fim(modelo, unit, causa);
}

/** O resumo agregado de um conjunto de explicações (para o relatório de reprodução: só contagens). */
export function agregarExplicacoes(
  xs: readonly { readonly grupo: GrupoItem; readonly explicacao: Explicacao }[],
): Record<GrupoItem, { total: number; conferem: number; causas: Record<string, number> }> {
  const r = {
    'diarias-taxas': { total: 0, conferem: 0, causas: {} as Record<string, number> },
    honorarios: { total: 0, conferem: 0, causas: {} as Record<string, number> },
    sadt: { total: 0, conferem: 0, causas: {} as Record<string, number> },
    matmed: { total: 0, conferem: 0, causas: {} as Record<string, number> },
  };
  for (const x of xs) {
    const g = r[x.grupo];
    g.total += 1;
    if (x.explicacao.confere) g.conferem += 1;
    g.causas[x.explicacao.causa] = (g.causas[x.explicacao.causa] ?? 0) + 1;
  }
  return r;
}

export interface PrecoCalculado {
  readonly modelo: ModeloBase;
  readonly unitario: number;
  readonly ch: number;
  readonly cop: number;
  readonly filme: number;
  readonly valor: number;
}

/**
 * O preço do lançamento manual pela tabela do contrato (a "fórmula reconstruída" do cap-11 §11.3, a mesma cascata do
 * explicador), sem modificador percentual: componentes com 2 casas, unitário com 4 e total com 2. Sem preço vigente,
 * null (o lançamento exige preço manual com a faixa e a aprovação; regra 12).
 */
export function precoDaTabela(
  grupo: GrupoItem,
  contrato: BaseContrato | null,
  quantidade: number,
): PrecoCalculado | null {
  if (!contrato) return null;
  const fim = (
    modelo: ModeloBase,
    ch: number,
    cop: number,
    filme: number,
    unitario?: number,
  ): PrecoCalculado => {
    const u = unitario ?? centavos(ch) + centavos(cop) + centavos(filme);
    return {
      modelo,
      unitario: quatroCasas(u),
      ch: centavos(ch),
      cop: centavos(cop),
      filme: centavos(filme),
      valor: centavos(u * quantidade),
    };
  };
  if (grupo === 'matmed')
    return contrato.referencia ? fim('referencia', 0, 0, 0, contrato.referencia.valor) : null;
  if (grupo === 'diarias-taxas')
    return contrato.diaria ? fim('diaria', 0, 0, 0, contrato.diaria.valor) : null;
  const filme = contrato.filme ? contrato.filme.m2 * contrato.filme.indice : 0;
  if (contrato.valores && contrato.valores.ch + contrato.valores.co + contrato.valores.filme > 0)
    return fim(
      'valor',
      contrato.valores.ch,
      contrato.valores.co,
      contrato.filme ? filme : contrato.valores.filme,
    );
  if (contrato.porte && contrato.porte.valor > 0)
    return fim(
      'porte',
      contrato.porte.valor * contrato.porte.fracao,
      contrato.cop ? contrato.cop.uco * contrato.cop.indice : 0,
      filme,
    );
  if (contrato.ch && contrato.ch.quantidade > 0)
    return fim('ch', contrato.ch.quantidade * contrato.ch.indice, 0, filme);
  return null;
}
