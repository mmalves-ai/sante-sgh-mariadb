// Regras puras da contratualização SUS (ficha do M55, fatia F5; regra 11; cap-07 §7.3; DP-35):
//   - o contrato com o gestor só vale para metas e apurações quando está ativo, na vigência, com o CNES do
//     estabelecimento e a habilitação SUS em dia (regra 11: "só com contrato e habilitação SUS ativos");
//   - metas quantitativas por código SIGTAP (grupo, subgrupo, forma de organização ou procedimento) e qualitativas por
//     indicador, cada uma com periodicidade (mensal ou maior), pontos e escore;
//   - o período da meta conta da competência inicial dela, em blocos do tamanho da periodicidade;
//   - realizado quantitativo = a soma da produção do período cujo código começa com o da meta (na modalidade da meta);
//   - cumprimento = realizado ÷ meta do período (na qualitativa "quanto menor, melhor": meta ÷ realizado), com a conta;
//   - escore e repasse pela faixa do cumprimento (parâmetro); o repasse estimado do mês com as parcelas impressas.
// Nada aqui lê banco nem relógio: a competência de referência, a produção e as apurações chegam prontas.
import {
  type ApuracaoSus,
  type ApuracaoSusEntrada,
  type CodigoRecusaContratualizacao,
  type ContratoSus,
  type ContratoSusEntrada,
  type EscoreSus,
  type FaixaCumprimentoSus,
  type FonteProducaoSus,
  MENSAGENS_CONTRATUALIZACAO,
  type MetaSus,
  type MetaSusEntrada,
  mesesDaPeriodicidade,
  NIVEIS_SIGTAP_META,
  type OrigemApuracaoSus,
  type ParteRepasseSus,
  type PeriodoMetaSus,
  PERIODICIDADES_SUBMENSAIS,
  type ProducaoSigtapSus,
  type RepasseEstimadoSus,
  type ResultadoMetaSus,
  type TipoMetaSus,
} from '@sgh/contratos';

export interface RecusaContratualizacao {
  readonly codigo: CodigoRecusaContratualizacao;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

const recusa = (
  codigo: CodigoRecusaContratualizacao,
  campos?: readonly string[],
): RecusaContratualizacao => ({
  codigo,
  mensagem: MENSAGENS_CONTRATUALIZACAO[codigo],
  ...(campos ? { campos } : {}),
});

const ESCORES_EM_ORDEM: readonly EscoreSus[] = [4, 3, 2, 1];
const dois = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => dois(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const reais = (centavos: number) =>
  `R$ ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Competências ─────────────────────────────────────────────────────────────────────────────────

/** A competência (AAAAMM) de uma data ISO já validada (o contrato, o incentivo). */
const competenciaDoDia = (iso: string): string => `${iso.slice(0, 4)}${iso.slice(5, 7)}`;

/** A competência `n` meses depois (ou antes, com n negativo). */
export function somarMeses(competencia: string, n: number): string {
  const total = Number(competencia.slice(0, 4)) * 12 + Number(competencia.slice(4, 6)) - 1 + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${ano}${String(mes).padStart(2, '0')}`;
}

/** Quantos meses de `de` a `ate` (0 quando iguais; negativo quando `ate` vem antes). */
export function mesesEntre(de: string, ate: string): number {
  const m = (c: string) => Number(c.slice(0, 4)) * 12 + Number(c.slice(4, 6));
  return m(ate) - m(de);
}

// ── Faixas de cumprimento (parâmetro) ─────────────────────────────────────────────────────────────

/**
 * As quatro faixas do parâmetro ("mínimo:repasse", do escore 4 ao 1). Inválidas (fora de ordem, repasse acima de 100%
 * ou crescente, último mínimo diferente de 0): null, e o serviço recusa com `faixas-invalidas`.
 */
export function lerFaixasCumprimento(texto: string): FaixaCumprimentoSus[] | null {
  const pares = texto.split(',').map((p) => p.trim().split(':').map(Number));
  if (pares.length !== 4) return null;
  const faixas: FaixaCumprimentoSus[] = [];
  for (const [i, par] of pares.entries()) {
    const [minimo, repasse] = par;
    if (par.length !== 2 || !Number.isInteger(minimo) || !Number.isInteger(repasse)) return null;
    if ((repasse as number) < 0 || (repasse as number) > 100) return null;
    faixas.push({
      minimoPct: minimo as number,
      escore: ESCORES_EM_ORDEM[i] as EscoreSus,
      repassePct: repasse as number,
    });
  }
  for (let i = 1; i < faixas.length; i++) {
    const a = faixas[i - 1] as FaixaCumprimentoSus;
    const b = faixas[i] as FaixaCumprimentoSus;
    if (b.minimoPct >= a.minimoPct || b.repassePct > a.repassePct) return null;
  }
  return faixas.at(-1)?.minimoPct === 0 ? faixas : null;
}

/** A faixa do cumprimento (a primeira cujo mínimo ele alcança). */
export function faixaDoCumprimento(
  cumprimentoPct: number,
  faixas: readonly FaixaCumprimentoSus[],
): FaixaCumprimentoSus {
  return faixas.find((f) => cumprimentoPct >= f.minimoPct) ?? (faixas.at(-1) as FaixaCumprimentoSus);
}

// ── Contrato ─────────────────────────────────────────────────────────────────────────────────────

export interface ContextoContratoSus {
  readonly numeroDuplicado: boolean;
}

/** O cadastro do contrato (inclusão e alteração): vigência, orçamento, incentivos. */
export function conferirContratoSus(
  e: ContratoSusEntrada,
  ctx: ContextoContratoSus,
): RecusaContratualizacao[] {
  const r: RecusaContratualizacao[] = [];
  if (e.fim < e.inicio) r.push(recusa('fim-antes-do-inicio', ['fim']));
  if (ctx.numeroDuplicado) r.push(recusa('numero-duplicado', ['numero']));
  if (e.valorPreMensalCentavos === 0 && e.valorPosMensalCentavos === 0)
    r.push(recusa('orcamento-zerado', ['valorPreMensalCentavos']));
  if (e.valorPreMensalCentavos === 0 && e.parteQualitativaPct > 0)
    r.push(recusa('parte-qualitativa-sem-pre', ['parteQualitativaPct']));
  const vistos = new Set<string>();
  for (const [i, x] of e.incentivos.entries()) {
    const fim = x.fim ?? e.fim;
    if (x.inicio < e.inicio || fim > e.fim || fim < x.inicio)
      r.push(recusa('incentivo-fora-da-vigencia', [`incentivos.${i}`]));
    const k = x.incentivo !== null && x.incentivo > 0 ? `d${x.incentivo}` : `n${x.nome.toLowerCase()}`;
    if (vistos.has(k)) r.push(recusa('incentivo-repetido', [`incentivos.${i}`]));
    vistos.add(k);
  }
  return r;
}

/**
 * Regra 11: o contrato e a habilitação SUS ativos. `hoje` (ISO) é a data do servidor; `cnesEstabelecimento` é o
 * parâmetro do faturamento SUS (null quando não definido: o CNES do contrato basta).
 */
export function conferirContratoSusAtivo(
  c: Pick<ContratoSus, 'situacao' | 'inicio' | 'fim' | 'cnes' | 'habilitacao' | 'habilitacaoValidade'>,
  hoje: string,
  cnesEstabelecimento: string | null,
): RecusaContratualizacao[] {
  if (c.situacao === 'encerrado') return [recusa('contrato-encerrado')];
  const r: RecusaContratualizacao[] = [];
  if (hoje < c.inicio || hoje > c.fim) r.push(recusa('contrato-nao-vigente', ['inicio', 'fim']));
  if (!c.cnes) r.push(recusa('cnes-ausente', ['cnes']));
  else if (cnesEstabelecimento && cnesEstabelecimento !== c.cnes) r.push(recusa('cnes-divergente', ['cnes']));
  if (!c.habilitacao) r.push(recusa('habilitacao-ausente', ['habilitacao']));
  else if (c.habilitacaoValidade !== null && c.habilitacaoValidade < hoje)
    r.push(recusa('habilitacao-vencida', ['habilitacaoValidade']));
  return r;
}

/** Os incentivos do contrato que valem na competência (a soma mensal, com as parcelas). */
export function incentivosDaCompetencia(
  c: Pick<ContratoSus, 'incentivos' | 'fim'>,
  competencia: string,
): { totalCentavos: number; conta: string[] } {
  const vigentes = c.incentivos.filter(
    (x) => competenciaDoDia(x.inicio) <= competencia && competenciaDoDia(x.fim ?? c.fim) >= competencia,
  );
  const totalCentavos = vigentes.reduce((s, x) => s + x.valorMensalCentavos, 0);
  const conta = vigentes.length
    ? [
        `incentivos = ${vigentes.map((x) => `${x.nome} ${reais(x.valorMensalCentavos)}`).join(' + ')} = ${reais(totalCentavos)}`,
      ]
    : ['incentivos = nenhum na competência = R$ 0,00'];
  return { totalCentavos, conta };
}

// ── Meta ─────────────────────────────────────────────────────────────────────────────────────────

export interface ContextoMetaSus {
  /** Algum procedimento da SIGTAP começa com o código da meta (lido no servidor). */
  readonly sigtapExiste: boolean;
}

const CAMPOS_QUANTITATIVA = ['nivelSigtap', 'codigoSigtap', 'modalidade', 'complexidade'] as const;
const CAMPOS_QUALITATIVA = ['indicador', 'formato', 'sentido', 'unidade', 'afericao'] as const;

/** A meta no contrato: periodicidade mensal ou maior, os campos do tipo e a vigência dentro da do contrato. */
export function conferirMetaSus(
  e: MetaSusEntrada,
  contrato: Pick<ContratoSus, 'inicio' | 'fim' | 'situacao'>,
  ctx: ContextoMetaSus,
): RecusaContratualizacao[] {
  if (contrato.situacao === 'encerrado') return [recusa('contrato-encerrado')];
  const r: RecusaContratualizacao[] = [];
  if ((PERIODICIDADES_SUBMENSAIS as readonly number[]).includes(e.periodicidade))
    r.push(recusa('periodicidade-submensal', ['periodicidade']));
  else if (mesesDaPeriodicidade(e.periodicidade) === null)
    r.push(recusa('periodicidade-invalida', ['periodicidade']));
  const ini = competenciaDoDia(contrato.inicio);
  const fim = competenciaDoDia(contrato.fim);
  if (e.inicio < ini || e.inicio > fim || (e.fim !== null && (e.fim > fim || e.fim < e.inicio)))
    r.push(recusa('meta-fora-da-vigencia', ['inicio', 'fim']));
  const outros = (e.tipo === 'quantitativa' ? CAMPOS_QUALITATIVA : CAMPOS_QUANTITATIVA).filter(
    (k) => e[k] !== null,
  );
  if (outros.length) r.push(recusa('campos-de-outro-tipo', outros));
  if (e.tipo === 'quantitativa') {
    if (e.nivelSigtap === null || e.codigoSigtap === null || e.modalidade === null)
      r.push(recusa('sigtap-obrigatorio', ['nivelSigtap', 'codigoSigtap', 'modalidade']));
    else if (NIVEIS_SIGTAP_META.find((n) => n.codigo === e.nivelSigtap)?.digitos !== e.codigoSigtap.length)
      r.push(recusa('sigtap-tamanho', ['codigoSigtap']));
    else if (!ctx.sigtapExiste) r.push(recusa('sigtap-inexistente', ['codigoSigtap']));
  } else {
    if (e.indicador === null) r.push(recusa('indicador-obrigatorio', ['indicador']));
    if (e.formato === null || e.sentido === null)
      r.push(recusa('formato-obrigatorio', ['formato', 'sentido']));
    else if (e.formato === 2 && (e.valorMeta !== 1 || e.sentido !== 'maior'))
      r.push(recusa('meta-sim-nao', ['valorMeta', 'sentido']));
    else if (e.formato === 7 && !Number.isInteger(e.valorMeta)) r.push(recusa('meta-inteira', ['valorMeta']));
  }
  return r;
}

/**
 * O período da meta que contém a competência: blocos do tamanho da periodicidade contados da competência inicial da
 * meta. Antes do início: o primeiro período. Periodicidade desconhecida conta como mensal (a meta gravada já passou
 * pela conferência).
 */
export function periodoDaMeta(
  m: Pick<MetaSus, 'inicio' | 'periodicidade'>,
  competencia: string,
): PeriodoMetaSus {
  const meses = mesesDaPeriodicidade(m.periodicidade) ?? 1;
  const decorridos = Math.max(0, mesesEntre(m.inicio, competencia));
  const inicio = somarMeses(m.inicio, Math.floor(decorridos / meses) * meses);
  const competencias = Array.from({ length: meses }, (_, i) => somarMeses(inicio, i));
  return { inicio, fim: competencias.at(-1) as string, competencias, meses };
}

/** A meta do período: a quantitativa é mensal (vezes os meses); a qualitativa vale para o período. */
export function metaDoPeriodo(m: Pick<MetaSus, 'tipo' | 'valorMeta'>, periodo: PeriodoMetaSus): number {
  return m.tipo === 'quantitativa' ? dois(m.valorMeta * periodo.meses) : m.valorMeta;
}

/** A produção do período que conta para a meta quantitativa (código pelo prefixo, na modalidade da meta). */
export function realizadoQuantitativo(
  m: Pick<MetaSus, 'codigoSigtap' | 'modalidade'>,
  producao: readonly ProducaoSigtapSus[],
  periodo: PeriodoMetaSus,
): { total: number; porCompetencia: { competencia: string; quantidade: number }[] } {
  const porCompetencia = periodo.competencias.map((competencia) => ({ competencia, quantidade: 0 }));
  const prefixo = m.codigoSigtap ?? '';
  for (const p of producao) {
    if (!prefixo || !p.codigo.startsWith(prefixo)) continue;
    if (m.modalidade !== 'todas' && m.modalidade !== p.modalidade) continue;
    const c = porCompetencia.find((x) => x.competencia === p.competencia);
    if (c) c.quantidade += p.quantidade;
  }
  return { total: porCompetencia.reduce((s, c) => s + c.quantidade, 0), porCompetencia };
}

/** Cumprimento em %, com 2 casas: realizado ÷ meta ("quanto menor, melhor": meta ÷ realizado, 100% com realizado 0). */
export function cumprimentoPct(
  m: Pick<MetaSus, 'tipo' | 'sentido'>,
  metaPeriodo: number,
  realizado: number,
): number {
  if (m.tipo === 'qualitativa' && m.sentido === 'menor')
    return realizado <= metaPeriodo ? 100 : dois((metaPeriodo / realizado) * 100);
  return metaPeriodo > 0 ? dois((realizado / metaPeriodo) * 100) : 0;
}

export interface EntradaResultadoMetaSus {
  readonly producao: readonly ProducaoSigtapSus[];
  readonly fonte: FonteProducaoSus;
  /** A apuração registrada do período, se houver (o retrato que vale para o repasse). */
  readonly apuracao: ApuracaoSus | null;
  readonly faixas: readonly FaixaCumprimentoSus[];
}

/** O resultado da meta no período que contém a competência, com as parcelas impressas. */
export function resultadoMetaSus(
  m: MetaSus,
  competencia: string,
  x: EntradaResultadoMetaSus,
): ResultadoMetaSus {
  const periodo = periodoDaMeta(m, competencia);
  const metaPeriodo = metaDoPeriodo(m, periodo);
  const conta: string[] = [];
  if (m.tipo === 'quantitativa')
    conta.push(
      `meta do período = ${fmt(m.valorMeta)} por competência × ${periodo.meses} = ${fmt(metaPeriodo)}`,
    );
  else conta.push(`meta do período = ${fmt(metaPeriodo)}${m.unidade ? ` ${m.unidade}` : ''}`);
  let realizado: number | null = null;
  let porCompetencia: { competencia: string; quantidade: number }[] = [];
  let origem: OrigemApuracaoSus | null = null;
  if (x.apuracao) {
    realizado = x.apuracao.realizado;
    origem = x.apuracao.origem;
    conta.push(`realizado = ${fmt(realizado)} (apuração registrada)`);
  } else if (m.tipo === 'quantitativa') {
    const q = realizadoQuantitativo(m, x.producao, periodo);
    realizado = q.total;
    porCompetencia = q.porCompetencia;
    origem = x.fonte;
    conta.push(
      `realizado = ${q.porCompetencia.map((c) => `${fmt(c.quantidade)} (${c.competencia})`).join(' + ')} = ${fmt(q.total)}`,
    );
  } else conta.push('realizado = sem apuração registrada no período');
  let cumprimento: number | null = null;
  let escore: EscoreSus | null = null;
  let pontosObtidos: number | null = null;
  if (realizado !== null) {
    cumprimento = cumprimentoPct(m, metaPeriodo, realizado);
    escore = faixaDoCumprimento(cumprimento, x.faixas).escore;
    if (m.tipo === 'qualitativa' && m.sentido === 'menor')
      conta.push(
        realizado <= metaPeriodo
          ? `cumprimento = ${fmt(realizado)} ≤ ${fmt(metaPeriodo)} = 100%`
          : `cumprimento = ${fmt(metaPeriodo)} ÷ ${fmt(realizado)} × 100 = ${fmt(cumprimento)}%`,
      );
    else conta.push(`cumprimento = ${fmt(realizado)} ÷ ${fmt(metaPeriodo)} × 100 = ${fmt(cumprimento)}%`);
    pontosObtidos =
      m.tipo === 'quantitativa'
        ? dois((m.pontos * Math.min(cumprimento, 100)) / 100)
        : cumprimento >= 100
          ? m.pontos
          : 0;
    conta.push(
      m.tipo === 'quantitativa'
        ? `pontos = ${m.pontos} × ${fmt(Math.min(cumprimento, 100))}% = ${fmt(pontosObtidos)}`
        : `pontos = ${cumprimento >= 100 ? `${m.pontos} (cumprida)` : `0 de ${m.pontos} (não cumprida)`}`,
    );
  }
  return {
    meta: m.id,
    tipo: m.tipo,
    descricao: m.descricao,
    periodo,
    metaPeriodo,
    realizado,
    realizadoPorCompetencia: porCompetencia,
    cumprimentoPct: cumprimento,
    escore,
    pontos: m.pontos,
    pontosObtidos,
    origem,
    apurada: x.apuracao !== null,
    apuracaoRegistrada: x.apuracao
      ? { id: x.apuracao.id, versao: x.apuracao.versao, observacao: x.apuracao.observacao }
      : null,
    conta,
  };
}

/** A meta vale na competência (ativa, entre o início e o fim dela). */
export function metaValeNaCompetencia(
  m: Pick<MetaSus, 'ativa' | 'inicio' | 'fim'>,
  competencia: string,
): boolean {
  return m.ativa && m.inicio <= competencia && (m.fim === null || m.fim >= competencia);
}

// ── Apuração ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A apuração do período (regra 11): na última competência do período, depois de ele terminar (`competenciaAtual` é a
 * do relógio do servidor), com o contrato ativo; a qualitativa leva o resultado (sim ou não: 1 ou 0), a quantitativa não
 * (o servidor lê a produção).
 */
export function conferirApuracaoSus(
  e: ApuracaoSusEntrada,
  m: MetaSus,
  competenciaAtual: string,
  ctx: { readonly apuracaoExistente: boolean },
): RecusaContratualizacao[] {
  if (!m.ativa) return [recusa('meta-inativa')];
  const r: RecusaContratualizacao[] = [];
  const periodo = periodoDaMeta(m, e.competencia);
  if (periodo.fim !== e.competencia || e.competencia < m.inicio || (m.fim !== null && e.competencia > m.fim))
    r.push(recusa('competencia-nao-fecha-periodo', ['competencia']));
  else if (e.competencia >= competenciaAtual) r.push(recusa('competencia-futura', ['competencia']));
  if (m.tipo === 'quantitativa') {
    if (e.realizado !== null) r.push(recusa('realizado-de-meta-quantitativa', ['realizado']));
  } else if (e.realizado === null) r.push(recusa('realizado-obrigatorio', ['realizado']));
  else if (m.formato === 2 && e.realizado !== 0 && e.realizado !== 1)
    r.push(recusa('realizado-sim-nao', ['realizado']));
  if (ctx.apuracaoExistente && e.versaoVista === null) r.push(recusa('apuracao-repetida', ['competencia']));
  return r;
}

// ── Repasse estimado do mês ──────────────────────────────────────────────────────────────────────

function parteDoRepasse(
  tipo: TipoMetaSus,
  valorCentavos: number,
  resultados: readonly ResultadoMetaSus[],
  faixas: readonly FaixaCumprimentoSus[],
): ParteRepasseSus {
  const doTipo = resultados.filter((r) => r.tipo === tipo);
  const pontosPossiveis = doTipo.reduce((s, r) => s + r.pontos, 0);
  const rotulo = tipo === 'quantitativa' ? 'parte quantitativa' : 'parte qualitativa';
  const conta = [`${rotulo} = ${reais(valorCentavos)}`];
  const pendente = doTipo.some((r) => r.pontosObtidos === null);
  if (valorCentavos === 0 || doTipo.length === 0 || pendente) {
    conta.push(
      doTipo.length === 0
        ? `${rotulo}: nenhuma meta na competência (sem condição de repasse)`
        : pendente
          ? `${rotulo}: há meta sem resultado no período (repasse pendente)`
          : `${rotulo}: sem valor no contrato`,
    );
    const semMeta = doTipo.length === 0;
    return {
      tipo,
      valorCentavos,
      pontosPossiveis,
      pontosObtidos: 0,
      cumprimentoPct: null,
      escore: null,
      repassePct: semMeta ? 100 : pendente ? null : 0,
      repasseCentavos: semMeta ? valorCentavos : pendente ? null : 0,
      conta,
    };
  }
  const pontosObtidos = dois(doTipo.reduce((s, r) => s + (r.pontosObtidos ?? 0), 0));
  const cumprimento = dois((pontosObtidos / pontosPossiveis) * 100);
  const faixa = faixaDoCumprimento(cumprimento, faixas);
  const repasseCentavos = Math.round((valorCentavos * faixa.repassePct) / 100);
  conta.push(
    `pontos = ${doTipo.map((r) => fmt(r.pontosObtidos ?? 0)).join(' + ')} = ${fmt(pontosObtidos)} de ${pontosPossiveis}`,
    `cumprimento da parte = ${fmt(pontosObtidos)} ÷ ${pontosPossiveis} × 100 = ${fmt(cumprimento)}% (faixa a partir de ${faixa.minimoPct}%: repasse ${faixa.repassePct}%)`,
    `repasse = ${reais(valorCentavos)} × ${faixa.repassePct}% = ${reais(repasseCentavos)}`,
  );
  return {
    tipo,
    valorCentavos,
    pontosPossiveis,
    pontosObtidos,
    cumprimentoPct: cumprimento,
    escore: faixa.escore,
    repassePct: faixa.repassePct,
    repasseCentavos,
    conta,
  };
}

/**
 * O repasse estimado da competência: o pré-fixado mensal dividido entre a parte das metas quantitativas e a das
 * qualitativas (o percentual do contrato), cada uma paga pela faixa do seu cumprimento em pontos; os incentivos da
 * competência; o pós-fixado é a estimativa do contrato (pago pela produção aprovada, fora desta conta).
 */
export function repasseEstimadoSus(
  c: ContratoSus,
  competencia: string,
  resultados: readonly ResultadoMetaSus[],
  faixas: readonly FaixaCumprimentoSus[],
): RepasseEstimadoSus {
  const pre = c.valorPreMensalCentavos;
  const quali = Math.round((pre * c.parteQualitativaPct) / 100);
  const quanti = pre - quali;
  const conta = [
    `pré-fixado mensal = ${reais(pre)} = quantitativa ${reais(quanti)} (${100 - c.parteQualitativaPct}%) + qualitativa ${reais(quali)} (${c.parteQualitativaPct}%)`,
  ];
  const partes = [
    parteDoRepasse('quantitativa', quanti, resultados, faixas),
    parteDoRepasse('qualitativa', quali, resultados, faixas),
  ];
  const inc = incentivosDaCompetencia(c, competencia);
  conta.push(...inc.conta);
  const pendente = partes.some((p) => p.repasseCentavos === null);
  const totalEstimadoCentavos = pendente
    ? null
    : partes.reduce((s, p) => s + (p.repasseCentavos ?? 0), 0) + inc.totalCentavos;
  conta.push(
    totalEstimadoCentavos === null
      ? 'total estimado = pendente (há meta sem resultado no período)'
      : `total estimado = ${partes.map((p) => reais(p.repasseCentavos ?? 0)).join(' + ')} + ${reais(inc.totalCentavos)} = ${reais(totalEstimadoCentavos)}`,
    `pós-fixado estimado = ${reais(c.valorPosMensalCentavos)} (pago pela produção aprovada, fora do total)`,
  );
  return {
    meses: 1,
    preFixadoCentavos: pre,
    partes,
    incentivosCentavos: inc.totalCentavos,
    posFixadoEstimadoCentavos: c.valorPosMensalCentavos,
    totalEstimadoCentavos,
    conta,
  };
}

/** A fonte da produção (regra 11): o faturamento SUS quando ligado; sem ele, as contas SUS do motor de convênios. */
export function fonteDaProducaoSus(faturamentoSusLigado: boolean): FonteProducaoSus {
  return faturamentoSusLigado ? 'faturamento-sus' : 'contas-sus';
}
