// Reajuste da operadora própria além do anual digitado (08-SGO L96, C1-086; F7): regras puras, sem banco.
// - Índice de reajuste com vigência (o teto anual da ANS para o individual ou familiar, com o protocolo do ofício, e os
//   índices econômicos ou próprios do coletivo): cadastrado uma vez e usado pela conferência do reajuste anual, sem o
//   teto digitado a cada pedido.
// - Agrupamento dos contratos coletivos pequenos (RN ANS 565/2022): todos os contratos coletivos com até o limite de
//   vidas (29 por padrão; a operadora pode subir o limite, nunca baixar) recebem um percentual único no período de 12
//   meses, calculado sobre o resultado somado do grupo e aplicado no aniversário de cada contrato.
// - Regra de reajuste por sinistralidade do coletivo grande: faixas contínuas do valor apurado (sinistralidade em % ou
//   mensalidade média em R$) com o percentual de cada faixa, apurado nos meses anteriores ao aniversário.
import { somarMeses } from './carteirinha.js';

export interface ProblemaReajusteColetivo {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}
const pb = (codigo: string, campo: string, detalhe: string): ProblemaReajusteColetivo => ({
  codigo,
  campo,
  detalhe,
});
const dataValida = (d: string | null | undefined): d is string =>
  !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r4 = (v: number) => Math.round((v + Number.EPSILON) * 10_000) / 10_000;

/** Menor limite de vidas do agrupamento: contratos com menos de 30 vidas (RN ANS 565/2022). */
export const LIMITE_VIDAS_AGRUPAMENTO_MINIMO = 29;

// ── Índice de reajuste ──────────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_INDICE_REAJUSTE = ['teto_individual_ans', 'economico', 'proprio'] as const;
export type TipoIndiceReajuste = (typeof TIPOS_INDICE_REAJUSTE)[number];

export interface IndiceReajuste {
  readonly id?: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: TipoIndiceReajuste;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly percentual: number;
  /** Protocolo do ofício da ANS que autoriza o teto (obrigatório no teto do individual). */
  readonly protocolo: string | null;
}

/** O índice novo: código, vigência sem sobrepor outra do mesmo código, faixa do percentual e o protocolo do teto. */
export function problemasDoIndice(
  e: IndiceReajuste,
  existentes: readonly Pick<IndiceReajuste, 'codigo' | 'vigenciaInicio' | 'vigenciaFim'>[],
): ProblemaReajusteColetivo[] {
  const p: ProblemaReajusteColetivo[] = [];
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(e.codigo.trim()))
    p.push(pb('indice-codigo', 'codigo', 'Código de 2 a 30 letras, números, ponto, hífen ou sublinhado.'));
  if (e.descricao.trim().length < 3)
    p.push(pb('indice-descricao', 'descricao', 'Informe a descrição do índice.'));
  if (!(TIPOS_INDICE_REAJUSTE as readonly string[]).includes(e.tipo))
    p.push(pb('indice-tipo', 'tipo', 'Tipo de índice desconhecido.'));
  if (!dataValida(e.vigenciaInicio) || !e.vigenciaInicio.endsWith('-01'))
    p.push(pb('indice-vigencia', 'vigenciaInicio', 'A vigência começa no primeiro dia de um mês.'));
  else if (e.vigenciaFim !== null && (!dataValida(e.vigenciaFim) || e.vigenciaFim < e.vigenciaInicio))
    p.push(pb('indice-vigencia', 'vigenciaFim', 'O fim da vigência não pode ser antes do início.'));
  if (!Number.isFinite(e.percentual) || e.percentual < -100 || e.percentual > 100)
    p.push(pb('indice-percentual', 'percentual', 'O percentual fica entre -100 e 100.'));
  if (e.tipo === 'teto_individual_ans' && !e.protocolo?.trim())
    p.push(
      pb('indice-sem-protocolo', 'protocolo', 'O teto da ANS exige o protocolo do ofício que o autoriza.'),
    );
  const fim = e.vigenciaFim ?? '9999-12-31';
  if (
    existentes.some(
      (x) =>
        x.codigo.trim().toUpperCase() === e.codigo.trim().toUpperCase() &&
        x.vigenciaInicio <= fim &&
        (x.vigenciaFim ?? '9999-12-31') >= e.vigenciaInicio,
    )
  )
    p.push(
      pb(
        'indice-sobreposto',
        'vigenciaInicio',
        'Já existe vigência deste código que cobre parte do período.',
      ),
    );
  return p;
}

/** O índice do tipo vigente na data (o de início mais recente entre os que cobrem a data). */
export function indiceVigente<T extends Pick<IndiceReajuste, 'tipo' | 'vigenciaInicio' | 'vigenciaFim'>>(
  indices: readonly T[],
  tipo: TipoIndiceReajuste,
  data: string,
): T | null {
  return (
    [...indices]
      .filter(
        (i) =>
          i.tipo === tipo && i.vigenciaInicio <= data && (i.vigenciaFim === null || i.vigenciaFim >= data),
      )
      .sort((a, b) => b.vigenciaInicio.localeCompare(a.vigenciaInicio))[0] ?? null
  );
}

// ── Regra por sinistralidade ─────────────────────────────────────────────────────────────────────────────────────

export type BaseApuracaoReajuste = 'sinistralidade' | 'mensalidade';
export interface FaixaReajuste {
  /** Valor inicial (incluído). */
  readonly de: number;
  /** Valor final (excluído); nulo na última faixa, sem limite. */
  readonly ate: number | null;
  readonly percentual: number;
}
export interface RegraReajusteSinistralidade {
  readonly codigo: string;
  readonly descricao: string;
  readonly base: BaseApuracaoReajuste;
  readonly meses: number;
  /** Sinistralidade de equilíbrio (%), referência da tela. */
  readonly meta: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly faixas: readonly FaixaReajuste[];
}

/** A regra: período de apuração, meta e faixas contínuas (começam em zero, sem buraco nem sobreposição). */
export function problemasDaRegra(r: RegraReajusteSinistralidade): ProblemaReajusteColetivo[] {
  const p: ProblemaReajusteColetivo[] = [];
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(r.codigo.trim()))
    p.push(pb('regra-codigo', 'codigo', 'Código de 2 a 30 letras, números, ponto, hífen ou sublinhado.'));
  if (r.descricao.trim().length < 3)
    p.push(pb('regra-descricao', 'descricao', 'Informe a descrição da regra.'));
  if (r.base !== 'sinistralidade' && r.base !== 'mensalidade')
    p.push(pb('regra-base', 'base', 'Base de apuração desconhecida.'));
  if (!Number.isInteger(r.meses) || r.meses < 1 || r.meses > 36)
    p.push(pb('regra-meses', 'meses', 'O período de apuração vai de 1 a 36 meses.'));
  if (r.meta !== null && (!(r.meta > 0) || r.meta > 100))
    p.push(pb('regra-meta', 'meta', 'A meta de sinistralidade fica acima de 0 e até 100%.'));
  if (!dataValida(r.vigenciaInicio))
    p.push(pb('regra-vigencia', 'vigenciaInicio', 'Informe o início da vigência.'));
  else if (r.vigenciaFim !== null && (!dataValida(r.vigenciaFim) || r.vigenciaFim < r.vigenciaInicio))
    p.push(pb('regra-vigencia', 'vigenciaFim', 'O fim da vigência não pode ser antes do início.'));
  if (!r.faixas.length) p.push(pb('regra-sem-faixa', 'faixas', 'Informe ao menos uma faixa.'));
  r.faixas.forEach((f, i) => {
    const campo = `faixas.${i}`;
    if (i === 0 && f.de !== 0) p.push(pb('regra-faixa-inicio', campo, 'A primeira faixa começa em zero.'));
    const ant = r.faixas[i - 1];
    if (ant && ant.ate !== f.de)
      p.push(pb('regra-faixa-continua', campo, 'Cada faixa começa onde a anterior termina.'));
    if (f.ate === null && i !== r.faixas.length - 1)
      p.push(pb('regra-faixa-aberta', campo, 'Só a última faixa fica sem valor final.'));
    if (f.ate !== null && !(f.ate > f.de))
      p.push(pb('regra-faixa-valor', campo, 'O valor final fica acima do inicial.'));
    if (!Number.isFinite(f.percentual) || f.percentual < -100 || f.percentual > 999)
      p.push(pb('regra-faixa-percentual', campo, 'O percentual fica entre -100 e 999.'));
  });
  return p;
}

/** Os meses apurados: os `meses` meses que terminam no mês anterior à competência do reajuste. */
export function periodoDeApuracao(competencia: string, meses: number): { inicio: string; fim: string } {
  const c = `${competencia}-01`;
  const fim = new Date(Date.parse(`${c}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { inicio: somarMeses(c, -meses), fim };
}

export interface ResultadoApuracaoReajuste {
  readonly receita: number;
  readonly despesa: number;
  readonly meses: number;
  /** Sinistralidade (%) = despesa / receita × 100, ou mensalidade média (R$) = receita / meses. */
  readonly valorApurado: number;
  readonly faixa: FaixaReajuste | null;
  readonly percentual: number | null;
  /** A conta com as parcelas impressas (vai para a memória de cálculo). */
  readonly memoria: string;
  readonly problemas: ProblemaReajusteColetivo[];
}

/** Aplica a regra ao resultado apurado (receita das mensalidades e despesa assistencial do período). */
export function calcularReajustePorRegra(
  regra: Pick<RegraReajusteSinistralidade, 'base' | 'meses' | 'faixas'>,
  x: { readonly receita: number; readonly despesa: number },
): ResultadoApuracaoReajuste {
  const receita = r2(x.receita);
  const despesa = r2(x.despesa);
  const problemas: ProblemaReajusteColetivo[] = [];
  if (!(receita > 0))
    problemas.push(pb('apuracao-sem-receita', 'receita', 'Sem mensalidade cobrada no período de apuração.'));
  const valorApurado =
    receita > 0
      ? regra.base === 'sinistralidade'
        ? r2((despesa / receita) * 100)
        : r2(receita / regra.meses)
      : 0;
  const faixa =
    receita > 0
      ? (regra.faixas.find((f) => valorApurado >= f.de && (f.ate === null || valorApurado < f.ate)) ?? null)
      : null;
  if (receita > 0 && !faixa)
    problemas.push(pb('apuracao-sem-faixa', 'faixas', 'O valor apurado não cai em nenhuma faixa da regra.'));
  const fmt = (v: number) => v.toFixed(2).replace('.', ',');
  const memoria =
    regra.base === 'sinistralidade'
      ? `Sinistralidade = despesa ${fmt(despesa)} / receita ${fmt(receita)} × 100 = ${fmt(valorApurado)}% (${regra.meses} meses)`
      : `Mensalidade média = receita ${fmt(receita)} / ${regra.meses} meses = ${fmt(valorApurado)}`;
  return {
    receita,
    despesa,
    meses: regra.meses,
    valorApurado,
    faixa,
    percentual: faixa ? r4(faixa.percentual) : null,
    memoria: faixa
      ? `${memoria}; faixa ${fmt(faixa.de)} a ${faixa.ate === null ? 'sem limite' : fmt(faixa.ate)} → ${fmt(faixa.percentual)}%`
      : memoria,
    problemas,
  };
}

// ── Contrato coletivo: agrupamento ou sinistralidade ─────────────────────────────────────────────────────────────

export interface ContratoParaReajusteColetivo {
  readonly situacao: string;
  /** 1 individual ou familiar, 2 coletivo empresarial, 3 coletivo por adesão. */
  readonly tipoContratacao: number;
  readonly vidas: number;
}

/** O contrato entra no agrupamento? Coletivo, não encerrado e com até o limite de vidas. */
export function problemasDoContratoNoAgrupamento(
  k: ContratoParaReajusteColetivo,
  limiteVidas: number,
): ProblemaReajusteColetivo[] {
  const p: ProblemaReajusteColetivo[] = [];
  if (k.situacao === 'encerrado') p.push(pb('contrato-encerrado', 'contrato', 'O contrato está encerrado.'));
  if (k.tipoContratacao === 1)
    p.push(
      pb(
        'agrupamento-so-coletivo',
        'contrato',
        'Individual ou familiar segue o teto da ANS, não o agrupamento.',
      ),
    );
  if (k.vidas > limiteVidas)
    p.push(
      pb(
        'agrupamento-acima-do-limite',
        'contrato',
        `O contrato tem mais de ${limiteVidas} vidas: reajuste próprio.`,
      ),
    );
  return p;
}

/** O reajuste por sinistralidade de um contrato: só o coletivo acima do limite do agrupamento. */
export function problemasDoContratoPorSinistralidade(
  k: ContratoParaReajusteColetivo,
  limiteVidas = LIMITE_VIDAS_AGRUPAMENTO_MINIMO,
): ProblemaReajusteColetivo[] {
  const p: ProblemaReajusteColetivo[] = [];
  if (k.situacao === 'encerrado') p.push(pb('contrato-encerrado', 'contrato', 'O contrato está encerrado.'));
  if (k.tipoContratacao === 1)
    p.push(pb('sinistralidade-so-coletivo', 'contrato', 'Individual ou familiar segue o teto da ANS.'));
  else if (k.vidas <= limiteVidas)
    p.push(
      pb(
        'sinistralidade-contrato-de-agrupamento',
        'contrato',
        `Contrato com até ${limiteVidas} vidas recebe o percentual único do agrupamento.`,
      ),
    );
  return p;
}

export type SituacaoAgrupamento = 'aberto' | 'calculado' | 'aplicado' | 'cancelado';

/** O agrupamento novo: descrição, início do período no primeiro dia do mês e o limite de vidas. */
export function problemasDoAgrupamento(a: {
  readonly descricao: string;
  readonly vigencia: string;
  readonly limiteVidas: number;
}): ProblemaReajusteColetivo[] {
  const p: ProblemaReajusteColetivo[] = [];
  if (a.descricao.trim().length < 3)
    p.push(pb('agrupamento-descricao', 'descricao', 'Informe a descrição do agrupamento.'));
  if (!dataValida(a.vigencia) || !a.vigencia.endsWith('-01'))
    p.push(pb('agrupamento-vigencia', 'vigencia', 'O período começa no primeiro dia de um mês.'));
  if (
    !Number.isInteger(a.limiteVidas) ||
    a.limiteVidas < LIMITE_VIDAS_AGRUPAMENTO_MINIMO ||
    a.limiteVidas > 9999
  )
    p.push(
      pb(
        'agrupamento-limite',
        'limiteVidas',
        `O limite é de pelo menos ${LIMITE_VIDAS_AGRUPAMENTO_MINIMO} vidas (contratos com menos de 30 vidas).`,
      ),
    );
  return p;
}

/** Os passos do agrupamento: calcular só aberto ou calculado (recalcula); aplicar dentro dos 12 meses do período. */
export function problemasDoPassoAgrupamento(
  a: { readonly situacao: SituacaoAgrupamento; readonly vigencia: string; readonly contratos: number },
  passo: 'calcular' | 'aplicar' | 'cancelar' | 'incluir',
  competencia?: string,
): ProblemaReajusteColetivo[] {
  const p: ProblemaReajusteColetivo[] = [];
  if (a.situacao === 'cancelado')
    return [pb('agrupamento-cancelado', 'situacao', 'O agrupamento está cancelado.')];
  if ((passo === 'calcular' || passo === 'incluir' || passo === 'cancelar') && a.situacao === 'aplicado')
    p.push(
      pb('agrupamento-ja-aplicado', 'situacao', 'O percentual já foi aplicado a contratos do agrupamento.'),
    );
  if (passo === 'calcular' && a.contratos === 0)
    p.push(pb('agrupamento-vazio', 'contratos', 'Inclua os contratos antes de calcular.'));
  if (passo === 'aplicar') {
    if (a.situacao === 'aberto')
      p.push(pb('agrupamento-sem-calculo', 'situacao', 'Calcule o percentual único antes de aplicar.'));
    const c = competencia ? `${competencia}-01` : '';
    if (!c || c < a.vigencia || c >= somarMeses(a.vigencia, 12))
      p.push(
        pb(
          'agrupamento-fora-do-periodo',
          'competencia',
          'A competência fica fora dos 12 meses do agrupamento.',
        ),
      );
  }
  return p;
}
