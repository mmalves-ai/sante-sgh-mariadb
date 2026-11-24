// Regras da cobrança por fonte pagadora (06-FAT linhas 6, 8 e 9), puras: a porta traz as linhas vigentes e o domínio
// decide. Três peças:
// 1) De-para do item do hospital para o código da fonte pagadora: a equivalência do item vence a do grupo; o plano do
//    paciente vence o plano superior, que vence a de todos os planos; o tipo de conta e o tipo de atendimento
//    específicos vencem o "todos". A quantidade cobrada sai da consumida pelos fatores (multiplica e divide).
// 2) Credenciamento de cobrança: quem (profissional ou prestador) pode cobrar o quê (tipo de conta, grupo de ato) em
//    cada fonte pagadora e plano, com vigência; a exceção por procedimento (item ou grupo), equipe ou plano permite
//    ou proíbe acima do credenciamento, e a proibição vence a permissão de mesma especificidade.
// 3) Preço da referência de mercado de mat/med na data: a maior vigência até a data entre as edições; a linha de
//    exclusão mais recente tira o preço; a tabela escolhe o de fábrica ou o máximo ao consumidor.
// Mudança nunca apaga: a equivalência e o credenciamento trocados se encerram pela vigência (o histórico fica).

export type TipoAtendimentoCobranca = 'ambulatorial' | 'internacao' | 'urgencia' | 'externo';
export const TIPOS_ATENDIMENTO_COBRANCA: readonly string[] = [
  'ambulatorial',
  'internacao',
  'urgencia',
  'externo',
  'todos',
];

const vigente = (inicio: string, fim: string | null, data: string) =>
  inicio <= data && (fim === null || fim >= data);

/** Dia anterior (AAAA-MM-DD), para encerrar a vigência de quem é substituído. */
export function diaAnterior(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── 1) De-para ─────────────────────────────────────────────────────────────────────────────────────

export interface EquivalenciaItemFonte {
  readonly id: number;
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly planoId: number | null;
  readonly tipoContaId: number | null;
  readonly tipoAtendimento: string;
  readonly codigo: string;
  readonly descricao: string | null;
  readonly fatorMultiplicacao: number;
  readonly fatorDivisao: number;
  readonly percentual: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export interface PedidoEquivalencia {
  readonly itemId: number;
  readonly grupoId: number | null;
  readonly planoId: number | null;
  readonly planoSuperiorId: number | null;
  readonly tipoContaId: number | null;
  readonly tipoAtendimento: TipoAtendimentoCobranca | null;
  readonly data: string;
}

/** Pontua a equivalência para o pedido (0: não serve). Item > grupo; plano > superior > todos; específico > todos. */
function pontosEquivalencia(e: EquivalenciaItemFonte, p: PedidoEquivalencia): number {
  if (!vigente(e.vigenciaInicio, e.vigenciaFim, p.data)) return 0;
  let pts = 0;
  if (e.itemId !== null) {
    if (e.itemId !== p.itemId) return 0;
    pts += 1000;
  } else if (e.grupoId === null || e.grupoId !== p.grupoId) return 0;
  else pts += 500;
  if (e.planoId !== null) {
    if (p.planoId !== null && e.planoId === p.planoId) pts += 100;
    else if (p.planoSuperiorId !== null && e.planoId === p.planoSuperiorId) pts += 50;
    else return 0;
  }
  if (e.tipoContaId !== null) {
    if (e.tipoContaId !== p.tipoContaId) return 0;
    pts += 20;
  }
  if (e.tipoAtendimento !== 'todos') {
    if (e.tipoAtendimento !== p.tipoAtendimento) return 0;
    pts += 10;
  }
  return pts;
}

/** A equivalência que vale para o pedido (nula: o item vai com o código do hospital e a conferência avisa). */
export function escolherEquivalencia(
  candidatas: readonly EquivalenciaItemFonte[],
  p: PedidoEquivalencia,
): EquivalenciaItemFonte | null {
  let melhor: EquivalenciaItemFonte | null = null;
  let mp = 0;
  for (const e of candidatas) {
    const pts = pontosEquivalencia(e, p);
    if (pts > mp || (pts === mp && pts > 0 && melhor && e.vigenciaInicio > melhor.vigenciaInicio)) {
      melhor = e;
      mp = pts;
    }
  }
  return melhor;
}

/** Quantidade na unidade da fonte pagadora (quatro casas). */
export function quantidadeNaFonte(
  quantidade: number,
  e: Pick<EquivalenciaItemFonte, 'fatorMultiplicacao' | 'fatorDivisao'>,
): number {
  return Math.round(((quantidade * e.fatorMultiplicacao) / e.fatorDivisao) * 10_000) / 10_000;
}

/** O item como a fonte pagadora o recebe na guia. */
export interface ItemNaFonte {
  readonly codigo: string;
  readonly descricao: string;
  readonly quantidade: number;
  readonly valorUnitario: number;
}

/**
 * Aplica o de-para ao item da guia: o código e a descrição da fonte, a quantidade na unidade dela (fatores) e o
 * percentual de cobrança sobre o total. O total só muda pelo percentual (a troca de unidade reparte o mesmo valor pela
 * nova quantidade; o unitário fica com quatro casas para o total não perder centavo).
 */
export function itemNaFonte(
  item: ItemNaFonte,
  e: Pick<
    EquivalenciaItemFonte,
    'codigo' | 'descricao' | 'fatorMultiplicacao' | 'fatorDivisao' | 'percentual'
  >,
): ItemNaFonte {
  const quantidade = quantidadeNaFonte(item.quantidade, e);
  const total = item.quantidade * item.valorUnitario * ((e.percentual ?? 100) / 100);
  const valorUnitario = quantidade > 0 ? Math.round((total / quantidade) * 10_000) / 10_000 : 0;
  return {
    codigo: e.codigo,
    descricao: e.descricao ?? item.descricao,
    quantidade,
    valorUnitario,
  };
}

export interface NovaEquivalenciaItem {
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly codigo: string;
  readonly tipoAtendimento: string;
  readonly fatorMultiplicacao: number;
  readonly fatorDivisao: number;
  readonly percentual: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** Erros por campo, para a tela mostrar na hora (vazio: pode gravar). */
export function validarEquivalencia(e: NovaEquivalenciaItem): Record<string, string> {
  const erros: Record<string, string> = {};
  if ((e.itemId === null) === (e.grupoId === null))
    erros['itemId'] = 'Informe o item ou o grupo de faturamento (um dos dois).';
  const cod = e.codigo.trim();
  if (!cod) erros['codigo'] = 'Informe o código do item na fonte pagadora.';
  else if (cod.length > 20) erros['codigo'] = 'O código na fonte pagadora tem até 20 caracteres.';
  if (!TIPOS_ATENDIMENTO_COBRANCA.includes(e.tipoAtendimento))
    erros['tipoAtendimento'] = 'Tipo de atendimento inválido.';
  if (!(e.fatorMultiplicacao > 0)) erros['fatorMultiplicacao'] = 'O fator de multiplicação é maior que zero.';
  if (!(e.fatorDivisao > 0)) erros['fatorDivisao'] = 'O fator de divisão é maior que zero.';
  if (e.percentual !== null && !(e.percentual > 0 && e.percentual <= 1000))
    erros['percentual'] = 'O percentual de cobrança fica entre 0 e 1000.';
  if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
    erros['vigenciaFim'] = 'O fim da vigência não pode ser antes do início.';
  return erros;
}

// ── 2) Credenciamento de cobrança e exceção ────────────────────────────────────────────────────────

export interface CredenciamentoCobranca {
  readonly id: number;
  readonly profissionalId: number | null;
  readonly prestadorId: number | null;
  readonly planoId: number | null;
  readonly tipoContaId: number | null;
  readonly grupoAtoId: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export interface ExcecaoCredenciamento {
  readonly id: number;
  readonly credenciamentoId: number | null;
  readonly profissionalId: number | null;
  readonly prestadorId: number | null;
  readonly equipeId: number | null;
  readonly fonteId: number | null;
  readonly planoId: number | null;
  readonly tipoAtendimento: string;
  readonly grupoId: number | null;
  readonly itemId: number | null;
  readonly efeito: 'permite' | 'proibe';
  readonly motivo: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export interface PedidoCobranca {
  readonly fonteId: number;
  readonly particular: boolean;
  readonly profissionalId: number | null;
  readonly prestadorId: number | null;
  readonly equipeIds: readonly number[];
  readonly planoId: number | null;
  readonly planoSuperiorId: number | null;
  readonly tipoContaId: number | null;
  readonly tipoAtendimento: TipoAtendimentoCobranca | null;
  readonly itemId: number | null;
  readonly grupoId: number | null;
  readonly grupoAtoId: number | null;
  readonly data: string;
}

export interface ConferenciaCobranca {
  readonly permitido: boolean;
  readonly origem: 'particular' | 'excecao' | 'credenciamento' | 'sem-credenciamento';
  readonly credenciamentoId: number | null;
  readonly excecaoId: number | null;
  readonly motivo: string | null;
}

function pontosPlano(planoId: number | null, p: PedidoCobranca): number {
  if (planoId === null) return 1;
  if (p.planoId !== null && planoId === p.planoId) return 3;
  if (p.planoSuperiorId !== null && planoId === p.planoSuperiorId) return 2;
  return 0;
}

function credenciamentoServe(c: CredenciamentoCobranca, p: PedidoCobranca): number {
  if (!vigente(c.vigenciaInicio, c.vigenciaFim, p.data)) return 0;
  const quem =
    (c.profissionalId !== null && c.profissionalId === p.profissionalId) ||
    (c.prestadorId !== null && c.prestadorId === p.prestadorId);
  if (!quem) return 0;
  const pl = pontosPlano(c.planoId, p);
  if (!pl) return 0;
  if (c.tipoContaId !== null && c.tipoContaId !== p.tipoContaId) return 0;
  if (c.grupoAtoId !== null && c.grupoAtoId !== p.grupoAtoId) return 0;
  return pl * 100 + (c.tipoContaId !== null ? 10 : 0) + (c.grupoAtoId !== null ? 10 : 0);
}

/**
 * Pontua a exceção para o pedido (0: não serve). Ordem: procedimento (item > grupo > todos), depois o sujeito
 * (credenciamento, profissional ou prestador > equipe), depois o plano (do paciente > superior > todos), o tipo de
 * atendimento e a fonte. Assim a permissão individual abre exceção dentro da proibição da equipe. A exceção presa a um
 * credenciamento vale quando esse credenciamento serve ao pedido, mesmo que outro mais específico também sirva.
 */
function excecaoServe(
  x: ExcecaoCredenciamento,
  p: PedidoCobranca,
  credenciamentosQueServem: ReadonlySet<number>,
): number {
  if (!vigente(x.vigenciaInicio, x.vigenciaFim, p.data)) return 0;
  if (x.fonteId !== null && x.fonteId !== p.fonteId) return 0;
  const individual =
    (x.credenciamentoId !== null && credenciamentosQueServem.has(x.credenciamentoId)) ||
    (x.profissionalId !== null && x.profissionalId === p.profissionalId) ||
    (x.prestadorId !== null && x.prestadorId === p.prestadorId);
  const equipe = x.equipeId !== null && p.equipeIds.includes(x.equipeId);
  if (!individual && !equipe) return 0;
  const pl = pontosPlano(x.planoId, p);
  if (!pl) return 0;
  if (x.tipoAtendimento !== 'todos' && x.tipoAtendimento !== p.tipoAtendimento) return 0;
  let pts =
    (individual ? 200 : 100) +
    pl * 10 +
    (x.tipoAtendimento !== 'todos' ? 5 : 0) +
    (x.fonteId !== null ? 2 : 0);
  if (x.itemId !== null) {
    if (x.itemId !== p.itemId) return 0;
    pts += 1000;
  } else if (x.grupoId !== null) {
    if (x.grupoId !== p.grupoId) return 0;
    pts += 500;
  }
  return pts;
}

/**
 * Confere se o profissional (ou prestador) pode cobrar o item na fonte pagadora na data. A exceção mais específica
 * decide (o sujeito individual vence a equipe; proibição vence permissão empatada); sem exceção, o credenciamento vigente mais específico. Particular e
 * item sem quem cobre não pedem credenciamento.
 */
export function conferirCobranca(
  credenciamentos: readonly CredenciamentoCobranca[],
  excecoes: readonly ExcecaoCredenciamento[],
  p: PedidoCobranca,
): ConferenciaCobranca {
  if (p.particular || (p.profissionalId === null && p.prestadorId === null))
    return { permitido: true, origem: 'particular', credenciamentoId: null, excecaoId: null, motivo: null };
  let cred: CredenciamentoCobranca | null = null;
  let cp = 0;
  const servem = new Set<number>();
  for (const c of credenciamentos) {
    const pts = credenciamentoServe(c, p);
    if (pts > 0) servem.add(c.id);
    if (pts > cp || (pts === cp && pts > 0 && cred && c.id > cred.id)) {
      cred = c;
      cp = pts;
    }
  }
  let exc: ExcecaoCredenciamento | null = null;
  let ep = 0;
  for (const x of excecoes) {
    const pts = excecaoServe(x, p, servem);
    if (pts > ep || (pts === ep && pts > 0 && exc && x.efeito === 'proibe' && exc.efeito === 'permite')) {
      exc = x;
      ep = pts;
    }
  }
  if (exc)
    return {
      permitido: exc.efeito === 'permite',
      origem: 'excecao',
      credenciamentoId: cred?.id ?? null,
      excecaoId: exc.id,
      motivo:
        exc.efeito === 'proibe'
          ? `Exceção ao credenciamento proíbe a cobrança${exc.motivo ? `: ${exc.motivo}` : '.'}`
          : null,
    };
  if (cred)
    return {
      permitido: true,
      origem: 'credenciamento',
      credenciamentoId: cred.id,
      excecaoId: null,
      motivo: null,
    };
  return {
    permitido: false,
    origem: 'sem-credenciamento',
    credenciamentoId: null,
    excecaoId: null,
    motivo: 'Sem credenciamento vigente para cobrar este item nesta fonte pagadora.',
  };
}

export interface NovoCredenciamentoCobranca {
  readonly profissionalId: number | null;
  readonly prestadorId: number | null;
  readonly codigoNaFonte: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export function validarCredenciamentoCobranca(e: NovoCredenciamentoCobranca): Record<string, string> {
  const erros: Record<string, string> = {};
  if ((e.profissionalId === null) === (e.prestadorId === null))
    erros['profissionalId'] = 'Informe o profissional ou o prestador (um dos dois).';
  if (e.codigoNaFonte !== null && e.codigoNaFonte.trim().length > 20)
    erros['codigoNaFonte'] = 'O código na fonte pagadora tem até 20 caracteres.';
  if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
    erros['vigenciaFim'] = 'O fim da vigência não pode ser antes do início.';
  return erros;
}

export interface NovaExcecaoCredenciamento {
  readonly credenciamentoId: number | null;
  readonly profissionalId: number | null;
  readonly prestadorId: number | null;
  readonly equipeId: number | null;
  readonly tipoAtendimento: string;
  readonly efeito: string;
  readonly motivo: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export function validarExcecaoCredenciamento(e: NovaExcecaoCredenciamento): Record<string, string> {
  const erros: Record<string, string> = {};
  if (
    e.credenciamentoId === null &&
    e.profissionalId === null &&
    e.prestadorId === null &&
    e.equipeId === null
  )
    erros['profissionalId'] =
      'Informe a quem a exceção vale: credenciamento, profissional, prestador ou equipe.';
  if (e.efeito !== 'permite' && e.efeito !== 'proibe') erros['efeito'] = 'O efeito é permitir ou proibir.';
  if (e.efeito === 'proibe' && !(e.motivo ?? '').trim())
    erros['motivo'] = 'Informe o motivo da proibição (vai para quem lança a conta).';
  if (!TIPOS_ATENDIMENTO_COBRANCA.includes(e.tipoAtendimento))
    erros['tipoAtendimento'] = 'Tipo de atendimento inválido.';
  if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
    erros['vigenciaFim'] = 'O fim da vigência não pode ser antes do início.';
  return erros;
}

// ── 3) Referência de mercado de mat/med ────────────────────────────────────────────────────────────

export interface PrecoReferenciaEdicao {
  readonly edicaoId: number;
  readonly vigenciaInicio: string;
  readonly operacao: string;
  readonly pf: number | null;
  readonly pmc: number | null;
}

/** O preço da referência na data (nulo: sem preço vigente, ou retirado pela edição mais recente). */
export function precoReferenciaNaData(
  precos: readonly PrecoReferenciaEdicao[],
  data: string,
): PrecoReferenciaEdicao | null {
  const ate = precos
    .filter((x) => x.vigenciaInicio <= data)
    .sort((a, b) =>
      a.vigenciaInicio === b.vigenciaInicio
        ? b.edicaoId - a.edicaoId
        : a.vigenciaInicio < b.vigenciaInicio
          ? 1
          : -1,
    );
  const p = ate[0];
  return p && p.operacao !== 'exclusao' ? p : null;
}

/** O valor que a tabela cobra: o de fábrica ou o máximo ao consumidor, conforme a tabela de mat/med. */
export function valorDaReferencia(p: PrecoReferenciaEdicao | null, base: 'pf' | 'pmc' | null): number | null {
  if (!p) return null;
  return base === 'pf' ? p.pf : (p.pmc ?? p.pf);
}
