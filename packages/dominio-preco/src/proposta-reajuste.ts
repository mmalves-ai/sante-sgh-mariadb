// Proposta de reajuste de honorários (ficha do M12, seção 5 `preco.reajustar` e regras 2, 3, 5, 10; sante-api:
// src/services/acoes-precos.js): o reajuste é uma LINHA NOVA datada em TBVLRTHM, nunca a alteração da que
// existe. A proposta mostra item a item o valor de antes e o de depois, os vetos (nada é gravado) e os
// alertas (os que exigem confirmação explícita: tabela compartilhada e tabela com percentual em TBPERTHM).
//
// Modos: `percentual` (sobre o VALOR_CH vigente; os outros componentes são COPIADOS da vigência atual, nunca
// zerados), `valor` (o VALOR_CH novo de cada item) e `arquivo` (os componentes informados por item, da
// importação versionada). Precisão (regra 10): o valor calculado pelo percentual é arredondado a centavos
// (como a sante-api grava em produção); o valor informado (tela ou arquivo) e os componentes copiados vão
// exatamente como estão, sem arredondar.
import {
  CASAS_MAXIMAS_VALOR,
  ITENS_POR_TRANSACAO,
  TABELA_PERCENTUAL_A_CONFIRMAR,
  TABELAS_COM_PERCENTUAL,
  TETO_ITENS_PROPOSTA,
  VALOR_MAXIMO_COMPONENTE,
} from '@sgh/contratos';
import { tabelaCompartilhada, type UsoDaTabela } from './impacto.js';
import { centavos, type Componentes, NOMES_COMPONENTES, totalComponentes } from './modelo-valor.js';
import { dataDeVigencia } from './vigencia.js';

export interface ItemParaReajuste {
  readonly codigo: number;
  readonly nome: string;
  /** TBTABTHM.SITUACAO (A = ativo). */
  readonly situacao: string | null;
  /** TBTABTHM.CH (≠ 0: modelo AMB, veto). */
  readonly ch: number;
  /** Data da vigência que vale hoje (null: sem vigência anterior). */
  readonly vigencia: string | null;
  readonly valores: Componentes | null;
  /** Maior DATA do item em TBVLRTHM (inclui vigência futura). */
  readonly ultimaData: string | null;
  /** Já existe linha na data pedida (TAB, COD, DATA). */
  readonly temNaData: boolean;
}

export type PedidoReajuste =
  | { readonly modo: 'percentual'; readonly percentual: number }
  | { readonly modo: 'valor'; readonly valores: ReadonlyMap<number, number> }
  | {
      readonly modo: 'arquivo';
      readonly valores: ReadonlyMap<number, Partial<Componentes> & { readonly ch: number }>;
    };

export interface ContextoReajuste {
  readonly tabela: number;
  /** Início da vigência pedida (AAAA-MM-DD). */
  readonly data: string;
  /** Data do banco (AAAA-MM-DD). */
  readonly hoje: string;
  readonly convenios: readonly UsoDaTabela[];
  /** Vigência futura só com decisão do faturamento registrada (DP-33); padrão: não. */
  readonly vigenciaFuturaPermitida?: boolean;
}

export type CodigoVeto =
  | 'data-invalida'
  | 'data-anterior-a-hoje'
  | 'data-futura'
  | 'sem-itens'
  | 'teto-itens'
  | 'percentual-invalido'
  | 'modelo-ch'
  | 'item-inativo'
  | 'vigencia-posterior'
  | 'vigencia-na-data'
  | 'sem-vigencia-anterior'
  | 'valor-invalido'
  | 'sem-efeito';

export interface Veto {
  readonly codigo: CodigoVeto;
  readonly mensagem: string;
  readonly itens: readonly number[];
}

export type CodigoAlerta =
  | 'tabela-compartilhada'
  | 'percentual-na-tabela'
  | 'percentual-a-confirmar'
  | 'componentes-copiados'
  | 'primeiro-preco'
  | 'preco-zero'
  | 'vigencia-futura-existente'
  | 'sem-mudanca-em-alguns'
  | 'muda-agora'
  | 'transacoes';

export type Confirmacao = 'tabelaCompartilhada' | 'percentualTabela';

export interface Alerta {
  readonly codigo: CodigoAlerta;
  readonly mensagem: string;
  readonly confirmacao: Confirmacao | null;
}

export interface LinhaProposta {
  readonly codigo: number;
  readonly nome: string;
  readonly vigenciaAtual: string | null;
  readonly atuais: Componentes | null;
  readonly novos: Componentes;
  readonly totalAtual: number | null;
  readonly totalNovo: number;
  /** Variação do VALOR_CH em % (null sem valor anterior). */
  readonly variacao: number | null;
  readonly muda: boolean;
}

export interface Proposta {
  readonly tabela: number;
  readonly data: string;
  readonly linhas: readonly LinhaProposta[];
  readonly vetos: readonly Veto[];
  readonly alertas: readonly Alerta[];
  readonly confirmacoes: readonly Confirmacao[];
  readonly resumo: {
    readonly itens: number;
    readonly mudam: number;
    readonly somaChAtual: number;
    readonly somaChNova: number;
    readonly variacao: number | null;
    readonly conveniosAfetados: number;
    readonly conveniosAtivosAfetados: number;
    readonly transacoes: number;
  };
}

const lista = (cods: readonly number[], n = 5) =>
  cods.slice(0, n).join(', ') + (cods.length > n ? ` e mais ${cods.length - n}` : '');

/** Casas decimais de um número (no texto decimal do JavaScript). */
export function casasDecimais(v: number): number {
  if (!Number.isFinite(v)) return Infinity;
  const s = String(v);
  if (s.includes('e-')) return Number(s.split('e-')[1]) + (s.split('e-')[0]?.split('.')[1]?.length ?? 0);
  return s.split('.')[1]?.length ?? 0;
}

/** Componente aceitável: finito, ≥ 0, até o teto, até 4 casas (2 em anestesia e filme, NUMERIC(10,2)). */
export function componenteValido(nome: keyof Componentes, v: number): boolean {
  const casas = nome === 'anes' || nome === 'filme' ? 2 : CASAS_MAXIMAS_VALOR;
  return Number.isFinite(v) && v >= 0 && v <= VALOR_MAXIMO_COMPONENTE && casasDecimais(v) <= casas;
}

function iguais(a: Componentes | null, b: Componentes): boolean {
  return !!a && NOMES_COMPONENTES.every((k) => a[k] === b[k]);
}

/** Divide a lista em partes de até `tamanho` (as transações curtas do reajuste). */
export function fatiar<T>(itens: readonly T[], tamanho = ITENS_POR_TRANSACAO): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) r.push(itens.slice(i, i + tamanho));
  return r;
}

export function proporReajuste(
  itens: readonly ItemParaReajuste[],
  pedido: PedidoReajuste,
  ctx: ContextoReajuste,
): Proposta {
  const vetos: Veto[] = [];
  const veto = (codigo: CodigoVeto, mensagem: string, cods: readonly number[] = []) =>
    vetos.push({ codigo, mensagem, itens: cods });
  if (!dataDeVigencia(ctx.data)) veto('data-invalida', 'A data de início da vigência não é uma data válida.');
  else if (ctx.data < ctx.hoje)
    veto(
      'data-anterior-a-hoje',
      `A vigência começa em ${ctx.data}, antes de hoje (${ctx.hoje}): o reajuste retroativo mudaria o preço de lançamentos já feitos e não é feito pelo sistema novo.`,
    );
  else if (ctx.data > ctx.hoje && !ctx.vigenciaFuturaPermitida)
    veto(
      'data-futura',
      `Vigência futura (${ctx.data}) só com decisão do faturamento registrada (DP-33); o padrão é a data de hoje (${ctx.hoje}).`,
    );
  if (itens.length === 0) veto('sem-itens', 'Nenhum item na proposta.');
  if (itens.length > TETO_ITENS_PROPOSTA)
    veto('teto-itens', `A proposta tem ${itens.length} itens; o teto é ${TETO_ITENS_PROPOSTA}.`);
  if (pedido.modo === 'percentual') {
    const p = pedido.percentual;
    if (!Number.isFinite(p) || p <= -100 || p > 1000 || casasDecimais(p) > 4)
      veto('percentual-invalido', 'O percentual deve ser maior que −100 e até 1000 (ex.: 10 = +10%).');
  }

  const inativos = itens.filter((i) => (i.situacao ?? '').trim() !== 'A').map((i) => i.codigo);
  if (inativos.length)
    veto(
      'item-inativo',
      `${inativos.length} item(ns) inativo(s) na tabela (${lista(inativos)}): o preço novo não apareceria em lugar nenhum.`,
      inativos,
    );
  const comCh = itens.filter((i) => i.ch !== 0).map((i) => i.codigo);
  if (comCh.length)
    veto(
      'modelo-ch',
      `${comCh.length} item(ns) com CH ≠ 0 (modelo AMB: ${lista(comCh)}): o preço é o CH × o valor do CH do convênio; o reajuste desse modelo é pelo índice (preco.registrarIndice), operação especificada e desligada até a onda 4.`,
      comCh,
    );
  const naData = itens.filter((i) => i.temNaData).map((i) => i.codigo);
  if (naData.length)
    veto(
      'vigencia-na-data',
      `Já existe vigência em ${ctx.data} para ${naData.length} item(ns) (${lista(naData)}): o reajuste só cria vigência nova, nunca sobrescreve.`,
      naData,
    );
  const posteriores = itens
    .filter((i) => !i.temNaData && i.vigencia !== null && i.vigencia >= ctx.data)
    .map((i) => i.codigo);
  if (posteriores.length)
    veto(
      'vigencia-posterior',
      `A vigência atual de ${posteriores.length} item(ns) (${lista(posteriores)}) não é anterior a ${ctx.data}: a linha nova não mudaria o preço.`,
      posteriores,
    );

  const linhas: LinhaProposta[] = [];
  const semBase: number[] = [];
  const invalidos: number[] = [];
  for (const i of itens) {
    const atuais = i.valores;
    let novos: Componentes;
    if (pedido.modo === 'percentual') {
      if (!atuais) {
        semBase.push(i.codigo);
        novos = { ch: 0, co: 0, filme: 0, anes: 0, outros: 0 };
      } else novos = { ...atuais, ch: centavos(atuais.ch * (1 + pedido.percentual / 100)) };
    } else {
      const base = atuais ?? { ch: 0, co: 0, filme: 0, anes: 0, outros: 0 };
      const informado = pedido.valores.get(i.codigo);
      if (informado === undefined) {
        invalidos.push(i.codigo);
        novos = base;
      } else if (typeof informado === 'number') novos = { ...base, ch: informado };
      else novos = { ...base, ...informado };
    }
    if (NOMES_COMPONENTES.some((k) => !componenteValido(k, novos[k])) && !invalidos.includes(i.codigo))
      invalidos.push(i.codigo);
    const totalAtual = atuais ? totalComponentes(atuais) : null;
    linhas.push({
      codigo: i.codigo,
      nome: i.nome,
      vigenciaAtual: i.vigencia,
      atuais,
      novos,
      totalAtual,
      totalNovo: totalComponentes(novos),
      variacao:
        atuais && atuais.ch > 0 ? Math.round(((novos.ch - atuais.ch) / atuais.ch) * 10000) / 100 : null,
      muda: !iguais(atuais, novos),
    });
  }
  if (semBase.length)
    veto(
      'sem-vigencia-anterior',
      `${semBase.length} item(ns) sem vigência anterior (${lista(semBase)}): o percentual sobre nada gravaria preço zero; informe o valor de cada um.`,
      semBase,
    );
  if (invalidos.length)
    veto(
      'valor-invalido',
      `${invalidos.length} item(ns) com valor ausente ou inválido (${lista(invalidos)}): até 4 casas (2 em anestesia e filme), não negativo, até ${VALOR_MAXIMO_COMPONENTE}.`,
      invalidos,
    );
  const mudam = linhas.filter((l) => l.muda);
  if (itens.length > 0 && mudam.length === 0)
    veto('sem-efeito', 'Nenhum item mudaria de valor: a linha nova entraria sem alterar preço algum.');

  const alertas: Alerta[] = [];
  const alerta = (codigo: CodigoAlerta, mensagem: string, confirmacao: Confirmacao | null = null) =>
    alertas.push({ codigo, mensagem, confirmacao });
  const ativos = ctx.convenios.filter((c) => c.ativo);
  if (tabelaCompartilhada(ctx.tabela, ctx.convenios))
    alerta(
      'tabela-compartilhada',
      `A tabela ${ctx.tabela} é usada por ${ctx.convenios.length} convênio(s), ${ativos.length} ativo(s) (${ativos
        .map((c) => `${c.codigo} ${c.nome}`)
        .join(
          '; ',
        )}): o reajuste muda o preço de todos eles. A separação numa tabela própria (troca da tabela vigente do contrato) é operação especificada e desligada até a onda 4.`,
      'tabelaCompartilhada',
    );
  if (TABELAS_COM_PERCENTUAL.includes(ctx.tabela))
    alerta(
      'percentual-na-tabela',
      `A tabela ${ctx.tabela} tem percentual por procedimento em TBPERTHM: o preço final passa por ele e o reajuste só do valor pode não dar o aumento pretendido.`,
      'percentualTabela',
    );
  if (ctx.tabela === TABELA_PERCENTUAL_A_CONFIRMAR)
    alerta(
      'percentual-a-confirmar',
      `O significado do percentual da tabela ${ctx.tabela} em TBPERTHM está "a confirmar" com o faturamento (DP-33).`,
    );
  if (pedido.modo === 'percentual') {
    const comComp = linhas.filter((l) => l.atuais && totalComponentes(l.atuais) !== l.atuais.ch);
    if (comComp.length)
      alerta(
        'componentes-copiados',
        `${comComp.length} item(ns) têm componentes além do CH; eles são copiados da vigência atual sem reajuste, e o aumento do total fica menor que o percentual.`,
      );
  }
  const primeiros = linhas.filter((l) => !l.atuais).map((l) => l.codigo);
  if (primeiros.length && pedido.modo !== 'percentual')
    alerta(
      'primeiro-preco',
      `${primeiros.length} item(ns) sem vigência anterior (${lista(primeiros)}): é o primeiro preço deles; os componentes não informados vão como 0.`,
    );
  const zero = linhas.filter((l) => l.novos.ch === 0).map((l) => l.codigo);
  if (zero.length)
    alerta(
      'preco-zero',
      `${zero.length} item(ns) ficariam com CH = 0 (${lista(zero)}): é preço zero, não "sem preço".`,
    );
  const futuras = itens.filter((i) => i.ultimaData !== null && i.ultimaData > ctx.data).map((i) => i.codigo);
  if (futuras.length)
    alerta(
      'vigencia-futura-existente',
      `${futuras.length} item(ns) já têm vigência futura (${lista(futuras)}): o preço novo vale só até ela.`,
    );
  if (mudam.length > 0 && mudam.length < linhas.length)
    alerta(
      'sem-mudanca-em-alguns',
      `${linhas.length - mudam.length} item(ns) receberiam o mesmo valor que já vale: saem da gravação.`,
    );
  if (ctx.data === ctx.hoje)
    alerta(
      'muda-agora',
      `A vigência começa hoje (${ctx.hoje}): no instante da gravação, o SPDATA e o sistema novo passam a usar o valor novo.`,
    );
  const transacoes = fatiar(mudam).length;
  if (transacoes > 1)
    alerta(
      'transacoes',
      `A gravação sai em ${transacoes} transações curtas de até ${ITENS_POR_TRANSACAO} itens; se uma falhar, as anteriores ficam gravadas e o desfazer do lote as remove.`,
    );

  const somaChAtual = centavos(linhas.reduce((s, l) => s + (l.atuais?.ch ?? 0), 0));
  const somaChNova = centavos(linhas.reduce((s, l) => s + l.novos.ch, 0));
  return {
    tabela: ctx.tabela,
    data: ctx.data,
    linhas,
    vetos,
    alertas,
    confirmacoes: alertas.flatMap((a) => (a.confirmacao ? [a.confirmacao] : [])),
    resumo: {
      itens: linhas.length,
      mudam: mudam.length,
      somaChAtual,
      somaChNova,
      variacao: somaChAtual > 0 ? Math.round(((somaChNova - somaChAtual) / somaChAtual) * 10000) / 100 : null,
      conveniosAfetados: ctx.convenios.length,
      conveniosAtivosAfetados: ativos.length,
      transacoes,
    },
  };
}

/** As confirmações exigidas que o pedido não trouxe (vazio: pode gravar). */
export function confirmacoesFaltando(
  exigidas: readonly Confirmacao[],
  dadas: Readonly<Partial<Record<Confirmacao, boolean>>>,
): Confirmacao[] {
  return exigidas.filter((c) => dadas[c] !== true);
}
