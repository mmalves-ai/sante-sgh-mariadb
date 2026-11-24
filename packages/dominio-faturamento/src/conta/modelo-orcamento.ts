// F3.7 (06-FAT linha 40): modelo de orçamento padrão por procedimento e acomodação. Regras puras:
// - o cadastro do modelo (procedimento principal, acomodação, itens e honorários da equipe, percentuais e validade);
// - a montagem do orçamento a partir do modelo: cada item pelo valor fixado no modelo ou, sem ele, pelo preço da
//   tabela vigente; o honorário pela função da equipe sobre o valor do procedimento principal; a taxa de
//   administração sobre os itens que não são honorário; o acréscimo do item e o do modelo; o modelo com valor
//   fechado vira pacote (uma linha com o valor fechado e os componentes com a parte de cada um, para conferência).
// O item sem preço fica no orçamento com valor zero e é devolvido em "semPreco", para a tela pedir o valor na hora.

export const TIPOS_ITEM_MODELO = [
  'procedimento',
  'exame',
  'diaria',
  'taxa',
  'material',
  'medicamento',
  'honorario',
  'pacote',
  'outro',
] as const;
export type TipoItemModelo = (typeof TIPOS_ITEM_MODELO)[number];

const r2 = (x: number) => Math.round(x * 100) / 100;
const pctOk = (p: number | null) => p === null || (p >= 0 && p <= 100);

export interface ItemModeloEntrada {
  readonly tipo: TipoItemModelo;
  readonly itemId: number | null;
  readonly funcaoId: number | null;
  readonly profissionalId: number | null;
  readonly quantidade: number;
  readonly unitario: number | null;
  readonly acrescimo: number | null;
}

export interface ModeloEntrada {
  readonly codigo: string;
  readonly descricao: string;
  readonly procedimentoId: number;
  readonly acomodacaoId: number;
  readonly quantidade: number;
  readonly valorFechado: number | null;
  readonly administracao: number | null;
  readonly acrescimo: number | null;
  readonly validadeDias: number | null;
  readonly itens: readonly ItemModeloEntrada[];
}

/** Erros por campo do cadastro do modelo (vazio: pode gravar). Os erros dos itens vêm como "itens.<n>.<campo>". */
export function validarModelo(m: ModeloEntrada): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(m.codigo))
    erros['codigo'] = 'O código tem até 30 letras, números, ponto, hífen ou sublinhado.';
  if (!m.descricao.trim()) erros['descricao'] = 'Informe a descrição do modelo.';
  if (!(m.procedimentoId > 0)) erros['procedimentoId'] = 'Escolha o procedimento principal.';
  if (!(m.acomodacaoId > 0)) erros['acomodacaoId'] = 'Escolha a acomodação.';
  if (!(m.quantidade > 0)) erros['quantidade'] = 'A quantidade é maior que zero.';
  if (m.valorFechado !== null && !(m.valorFechado > 0))
    erros['valorFechado'] = 'O valor fechado é maior que zero (ou fica em branco).';
  if (!pctOk(m.administracao)) erros['administracao'] = 'O percentual vai de 0 a 100.';
  if (!pctOk(m.acrescimo)) erros['acrescimo'] = 'O percentual vai de 0 a 100.';
  if (
    m.validadeDias !== null &&
    (!Number.isInteger(m.validadeDias) || m.validadeDias < 1 || m.validadeDias > 365)
  )
    erros['validadeDias'] = 'A validade vai de 1 a 365 dias.';
  const vistos = new Set<string>();
  m.itens.forEach((i, k) => {
    const p = `itens.${k}`;
    if (i.tipo === 'honorario') {
      if (!i.funcaoId) erros[`${p}.funcaoId`] = 'O honorário pede a função na equipe.';
    } else if (!i.itemId) erros[`${p}.itemId`] = 'Escolha o item.';
    if (!(i.quantidade > 0)) erros[`${p}.quantidade`] = 'A quantidade é maior que zero.';
    if (i.unitario !== null && i.unitario < 0) erros[`${p}.unitario`] = 'O valor não é negativo.';
    if (!pctOk(i.acrescimo)) erros[`${p}.acrescimo`] = 'O percentual vai de 0 a 100.';
    const chave = `${i.tipo}:${i.itemId ?? ''}:${i.funcaoId ?? ''}`;
    if (vistos.has(chave))
      erros[`${p}.itemId`] = 'Item repetido no modelo: ajuste a quantidade da linha anterior.';
    vistos.add(chave);
  });
  return erros;
}

export interface ItemModeloPrecificavel extends ItemModeloEntrada {
  /** Preço unitário da tabela vigente da fonte particular (nulo: sem preço). */
  readonly precoTabela: number | null;
  /** Percentual de cobrança da função da equipe (honorário). */
  readonly percentualFuncao: number | null;
}

export interface LinhaOrcamentoModelo {
  readonly sequencia: number;
  readonly tipo: TipoItemModelo;
  readonly itemId: number | null;
  readonly funcaoId: number | null;
  readonly profissionalId: number | null;
  readonly quantidade: number;
  readonly unitario: number;
  readonly total: number;
  readonly valorPacote: number | null;
}

export interface OrcamentoDoModelo {
  readonly linhas: readonly LinhaOrcamentoModelo[];
  readonly bruto: number;
  readonly administracao: number;
  readonly acrescimo: number;
  readonly total: number;
  /** Sequências sem preço (nem no modelo nem na tabela): ficam com zero e a tela pede o valor. */
  readonly semPreco: readonly number[];
  readonly validadeDias: number;
}

/** Monta o orçamento a partir do modelo; o procedimento principal entra sempre como a primeira linha. */
export function montarOrcamentoDoModelo(
  modelo: Pick<
    ModeloEntrada,
    'procedimentoId' | 'quantidade' | 'valorFechado' | 'administracao' | 'acrescimo'
  > & {
    readonly validadeDias: number | null;
    readonly precoPrincipal: number | null;
  },
  itens: readonly ItemModeloPrecificavel[],
  validadePadraoDias = 30,
): OrcamentoDoModelo {
  const semPreco: number[] = [];
  const unitPrincipal = modelo.precoPrincipal ?? 0;
  const principal = r2(unitPrincipal * modelo.quantidade);
  const linhas: LinhaOrcamentoModelo[] = [
    {
      sequencia: 1,
      tipo: 'procedimento',
      itemId: modelo.procedimentoId,
      funcaoId: null,
      profissionalId: null,
      quantidade: modelo.quantidade,
      unitario: unitPrincipal,
      total: principal,
      valorPacote: null,
    },
  ];
  if (modelo.precoPrincipal === null) semPreco.push(1);
  let honorarios = 0;
  for (const i of itens) {
    const sequencia = linhas.length + 1;
    let unit: number | null;
    if (i.unitario !== null) unit = i.unitario;
    else if (i.tipo === 'honorario')
      unit =
        i.percentualFuncao !== null && modelo.precoPrincipal !== null
          ? r2((unitPrincipal * i.percentualFuncao) / 100)
          : null;
    else unit = i.precoTabela;
    if (unit === null) semPreco.push(sequencia);
    const base = r2((unit ?? 0) * i.quantidade);
    const total = r2(base * (1 + (i.acrescimo ?? 0) / 100));
    if (i.tipo === 'honorario') honorarios = r2(honorarios + total);
    linhas.push({
      sequencia,
      tipo: i.tipo,
      itemId: i.itemId,
      funcaoId: i.funcaoId,
      profissionalId: i.profissionalId,
      quantidade: i.quantidade,
      unitario: unit ?? 0,
      total,
      valorPacote: null,
    });
  }
  const bruto = r2(linhas.reduce((t, l) => t + l.total, 0));
  const administracao = r2(((bruto - honorarios) * (modelo.administracao ?? 0)) / 100);
  const acrescimo = r2(((bruto + administracao) * (modelo.acrescimo ?? 0)) / 100);
  const validadeDias = modelo.validadeDias ?? validadePadraoDias;
  if (modelo.valorFechado === null)
    return {
      linhas,
      bruto,
      administracao,
      acrescimo,
      total: r2(bruto + administracao + acrescimo),
      semPreco,
      validadeDias,
    };
  // Valor fechado: o pacote leva o valor; cada componente mostra a sua parte (proporcional ao calculado).
  const fechado = modelo.valorFechado;
  let distribuido = 0;
  const componentes = linhas.map((l, k) => {
    const parte =
      k === linhas.length - 1 ? r2(fechado - distribuido) : bruto > 0 ? r2((fechado * l.total) / bruto) : 0;
    distribuido = r2(distribuido + parte);
    return { ...l, sequencia: k + 2, unitario: 0, total: 0, valorPacote: parte };
  });
  const pacote: LinhaOrcamentoModelo = {
    sequencia: 1,
    tipo: 'pacote',
    itemId: modelo.procedimentoId,
    funcaoId: null,
    profissionalId: null,
    quantidade: 1,
    unitario: fechado,
    total: fechado,
    valorPacote: fechado,
  };
  return {
    linhas: [pacote, ...componentes],
    bruto: fechado,
    administracao: 0,
    acrescimo: 0,
    total: fechado,
    semPreco: [],
    validadeDias,
  };
}
