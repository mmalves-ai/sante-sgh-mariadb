// Custo-padrão por procedimento (07-FIN L140, C2-115; F8): a ficha técnica do procedimento (insumos, minutos de sala,
// gases medicinais, diárias, exames, serviços, mão de obra), o custo de cada item pela quantidade e pelo custo unitário de
// referência (custo médio do insumo, custo por minuto da sala e do gás, custo-padrão da diária da unidade), o total da
// ficha (honorário e operacional), a escolha da ficha vigente na data, a ativação de uma nova versão (a anterior fica
// encerrada na véspera, nunca apagada) e a comparação do padrão com o custo apurado das contas da competência
// (variação em valor e em percentual, com a tolerância).
// Valores em centavos (inteiros); a quantidade e o custo unitário com quatro casas, como no banco. Puro: sem banco.

export const TIPOS_ITEM_FICHA = [
  'insumo',
  'exame',
  'sala_cirurgica',
  'gas_medicinal',
  'diaria',
  'servico',
  'procedimento',
  'mao_de_obra',
  'outro',
] as const;
export type TipoItemFicha = (typeof TIPOS_ITEM_FICHA)[number];

export const SITUACOES_FICHA_CUSTO = ['rascunho', 'ativa', 'inativa'] as const;
export type SituacaoFichaCusto = (typeof SITUACOES_FICHA_CUSTO)[number];

/** O que a quantidade mede em cada tipo (a tela mostra ao lado do campo). */
export const UNIDADE_DO_TIPO: Readonly<Record<TipoItemFicha, string>> = {
  insumo: 'unidade de estoque',
  exame: 'exame',
  sala_cirurgica: 'minuto de sala',
  gas_medicinal: 'minuto de uso',
  diaria: 'diária',
  servico: 'serviço',
  procedimento: 'procedimento',
  mao_de_obra: 'hora',
  outro: 'unidade',
};

/** Tipos com custo unitário de referência lido do cadastro de custos; os demais pedem o custo informado. */
export const TIPOS_COM_REFERENCIA: readonly TipoItemFicha[] = [
  'insumo',
  'gas_medicinal',
  'sala_cirurgica',
  'diaria',
  'procedimento',
];

/** Tolerância padrão da variação entre o apurado e o padrão (10%, em centésimos de ponto percentual). */
export const TOLERANCIA_PADRAO_CENT = 1000;

export interface ProblemaCustoPadrao {
  readonly codigo: string;
  readonly detalhe: string;
  readonly campo: string;
}

const p = (codigo: string, detalhe: string, campo: string): ProblemaCustoPadrao => ({
  codigo,
  detalhe,
  campo,
});

export const tipoItemValido = (v: string): v is TipoItemFicha =>
  (TIPOS_ITEM_FICHA as readonly string[]).includes(v);

/** Quantidade ou custo com até quatro casas, em décimos de milésimo (inteiro). */
export function emQuatroCasas(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  const n = Math.round(v * 10_000);
  return Math.abs(n / 10_000 - v) < 1e-9 ? n : null;
}

/** Custo do item em centavos: quantidade × custo unitário, arredondado meio para cima. */
export function custoDoItemCent(quantidade: number, custoUnitario: number): number {
  const q = BigInt(Math.round(quantidade * 10_000));
  const u = BigInt(Math.round(custoUnitario * 10_000));
  // q·u está em 10^-8 reais; centavos = q·u / 10^6, meio para cima.
  const bruto = q * u;
  return Number((bruto + 500_000n) / 1_000_000n);
}

export interface EntradaFichaCusto {
  readonly descricao: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export function problemasDaFicha(e: EntradaFichaCusto): ProblemaCustoPadrao[] {
  const r: ProblemaCustoPadrao[] = [];
  if (!e.descricao.trim()) r.push(p('descricao-obrigatoria', 'Informe a descrição da ficha.', 'descricao'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.vigenciaInicio))
    r.push(p('vigencia-invalida', 'Informe o início da vigência.', 'vigenciaInicio'));
  if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
    r.push(p('vigencia-invalida', 'O fim da vigência não pode ser antes do início.', 'vigenciaFim'));
  return r;
}

export interface EntradaItemFicha {
  readonly tipo: string;
  /** Id do insumo, exame, procedimento cirúrgico, acomodação, serviço ou procedimento (conforme o tipo). */
  readonly referencia: number | null;
  readonly descricao: string | null;
  readonly quantidade: number;
  /** Informado na tela; null: o de referência do cadastro de custos. */
  readonly custoUnitario: number | null;
}

/**
 * Problemas do item antes de gravar. `custoReferencia` é o custo unitário do cadastro (null: não há); sem custo
 * informado nem de referência, o item é recusado (a ficha não guarda custo zero por omissão).
 */
export function problemasDoItemFicha(
  e: EntradaItemFicha,
  custoReferencia: number | null,
): ProblemaCustoPadrao[] {
  const r: ProblemaCustoPadrao[] = [];
  if (!tipoItemValido(e.tipo)) return [p('tipo-invalido', 'Tipo de item desconhecido.', 'tipo')];
  const semReferencia = e.tipo === 'mao_de_obra' || e.tipo === 'outro';
  if (semReferencia) {
    if (!e.descricao?.trim())
      r.push(p('descricao-obrigatoria', 'Descreva a mão de obra ou o item avulso.', 'descricao'));
  } else if (e.referencia === null || e.referencia <= 0) {
    r.push(p('referencia-obrigatoria', `Escolha o item (${UNIDADE_DO_TIPO[e.tipo]}).`, 'referencia'));
  }
  const q = emQuatroCasas(e.quantidade);
  if (q === null || q <= 0)
    r.push(
      p('quantidade-invalida', 'A quantidade deve ser maior que zero, com até quatro casas.', 'quantidade'),
    );
  if (e.custoUnitario !== null) {
    const u = emQuatroCasas(e.custoUnitario);
    if (u === null || u < 0)
      r.push(
        p(
          'custo-invalido',
          'O custo unitário não pode ser negativo e tem até quatro casas.',
          'custoUnitario',
        ),
      );
  } else if (custoReferencia === null) {
    r.push(
      p(
        'sem-custo-referencia',
        TIPOS_COM_REFERENCIA.includes(e.tipo)
          ? 'O item não tem custo de referência vigente: informe o custo unitário.'
          : 'Informe o custo unitário deste tipo de item.',
        'custoUnitario',
      ),
    );
  }
  return r;
}

/** O custo unitário que fica no item: o informado ou o de referência. */
export const custoUnitarioDoItem = (e: EntradaItemFicha, custoReferencia: number | null): number =>
  e.custoUnitario ?? custoReferencia ?? 0;

export interface ItemFichaCalculo {
  readonly tipo: TipoItemFicha;
  readonly custoTotal: number; // centavos
}

export interface CustoPadraoCalculado {
  readonly honorario: number;
  readonly operacional: number;
  readonly total: number;
  readonly porTipo: Readonly<Partial<Record<TipoItemFicha, number>>>;
}

/** Totais da ficha: a mão de obra é o honorário; o restante (insumos, sala, gases, diárias...) é o operacional. */
export function calcularCustoPadrao(itens: readonly ItemFichaCalculo[]): CustoPadraoCalculado {
  let honorario = 0;
  let operacional = 0;
  const porTipo: Partial<Record<TipoItemFicha, number>> = {};
  for (const i of itens) {
    if (i.tipo === 'mao_de_obra') honorario += i.custoTotal;
    else operacional += i.custoTotal;
    porTipo[i.tipo] = (porTipo[i.tipo] ?? 0) + i.custoTotal;
  }
  return { honorario, operacional, total: honorario + operacional, porTipo };
}

// ---- referências com vigência ----

export interface ValorVigente {
  readonly inicio: string;
  readonly fim: string | null;
  readonly valor: number;
}

/** O valor vigente na data: o de início mais recente que já começou e não terminou. */
export function vigenteNaData(lista: readonly ValorVigente[], data: string): number | null {
  let melhor: ValorVigente | null = null;
  for (const v of lista)
    if (v.inicio <= data && (v.fim === null || v.fim >= data) && (!melhor || v.inicio > melhor.inicio))
      melhor = v;
  return melhor ? melhor.valor : null;
}

/** Custo do minuto de sala: a média das salas com custo vigente (quatro casas); sem sala, null. */
export function custoMinutoSala(salas: readonly (readonly ValorVigente[])[], data: string): number | null {
  const vals = salas.map((s) => vigenteNaData(s, data)).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10_000) / 10_000;
}

// ---- ficha vigente e ativação ----

export interface FichaParaVigencia {
  readonly id: number;
  readonly situacao: SituacaoFichaCusto;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly padrao: boolean;
}

/** A ficha ativa vigente na data: a marcada como padrão; sem marca, a de início mais recente. */
export function fichaVigente<F extends FichaParaVigencia>(fichas: readonly F[], data: string): F | null {
  const vig = fichas.filter(
    (f) =>
      f.situacao === 'ativa' && f.vigenciaInicio <= data && (f.vigenciaFim === null || f.vigenciaFim >= data),
  );
  if (vig.length === 0) return null;
  return (
    vig.find((f) => f.padrao) ?? [...vig].sort((a, b) => b.vigenciaInicio.localeCompare(a.vigenciaInicio))[0]!
  );
}

const vespera = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export interface PlanoAtivacao {
  readonly problemas: ProblemaCustoPadrao[];
  /** Fichas ativas do mesmo procedimento encerradas na véspera do início da nova (o histórico fica). */
  readonly encerrar: readonly { readonly id: number; readonly vigenciaFim: string }[];
}

/**
 * Ativar uma ficha em rascunho: precisa de ao menos um item e de custo total maior que zero; a ativa anterior do mesmo
 * procedimento que começou antes é encerrada na véspera; a que começa no mesmo dia ou depois é sobreposição (recusa).
 */
export function planejarAtivacao(
  ficha: FichaParaVigencia & { readonly itens: number; readonly custoTotal: number },
  outras: readonly FichaParaVigencia[],
): PlanoAtivacao {
  const problemas: ProblemaCustoPadrao[] = [];
  if (ficha.situacao !== 'rascunho')
    problemas.push(p('ficha-nao-rascunho', 'Só a ficha em rascunho pode ser ativada.', 'situacao'));
  if (ficha.itens === 0)
    problemas.push(p('ficha-sem-itens', 'Inclua ao menos um item antes de ativar a ficha.', 'itens'));
  else if (ficha.custoTotal <= 0)
    problemas.push(p('ficha-sem-custo', 'A ficha não tem custo: confira os custos unitários.', 'itens'));
  const encerrar: { id: number; vigenciaFim: string }[] = [];
  for (const o of outras) {
    if (o.id === ficha.id || o.situacao !== 'ativa') continue;
    const fimO = o.vigenciaFim ?? '9999-12-31';
    const fimN = ficha.vigenciaFim ?? '9999-12-31';
    const sobrepoe = o.vigenciaInicio <= fimN && fimO >= ficha.vigenciaInicio;
    if (!sobrepoe) continue;
    if (o.vigenciaInicio < ficha.vigenciaInicio)
      encerrar.push({ id: o.id, vigenciaFim: vespera(ficha.vigenciaInicio) });
    else
      problemas.push(
        p(
          'vigencia-sobreposta',
          'Já há ficha ativa deste procedimento começando na mesma data ou depois: ajuste a vigência.',
          'vigenciaInicio',
        ),
      );
  }
  return { problemas, encerrar };
}

export function problemasDaInativacao(situacao: SituacaoFichaCusto, motivo: string): ProblemaCustoPadrao[] {
  const r: ProblemaCustoPadrao[] = [];
  if (situacao === 'inativa') r.push(p('ficha-inativa', 'A ficha já está inativa.', 'situacao'));
  if (!motivo.trim()) r.push(p('motivo-obrigatorio', 'Informe o motivo da inativação.', 'motivo'));
  return r;
}

/** Itens só mudam na ficha em rascunho (a ativa é o padrão em uso: muda-se por uma nova versão). */
export const problemasDaEdicaoDeItens = (situacao: SituacaoFichaCusto): ProblemaCustoPadrao[] =>
  situacao === 'rascunho'
    ? []
    : [p('ficha-nao-rascunho', 'A ficha ativa ou inativa não muda: crie uma nova versão.', 'situacao')];

/** Próxima versão da ficha do procedimento ("1", "2"...), pelas versões numéricas já usadas. */
export function proximaVersaoFicha(versoes: readonly string[]): string {
  const n = versoes.map((v) => Number.parseInt(v, 10)).filter((x) => Number.isFinite(x));
  return String((n.length ? Math.max(...n) : 0) + 1);
}

// ---- comparação com o apurado ----

export interface ContaApurada {
  readonly conta: number;
  readonly numero: string;
  /** Quantas vezes o procedimento foi lançado na conta. */
  readonly quantidade: number;
  /** Custo apurado da conta (centavos). */
  readonly custoApurado: number;
}

export type ClasseVariacao = 'dentro' | 'acima' | 'abaixo';

export interface LinhaComparacao extends ContaApurada {
  readonly custoPadrao: number;
  readonly variacao: number;
  /** Variação sobre o padrão em centésimos de ponto percentual (null: padrão zero). */
  readonly variacaoPercentualCent: number | null;
  readonly classe: ClasseVariacao;
}

export interface ComparacaoCustoPadrao {
  readonly linhas: LinhaComparacao[];
  readonly totalPadrao: number;
  readonly totalApurado: number;
  readonly variacao: number;
  readonly variacaoPercentualCent: number | null;
  readonly classe: ClasseVariacao;
  readonly contagem: Readonly<Record<ClasseVariacao, number>>;
}

const percentualCent = (variacao: number, base: number): number | null =>
  base === 0 ? null : Math.round((variacao * 10_000) / base);

const classificar = (pc: number | null, variacao: number, tolerancia: number): ClasseVariacao => {
  if (pc === null) return variacao > 0 ? 'acima' : variacao < 0 ? 'abaixo' : 'dentro';
  if (pc > tolerancia) return 'acima';
  if (pc < -tolerancia) return 'abaixo';
  return 'dentro';
};

/**
 * Compara o custo-padrão (centavos por procedimento) com o custo apurado de cada conta que lançou o procedimento: o
 * padrão da conta é o custo da ficha vezes a quantidade lançada; a variação é apurado − padrão, classificada pela
 * tolerância (acima, abaixo ou dentro).
 */
export function compararComApurado(
  custoPadraoCent: number,
  contas: readonly ContaApurada[],
  toleranciaCent: number = TOLERANCIA_PADRAO_CENT,
): ComparacaoCustoPadrao {
  const contagem: Record<ClasseVariacao, number> = { dentro: 0, acima: 0, abaixo: 0 };
  let totalPadrao = 0;
  let totalApurado = 0;
  const linhas = contas.map((c) => {
    const custoPadrao = custoDoItemCent(c.quantidade, custoPadraoCent / 100);
    const variacao = c.custoApurado - custoPadrao;
    const pc = percentualCent(variacao, custoPadrao);
    const classe = classificar(pc, variacao, toleranciaCent);
    contagem[classe] += 1;
    totalPadrao += custoPadrao;
    totalApurado += c.custoApurado;
    return { ...c, custoPadrao, variacao, variacaoPercentualCent: pc, classe };
  });
  const variacao = totalApurado - totalPadrao;
  const pc = percentualCent(variacao, totalPadrao);
  return {
    linhas,
    totalPadrao,
    totalApurado,
    variacao,
    variacaoPercentualCent: pc,
    classe: classificar(pc, variacao, toleranciaCent),
    contagem,
  };
}
