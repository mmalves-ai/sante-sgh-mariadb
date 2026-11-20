// Regras do processo formal de compra (ficha do M55, etapa 4; regras 9, 10 e 12; cap-07 §7.3; Lei 14.133/2021 ou o
// regulamento próprio). Funções puras: a gravação confere de novo na transação, com o processo relido e travado.
//   - etapas: termo de referência → pesquisa de preços → edital e parecer → aviso publicado → sessão → julgado →
//     (recurso) → homologado; a contratação direta (dispensa, inexigibilidade) pula o edital, o aviso e o recurso;
//   - pesquisa de preços (art. 23): o valor estimado de cada item pela mediana, média ou menor preço, com as parcelas
//     impressas; item com menos preços que o mínimo só segue com a justificativa;
//   - aviso (art. 55): o prazo mínimo entre a publicação e a abertura em dias úteis, pela natureza e pelo critério;
//     o parecer jurídico favorável antes da publicação (art. 53), quando o estabelecimento exige;
//   - julgamento (arts. 33 a 36, 59 e 60): a classificação por item, a proposta acima do estimado fora (Lei 14.133),
//     o aviso de inexequível em obra (abaixo de 75%), o empate decidido com justificativa;
//   - recurso (art. 165): 3 dias úteis do julgamento; a homologação espera o prazo e o recurso decidido;
//   - segregação de funções (art. 7 §1): quem homologa não é o agente nem quem julgou;
//   - dispensa por valor (art. 75, I e II): o estimado até o limite do estabelecimento.
import {
  type AcaoLicitacao,
  type AvisoLicitacao,
  type ClassificacaoProposta,
  type CriterioJulgamento,
  ETAPAS_FINAIS_LICITACAO,
  type EtapaLicitacao,
  type EstimativaItem,
  type EstimativaLicitacao,
  type EventoLicitacao,
  type ItemLicitacao,
  type JulgamentoItem,
  type JulgamentoLicitacao,
  type LicitacaoDetalhe,
  type LicitacaoGravada,
  type LicitacaoResumo,
  type MetodoEstimativa,
  MODALIDADES_LICITACAO,
  type ModalidadeLicitacao,
  type NaturezaObjetoLicitacao,
  type ParametrosLicitacao,
  type PrecoPesquisado,
  type PropostaLicitacao,
  type RegimeLicitacao,
  type TipoEventoLicitacao,
} from '../licitacao.js';
import { reais, recusa, type RecusaSuprimentos } from './recusa.js';

// ── Datas e dias úteis (AAAA-MM-DD, sem fuso; sábado, domingo e feriado do calendário não contam) ─────────────────

const utc = (iso: string): number => {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(a, m - 1, d);
};
const isoDe = (t: number): string => new Date(t).toISOString().slice(0, 10);
const DIA = 86_400_000;

/**
 * Os feriados do calendário (cadastro de feriados do estabelecimento, M10): AAAA-MM-DD; o ano 9999 vale todo ano,
 * como o cadastro grava. O ponto facultativo também não conta (D-PRAZO-554: na dúvida, o prazo fica maior).
 */
export type FeriadosLicitacao = readonly string[];

function calendario(feriados: FeriadosLicitacao): (t: number) => boolean {
  const fixos = new Set<string>();
  const anuais = new Set<string>();
  for (const f of feriados) {
    const d = f.slice(0, 10);
    if (d.startsWith('9999-')) anuais.add(d.slice(5));
    else fixos.add(d);
  }
  return (t) => {
    const s = new Date(t).getUTCDay();
    if (s === 0 || s === 6) return false;
    const iso = isoDe(t);
    return !fixos.has(iso) && !anuais.has(iso.slice(5));
  };
}

/** Os dias úteis depois de `de` até `ate`, inclusive (a contagem exclui o dia do começo, art. 183). */
export function diasUteisEntre(de: string, ate: string, feriados: FeriadosLicitacao = []): number {
  const a = utc(de);
  const b = utc(ate);
  if (b <= a) return 0;
  const util = calendario(feriados);
  let n = 0;
  for (let t = a + DIA; t <= b; t += DIA) if (util(t)) n++;
  return n;
}

/** A data em que se completam `n` dias úteis depois de `de` (n = 0: o próprio dia). */
export function somarDiasUteis(de: string, n: number, feriados: FeriadosLicitacao = []): string {
  const util = calendario(feriados);
  let t = utc(de);
  let falta = n;
  while (falta > 0) {
    t += DIA;
    if (util(t)) falta--;
  }
  return isoDe(t);
}

// ── Modalidade e prazos ─────────────────────────────────────────────────────────────────────────────────────────

export function contratacaoDireta(m: ModalidadeLicitacao): boolean {
  return MODALIDADES_LICITACAO.find((x) => x.codigo === m)?.direta ?? false;
}

const MAIOR_MELHOR: readonly CriterioJulgamento[] = ['maior-desconto', 'maior-lance', 'maior-retorno'];
const PRECO_FACE: readonly CriterioJulgamento[] = ['menor-preco', 'maior-desconto'];

/**
 * O prazo mínimo do aviso em dias úteis (Lei 14.133, art. 55): bens 8 (menor preço ou maior desconto) ou 15; serviço
 * e obra comuns 10; especiais 25; maior lance 15; técnica e preço e melhor técnica 35. O regulamento próprio usa o
 * prazo do estabelecimento; a contratação direta não tem aviso (nulo).
 */
export function prazoMinimoAviso(
  o: {
    regime: RegimeLicitacao;
    modalidade: ModalidadeLicitacao;
    criterio: CriterioJulgamento;
    natureza: NaturezaObjetoLicitacao;
  },
  p: Pick<ParametrosLicitacao, 'prazoAvisoRegulamentoDiasUteis'>,
): number | null {
  if (contratacaoDireta(o.modalidade)) return null;
  if (o.regime === 'regulamento') return p.prazoAvisoRegulamentoDiasUteis;
  if (o.criterio === 'maior-lance') return 15;
  if (o.criterio === 'tecnica-preco' || o.criterio === 'melhor-tecnica') return 35;
  const face = PRECO_FACE.includes(o.criterio);
  switch (o.natureza) {
    case 'bens':
      return face ? 8 : 15;
    case 'servico-comum':
    case 'obra-comum':
      return face ? 10 : 35;
    case 'servico-especial':
    case 'obra-especial':
      return face ? 25 : 35;
  }
}

/** A dispensa pelo valor (art. 75, I: obras e serviços de engenharia; II: os demais), lida do fundamento. */
export function incisoDispensaValor(fundamento: string | null): 'I' | 'II' | null {
  const m = /75\s*,?\s*(?:inc(?:iso)?\.?\s*)?(II|I)(?![IVX])/i.exec(fundamento ?? '');
  return m ? (m[1]!.toUpperCase() as 'I' | 'II') : null;
}

// ── Pesquisa de preços (art. 23) ────────────────────────────────────────────────────────────────────────────────

const fmt = (n: number, casas = 2): string =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });
const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function central(precos: readonly number[], metodo: MetodoEstimativa): number | null {
  if (precos.length === 0) return null;
  const o = [...precos].sort((a, b) => a - b);
  if (metodo === 'menor') return o[0]!;
  if (metodo === 'media') return r4(o.reduce((s, x) => s + x, 0) / o.length);
  const m = Math.floor(o.length / 2);
  return o.length % 2 === 1 ? o[m]! : r4((o[m - 1]! + o[m]!) / 2);
}

const NOME_METODO: Readonly<Record<MetodoEstimativa, string>> = {
  mediana: 'mediana',
  media: 'média',
  menor: 'menor',
};

/** O valor estimado do item com as parcelas: os preços, o método, a conta unitária e a total. */
export function estimarItem(
  item: Pick<ItemLicitacao, 'id' | 'numero' | 'quantidade'>,
  precos: readonly number[],
  metodo: MetodoEstimativa,
  minimoPrecos: number,
): EstimativaItem {
  const unit = central(precos, metodo);
  const total = unit === null ? null : reais(unit * item.quantidade);
  const lista = [...precos].sort((a, b) => a - b).map((x) => fmt(x, 4));
  const conta =
    unit === null
      ? `item ${item.numero}: sem preço pesquisado`
      : `item ${item.numero}: ${NOME_METODO[metodo]} de [${lista.join('; ')}] = ${fmt(unit, 4)} × ${fmt(item.quantidade, 3)} = ${fmt(total!)}`;
  return {
    item: item.id,
    metodo,
    precos: [...precos],
    quantidadePrecos: precos.length,
    valorUnitario: unit,
    quantidade: item.quantidade,
    valorTotal: total,
    conta,
    abaixoDoMinimo: precos.length < minimoPrecos,
  };
}

/** O preço como a conta o lê: o descartado (com justificativa) fica fora da estimativa e do mínimo. */
export type PrecoNaConta = Pick<PrecoPesquisado, 'item' | 'valor'> & {
  readonly descarte?: PrecoPesquisado['descarte'];
};

/** A estimativa do processo: a soma dos itens (sem os preços descartados), com cada parcela impressa. */
export function estimarLicitacao(
  itens: readonly Pick<ItemLicitacao, 'id' | 'numero' | 'quantidade'>[],
  precos: readonly PrecoNaConta[],
  metodo: MetodoEstimativa,
  minimoPrecos: number,
): EstimativaLicitacao {
  const est = itens.map((i) =>
    estimarItem(
      i,
      precos.filter((p) => p.item === i.id && !p.descarte).map((p) => p.valor),
      metodo,
      minimoPrecos,
    ),
  );
  const completo = est.every((e) => e.valorTotal !== null);
  const total = completo ? reais(est.reduce((s, e) => s + (e.valorTotal ?? 0), 0)) : null;
  const conta = completo
    ? `${est.map((e) => fmt(e.valorTotal!)).join(' + ')} = ${fmt(total!)}`
    : 'Há item sem preço pesquisado.';
  return {
    itens: est,
    valorTotal: total,
    conta,
    minimoPrecos,
    itensAbaixoDoMinimo: est.filter((e) => e.abaixoDoMinimo).length,
  };
}

// ── Julgamento (arts. 33 a 36, 59 e 60) ─────────────────────────────────────────────────────────────────────────

export interface ContextoJulgamento {
  readonly regime: RegimeLicitacao;
  readonly criterio: CriterioJulgamento;
  readonly natureza: NaturezaObjetoLicitacao;
  readonly pesoTecnica: number | null;
}

/** O julgamento de um item: a classificação das propostas válidas e o vencedor (ou o empate, fracasso, deserto). */
export function julgarItem(
  item: Pick<ItemLicitacao, 'id' | 'quantidade' | 'valorEstimado'>,
  propostas: readonly PropostaLicitacao[],
  c: ContextoJulgamento,
  desempate: number | null = null,
): JulgamentoItem {
  const doItem = propostas.filter((p) => p.item === item.id);
  if (doItem.length === 0)
    return {
      item: item.id,
      resultado: 'deserto',
      vencedor: null,
      valorUnitario: null,
      valorTotal: null,
      empatados: [],
      classificacao: [],
    };
  const est = item.valorEstimado;
  const ehPreco = c.criterio === 'menor-preco' || c.criterio === 'tecnica-preco';
  const linhas = doItem.map((p) => {
    const valorFinal = p.lance ?? p.valor;
    const acima = c.regime === 'lei-14133' && ehPreco && est !== null && valorFinal > est;
    const inexequivel =
      c.criterio === 'menor-preco' &&
      (c.natureza === 'obra-comum' || c.natureza === 'obra-especial') &&
      est !== null &&
      valorFinal < est * 0.75;
    return { p, valorFinal, acima, inexequivel };
  });
  const validas = linhas.filter((l) => l.p.situacao === 'valida' && !l.acima);
  const menorPreco = Math.min(...validas.map((l) => l.valorFinal));
  const pontuar = (l: (typeof linhas)[number]): number | null => {
    if (c.criterio === 'tecnica-preco') {
      const peso = (c.pesoTecnica ?? 0) / 100;
      return (
        Math.round(((l.p.notaTecnica ?? 0) * peso + (menorPreco / l.valorFinal) * 100 * (1 - peso)) * 100) /
        100
      );
    }
    if (c.criterio === 'melhor-tecnica') return l.p.notaTecnica ?? 0;
    return null;
  };
  const chave = (l: (typeof linhas)[number]): number => {
    const pt = pontuar(l);
    if (pt !== null) return pt;
    return MAIOR_MELHOR.includes(c.criterio) ? l.valorFinal : -l.valorFinal;
  };
  const ordenadas = [...validas].sort((a, b) => chave(b) - chave(a) || a.p.id - b.p.id);
  const melhor = ordenadas.length > 0 ? chave(ordenadas[0]!) : null;
  const empatados =
    melhor === null ? [] : ordenadas.filter((l) => chave(l) === melhor).map((l) => l.p.fornecedor);
  let vencedorLinha = ordenadas[0] ?? null;
  if (empatados.length > 1) {
    vencedorLinha =
      desempate !== null && empatados.includes(desempate)
        ? (ordenadas.find((l) => l.p.fornecedor === desempate) ?? null)
        : null;
  }
  const posicao = new Map(ordenadas.map((l, i) => [l.p.id, i + 1]));
  const classificacao: ClassificacaoProposta[] = linhas
    .map((l) => ({
      proposta: l.p.id,
      fornecedor: l.p.fornecedor,
      valorFinal: l.valorFinal,
      pontuacao: pontuar(l),
      posicao: posicao.get(l.p.id) ?? null,
      situacao:
        l.p.situacao !== 'valida' ? l.p.situacao : l.acima ? ('acima-estimado' as const) : l.p.situacao,
      motivo:
        l.p.situacao !== 'valida'
          ? l.p.motivo
          : l.acima
            ? 'Acima do valor estimado: negocie o preço ou desclassifique.'
            : null,
      avisoInexequivel: l.inexequivel,
    }))
    .sort((a, b) => (a.posicao ?? 9_999) - (b.posicao ?? 9_999) || a.proposta - b.proposta);
  if (ordenadas.length === 0)
    return {
      item: item.id,
      resultado: 'fracassado',
      vencedor: null,
      valorUnitario: null,
      valorTotal: null,
      empatados: [],
      classificacao,
    };
  if (!vencedorLinha)
    return {
      item: item.id,
      resultado: 'empate',
      vencedor: null,
      valorUnitario: null,
      valorTotal: null,
      empatados,
      classificacao,
    };
  const unit = vencedorLinha.valorFinal;
  return {
    item: item.id,
    resultado: 'adjudicavel',
    vencedor: vencedorLinha.p.fornecedor,
    valorUnitario: unit,
    valorTotal: c.criterio === 'maior-desconto' ? null : reais(unit * item.quantidade),
    empatados: empatados.length > 1 ? empatados : [],
    classificacao,
  };
}

/** O julgamento do processo: cada item e o total adjudicado com as parcelas. */
export function julgarLicitacao(
  itens: readonly Pick<ItemLicitacao, 'id' | 'numero' | 'quantidade' | 'valorEstimado'>[],
  propostas: readonly PropostaLicitacao[],
  c: ContextoJulgamento,
  desempates: readonly { item: number; fornecedor: number }[] = [],
): JulgamentoLicitacao {
  const j = itens.map((i) =>
    julgarItem(i, propostas, c, desempates.find((d) => d.item === i.id)?.fornecedor ?? null),
  );
  const comValor = j.filter((x) => x.valorTotal !== null);
  const total = reais(comValor.reduce((s, x) => s + (x.valorTotal ?? 0), 0));
  const conta =
    comValor.length === 0
      ? 'Nenhum item com valor adjudicado.'
      : `${comValor
          .map((x) => {
            const n = itens.find((i) => i.id === x.item)?.numero ?? 0;
            return `item ${n}: ${fmt(x.valorTotal!)}`;
          })
          .join(' + ')} = ${fmt(total)}`;
  return {
    itens: j,
    valorTotal: total,
    conta,
    empates: j.filter((x) => x.resultado === 'empate').length,
    fracassados: j.filter((x) => x.resultado === 'fracassado').length,
    desertos: j.filter((x) => x.resultado === 'deserto').length,
  };
}

// ── Etapas ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function etapaFinal(e: EtapaLicitacao): boolean {
  return ETAPAS_FINAIS_LICITACAO.includes(e);
}

/** O estado relido do processo que as regras de etapa conferem. */
export interface EstadoLicitacao {
  readonly processo: LicitacaoGravada;
  readonly itens: readonly ItemLicitacao[];
  readonly precos: readonly PrecoNaConta[];
  readonly propostas: readonly PropostaLicitacao[];
  readonly eventos: readonly Pick<EventoLicitacao, 'tipo' | 'resultado' | 'criadoEm' | 'id'>[];
  readonly hoje: string;
  readonly parametros: ParametrosLicitacao;
  /** O calendário de feriados do estabelecimento (cadastro do M10; ano 9999 = todo ano). Sem ele, só o fim de semana. */
  readonly feriados?: FeriadosLicitacao;
}

/** O dia final do prazo de recurso (nulo na contratação direta ou antes do julgamento). */
export function fimPrazoRecurso(
  e: Pick<EstadoLicitacao, 'processo' | 'parametros' | 'feriados'>,
): string | null {
  const p = e.processo;
  if (contratacaoDireta(p.modalidade) || !p.dataJulgamento) return null;
  return somarDiasUteis(p.dataJulgamento, e.parametros.prazoRecursoDiasUteis, e.feriados ?? []);
}

const ultimo = <T extends { tipo: TipoEventoLicitacao; id: number }>(
  ev: readonly T[],
  tipo: TipoEventoLicitacao,
) => [...ev].filter((x) => x.tipo === tipo).sort((a, b) => b.id - a.id)[0] ?? null;

/** A pesquisa completa para seguir: todo item com preço e o estimado positivo; abaixo do mínimo, a justificativa. */
function conferirPesquisa(e: EstadoLicitacao, justificativa: string | null): RecusaSuprimentos | null {
  const est = estimarLicitacao(e.itens, e.precos, e.processo.metodoEstimativa, e.parametros.minimoPrecos);
  if (est.valorTotal === null || est.valorTotal <= 0)
    return recusa(
      'licitacao-sem-preco',
      'Há item sem preço pesquisado: registre ao menos um preço por item.',
    );
  if (est.itensAbaixoDoMinimo > 0 && (justificativa ?? '').length < 20)
    return recusa(
      'licitacao-pesquisa-insuficiente',
      `Há ${est.itensAbaixoDoMinimo} item(ns) com menos de ${e.parametros.minimoPrecos} preços: pesquise mais ou justifique (20 letras ou mais).`,
      ['justificativaPesquisa'],
    );
  const p = e.processo;
  if (p.modalidade === 'dispensa' && p.regime === 'lei-14133') {
    const inciso = incisoDispensaValor(p.fundamento);
    const limite =
      inciso === 'I'
        ? e.parametros.limiteDispensaObras
        : inciso === 'II'
          ? e.parametros.limiteDispensaDemais
          : null;
    if (limite !== null && est.valorTotal > limite)
      return recusa(
        'licitacao-dispensa-acima-limite',
        `O valor estimado (${fmt(est.valorTotal)}) passa do limite da dispensa pelo valor (art. 75, ${inciso}: ${fmt(limite)}).`,
      );
  }
  return null;
}

export type DadosAvanco =
  | { readonly para: 'pesquisa' }
  | { readonly para: 'edital' | 'sessao'; readonly justificativaPesquisa: string | null }
  | {
      readonly para: 'publicado';
      readonly dataPublicacao: string;
      readonly dataAbertura: string;
    }
  | {
      readonly para: 'julgado';
      readonly desempates: readonly { item: number; fornecedor: number }[];
      readonly justificativaDesempate: string | null;
    }
  | { readonly para: 'fracassado' | 'deserto' };

/** As etapas de onde cada destino pode vir (a contratação direta vai da pesquisa à sessão). */
const ORIGENS: Readonly<Record<DadosAvanco['para'], readonly EtapaLicitacao[]>> = {
  pesquisa: ['planejamento'],
  edital: ['pesquisa'],
  publicado: ['edital'],
  sessao: ['pesquisa', 'publicado'],
  julgado: ['sessao'],
  fracassado: ['sessao'],
  deserto: ['publicado', 'sessao'],
};

const ROTULO_ETAPA: Readonly<Record<EtapaLicitacao, string>> = {
  planejamento: 'o termo de referência',
  pesquisa: 'a pesquisa de preços',
  edital: 'o edital',
  publicado: 'o aviso publicado',
  sessao: 'a sessão',
  julgado: 'o julgamento',
  recurso: 'o recurso',
  homologado: 'a homologação',
  fracassado: 'o processo fracassado',
  deserto: 'o processo deserto',
  revogado: 'a revogação',
  anulado: 'a anulação',
};

/** Pode o processo ir para a etapa? A recusa diz o porquê (a tela mostra). */
export function podeAvancar(e: EstadoLicitacao, d: DadosAvanco): RecusaSuprimentos | null {
  const p = e.processo;
  const direta = contratacaoDireta(p.modalidade);
  if (etapaFinal(p.etapa))
    return recusa('licitacao-encerrada', 'O processo está encerrado: nenhuma etapa muda mais.');
  if (!ORIGENS[d.para].includes(p.etapa))
    return recusa(
      'licitacao-etapa-invalida',
      `Daqui (${ROTULO_ETAPA[p.etapa]}) o processo não vai para ${ROTULO_ETAPA[d.para]}.`,
    );
  switch (d.para) {
    case 'pesquisa':
      return null;
    case 'edital':
      if (direta)
        return recusa('licitacao-etapa-invalida', 'A contratação direta não tem edital: siga para a sessão.');
      return conferirPesquisa(e, d.justificativaPesquisa);
    case 'sessao':
      if (p.etapa === 'pesquisa') {
        if (!direta)
          return recusa('licitacao-etapa-invalida', 'Antes da sessão vêm o edital e o aviso publicado.');
        return conferirPesquisa(e, d.justificativaPesquisa);
      }
      if (p.dataAbertura && e.hoje < p.dataAbertura)
        return recusa('licitacao-antes-abertura', `A sessão só abre na data marcada (${p.dataAbertura}).`);
      return null;
    case 'publicado': {
      if (d.dataPublicacao > e.hoje)
        return recusa('licitacao-publicacao-futura', 'Registre a publicação depois que ela sair.', [
          'dataPublicacao',
        ]);
      if (e.parametros.exigeParecer && p.regime === 'lei-14133') {
        const par = ultimo(e.eventos, 'parecer');
        if (!par)
          return recusa(
            'licitacao-sem-parecer',
            'Registre o parecer jurídico do edital antes da publicação.',
          );
        if (par.resultado === 'desfavoravel')
          return recusa(
            'licitacao-parecer-desfavoravel',
            'O último parecer jurídico é desfavorável: ajuste o edital e registre um novo parecer.',
          );
      }
      const minimo = prazoMinimoAviso(p, e.parametros) ?? 0;
      const uteis = diasUteisEntre(d.dataPublicacao, d.dataAbertura, e.feriados ?? []);
      if (uteis < minimo)
        return recusa(
          'licitacao-prazo-aviso',
          `Entre a publicação e a abertura há ${uteis} dias úteis (sem sábado, domingo e feriado); o mínimo é ${minimo} (a primeira data possível é ${somarDiasUteis(d.dataPublicacao, minimo, e.feriados ?? [])}).`,
          ['dataAbertura'],
        );
      return null;
    }
    case 'julgado': {
      const j = julgarLicitacao(e.itens, e.propostas, p, d.desempates);
      if (j.empates > 0)
        return recusa(
          'licitacao-empate',
          `Há ${j.empates} item(ns) empatado(s): escolha o vencedor pelo critério de desempate.`,
          ['desempates'],
        );
      if (d.desempates.length > 0 && (d.justificativaDesempate ?? '').length < 20)
        return recusa(
          'licitacao-desempate-sem-justificativa',
          'Justifique o desempate (20 letras ou mais).',
          ['justificativaDesempate'],
        );
      if (!j.itens.some((x) => x.resultado === 'adjudicavel'))
        return recusa(
          'licitacao-sem-vencedor',
          'Nenhum item tem vencedor: declare o processo fracassado ou deserto.',
        );
      return null;
    }
    case 'deserto':
      if (e.propostas.length > 0)
        return recusa('licitacao-com-propostas', 'Há propostas registradas: o processo não é deserto.');
      return null;
    case 'fracassado': {
      const j = julgarLicitacao(e.itens, e.propostas, p);
      if (j.itens.some((x) => x.resultado === 'adjudicavel' || x.resultado === 'empate'))
        return recusa('licitacao-com-vencedor', 'Há item com proposta válida: julgue o processo.');
      return null;
    }
  }
}

/** Pode homologar? A etapa, o prazo de recurso vencido e a segregação de funções. */
export function podeHomologar(e: EstadoLicitacao, usuario: string): RecusaSuprimentos | null {
  const p = e.processo;
  if (p.etapa === 'recurso')
    return recusa('licitacao-recurso-pendente', 'Há recurso sem decisão: decida antes de homologar.');
  if (p.etapa !== 'julgado') return recusa('licitacao-etapa-invalida', 'Só o processo julgado é homologado.');
  const fim = fimPrazoRecurso(e);
  if (fim !== null && e.hoje <= fim)
    return recusa('licitacao-prazo-recurso', `O prazo de recurso vai até ${fim}: homologue depois dele.`);
  const u = usuario.toUpperCase();
  if (u === p.agente.toUpperCase() || (p.julgadoPor && u === p.julgadoPor.toUpperCase()))
    return recusa(
      'licitacao-segregacao',
      'Quem conduziu ou julgou o processo não o homologa: a homologação é de outra pessoa (segregação de funções).',
    );
  return null;
}

/** Pode revogar ou anular? Revogar, só antes do fim; anular, também depois da homologação. */
export function podeEncerrar(
  p: Pick<LicitacaoGravada, 'etapa'>,
  para: 'revogado' | 'anulado',
): RecusaSuprimentos | null {
  if (para === 'anulado' && p.etapa === 'homologado') return null;
  if (etapaFinal(p.etapa))
    return recusa('licitacao-encerrada', 'O processo está encerrado: nenhuma etapa muda mais.');
  return null;
}

/** As etapas em que cada evento é registrado (o recurso e a decisão também mudam a etapa). */
const ETAPAS_DO_EVENTO: Readonly<
  Record<Exclude<TipoEventoLicitacao, 'etapa' | 'publicacao'>, readonly EtapaLicitacao[]>
> = {
  parecer: ['planejamento', 'pesquisa', 'edital'],
  esclarecimento: ['edital', 'publicado'],
  recurso: ['julgado'],
  'decisao-recurso': ['recurso'],
  documento: [
    'planejamento',
    'pesquisa',
    'edital',
    'publicado',
    'sessao',
    'julgado',
    'recurso',
    'homologado',
    'fracassado',
    'deserto',
    'revogado',
    'anulado',
  ],
  ata: ['julgado', 'homologado'],
  pedido: ['homologado'],
};

export interface DadosEvento {
  readonly tipo: Exclude<TipoEventoLicitacao, 'etapa' | 'publicacao'>;
  readonly data?: string | null;
  /** O recorrente (recurso). */
  readonly fornecedor?: number | null;
  /** O fornecedor do pedido de compra relido (pedido). */
  readonly fornecedorPedido?: number | null;
  /** O pedido já está ligado a este processo? */
  readonly pedidoJaLigado?: boolean;
}

/** Pode registrar o evento? A etapa, o prazo de recurso, o recorrente licitante e o pedido do vencedor. */
export function podeRegistrarEvento(e: EstadoLicitacao, d: DadosEvento): RecusaSuprimentos | null {
  const p = e.processo;
  if (d.tipo !== 'documento' && !ETAPAS_DO_EVENTO[d.tipo].includes(p.etapa))
    return recusa('licitacao-etapa-invalida', `Isto não se registra com ${ROTULO_ETAPA[p.etapa]}.`);
  if (d.data && d.data > e.hoje)
    return recusa('licitacao-data-futura', 'A data não pode ser futura.', ['data']);
  if (d.tipo === 'recurso') {
    if (contratacaoDireta(p.modalidade))
      return recusa('licitacao-etapa-invalida', 'A contratação direta não tem fase de recurso.');
    const fim = fimPrazoRecurso(e);
    if (fim !== null && e.hoje > fim)
      return recusa('licitacao-recurso-intempestivo', `O prazo de recurso acabou em ${fim}.`);
    if (!e.propostas.some((x) => x.fornecedor === d.fornecedor))
      return recusa('licitacao-recorrente', 'Só recorre quem participou do processo (fez proposta).', [
        'fornecedor',
      ]);
  }
  if (d.tipo === 'pedido') {
    if (d.fornecedorPedido === null || d.fornecedorPedido === undefined)
      return recusa('licitacao-pedido-inexistente', 'O pedido de compra não foi encontrado.', ['pedido']);
    if (!e.itens.some((i) => i.vencedor === d.fornecedorPedido))
      return recusa(
        'licitacao-pedido-fornecedor',
        'O pedido é de um fornecedor que não venceu nenhum item deste processo.',
        ['pedido'],
      );
    if (d.pedidoJaLigado)
      return recusa('licitacao-pedido-repetido', 'Este pedido já está ligado ao processo.', ['pedido']);
  }
  return null;
}

/** A etapa que o evento leva (o recurso abre a análise; a decisão provida refaz o julgamento). */
export function etapaDepoisDoEvento(
  atual: EtapaLicitacao,
  tipo: TipoEventoLicitacao,
  resultado: string | null,
): EtapaLicitacao {
  if (tipo === 'recurso') return 'recurso';
  if (tipo === 'decisao-recurso') return resultado === 'provido' ? 'sessao' : 'julgado';
  return atual;
}

/** Pode registrar preço (só na pesquisa) ou proposta e situação (só na sessão)? */
export function podeRegistrarPreco(
  e: Pick<EstadoLicitacao, 'processo' | 'itens'>,
  item: number,
): RecusaSuprimentos | null {
  if (e.processo.etapa !== 'pesquisa')
    return recusa('licitacao-etapa-invalida', 'Os preços se registram na pesquisa de preços.');
  if (!e.itens.some((i) => i.id === item))
    return recusa('licitacao-item-inexistente', 'O item não é deste processo.', ['item']);
  return null;
}

/** O descarte de um preço: só na pesquisa, do próprio processo e uma vez (o preço fica gravado, marcado). */
export function podeDescartarPreco(
  e: Pick<EstadoLicitacao, 'processo'> & {
    readonly precosDetalhe: readonly Pick<PrecoPesquisado, 'id' | 'descarte'>[];
  },
  preco: number,
): RecusaSuprimentos | null {
  if (e.processo.etapa !== 'pesquisa')
    return recusa('licitacao-etapa-invalida', 'Os preços só se descartam durante a pesquisa de preços.');
  const x = e.precosDetalhe.find((p) => p.id === preco);
  if (!x) return recusa('licitacao-preco-inexistente', 'O preço não é deste processo.');
  if (x.descarte) return recusa('licitacao-preco-descartado', 'Este preço já foi descartado.');
  return null;
}

export function podeRegistrarProposta(
  e: Pick<EstadoLicitacao, 'processo' | 'itens' | 'propostas'>,
  x: { item: number; fornecedor: number; lance: number | null; notaTecnica: number | null },
): RecusaSuprimentos | null {
  const p = e.processo;
  if (p.etapa !== 'sessao') return recusa('licitacao-etapa-invalida', 'As propostas se registram na sessão.');
  if (!e.itens.some((i) => i.id === x.item))
    return recusa('licitacao-item-inexistente', 'O item não é deste processo.', ['item']);
  if (e.propostas.some((q) => q.item === x.item && q.fornecedor === x.fornecedor))
    return recusa('licitacao-proposta-repetida', 'Este fornecedor já tem proposta neste item.', [
      'fornecedor',
    ]);
  const lances = p.modalidade.startsWith('pregao') || p.modalidade === 'leilao';
  if (x.lance !== null && !lances)
    return recusa('licitacao-lance', 'Lance só no pregão e no leilão.', ['lance']);
  if ((p.criterio === 'tecnica-preco' || p.criterio === 'melhor-tecnica') && x.notaTecnica === null)
    return recusa('licitacao-nota-tecnica', 'Informe a nota técnica da proposta.', ['notaTecnica']);
  return null;
}

export function podeMudarSituacaoProposta(p: Pick<LicitacaoGravada, 'etapa'>): RecusaSuprimentos | null {
  if (p.etapa !== 'sessao')
    return recusa('licitacao-etapa-invalida', 'A proposta se classifica ou desclassifica na sessão.');
  return null;
}

/** O termo (e os itens) só mudam no termo de referência; o processo encerrado não muda. */
export function podeAlterarTermo(p: Pick<LicitacaoGravada, 'etapa'>): RecusaSuprimentos | null {
  if (p.etapa !== 'planejamento')
    return recusa('licitacao-termo-fechado', 'O termo de referência só muda antes da pesquisa de preços.');
  return null;
}

// ── Montagem do detalhe ─────────────────────────────────────────────────────────────────────────────────────────

const PROXIMAS: Readonly<Record<EtapaLicitacao, readonly AcaoLicitacao['acao'][]>> = {
  planejamento: ['pesquisa', 'revogar'],
  pesquisa: ['edital', 'sessao', 'revogar'],
  edital: ['publicado', 'revogar'],
  publicado: ['sessao', 'deserto', 'revogar'],
  sessao: ['julgado', 'fracassado', 'deserto', 'revogar'],
  julgado: ['homologar', 'revogar'],
  recurso: ['revogar'],
  homologado: [],
  fracassado: [],
  deserto: [],
  revogado: [],
  anulado: [],
};

/** As próximas ações com o motivo do bloqueio (a prévia; a gravação confere de novo). */
export function acoesLicitacao(e: EstadoLicitacao, usuario: string): AcaoLicitacao[] {
  const p = e.processo;
  const direta = contratacaoDireta(p.modalidade);
  return PROXIMAS[p.etapa]
    .filter((a) => !(direta && a === 'edital') && !(!direta && a === 'sessao' && p.etapa === 'pesquisa'))
    .map((acao): AcaoLicitacao => {
      let r: RecusaSuprimentos | null;
      if (acao === 'homologar') r = podeHomologar(e, usuario);
      else if (acao === 'revogar') r = podeEncerrar(p, 'revogado');
      else if (acao === 'publicado') {
        const prazo = prazoMinimoAviso(p, e.parametros) ?? 0;
        r = podeAvancar(e, {
          para: 'publicado',
          dataPublicacao: e.hoje,
          dataAbertura: somarDiasUteis(e.hoje, Math.max(prazo, 1), e.feriados ?? []),
        });
      } else if (acao === 'julgado')
        r = podeAvancar(e, { para: 'julgado', desempates: [], justificativaDesempate: null });
      else if (acao === 'edital' || acao === 'sessao') {
        r = podeAvancar(e, { para: acao, justificativaPesquisa: null });
        // Abaixo do mínimo de preços segue com a justificativa: a ação fica disponível e diz o que pede.
        if (r?.codigo === 'licitacao-pesquisa-insuficiente') return { acao, pode: true, motivo: r.mensagem };
      } else if (acao === 'fracassado' || acao === 'deserto') r = podeAvancar(e, { para: acao });
      else if (acao === 'pesquisa') r = podeAvancar(e, { para: 'pesquisa' });
      else r = null;
      if (acao === 'julgado' && r?.codigo === 'licitacao-empate')
        return { acao, pode: true, motivo: r.mensagem };
      return { acao, pode: r === null, motivo: r?.mensagem ?? null };
    });
}

export function avisosLicitacao(e: EstadoLicitacao, j: JulgamentoLicitacao | null): AvisoLicitacao[] {
  const a: AvisoLicitacao[] = [];
  const p = e.processo;
  const est = estimarLicitacao(e.itens, e.precos, p.metodoEstimativa, e.parametros.minimoPrecos);
  if (p.etapa === 'pesquisa' && est.itensAbaixoDoMinimo > 0)
    a.push({
      codigo: 'pesquisa-insuficiente',
      mensagem: `${est.itensAbaixoDoMinimo} item(ns) com menos de ${e.parametros.minimoPrecos} preços pesquisados.`,
    });
  if (j?.itens.some((x) => x.classificacao.some((c) => c.avisoInexequivel)))
    a.push({
      codigo: 'inexequivel',
      mensagem: 'Há proposta abaixo de 75% do estimado em obra ou serviço de engenharia: peça a comprovação.',
    });
  if (j && j.empates > 0)
    a.push({ codigo: 'empate', mensagem: `${j.empates} item(ns) empatado(s): desempate ao julgar.` });
  const fim = fimPrazoRecurso(e);
  if (p.etapa === 'julgado' && fim !== null && e.hoje <= fim)
    a.push({ codigo: 'prazo-recurso', mensagem: `Prazo de recurso até ${fim}.` });
  return a;
}

export function resumoLicitacao(p: LicitacaoGravada, itens: number): LicitacaoResumo {
  return {
    id: p.id,
    numero: p.numero,
    regime: p.regime,
    modalidade: p.modalidade,
    criterio: p.criterio,
    objeto: p.objeto,
    etapa: p.etapa,
    agente: p.agente,
    valorEstimado: p.valorEstimado,
    dataAbertura: p.dataAbertura,
    itens,
    versao: p.versao,
  };
}

const ORCAMENTO_SIGILOSO = 'Orçamento sigiloso até o julgamento.';

/**
 * O detalhe do processo: a estimativa com as parcelas, o julgamento (a prévia na sessão; o gravado depois), as
 * próximas ações e os avisos. O orçamento sigiloso (art. 24) fica fora até o julgamento para quem não conduz.
 */
export function montarLicitacao(
  e: EstadoLicitacao & {
    readonly precosDetalhe: readonly PrecoPesquisado[];
    readonly eventosDetalhe: readonly EventoLicitacao[];
  },
  usuario: string,
  conduz: boolean,
): LicitacaoDetalhe {
  const p = e.processo;
  const julgamento =
    p.etapa === 'sessao' || p.etapa === 'julgado' || p.etapa === 'recurso' || p.etapa === 'homologado'
      ? julgarLicitacao(
          e.itens,
          e.propostas,
          p,
          e.itens.filter((i) => i.vencedor !== null).map((i) => ({ item: i.id, fornecedor: i.vencedor! })),
        )
      : null;
  const esconder = p.sigiloso && !conduz && !p.dataJulgamento;
  const estimativa = estimarLicitacao(e.itens, e.precos, p.metodoEstimativa, e.parametros.minimoPrecos);
  return {
    ...resumoLicitacao(p, e.itens.length),
    valorEstimado: esconder ? null : p.valorEstimado,
    processo: esconder ? { ...p, valorEstimado: null } : p,
    itensDetalhe: esconder ? e.itens.map((i) => ({ ...i, valorEstimado: null })) : e.itens,
    precos: esconder ? [] : e.precosDetalhe,
    propostas: e.propostas,
    eventos: esconder ? e.eventosDetalhe.map(eventoSemOrcamento) : e.eventosDetalhe,
    estimativa: esconder
      ? {
          itens: [],
          valorTotal: null,
          conta: ORCAMENTO_SIGILOSO,
          minimoPrecos: e.parametros.minimoPrecos,
          itensAbaixoDoMinimo: 0,
        }
      : estimativa,
    // A prévia do julgamento na sessão compara as propostas com o estimado: para quem não conduz, sai depois dele.
    julgamento: esconder ? null : julgamento,
    acoes: acoesLicitacao(e, usuario),
    avisos: avisosLicitacao(e, esconder ? null : julgamento),
    prazoRecursoAte: fimPrazoRecurso(e),
    hoje: e.hoje,
    feriados: e.feriados ?? [],
  };
}

/**
 * O evento sem as parcelas da estimativa (art. 24): a saída da pesquisa grava a conta (os preços e o total) na
 * descrição, e o recurso e a decisão podem citá-la. Para quem não conduz, antes do julgamento, a descrição das
 * mudanças de etapa a partir da pesquisa vira o aviso do sigilo; os demais atos seguem como gravados.
 */
function eventoSemOrcamento(ev: EventoLicitacao): EventoLicitacao {
  if (ev.tipo === 'etapa' && ev.de === 'pesquisa')
    return { ...ev, descricao: `Pesquisa de preços concluída. ${ORCAMENTO_SIGILOSO}` };
  return ev;
}
