// 08-SGO L102 (C2-120): remuneração e pagamento do prestador da rede. Regras puras (sem banco): a tabela negociada e os
// itens dela (valor em reais ou em unidades CH, UCO e filme), a regra de valoração que escolhe tabela, fator e acréscimo
// de urgência, o pacote com valor global, o reajuste do contrato, o calendário de pagamento, o adiantamento e o cálculo
// do lote de pagamento (tributos retidos e compensação de adiantamento). Dinheiro com 2 casas; unidades com 4.

export interface ProblemaRemuneracao {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const centavos = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
const quatro = (v: number): number => Math.round((v + Number.EPSILON) * 10_000) / 10_000;
const vazio = (s: string | null | undefined) => !s || !s.trim();
const p = (codigo: string, campo: string, detalhe: string): ProblemaRemuneracao => ({
  codigo,
  campo,
  detalhe,
});

function vigencia(inicio: string, fim: string | null, out: ProblemaRemuneracao[]): void {
  if (!DATA.test(inicio)) out.push(p('data-invalida', 'inicio', 'Informe o início da vigência.'));
  else if (fim !== null && (!DATA.test(fim) || fim < inicio))
    out.push(p('vigencia-invertida', 'fim', 'O fim da vigência não pode ser antes do início.'));
}

// ---------------------------------------------------------------- tabela negociada

export const FINALIDADES_TABELA = [
  'pagamento_rede',
  'referencia',
  'custo',
  'reembolso',
  'intercambio',
] as const;
export type FinalidadeTabela = (typeof FINALIDADES_TABELA)[number];
export type TipoValorTabela = 'valor_fixo' | 'indice';

export interface TabelaRemuneracaoCadastro {
  codigo: string;
  nome: string;
  finalidade: FinalidadeTabela;
  tipoValor: TipoValorTabela;
  valorCh: number | null;
  valorUco: number | null;
  valorFilme: number | null;
  prestador: number | null;
  inicio: string;
  fim: string | null;
}

export function problemasDaTabelaRemuneracao(t: TabelaRemuneracaoCadastro): ProblemaRemuneracao[] {
  const out: ProblemaRemuneracao[] = [];
  if (vazio(t.codigo)) out.push(p('campo-obrigatorio', 'codigo', 'Informe o código da tabela.'));
  if (vazio(t.nome)) out.push(p('campo-obrigatorio', 'nome', 'Informe o nome da tabela.'));
  if (!FINALIDADES_TABELA.includes(t.finalidade))
    out.push(p('finalidade-invalida', 'finalidade', 'Finalidade da tabela desconhecida.'));
  for (const [campo, v] of [
    ['valorCh', t.valorCh],
    ['valorUco', t.valorUco],
    ['valorFilme', t.valorFilme],
  ] as const)
    if (v !== null && v < 0)
      out.push(p('valor-negativo', campo, 'O valor da unidade não pode ser negativo.'));
  if (t.tipoValor === 'indice' && !(t.valorCh !== null && t.valorCh > 0))
    out.push(
      p('unidade-sem-valor', 'valorCh', 'Tabela em unidades precisa do valor do CH (unidade de honorário).'),
    );
  vigencia(t.inicio, t.fim, out);
  return out;
}

export interface ItemTabelaCadastro {
  procedimento: number | null;
  grupo: number | null;
  valor: number | null;
  quantidadeCh: number | null;
  quantidadeUco: number | null;
  quantidadeFilme: number | null;
  inicio: string;
  fim: string | null;
}

export function problemasDoItemTabela(
  i: ItemTabelaCadastro,
  tabela: { tipoValor: TipoValorTabela; inicio: string; fim: string | null },
): ProblemaRemuneracao[] {
  const out: ProblemaRemuneracao[] = [];
  if (i.procedimento === null && i.grupo === null)
    out.push(p('item-sem-alvo', 'procedimento', 'Escolha o procedimento ou o grupo de procedimentos.'));
  if (tabela.tipoValor === 'valor_fixo') {
    if (i.valor === null || i.valor < 0)
      out.push(p('item-sem-valor', 'valor', 'Informe o valor em reais do item.'));
  } else if (![i.quantidadeCh, i.quantidadeUco, i.quantidadeFilme].some((q) => q !== null && q > 0))
    out.push(p('item-sem-unidades', 'quantidadeCh', 'Informe a quantidade de CH, UCO ou filme do item.'));
  vigencia(i.inicio, i.fim, out);
  if (DATA.test(i.inicio) && i.inicio < tabela.inicio)
    out.push(p('fora-da-tabela', 'inicio', 'O item não pode começar antes da vigência da tabela.'));
  if (tabela.fim !== null && (i.fim === null || i.fim > tabela.fim) && i.inicio > tabela.fim)
    out.push(p('fora-da-tabela', 'inicio', 'O item começa depois do fim da tabela.'));
  return out;
}

/** Valor em reais de uma unidade do item: em reais direto, ou unidades × valor da unidade da tabela. */
export function valorDoItem(
  i: Pick<ItemTabelaCadastro, 'valor' | 'quantidadeCh' | 'quantidadeUco' | 'quantidadeFilme'>,
  t: Pick<TabelaRemuneracaoCadastro, 'tipoValor' | 'valorCh' | 'valorUco' | 'valorFilme'>,
): number {
  if (t.tipoValor === 'valor_fixo') return centavos(i.valor ?? 0);
  return centavos(
    (i.quantidadeCh ?? 0) * (t.valorCh ?? 0) +
      (i.quantidadeUco ?? 0) * (t.valorUco ?? 0) +
      (i.quantidadeFilme ?? 0) * (t.valorFilme ?? 0),
  );
}

// ---------------------------------------------------------------- regra de valoração

export interface RegraValoracaoCadastro {
  codigo: string;
  descricao: string;
  prioridade: number;
  prestador: number | null;
  tipoPrestador: number | null;
  grupo: number | null;
  item: number | null;
  tabela: number;
  fator: number;
  acrescimo: number | null;
  diaSemana: number | null;
  horaInicio: string | null;
  horaFim: string | null;
  inicio: string;
  fim: string | null;
}

export function problemasDaRegraValoracao(r: RegraValoracaoCadastro): ProblemaRemuneracao[] {
  const out: ProblemaRemuneracao[] = [];
  if (vazio(r.codigo)) out.push(p('campo-obrigatorio', 'codigo', 'Informe o código da regra.'));
  if (vazio(r.descricao)) out.push(p('campo-obrigatorio', 'descricao', 'Informe a descrição da regra.'));
  if (!(r.fator > 0))
    out.push(p('fator-invalido', 'fator', 'O fator multiplica a tabela e precisa ser maior que zero.'));
  if (r.acrescimo !== null && (r.acrescimo < 0 || r.acrescimo > 500))
    out.push(p('acrescimo-invalido', 'acrescimo', 'O acréscimo fica entre 0% e 500%.'));
  if (r.diaSemana !== null && !(r.diaSemana >= 1 && r.diaSemana <= 7))
    out.push(p('dia-invalido', 'diaSemana', 'Dia da semana de 1 (domingo) a 7 (sábado).'));
  if ((r.horaInicio === null) !== (r.horaFim === null))
    out.push(p('horario-incompleto', 'horaFim', 'Informe o início e o fim do horário especial.'));
  else if (r.horaInicio !== null && (!HORA.test(r.horaInicio) || !HORA.test(r.horaFim ?? '')))
    out.push(p('horario-invalido', 'horaInicio', 'Horário no formato HH:MM.'));
  if ((r.diaSemana !== null || r.horaInicio !== null) && r.acrescimo === null)
    out.push(p('acrescimo-ausente', 'acrescimo', 'O horário especial precisa do percentual de acréscimo.'));
  vigencia(r.inicio, r.fim, out);
  return out;
}

export interface RegraParaEscolha extends Pick<
  RegraValoracaoCadastro,
  | 'prioridade'
  | 'prestador'
  | 'tipoPrestador'
  | 'grupo'
  | 'item'
  | 'tabela'
  | 'fator'
  | 'acrescimo'
  | 'diaSemana'
  | 'horaInicio'
  | 'horaFim'
  | 'inicio'
  | 'fim'
> {
  id: number;
}
export interface EventoValoracao {
  prestador: number;
  tipoPrestador: number | null;
  grupos: readonly number[];
  item: number | null;
  data: string;
  hora: string | null;
  urgencia: boolean;
}

const especificidade = (r: RegraParaEscolha) =>
  [r.prestador, r.tipoPrestador, r.grupo, r.item].filter((x) => x !== null).length;

/** A regra que vale para o evento: vigente na data, todos os critérios preenchidos casam; menor prioridade e, no empate, a mais específica. */
export function escolherRegra<R extends RegraParaEscolha>(
  regras: readonly R[],
  e: EventoValoracao,
): R | null {
  const casam = regras.filter(
    (r) =>
      r.inicio <= e.data &&
      (r.fim === null || r.fim >= e.data) &&
      (r.prestador === null || r.prestador === e.prestador) &&
      (r.tipoPrestador === null || r.tipoPrestador === e.tipoPrestador) &&
      (r.grupo === null || e.grupos.includes(r.grupo)) &&
      (r.item === null || r.item === e.item),
  );
  casam.sort((a, b) => a.prioridade - b.prioridade || especificidade(b) - especificidade(a) || b.id - a.id);
  return casam[0] ?? null;
}

/** Dia da semana de 1 (domingo) a 7 (sábado) da data ISO. */
export const diaDaSemana = (data: string): number => new Date(`${data}T12:00:00Z`).getUTCDay() + 1;

/** O acréscimo vale na urgência e, se a regra tem dia ou horário, só dentro deles (o horário pode virar a noite). */
export function acrescimoAplica(r: RegraParaEscolha, e: EventoValoracao): boolean {
  if (r.acrescimo === null || r.acrescimo === 0) return false;
  const temJanela = r.diaSemana !== null || r.horaInicio !== null;
  if (!temJanela) return e.urgencia;
  if (r.diaSemana !== null && diaDaSemana(e.data) !== r.diaSemana) return false;
  if (r.horaInicio !== null && r.horaFim !== null) {
    if (e.hora === null) return false;
    const h = e.hora.slice(0, 5);
    return r.horaInicio <= r.horaFim
      ? h >= r.horaInicio && h <= r.horaFim
      : h >= r.horaInicio || h <= r.horaFim;
  }
  return true;
}

export interface Valoracao {
  regra: number;
  tabela: number;
  valorUnitarioTabela: number;
  fator: number;
  acrescimoPercentual: number;
  quantidade: number;
  valor: number;
}

/** Valor do evento: unitário da tabela × fator × (1 + acréscimo) × quantidade, em centavos. */
export function valorar(
  r: RegraParaEscolha,
  e: EventoValoracao,
  valorUnitarioTabela: number,
  quantidade: number,
): Valoracao {
  const acrescimo = acrescimoAplica(r, e) ? (r.acrescimo ?? 0) : 0;
  return {
    regra: r.id,
    tabela: r.tabela,
    valorUnitarioTabela,
    fator: r.fator,
    acrescimoPercentual: acrescimo,
    quantidade,
    valor: centavos(valorUnitarioTabela * r.fator * (1 + acrescimo / 100) * quantidade),
  };
}

// ---------------------------------------------------------------- pacote

export const TIPOS_PACOTE = [
  'clinico',
  'cirurgico',
  'obstetrico',
  'diagnostico',
  'terapeutico',
  'outro',
] as const;
export type TipoPacote = (typeof TIPOS_PACOTE)[number];
export interface PacoteCadastro {
  codigo: string;
  descricao: string;
  prestador: number | null;
  principal: number;
  tipo: TipoPacote;
  regime: 'ambulatorial' | 'internacao' | 'hospital_dia' | null;
  diarias: number | null;
  valorGlobal: number;
  inicio: string;
  fim: string | null;
  inclusoes: string | null;
  itens: readonly { item: number; inclusao: 'incluido' | 'excluido'; quantidade: number | null }[];
}

export function problemasDoPacote(x: PacoteCadastro): ProblemaRemuneracao[] {
  const out: ProblemaRemuneracao[] = [];
  if (vazio(x.codigo)) out.push(p('campo-obrigatorio', 'codigo', 'Informe o código do pacote.'));
  if (vazio(x.descricao)) out.push(p('campo-obrigatorio', 'descricao', 'Informe a descrição do pacote.'));
  if (!TIPOS_PACOTE.includes(x.tipo)) out.push(p('tipo-invalido', 'tipo', 'Tipo de pacote desconhecido.'));
  if (!(x.valorGlobal > 0))
    out.push(p('valor-invalido', 'valorGlobal', 'O valor global do pacote precisa ser maior que zero.'));
  if (x.diarias !== null && (x.diarias < 0 || !Number.isInteger(x.diarias)))
    out.push(p('diarias-invalidas', 'diarias', 'Quantidade de diárias inteira e não negativa.'));
  if (x.regime === 'ambulatorial' && x.diarias)
    out.push(p('diarias-no-ambulatorial', 'diarias', 'Pacote ambulatorial não inclui diárias.'));
  const vistos = new Set<number>();
  for (const i of x.itens) {
    if (vistos.has(i.item))
      out.push(p('item-repetido', 'itens', 'O mesmo item aparece duas vezes no pacote.'));
    vistos.add(i.item);
    if (i.quantidade !== null && !(i.quantidade > 0))
      out.push(p('quantidade-invalida', 'itens', 'A quantidade padrão do item precisa ser maior que zero.'));
    if (i.item === x.principal && i.inclusao === 'excluido')
      out.push(p('principal-excluido', 'itens', 'O procedimento principal não pode ficar fora do pacote.'));
  }
  vigencia(x.inicio, x.fim, out);
  return out;
}

// ---------------------------------------------------------------- reajuste do contrato

export type FormaReajusteRede = 'acordo' | 'indice_contratual' | 'indice_legal';
export interface ReajusteRedeCadastro {
  forma: FormaReajusteRede;
  indice: number | null;
  percentual: number;
  dataBase: string;
  inicio: string;
  descricao: string | null;
}

export function problemasDoReajusteRede(r: ReajusteRedeCadastro): ProblemaRemuneracao[] {
  const out: ProblemaRemuneracao[] = [];
  if (!(r.percentual > -50 && r.percentual <= 100) || r.percentual === 0)
    out.push(
      p('percentual-invalido', 'percentual', 'Percentual de reajuste diferente de zero, entre -50% e 100%.'),
    );
  if (r.forma !== 'acordo' && r.indice === null)
    out.push(p('indice-ausente', 'indice', 'Reajuste por índice precisa do índice aplicado.'));
  if (r.forma === 'acordo' && vazio(r.descricao))
    out.push(
      p('acordo-sem-registro', 'descricao', 'Descreva o acordo (data e termo) que justifica o percentual.'),
    );
  if (!DATA.test(r.dataBase)) out.push(p('data-invalida', 'dataBase', 'Informe a data-base do reajuste.'));
  if (!DATA.test(r.inicio))
    out.push(p('data-invalida', 'inicio', 'Informe o início da vigência do reajuste.'));
  else if (DATA.test(r.dataBase) && r.inicio < r.dataBase)
    out.push(p('inicio-antes-da-base', 'inicio', 'O reajuste não vale antes da data-base.'));
  return out;
}

export const reajustarValor = (v: number, percentual: number): number => centavos(v * (1 + percentual / 100));
export const reajustarUnidade = (v: number, percentual: number): number => quatro(v * (1 + percentual / 100));

/** Próximo reajuste: 12 meses depois da data-base (contrato com periodicidade anual, Lei 13.003/2014). */
export function proximoReajuste(dataBase: string): string {
  const [a, m, d] = dataBase.split('-').map(Number) as [number, number, number];
  return `${String(a + 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Dia anterior (para encerrar o item antigo no início do reajustado). */
export function diaAnterior(data: string): string {
  const t = new Date(`${data}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- calendário de pagamento

export interface CalendarioPagamentoCadastro {
  competencia: string;
  prestador: number | null;
  atendimentoInicio: string;
  atendimentoFim: string;
  entregaInicio: string | null;
  entregaFim: string | null;
  corte: string | null;
  pagamento: string;
}

export function problemasDoCalendario(c: CalendarioPagamentoCadastro): ProblemaRemuneracao[] {
  const out: ProblemaRemuneracao[] = [];
  if (!DATA.test(c.competencia) || !c.competencia.endsWith('-01'))
    out.push(p('competencia-invalida', 'competencia', 'A competência é o primeiro dia do mês de pagamento.'));
  if (
    !DATA.test(c.atendimentoInicio) ||
    !DATA.test(c.atendimentoFim) ||
    c.atendimentoFim < c.atendimentoInicio
  )
    out.push(p('periodo-invertido', 'atendimentoFim', 'O período de atendimento tem início e fim em ordem.'));
  if ((c.entregaInicio === null) !== (c.entregaFim === null))
    out.push(p('entrega-incompleta', 'entregaFim', 'Informe o início e o fim da entrega das contas.'));
  else if (c.entregaInicio !== null && c.entregaFim !== null && c.entregaFim < c.entregaInicio)
    out.push(p('periodo-invertido', 'entregaFim', 'A entrega termina depois de começar.'));
  if (c.entregaFim !== null && c.corte !== null && c.corte < c.entregaFim)
    out.push(p('corte-antes-da-entrega', 'corte', 'O corte vem depois do fim da entrega das contas.'));
  if (!DATA.test(c.pagamento)) out.push(p('data-invalida', 'pagamento', 'Informe a data de pagamento.'));
  else {
    if (c.corte !== null && c.pagamento < c.corte)
      out.push(p('pagamento-antes-do-corte', 'pagamento', 'O pagamento vem depois do corte.'));
    if (DATA.test(c.atendimentoFim) && c.pagamento < c.atendimentoFim)
      out.push(
        p('pagamento-antes-do-atendimento', 'pagamento', 'O pagamento vem depois do período de atendimento.'),
      );
  }
  return out;
}

/** Dias entre o fim do atendimento e o pagamento (o prazo que o contrato promete ao prestador). */
export function diasParaPagamento(atendimentoFim: string, pagamento: string): number {
  return Math.round(
    (Date.parse(`${pagamento}T00:00:00Z`) - Date.parse(`${atendimentoFim}T00:00:00Z`)) / 86_400_000,
  );
}

// ---------------------------------------------------------------- adiantamento e lote de pagamento

export interface AdiantamentoCadastro {
  descricao: string;
  data: string;
  valor: number;
  parcelas: number;
  inicioCompensacao: string | null;
}

export function problemasDoAdiantamento(a: AdiantamentoCadastro): ProblemaRemuneracao[] {
  const out: ProblemaRemuneracao[] = [];
  if (vazio(a.descricao)) out.push(p('campo-obrigatorio', 'descricao', 'Informe o motivo do adiantamento.'));
  if (!DATA.test(a.data)) out.push(p('data-invalida', 'data', 'Informe a data do adiantamento.'));
  if (!(a.valor > 0))
    out.push(p('valor-invalido', 'valor', 'O valor do adiantamento precisa ser maior que zero.'));
  if (!Number.isInteger(a.parcelas) || a.parcelas < 1 || a.parcelas > 60)
    out.push(p('parcelas-invalidas', 'parcelas', 'Compensação em 1 a 60 pagamentos.'));
  if (a.inicioCompensacao !== null) {
    if (!DATA.test(a.inicioCompensacao) || !a.inicioCompensacao.endsWith('-01'))
      out.push(
        p('competencia-invalida', 'inicioCompensacao', 'A compensação começa no primeiro dia de um mês.'),
      );
    else if (DATA.test(a.data) && a.inicioCompensacao < `${a.data.slice(0, 7)}-01`)
      out.push(
        p('compensacao-antes', 'inicioCompensacao', 'A compensação não começa antes do adiantamento.'),
      );
  }
  return out;
}

export interface TributoDoLote {
  tributo: number;
  aliquota: number;
  deducao: number;
  minimo: number | null;
}
export interface AdiantamentoAberto {
  id: number;
  valor: number;
  compensado: number;
  parcelas: number;
  inicioCompensacao: string | null;
}
export interface CalculoPagamento {
  bruto: number;
  tributos: {
    tributo: number;
    base: number;
    aliquota: number;
    deducao: number;
    imposto: number;
    retido: number;
  }[];
  valorTributos: number;
  liquidoLote: number;
  compensacoes: { id: number; valor: number; quitado: boolean }[];
  valorCompensado: number;
  liquidoTitulo: number;
}

/**
 * O pagamento do prestador: cada tributo sobre a base (bruto - dedução), retido só a partir do mínimo de retenção;
 * depois a compensação dos adiantamentos já em compensação na competência (uma parcela de cada, até o saldo e até o
 * líquido disponível; o mais antigo primeiro).
 */
export function calcularPagamento(
  bruto: number,
  tributos: readonly TributoDoLote[],
  adiantamentos: readonly AdiantamentoAberto[],
  competencia: string,
): CalculoPagamento {
  const b = centavos(bruto);
  const linhas = tributos.map((t) => {
    const base = centavos(Math.max(0, b - t.deducao));
    const imposto = centavos((base * t.aliquota) / 100);
    const retido = t.minimo !== null && imposto < t.minimo ? 0 : imposto;
    return { tributo: t.tributo, base, aliquota: t.aliquota, deducao: centavos(t.deducao), imposto, retido };
  });
  const valorTributos = centavos(linhas.reduce((s, l) => s + l.retido, 0));
  const liquidoLote = centavos(b - valorTributos);
  let disponivel = liquidoLote;
  const compensacoes: CalculoPagamento['compensacoes'] = [];
  for (const a of [...adiantamentos].sort((x, y) => x.id - y.id)) {
    if (a.inicioCompensacao !== null && a.inicioCompensacao > competencia) continue;
    const saldo = centavos(a.valor - a.compensado);
    if (saldo <= 0 || disponivel <= 0) continue;
    const parcela = centavos(a.valor / a.parcelas);
    const v = centavos(Math.min(parcela, saldo, disponivel));
    disponivel = centavos(disponivel - v);
    compensacoes.push({ id: a.id, valor: v, quitado: centavos(saldo - v) === 0 });
  }
  const valorCompensado = centavos(compensacoes.reduce((s, c) => s + c.valor, 0));
  return {
    bruto: b,
    tributos: linhas,
    valorTributos,
    liquidoLote,
    compensacoes,
    valorCompensado,
    liquidoTitulo: centavos(liquidoLote - valorCompensado),
  };
}

export function problemasDoLotePagamento(x: {
  competencia: string;
  vencimento: string;
  contas: readonly number[];
  tributos: readonly TributoDoLote[];
}): ProblemaRemuneracao[] {
  const out: ProblemaRemuneracao[] = [];
  if (!DATA.test(x.competencia) || !x.competencia.endsWith('-01'))
    out.push(p('competencia-invalida', 'competencia', 'A competência é o primeiro dia do mês de pagamento.'));
  if (!DATA.test(x.vencimento))
    out.push(p('data-invalida', 'vencimento', 'Informe o vencimento do pagamento.'));
  if (!x.contas.length)
    out.push(p('lote-vazio', 'contas', 'Escolha ao menos uma conta analisada do prestador.'));
  if (new Set(x.contas).size !== x.contas.length)
    out.push(p('conta-repetida', 'contas', 'A mesma conta aparece duas vezes.'));
  const vistos = new Set<number>();
  for (const t of x.tributos) {
    if (vistos.has(t.tributo))
      out.push(p('tributo-repetido', 'tributos', 'O mesmo tributo aparece duas vezes.'));
    vistos.add(t.tributo);
    if (!(t.aliquota >= 0 && t.aliquota <= 100) || t.deducao < 0)
      out.push(p('tributo-invalido', 'tributos', 'Alíquota entre 0% e 100% e dedução não negativa.'));
  }
  return out;
}
