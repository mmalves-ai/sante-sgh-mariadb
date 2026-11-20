// Férias (M53-F3; ficha do M53, seções 1 e 8, regras 7 e 8; CLT arts. 129 a 145): os períodos aquisitivos do vínculo, o
// direito pela escala das faltas, o saldo, a conferência da programação (frações, abono, véspera do descanso, dobra) e
// o recibo de férias com a memória por rubrica. Regra pura: quem chama lê o vínculo, o histórico das folhas mensais
// calculadas, os afastamentos, as férias já programadas, o salário, a tabela legal, os parâmetros e as rubricas.
//
// Decisões (POL-5, dono confirma; registradas nas evidências do M53.4):
// - D-ESCALA-534: a escala do art. 130 (até 5 faltas: 30 dias; 6 a 14: 24; 15 a 23: 18; 24 a 32: 12; acima: 0) é texto
//   da lei sem número de tabela pública que mude por vigência (inalterada desde 1977): fica no código, como o mês de 30.
// - D-FALTAS-534: as faltas injustificadas do período = minutos de falta das folhas mensais calculadas das competências
//   do período (D-MES-534) ÷ a jornada diária (carga semanal ÷ 6), arredondado para baixo.
// - D-AFAST-534: afastamento a cargo da Previdência acima de 180 dias no período (art. 133, IV) vira aviso para o DP
//   conferir; o sistema não cancela o direito sozinho.
// - D-VESPERA-534: o gozo não começa na sexta nem no sábado (repouso no domingo; art. 134 §3); os feriados entram com o
//   calendário de feriados (cadastro de outra etapa).
// - D-FRACAO-534: até três frações por período, cada uma com 5 dias ou mais, e uma delas com 14 ou mais; quando o
//   direito restante for menor que 14 dias (faltas), o gozo é de uma vez.
// - D-ABONO-534: o abono pecuniário é pedido uma vez no período, até 1/3 do direito (arredondado para baixo), e sai do
//   saldo junto com a fração em que foi pedido.
// - D-REMUN-534: a remuneração das férias = salário em vigor no início do gozo + insalubridade (salário mínimo da tabela
//   em vigor) + periculosidade + as médias das variáveis (D-MEDIA-534); o terço constitucional sobre o gozo e as médias,
//   e sobre o abono; a dobra do art. 137 paga de novo os dias de gozo depois do concessivo, com o terço.
// - D-PAGTO-534: o pagamento do recibo é dois dias antes do início do gozo (art. 145); a competência do recibo é a do
//   início do gozo (tabela legal, parâmetros e rubricas em vigor nela).
// - D-ADIANTF-534: o adiantamento do 13º pedido com as férias é metade da remuneração fixa × avos do ano ÷ 12, como a
//   1ª parcela (D-PRIM13-534); um por ano.
import type {
  AvisoPeriodoFerias,
  AvisoProgramacaoFerias,
  DiasAfastamentoFolha,
  PapelCalculoFolha,
  ParametrosFolha,
  PendenciaCalculo,
  PeriodoAquisitivo,
  RecusaProgramacaoFerias,
  RubricaFolha,
  SituacaoFerias,
  TabelaLegalFolha,
} from '@sgh/contratos';
import { diaUtc } from '../datas.js';
import {
  type AfastamentoParaCalculo,
  type Bruta,
  DIAS_MES_COMERCIAL,
  multiplicarDividir,
  pct,
  reais,
  rubricaServeAoPapel,
  type SalarioParaCalculo,
  type VinculoParaCalculo,
} from './calculo.js';
import {
  avosDoAno,
  competenciasDoPeriodo,
  competenciasSemCalculo,
  diaDaSemana,
  type HistoricoFolha,
  mediaDasVariaveis,
  somarAnos,
  maisDias,
} from './medias.js';
import { fecharRecibo, papeisSemRubrica, type ReciboFechado, rubricasDosParametros } from './recibo.js';
import { conferirTabelaLegal, vigenteNaCompetencia, vigenteNaData } from './vigencia.js';

/** A escala do art. 130 da CLT (D-ESCALA-534): faltas injustificadas no período → dias de férias. */
export const ESCALA_FALTAS_FERIAS = [
  { ate: 5, dias: 30 },
  { ate: 14, dias: 24 },
  { ate: 23, dias: 18 },
  { ate: 32, dias: 12 },
] as const;

export const DIAS_MINIMOS_FRACAO = 5;
export const DIAS_FRACAO_PRINCIPAL = 14;
export const MAXIMO_FRACOES = 3;
export const DIAS_AVISO_FERIAS = 30;
export const DIAS_AFASTAMENTO_LONGO = 180;

export function diasDeDireito(faltas: number): number {
  for (const f of ESCALA_FALTAS_FERIAS) if (faltas <= f.ate) return f.dias;
  return 0;
}

/** Jornada diária em minutos (carga semanal ÷ 6 dias). */
export function jornadaDiariaMinutos(cargaSemanal: number): number {
  return Math.max(1, Math.round((cargaSemanal * 60) / 6));
}

export interface PeriodoBase {
  readonly inicio: string;
  readonly fim: string;
  readonly concessivoFim: string;
}

/** Os períodos aquisitivos do vínculo que começam até `ate` (o último pode estar em aquisição). */
export function periodosAquisitivos(admissao: string, ate: string): PeriodoBase[] {
  const out: PeriodoBase[] = [];
  for (let k = 0; k < 200; k++) {
    const inicio = somarAnos(admissao, k);
    if (diaUtc(inicio) > diaUtc(ate)) break;
    out.push({
      inicio,
      fim: maisDias(somarAnos(admissao, k + 1), -1),
      concessivoFim: maisDias(somarAnos(admissao, k + 2), -1),
    });
  }
  return out;
}

/** Uma fração de férias já registrada do vínculo (para o saldo e a conferência da programação). */
export interface FeriasRegistrada {
  readonly id: number;
  readonly aquisitivoInicio: string;
  readonly inicio: string;
  readonly fim: string;
  readonly dias: number;
  readonly abono: number;
  readonly adiantarDecimo: boolean;
  readonly situacao: SituacaoFerias;
}

/** Dias de afastamento a cargo da Previdência (além dos dias da empresa) dentro de [inicio, fim]. */
export function diasAfastadoNoPeriodo(
  afastamentos: readonly AfastamentoParaCalculo[],
  inicio: string,
  fim: string,
  diasEmpresa: number,
): number {
  let total = 0;
  for (const a of afastamentos) {
    if (a.situacao !== 'ativo') continue;
    const desde = Math.max(diaUtc(a.inicio) + diasEmpresa, diaUtc(inicio));
    const ate = Math.min(a.fim === null ? Number.MAX_SAFE_INTEGER : diaUtc(a.fim), diaUtc(fim));
    if (ate >= desde) total += ate - desde + 1;
  }
  return total;
}

export interface EntradaSaldoFerias {
  readonly vinculo: Pick<VinculoParaCalculo, 'admissao' | 'desligamento' | 'cargaSemanal' | 'tipo'>;
  readonly hoje: string;
  readonly historico: readonly HistoricoFolha[];
  readonly afastamentos: readonly AfastamentoParaCalculo[];
  readonly diasEmpresa: number;
  readonly ferias: readonly FeriasRegistrada[];
}

/** Os períodos aquisitivos com faltas, direito, gozados, programados, abono, saldo, situação e avisos. */
export function saldoDosPeriodos(e: EntradaSaldoFerias): PeriodoAquisitivo[] {
  if (e.vinculo.tipo !== 'clt') return [];
  const ate =
    e.vinculo.desligamento !== null && diaUtc(e.vinculo.desligamento) < diaUtc(e.hoje)
      ? e.vinculo.desligamento
      : e.hoje;
  const jornada = jornadaDiariaMinutos(e.vinculo.cargaSemanal);
  const competenciaHoje = e.hoje.slice(0, 7);
  return periodosAquisitivos(e.vinculo.admissao, ate).map((p) => {
    const comps = competenciasDoPeriodo(p.inicio);
    const passadas = comps.filter((c) => c < competenciaHoje && c >= e.vinculo.admissao.slice(0, 7));
    const set = new Set(comps);
    const faltasMin = e.historico
      .filter((h) => h.papel === 'faltas' && set.has(h.competencia))
      .reduce((s, h) => s + Math.max(0, h.quantidade), 0);
    const faltas = Math.floor(faltasMin / jornada);
    const direito = diasDeDireito(faltas);
    const doPeriodo = e.ferias.filter((f) => f.aquisitivoInicio === p.inicio && f.situacao !== 'cancelada');
    const gozados = doPeriodo.filter((f) => f.situacao === 'calculada').reduce((s, f) => s + f.dias, 0);
    const programados = doPeriodo.filter((f) => f.situacao === 'programada').reduce((s, f) => s + f.dias, 0);
    const abono = doPeriodo.reduce((s, f) => s + f.abono, 0);
    const saldo = Math.max(0, direito - gozados - programados - abono);
    const avisos: AvisoPeriodoFerias[] = [];
    if (diasAfastadoNoPeriodo(e.afastamentos, p.inicio, p.fim, e.diasEmpresa) > DIAS_AFASTAMENTO_LONGO)
      avisos.push('afastamento-longo');
    const semCalculo = competenciasSemCalculo(e.historico, passadas);
    if (semCalculo.length > 0) avisos.push('competencias-sem-calculo');
    const hoje = diaUtc(e.hoje);
    const situacao =
      hoje <= diaUtc(p.fim)
        ? 'em-aquisicao'
        : saldo === 0
          ? 'quitado'
          : hoje > diaUtc(p.concessivoFim)
            ? 'vencido'
            : 'aberto';
    return {
      inicio: p.inicio,
      fim: p.fim,
      concessivoFim: p.concessivoFim,
      situacao,
      faltas,
      direito,
      gozados,
      abono,
      programados,
      saldo,
      avisos,
      competenciasSemCalculo: semCalculo,
    };
  });
}

// ── Programação ───────────────────────────────────────────────────────────────────────────────────────────────

export interface EntradaProgramacaoFerias {
  readonly vinculo: Pick<VinculoParaCalculo, 'tipo' | 'desligamento'>;
  readonly hoje: string;
  /** O período aquisitivo escolhido (null: não é do vínculo). */
  readonly periodo: PeriodoAquisitivo | null;
  /** Todas as frações do vínculo fora as canceladas (de qualquer período). */
  readonly ferias: readonly FeriasRegistrada[];
  /** O 13º do ano do gozo já foi adiantado na 1ª parcela da empresa. */
  readonly decimoAdiantadoNoAno: boolean;
  readonly nova: {
    readonly inicio: string;
    readonly dias: number;
    readonly abono: number;
    readonly adiantarDecimo: boolean;
  };
}

export interface ProgramacaoConferida {
  readonly recusas: readonly RecusaProgramacaoFerias[];
  readonly avisos: readonly AvisoProgramacaoFerias[];
  readonly fim: string;
  readonly pagamento: string;
  /** Dias de gozo depois do fim do concessivo (pagos em dobro). */
  readonly dobra: number;
}

/** Confere a fração de férias contra a CLT (D-FRACAO-534, D-ABONO-534, D-VESPERA-534) e o que já está registrado. */
export function conferirProgramacao(e: EntradaProgramacaoFerias): ProgramacaoConferida {
  const n = e.nova;
  const fim = maisDias(n.inicio, Math.max(1, n.dias) - 1);
  const pagamento = maisDias(n.inicio, -2);
  const recusas: RecusaProgramacaoFerias[] = [];
  const avisos: AvisoProgramacaoFerias[] = [];
  const base = { fim, pagamento, dobra: 0 };
  if (e.vinculo.tipo !== 'clt') return { ...base, recusas: ['vinculo-sem-ferias'], avisos };
  const p = e.periodo;
  if (!p) return { ...base, recusas: ['periodo-inexistente'], avisos };
  const ini = diaUtc(n.inicio);
  if (ini <= diaUtc(p.fim)) recusas.push('aquisitivo-incompleto');
  if (ini < diaUtc(e.hoje)) recusas.push('inicio-no-passado');
  if (e.vinculo.desligamento !== null && diaUtc(fim) > diaUtc(e.vinculo.desligamento))
    recusas.push('depois-do-desligamento');
  if (n.dias < DIAS_MINIMOS_FRACAO) recusas.push('fracao-minima');
  const partes = e.ferias.filter((f) => f.aquisitivoInicio === p.inicio && f.situacao !== 'cancelada');
  if (partes.length >= MAXIMO_FRACOES) recusas.push('tres-fracoes');
  if (n.dias + n.abono > p.saldo) recusas.push('saldo-insuficiente');
  if (n.abono > 0) {
    if (n.abono > Math.floor(p.direito / 3)) recusas.push('abono-acima');
    if (partes.some((f) => f.abono > 0)) recusas.push('abono-repetido');
  }
  const restante = p.saldo - n.dias - n.abono;
  if (restante > 0 && restante < DIAS_MINIMOS_FRACAO && !recusas.includes('saldo-insuficiente'))
    recusas.push('fracao-minima');
  const abonoTotal = partes.reduce((s, f) => s + f.abono, 0) + n.abono;
  const gozoTotal = p.direito - abonoTotal;
  const temPrincipal = n.dias >= DIAS_FRACAO_PRINCIPAL || partes.some((f) => f.dias >= DIAS_FRACAO_PRINCIPAL);
  if (gozoTotal >= DIAS_FRACAO_PRINCIPAL) {
    if (!temPrincipal && restante < DIAS_FRACAO_PRINCIPAL) recusas.push('fracao-quatorze');
  } else if (partes.length > 0 || restante > 0) recusas.push('fracao-quatorze');
  const dia = diaDaSemana(n.inicio);
  if (dia === 5 || dia === 6) recusas.push('vespera-de-descanso');
  if (
    e.ferias.some(
      (f) => f.situacao !== 'cancelada' && diaUtc(f.inicio) <= diaUtc(fim) && diaUtc(f.fim) >= ini,
    )
  )
    recusas.push('sobreposicao');
  if (n.adiantarDecimo) {
    const ano = n.inicio.slice(0, 4);
    if (
      e.decimoAdiantadoNoAno ||
      e.ferias.some((f) => f.situacao !== 'cancelada' && f.adiantarDecimo && f.inicio.slice(0, 4) === ano)
    )
      recusas.push('adiantamento-repetido');
  }
  if (ini - diaUtc(e.hoje) < DIAS_AVISO_FERIAS) avisos.push('aviso-curto');
  let dobra = 0;
  const limite = diaUtc(p.concessivoFim);
  if (diaUtc(fim) > limite) {
    dobra = Math.min(n.dias, diaUtc(fim) - Math.max(limite, ini - 1));
    avisos.push('concessivo-vencido');
  }
  return { recusas: [...new Set(recusas)], avisos, fim, pagamento, dobra };
}

// ── Recibo de férias ──────────────────────────────────────────────────────────────────────────────────────────

export interface EntradaCalculoFerias {
  readonly empresa: number;
  readonly vinculo: VinculoParaCalculo;
  readonly ferias: {
    readonly aquisitivoInicio: string;
    readonly inicio: string;
    readonly dias: number;
    readonly abono: number;
    readonly dobra: number;
    readonly adiantarDecimo: boolean;
  };
  readonly salarios: readonly SalarioParaCalculo[];
  readonly historico: readonly HistoricoFolha[];
  readonly afastamentos: readonly AfastamentoParaCalculo[];
  readonly diasAfastamento: readonly DiasAfastamentoFolha[];
  readonly tabelasLegais: readonly TabelaLegalFolha[];
  readonly parametros: readonly ParametrosFolha[];
  readonly rubricas: readonly RubricaFolha[];
}

export interface ResultadoCalculoFeriasPuro {
  readonly competencia: string;
  readonly pendencias: readonly PendenciaCalculo[];
  readonly recibo: ReciboFechado | null;
  readonly tabelaLegal: string | null;
  readonly parametros: string | null;
  /** Competências do período aquisitivo sem folha mensal calculada (as médias contam só as calculadas). */
  readonly competenciasSemCalculo: readonly string[];
}

/** Remuneração fixa do mês: salário + insalubridade (sobre o salário mínimo) + periculosidade (sobre o salário). */
export function remuneracaoFixa(
  s: SalarioParaCalculo,
  t: TabelaLegalFolha,
  p: ParametrosFolha,
): { valor: number; memoria: string } {
  const insal = s.insalubridade > 0 ? multiplicarDividir([t.salarioMinimo, s.insalubridade], [10_000]) : 0;
  const peric = s.periculosidade
    ? multiplicarDividir([s.salario, p.percentuais.periculosidade], [10_000])
    : 0;
  const partes = [`salário ${reais(s.salario)}`];
  if (insal > 0) partes.push(`insalubridade ${reais(t.salarioMinimo)} × ${pct(s.insalubridade)}`);
  if (peric > 0) partes.push(`periculosidade ${pct(p.percentuais.periculosidade)}`);
  return { valor: s.salario + insal + peric, memoria: partes.join(' + ') };
}

const pend = (
  codigo: PendenciaCalculo['codigo'],
  vinculo: number | null,
  papel: PapelCalculoFolha | null = null,
) => ({
  codigo,
  vinculos: vinculo === null ? [] : [vinculo],
  papel,
});

/** Calcula o recibo de férias da fração programada (D-REMUN-534, D-PAGTO-534, D-ADIANTF-534). */
export function calcularFerias(e: EntradaCalculoFerias): ResultadoCalculoFeriasPuro {
  const competencia = e.ferias.inicio.slice(0, 7);
  const v = e.vinculo;
  const pendencias: PendenciaCalculo[] = [];
  const tabela = vigenteNaCompetencia(e.tabelasLegais, competencia);
  if (!tabela) pendencias.push(pend('sem-tabela-legal', null));
  else if (conferirTabelaLegal(tabela).length > 0) pendencias.push(pend('tabela-legal-divergente', null));
  const parametros = vigenteNaCompetencia(
    e.parametros.filter((p) => p.empresa === e.empresa),
    competencia,
  );
  if (!parametros) pendencias.push(pend('sem-parametros', null));
  const salario = vigenteNaData(
    e.salarios.filter((s) => s.vinculo === v.id),
    e.ferias.inicio,
  );
  if (!salario) pendencias.push(pend('sem-salario', v.id));
  const comps = competenciasDoPeriodo(e.ferias.aquisitivoInicio);
  const semCalculo = competenciasSemCalculo(
    e.historico,
    comps.filter((c) => c < competencia && c >= v.admissao.slice(0, 7)),
  );
  const vazio = {
    competencia,
    recibo: null,
    tabelaLegal: tabela?.inicio ?? null,
    parametros: parametros?.inicio ?? null,
    competenciasSemCalculo: semCalculo,
  };
  if (!tabela || !parametros || !salario || pendencias.length > 0) return { ...vazio, pendencias };

  const { mapa, invalidas } = rubricasDosParametros(
    parametros,
    e.rubricas,
    e.empresa,
    competencia,
    rubricaServeAoPapel,
  );
  const divisor = parametros.divisorHoras ?? v.cargaSemanal * 5;
  const fixa = remuneracaoFixa(salario, tabela, parametros);
  const media = mediaDasVariaveis(e.historico, new Set(comps), 12, salario.salario, divisor, parametros);
  const f = e.ferias;
  const brutas: Bruta[] = [];
  const gozo = multiplicarDividir([fixa.valor, f.dias], [DIAS_MES_COMERCIAL]);
  brutas.push({
    papel: 'feriasGozo',
    quantidade: f.dias,
    unidade: 'dias',
    valor: gozo,
    memoria: `(${fixa.memoria}) = ${reais(fixa.valor)} × ${f.dias}/${DIAS_MES_COMERCIAL} dias`,
  });
  const medias = multiplicarDividir([media.valor, f.dias], [DIAS_MES_COMERCIAL]);
  brutas.push({
    papel: 'feriasMedias',
    quantidade: f.dias,
    unidade: 'dias',
    valor: medias,
    memoria: `média ${reais(media.valor)} × ${f.dias}/${DIAS_MES_COMERCIAL} dias: ${media.memoria}`,
  });
  brutas.push({
    papel: 'feriasTerco',
    quantidade: 0,
    unidade: 'valor',
    valor: multiplicarDividir([gozo + medias], [3]),
    memoria: `(${reais(gozo)} + ${reais(medias)}) ÷ 3`,
  });
  const remun = fixa.valor + media.valor;
  if (f.abono > 0) {
    const abono = multiplicarDividir([remun, f.abono], [DIAS_MES_COMERCIAL]);
    brutas.push(
      {
        papel: 'abonoPecuniario',
        quantidade: f.abono,
        unidade: 'dias',
        valor: abono,
        memoria: `${reais(remun)} × ${f.abono}/${DIAS_MES_COMERCIAL} dias`,
      },
      {
        papel: 'abonoTerco',
        quantidade: 0,
        unidade: 'valor',
        valor: multiplicarDividir([abono], [3]),
        memoria: `${reais(abono)} ÷ 3`,
      },
    );
  }
  if (f.dobra > 0)
    brutas.push({
      papel: 'feriasDobra',
      quantidade: f.dobra,
      unidade: 'dias',
      valor: multiplicarDividir([remun, f.dobra, 4], [DIAS_MES_COMERCIAL, 3]),
      memoria: `${reais(remun)} × ${f.dobra}/${DIAS_MES_COMERCIAL} dias × 4/3 (dias depois do período concessivo, em dobro)`,
    });
  if (f.adiantarDecimo) {
    const dias = vigenteNaCompetencia(e.diasAfastamento, competencia)?.dias ?? 0;
    const { avos } = avosDoAno(
      v,
      e.afastamentos.filter((a) => a.vinculo === v.id),
      Number(f.inicio.slice(0, 4)),
      dias,
    );
    brutas.push({
      papel: 'decimoAdiantamento',
      quantidade: avos,
      unidade: 'valor',
      valor: multiplicarDividir([fixa.valor, avos], [24]),
      memoria: `${reais(fixa.valor)} × ${avos}/12 avos ÷ 2 (adiantamento do 13º com as férias)`,
    });
  }
  const recibo = fecharRecibo(
    v,
    f.dias,
    brutas,
    { tabela, parametros, rubricas: mapa, dependentesIrrf: salario.dependentesIrrf },
    {
      papelInss: 'inssFerias',
      papelIrrf: 'irrfFerias',
      irrf: 'mensal',
      foraDoInssIrrf: new Set<PapelCalculoFolha>(['decimoAdiantamento']),
      fgtsJaDepositado: 0,
      encargos: true,
    },
  );
  for (const p of papeisSemRubrica(recibo.linhas, mapa))
    pendencias.push(pend(invalidas.has(p) ? 'rubrica-invalida' : 'papel-sem-rubrica', v.id, p));
  if (recibo.resumo.descontos > recibo.resumo.proventos) pendencias.push(pend('liquido-negativo', v.id));
  // O recibo volta mesmo com pendência de rubrica ou líquido (a prévia mostra a conta); quem chama não grava.
  return { ...vazio, pendencias, recibo };
}
