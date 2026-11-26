// Acordo de nível de serviço (SLA) do contrato com fornecedor (09-AREA linha 88): a regra por modelo (tempo de
// atendimento, tempo de solução, disponibilidade ou produção), a meta na unidade do modelo, o horário e os dias cobertos,
// e as faixas de desempenho com a glosa e a multa de cada uma. A apuração do período mede só o tempo dentro da cobertura
// (o chamado aberto às 17h59 num serviço das 8h às 18h conta 1 minuto no dia e retoma às 8h do dia útil seguinte),
// calcula o desempenho em percentual, acha a faixa e imprime as parcelas da glosa e da multa.
// Prática de mercado (contratos de manutenção, engenharia clínica, TI, higienização): a meta de prazo vale por chamado e o
// desempenho do período é o percentual dos chamados no prazo; a disponibilidade é o tempo coberto sem parada sobre o
// tempo coberto; a produção é o realizado sobre o mínimo contratado. A faixa é semiaberta: vale de `desempenhoInicio`
// (inclusive) até `desempenhoFim` (exclusive); a última pode não ter fim. As faixas começam em zero e são contíguas.
// Instantes civis do estabelecimento em AAAA-MM-DDTHH:MM; datas em AAAA-MM-DD. Funções puras: a gravação confere de novo.
import { recusa, reais, type RecusaSuprimentos } from './recusa.js';

export const TIPOS_REGRA_SLA = ['tempo_atendimento', 'tempo_solucao', 'disponibilidade', 'producao'] as const;
export type TipoRegraSla = (typeof TIPOS_REGRA_SLA)[number];
export const UNIDADES_SLA = ['minuto', 'hora', 'dia', 'percentual', 'quantidade'] as const;
export type UnidadeSla = (typeof UNIDADES_SLA)[number];
export const PENALIDADES_SLA = ['nenhuma', 'glosa', 'multa', 'glosa_e_multa'] as const;
export type PenalidadeSla = (typeof PENALIDADES_SLA)[number];

export const FAIXAS_MAXIMAS_SLA = 10;
export const DIAS_MAXIMOS_APURACAO_SLA = 92;

/** As unidades que cada modelo aceita (a primeira é a sugerida pela tela). */
export function unidadesDoModeloSla(tipo: TipoRegraSla): readonly UnidadeSla[] {
  if (tipo === 'disponibilidade') return ['percentual'];
  if (tipo === 'producao') return ['quantidade'];
  return ['hora', 'minuto', 'dia'];
}

export interface FaixaSlaEntrada {
  readonly codigo: string;
  readonly descricao: string;
  readonly desempenhoInicio: number;
  readonly desempenhoFim: number | null;
  readonly penalidade: PenalidadeSla;
  /** Percentual glosado da fatura do período (0 exclusive a 100). */
  readonly percentualGlosa: number | null;
  readonly valorMulta: number | null;
}

export interface SlaContratoEntrada {
  /** Nulo: vale para o contrato inteiro. */
  readonly servico: number | null;
  readonly descricao: string;
  readonly tipoRegra: TipoRegraSla;
  readonly unidade: UnidadeSla;
  /** Prazo máximo por chamado (tempo), disponibilidade mínima em % ou produção mínima do período. */
  readonly meta: number;
  /** Horário diário coberto (HH:MM); os dois nulos: 24 horas. O fim antes do início cruza a meia-noite. */
  readonly horarioInicio: string | null;
  readonly horarioFim: string | null;
  readonly somenteDiasUteis: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly faixas: readonly FaixaSlaEntrada[];
}

export interface ContratoDoSla {
  readonly situacao: string;
  readonly inicio: string;
  readonly fim: string | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const CODIGO_FAIXA = /^[A-Za-z0-9]{1,5}$/;

const comGlosa = (p: PenalidadeSla) => p === 'glosa' || p === 'glosa_e_multa';
const comMulta = (p: PenalidadeSla) => p === 'multa' || p === 'glosa_e_multa';

/** As faixas de desempenho: começam em zero, contíguas, só a última sem fim, a penalidade com o seu valor. */
export function conferirFaixasSla(faixas: readonly FaixaSlaEntrada[]): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (faixas.length === 0)
    return [recusa('faixas-sla', 'Informe ao menos uma faixa de desempenho.', ['faixas'])];
  if (faixas.length > FAIXAS_MAXIMAS_SLA)
    r.push(recusa('faixas-sla', `No máximo ${FAIXAS_MAXIMAS_SLA} faixas por SLA.`, ['faixas']));
  const codigos = new Set<string>();
  faixas.forEach((f, i) => {
    const n = i + 1;
    if (!CODIGO_FAIXA.test(f.codigo))
      r.push(
        recusa('faixa-sla-codigo', `Faixa ${n}: o código tem de 1 a 5 letras ou números.`, [
          `faixas.${i}.codigo`,
        ]),
      );
    else if (codigos.has(f.codigo.toUpperCase()))
      r.push(
        recusa('faixa-sla-codigo', `Faixa ${n}: o código ${f.codigo} se repete.`, [`faixas.${i}.codigo`]),
      );
    codigos.add(f.codigo.toUpperCase());
    if (!f.descricao.trim() || f.descricao.length > 60)
      r.push(
        recusa('faixa-sla-descricao', `Faixa ${n}: a descrição tem de 1 a 60 caracteres.`, [
          `faixas.${i}.descricao`,
        ]),
      );
    const anterior = faixas[i - 1];
    const inicioEsperado = anterior ? anterior.desempenhoFim : 0;
    if (inicioEsperado === null || f.desempenhoInicio !== inicioEsperado)
      r.push(
        recusa(
          'faixas-sla-contiguas',
          i === 0
            ? 'A primeira faixa começa no desempenho zero.'
            : `Faixa ${n}: começa onde a faixa ${i} termina (${String(inicioEsperado ?? 'sem fim')}).`,
          [`faixas.${i}.desempenhoInicio`],
        ),
      );
    if (f.desempenhoFim === null && i < faixas.length - 1)
      r.push(
        recusa('faixas-sla-contiguas', `Faixa ${n}: só a última faixa fica sem fim.`, [
          `faixas.${i}.desempenhoFim`,
        ]),
      );
    if (f.desempenhoFim !== null && f.desempenhoFim <= f.desempenhoInicio)
      r.push(
        recusa('faixas-sla-contiguas', `Faixa ${n}: o fim é maior que o início.`, [
          `faixas.${i}.desempenhoFim`,
        ]),
      );
    if (comGlosa(f.penalidade)) {
      if (f.percentualGlosa === null || !(f.percentualGlosa > 0 && f.percentualGlosa <= 100))
        r.push(
          recusa('faixa-sla-glosa', `Faixa ${n}: a glosa é um percentual acima de 0 e até 100.`, [
            `faixas.${i}.percentualGlosa`,
          ]),
        );
    } else if (f.percentualGlosa !== null)
      r.push(
        recusa('faixa-sla-glosa', `Faixa ${n}: a penalidade escolhida não tem glosa.`, [
          `faixas.${i}.percentualGlosa`,
        ]),
      );
    if (comMulta(f.penalidade)) {
      if (f.valorMulta === null || !(f.valorMulta > 0))
        r.push(
          recusa('faixa-sla-multa', `Faixa ${n}: informe o valor da multa.`, [`faixas.${i}.valorMulta`]),
        );
    } else if (f.valorMulta !== null)
      r.push(
        recusa('faixa-sla-multa', `Faixa ${n}: a penalidade escolhida não tem multa.`, [
          `faixas.${i}.valorMulta`,
        ]),
      );
  });
  return r;
}

/** O SLA novo: modelo e unidade combinados, meta, horário, vigência dentro do contrato vigente e as faixas. */
export function conferirSlaContrato(e: SlaContratoEntrada, contrato: ContratoDoSla): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (contrato.situacao !== 'vigente')
    r.push(recusa('contrato-nao-vigente', 'O SLA só se cadastra em contrato vigente.'));
  if (!e.descricao.trim() || e.descricao.length > 150)
    r.push(recusa('sla-descricao', 'A descrição do SLA tem de 1 a 150 caracteres.', ['descricao']));
  if (!TIPOS_REGRA_SLA.includes(e.tipoRegra))
    r.push(recusa('sla-modelo', 'Escolha o modelo do SLA.', ['tipoRegra']));
  else if (!unidadesDoModeloSla(e.tipoRegra).includes(e.unidade))
    r.push(
      recusa('sla-unidade', `O modelo escolhido mede em ${unidadesDoModeloSla(e.tipoRegra).join(', ')}.`, [
        'unidade',
      ]),
    );
  if (!(e.meta > 0)) r.push(recusa('sla-meta', 'A meta é maior que zero.', ['meta']));
  else if (e.tipoRegra === 'disponibilidade' && e.meta > 100)
    r.push(recusa('sla-meta', 'A disponibilidade mínima vai até 100%.', ['meta']));
  if ((e.horarioInicio === null) !== (e.horarioFim === null))
    r.push(
      recusa('sla-horario', 'Informe o início e o fim do horário coberto, ou nenhum dos dois (24 horas).', [
        'horarioInicio',
      ]),
    );
  else if (e.horarioInicio !== null && e.horarioFim !== null) {
    if (!HORA.test(e.horarioInicio) || !HORA.test(e.horarioFim))
      r.push(recusa('sla-horario', 'O horário coberto vai em HH:MM.', ['horarioInicio']));
    else if (e.horarioInicio === e.horarioFim)
      r.push(
        recusa(
          'sla-horario',
          'O início e o fim do horário coberto são diferentes (24 horas: deixe os dois vazios).',
          ['horarioFim'],
        ),
      );
  }
  if (!DATA.test(e.vigenciaInicio))
    r.push(recusa('sla-vigencia', 'Informe o início da vigência do SLA.', ['vigenciaInicio']));
  else {
    if (e.vigenciaFim !== null && (!DATA.test(e.vigenciaFim) || e.vigenciaFim < e.vigenciaInicio))
      r.push(
        recusa('sla-vigencia', 'O fim da vigência do SLA é igual ou depois do início.', ['vigenciaFim']),
      );
    if (e.vigenciaInicio < contrato.inicio)
      r.push(recusa('sla-fora-contrato', 'O SLA começa dentro da vigência do contrato.', ['vigenciaInicio']));
    if (contrato.fim !== null && e.vigenciaInicio > contrato.fim)
      r.push(recusa('sla-fora-contrato', 'O SLA começa antes do fim do contrato.', ['vigenciaInicio']));
  }
  return [...r, ...conferirFaixasSla(e.faixas)];
}

/** Um SLA gravado do mesmo contrato (para a vigência do novo). */
export interface SlaGravadoResumo {
  readonly id: number;
  readonly servico: number | null;
  readonly tipoRegra: TipoRegraSla;
  readonly inicio: string;
  readonly fim: string | null;
}

/** A véspera de uma data ISO. */
export function vesperaSla(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * O plano da gravação do SLA novo: o do mesmo modelo e serviço que começou antes e ainda vale fecha na véspera (nada
 * apagado); o que começa no mesmo dia ou depois é recusado (corrija pelo fim da vigência dele).
 */
export function planejarSlaContrato(
  e: SlaContratoEntrada,
  existentes: readonly SlaGravadoResumo[],
): { readonly recusas: RecusaSuprimentos[]; readonly fechar: number[]; readonly fim: string } {
  const fim = vesperaSla(e.vigenciaInicio);
  const recusas: RecusaSuprimentos[] = [];
  const fechar: number[] = [];
  for (const x of existentes) {
    if (x.tipoRegra !== e.tipoRegra || x.servico !== e.servico) continue;
    const terminaAntes = x.fim !== null && x.fim < e.vigenciaInicio;
    const novoTerminaAntes = e.vigenciaFim !== null && e.vigenciaFim < x.inicio;
    if (terminaAntes || novoTerminaAntes) continue;
    if (x.inicio < e.vigenciaInicio) fechar.push(x.id);
    else
      recusas.push(
        recusa(
          'sla-sobreposto',
          `Já há um SLA deste modelo e serviço a partir de ${x.inicio}: encerre-o antes ou comece o novo depois.`,
          ['vigenciaInicio'],
        ),
      );
  }
  return { recusas, fechar, fim };
}

/** O que já ficou gravado contra um SLA e prende a vigência dele: os períodos apurados e os dias medidos. */
export interface HistoricoSlaGravado {
  readonly apuracoes: readonly { readonly inicio: string; readonly fim: string }[];
  /** Dia (AAAA-MM-DD) de início de cada medição registrada. */
  readonly medicoes: readonly string[];
}

/**
 * O fechamento da vigência de um SLA em `fim` (pelo encerramento ou pelo SLA novo do mesmo modelo e serviço): nada
 * apurado nem medido depois dessa data, senão a apuração e as medições ficariam fora da vigência do próprio SLA.
 */
export function conferirFechamentoSla(
  fim: string,
  h: HistoricoSlaGravado,
  campo: 'fim' | 'vigenciaInicio' = 'fim',
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  const apurada = h.apuracoes.filter((a) => a.fim > fim).map((a) => a.fim);
  if (apurada.length > 0)
    r.push(
      recusa(
        'sla-apurado',
        `Já há apuração depois de ${fim} (até ${apurada.reduce((a, b) => (a > b ? a : b))}): o fim da vigência fica a partir do fim dela.`,
        [campo],
      ),
    );
  const medida = h.medicoes.filter((d) => d > fim);
  if (medida.length > 0)
    r.push(
      recusa(
        'sla-com-medicao',
        `Há ${medida.length} medição(ões) registrada(s) depois de ${fim}: o fim da vigência fica a partir da última delas.`,
        [campo],
      ),
    );
  return r;
}

/**
 * A medição nova não cai num período já apurado: a apuração gravada (desempenho, glosa e multa) não muda em silêncio.
 * A correção de um período apurado é uma ocorrência de revisão registrada, nunca uma medição a mais.
 */
export function conferirMedicaoForaDeApuracao(
  m: Pick<MedicaoSlaEntrada, 'inicio'>,
  apuracoes: readonly { readonly inicio: string; readonly fim: string }[],
): RecusaSuprimentos[] {
  const dia = m.inicio.slice(0, 10);
  const a = apuracoes.find((x) => x.inicio <= dia && dia <= x.fim);
  return a
    ? [
        recusa(
          'medicao-em-periodo-apurado',
          `O período de ${a.inicio} a ${a.fim} já foi apurado neste SLA: a medição não entra depois da apuração.`,
          ['inicio'],
        ),
      ]
    : [];
}

// ── Cobertura (horário e dias) ──────────────────────────────────────────────────────────────────────────────────

export interface CoberturaSla {
  readonly horarioInicio: string | null;
  readonly horarioFim: string | null;
  readonly somenteDiasUteis: boolean;
  /** Feriados (AAAA-MM-DD) que não contam quando o SLA vale só em dias úteis. */
  readonly feriados: ReadonlySet<string>;
}

const MIN_DIA = 1440;
const minutoDe = (instante: string): number => Date.parse(`${instante}:00Z`) / 60000;
const hm = (h: string): number => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const diaDe = (minuto: number): string => new Date(minuto * 60000).toISOString().slice(0, 10);

/** O dia conta na cobertura (dias úteis: de segunda a sexta, fora os feriados). */
export function diaCobertoSla(dia: string, c: CoberturaSla): boolean {
  if (!c.somenteDiasUteis) return true;
  const semana = new Date(`${dia}T00:00:00Z`).getUTCDay();
  return semana !== 0 && semana !== 6 && !c.feriados.has(dia);
}

/** As janelas cobertas de um dia, em minutos absolutos. */
function janelasDoDia(inicioDia: number, c: CoberturaSla): [number, number][] {
  if (c.horarioInicio === null || c.horarioFim === null) return [[inicioDia, inicioDia + MIN_DIA]];
  const a = hm(c.horarioInicio);
  const b = hm(c.horarioFim);
  if (a < b) return [[inicioDia + a, inicioDia + b]];
  // Cruza a meia-noite: o fim da noite anterior (madrugada) e o começo da noite deste dia.
  return [
    [inicioDia, inicioDia + b],
    [inicioDia + a, inicioDia + MIN_DIA],
  ];
}

/** Os minutos de [inicio, fim) que caem no horário e nos dias cobertos. */
export function minutosCobertosSla(inicio: string, fim: string, c: CoberturaSla): number {
  if (!INSTANTE.test(inicio) || !INSTANTE.test(fim)) return 0;
  const i = minutoDe(inicio);
  const f = minutoDe(fim);
  if (!(f > i)) return 0;
  let total = 0;
  for (let d = Math.floor(i / MIN_DIA) * MIN_DIA; d < f; d += MIN_DIA) {
    if (!diaCobertoSla(diaDe(d), c)) continue;
    for (const [a, b] of janelasDoDia(d, c)) total += Math.max(0, Math.min(b, f) - Math.max(a, i));
  }
  return total;
}

/** Minutos na unidade do SLA (dia = 24 horas cobertas). */
export function minutosNaUnidadeSla(minutos: number, unidade: UnidadeSla): number {
  if (unidade === 'hora') return minutos / 60;
  if (unidade === 'dia') return minutos / MIN_DIA;
  return minutos;
}

// ── Medição e apuração ──────────────────────────────────────────────────────────────────────────────────────────

/** O chamado (tempo), a parada (disponibilidade) ou o realizado (produção) registrado contra o SLA. */
export interface MedicaoSlaEntrada {
  /** Abertura do chamado, início da parada ou dia do realizado (AAAA-MM-DDTHH:MM). */
  readonly inicio: string;
  /** Atendimento ou solução do chamado, ou fim da parada; nulo na produção. */
  readonly fim: string | null;
  /** Quantidade realizada (só na produção). */
  readonly quantidade: number | null;
  readonly descricao: string;
}

/** A medição: instantes válidos, nada no futuro, fim depois do início; a produção com a quantidade. */
export function conferirMedicaoSla(
  tipo: TipoRegraSla,
  m: MedicaoSlaEntrada,
  agora: string,
  vigencia: { readonly inicio: string; readonly fim: string | null },
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!m.descricao.trim())
    r.push(recusa('medicao-descricao', 'Descreva o chamado, a parada ou o realizado.', ['descricao']));
  if (!INSTANTE.test(m.inicio))
    return [...r, recusa('medicao-inicio', 'Informe a data e a hora de início.', ['inicio'])];
  if (m.inicio > agora) r.push(recusa('medicao-futura', 'A medição não começa no futuro.', ['inicio']));
  const dia = m.inicio.slice(0, 10);
  if (dia < vigencia.inicio || (vigencia.fim !== null && dia > vigencia.fim))
    r.push(recusa('medicao-fora-vigencia', 'A medição cai fora da vigência do SLA.', ['inicio']));
  if (tipo === 'producao') {
    if (m.quantidade === null || !(m.quantidade > 0))
      r.push(recusa('medicao-quantidade', 'Informe a quantidade realizada.', ['quantidade']));
    if (m.fim !== null) r.push(recusa('medicao-fim', 'O realizado da produção não tem fim.', ['fim']));
    return r;
  }
  if (m.quantidade !== null)
    r.push(recusa('medicao-quantidade', 'Só a produção tem quantidade.', ['quantidade']));
  if (m.fim === null || !INSTANTE.test(m.fim))
    r.push(
      recusa(
        'medicao-fim',
        tipo === 'disponibilidade'
          ? 'Informe o fim da parada.'
          : 'Informe o atendimento ou a solução do chamado.',
        ['fim'],
      ),
    );
  else if (m.fim <= m.inicio) r.push(recusa('medicao-fim', 'O fim é depois do início.', ['fim']));
  else if (m.fim > agora) r.push(recusa('medicao-futura', 'O fim não fica no futuro.', ['fim']));
  return r;
}

export interface SlaApuravel extends CoberturaSla {
  readonly tipoRegra: TipoRegraSla;
  readonly unidade: UnidadeSla;
  readonly meta: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly faixas: readonly FaixaSlaEntrada[];
}

export interface MedicaoSla extends MedicaoSlaEntrada {
  readonly id: number;
}

export interface MedicaoApurada {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string | null;
  /** O tempo coberto (na unidade do SLA) ou a quantidade. */
  readonly medido: number;
  /** No prazo (tempo); para a parada e a produção, sempre verdadeiro (entram no total). */
  readonly dentro: boolean;
}

export interface ApuracaoSla {
  readonly inicio: string;
  readonly fim: string;
  readonly considerados: number;
  readonly noPrazo: number;
  /** Minutos cobertos no período (disponibilidade) e minutos parados dentro deles. */
  readonly minutosCobertos: number;
  readonly minutosParados: number;
  readonly realizado: number;
  /** Desempenho do período em percentual (duas casas). */
  readonly desempenho: number;
  readonly metaAtingida: boolean;
  readonly faixa: FaixaSlaEntrada | null;
  readonly valorFatura: number | null;
  readonly glosa: number;
  readonly multa: number;
  readonly total: number;
  /** As parcelas impressas da conta (a tela e o histórico mostram de onde vem cada número). */
  readonly parcelas: readonly string[];
  readonly medicoes: readonly MedicaoApurada[];
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const somaDia = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** A faixa em que o desempenho cai (semiaberta; a última sem fim). */
export function faixaDoDesempenhoSla(
  faixas: readonly FaixaSlaEntrada[],
  desempenho: number,
): FaixaSlaEntrada | null {
  return (
    faixas.find(
      (f) => desempenho >= f.desempenhoInicio && (f.desempenhoFim === null || desempenho < f.desempenhoFim),
    ) ?? null
  );
}

/** O período da apuração: datas válidas, fim igual ou depois do início, até 92 dias, dentro da vigência, já fechado. */
export function conferirPeriodoApuracaoSla(
  periodo: { readonly inicio: string; readonly fim: string },
  sla: Pick<SlaApuravel, 'vigenciaInicio' | 'vigenciaFim'>,
  hoje: string,
): RecusaSuprimentos[] {
  if (!DATA.test(periodo.inicio) || !DATA.test(periodo.fim))
    return [recusa('periodo-apuracao', 'Informe o início e o fim do período.', ['inicio'])];
  const r: RecusaSuprimentos[] = [];
  if (periodo.fim < periodo.inicio)
    r.push(recusa('periodo-apuracao', 'O fim do período é igual ou depois do início.', ['fim']));
  else if (somaDia(periodo.inicio, DIAS_MAXIMOS_APURACAO_SLA) <= periodo.fim)
    r.push(recusa('periodo-apuracao', `O período vai até ${DIAS_MAXIMOS_APURACAO_SLA} dias.`, ['fim']));
  if (periodo.fim >= hoje)
    r.push(recusa('periodo-aberto', 'Apure só o período já encerrado (fim antes de hoje).', ['fim']));
  if (periodo.inicio < sla.vigenciaInicio || (sla.vigenciaFim !== null && periodo.fim > sla.vigenciaFim))
    r.push(recusa('periodo-fora-vigencia', 'O período fica dentro da vigência do SLA.', ['inicio']));
  return r;
}

/**
 * Apura o SLA no período [inicio, fim] (datas inclusivas) com as medições registradas.
 *   - tempo: cada chamado aberto no período mede só o tempo coberto; no prazo se medido ≤ meta; desempenho = % no prazo
 *     (sem chamado no período: 100%);
 *   - disponibilidade: minutos cobertos do período menos os parados dentro deles; desempenho = disponível / coberto;
 *   - produção: soma do realizado no período; desempenho = realizado / meta.
 * A glosa é o percentual da faixa sobre a fatura do período; a multa é o valor da faixa.
 */
export function apurarSla(
  sla: SlaApuravel,
  medicoes: readonly MedicaoSla[],
  periodo: { readonly inicio: string; readonly fim: string },
  valorFatura: number | null,
): ApuracaoSla {
  const iPer = `${periodo.inicio}T00:00`;
  const fPer = `${somaDia(periodo.fim, 1)}T00:00`;
  const noPeriodo = (m: MedicaoSla) => m.inicio >= iPer && m.inicio < fPer;
  const apuradas: MedicaoApurada[] = [];
  const parcelas: string[] = [];
  let desempenho: number;
  let metaAtingida: boolean;
  let considerados = 0;
  let noPrazo = 0;
  let minutosCobertos = 0;
  let minutosParados = 0;
  let realizado = 0;
  if (sla.tipoRegra === 'disponibilidade') {
    minutosCobertos = minutosCobertosSla(iPer, fPer, sla);
    for (const m of medicoes) {
      if (m.fim === null || m.fim <= iPer || m.inicio >= fPer) continue;
      const a = m.inicio < iPer ? iPer : m.inicio;
      const b = m.fim > fPer ? fPer : m.fim;
      const parado = minutosCobertosSla(a, b, sla);
      minutosParados += parado;
      considerados += 1;
      apuradas.push({ id: m.id, inicio: m.inicio, fim: m.fim, medido: parado, dentro: true });
    }
    minutosParados = Math.min(minutosParados, minutosCobertos);
    desempenho = minutosCobertos === 0 ? 100 : ((minutosCobertos - minutosParados) / minutosCobertos) * 100;
    metaAtingida = desempenho >= sla.meta;
    parcelas.push(
      `Disponibilidade: (${num(minutosCobertos)} min cobertos − ${num(minutosParados)} min parados) ÷ ${num(minutosCobertos)} min = ${num(reais(desempenho))}% (meta ${num(sla.meta)}%)`,
    );
  } else if (sla.tipoRegra === 'producao') {
    for (const m of medicoes.filter(noPeriodo)) {
      const q = m.quantidade ?? 0;
      realizado += q;
      considerados += 1;
      apuradas.push({ id: m.id, inicio: m.inicio, fim: null, medido: q, dentro: true });
    }
    desempenho = (realizado / sla.meta) * 100;
    metaAtingida = realizado >= sla.meta;
    parcelas.push(
      `Produção: ${num(realizado)} realizado ÷ ${num(sla.meta)} mínimo = ${num(reais(desempenho))}%`,
    );
  } else {
    for (const m of medicoes.filter(noPeriodo)) {
      if (m.fim === null) continue;
      const medido = minutosNaUnidadeSla(minutosCobertosSla(m.inicio, m.fim, sla), sla.unidade);
      const dentro = medido <= sla.meta;
      considerados += 1;
      if (dentro) noPrazo += 1;
      apuradas.push({ id: m.id, inicio: m.inicio, fim: m.fim, medido: reais(medido), dentro });
    }
    desempenho = considerados === 0 ? 100 : (noPrazo / considerados) * 100;
    metaAtingida = noPrazo === considerados;
    parcelas.push(
      `Prazo: ${noPrazo} de ${considerados} chamado(s) em até ${num(sla.meta)} ${sla.unidade}(s) cobertos = ${num(reais(desempenho))}%`,
    );
  }
  desempenho = reais(desempenho);
  const faixa = faixaDoDesempenhoSla(sla.faixas, desempenho);
  let glosa = 0;
  let multa = 0;
  if (faixa) {
    parcelas.push(
      `Faixa ${faixa.codigo} (${faixa.descricao}): de ${num(faixa.desempenhoInicio)}% ${faixa.desempenhoFim === null ? 'em diante' : `até antes de ${num(faixa.desempenhoFim)}%`}`,
    );
    if (comGlosa(faixa.penalidade) && faixa.percentualGlosa !== null && valorFatura !== null) {
      glosa = reais((valorFatura * faixa.percentualGlosa) / 100);
      parcelas.push(`Glosa: ${num(faixa.percentualGlosa)}% de ${brl(valorFatura)} = ${brl(glosa)}`);
    }
    if (comMulta(faixa.penalidade) && faixa.valorMulta !== null) {
      multa = reais(faixa.valorMulta);
      parcelas.push(`Multa da faixa: ${brl(multa)}`);
    }
  }
  const total = reais(glosa + multa);
  if (glosa > 0 && multa > 0) parcelas.push(`Total: ${brl(glosa)} + ${brl(multa)} = ${brl(total)}`);
  return {
    inicio: periodo.inicio,
    fim: periodo.fim,
    considerados,
    noPrazo,
    minutosCobertos,
    minutosParados,
    realizado,
    desempenho,
    metaAtingida,
    faixa,
    valorFatura,
    glosa,
    multa,
    total,
    parcelas,
    medicoes: apuradas,
  };
}

/** A glosa da faixa precisa do valor da fatura do período. */
export function conferirFaturaApuracaoSla(a: ApuracaoSla): RecusaSuprimentos[] {
  return a.faixa && comGlosa(a.faixa.penalidade) && a.valorFatura === null
    ? [
        recusa('fatura-obrigatoria', 'A faixa apurada tem glosa: informe o valor da fatura do período.', [
          'valorFatura',
        ]),
      ]
    : [];
}
