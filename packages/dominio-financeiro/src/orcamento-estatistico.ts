// Orçamento estatístico e indicadores orçamentários por setor (C1-129; ficha 07-FIN linha 131): a quantidade orçada de
// cada indicador (diárias, cirurgias, exames, consultas) por centro de custo e mês da versão do orçamento, a projeção
// sugerida a partir do realizado das estatísticas de custeio (média, último mês, tendência ou mesmo mês do ano anterior)
// e o painel dos indicadores: orçado × realizado por setor e por grupo, com o atingimento e a conta com as parcelas.
// Puro (sem I/O): a API valida e monta por aqui, e a tela valida na hora pela mesma regra.
// As quantidades andam em centésimos (inteiros), como as estatísticas de custeio: nada de ponto flutuante na soma.
import type { FalhaCampoOrcamento } from './orcamento-premissas.js';

export const VISOES_INDICADOR_ORCAMENTARIO = ['mensal', 'acumulado', 'media'] as const;
export type VisaoIndicadorOrcamentario = (typeof VISOES_INDICADOR_ORCAMENTARIO)[number];

export const PROJECOES_INDICADOR_ORCAMENTARIO = [
  'nenhuma',
  'media',
  'ultimo_mes',
  'tendencia',
  'mesmo_mes_ano_anterior',
] as const;
export type ProjecaoIndicadorOrcamentario = (typeof PROJECOES_INDICADOR_ORCAMENTARIO)[number];

/** Teto da quantidade do mês (DECIMAL(15,4) no banco; aqui em centésimos, com folga). */
export const TETO_QUANTIDADE_CENT = 1_000_000_000_000;

export interface IndicadorOrcamentarioEntrada {
  readonly codigo: string;
  readonly descricao: string;
  readonly grupoId: number | null;
  readonly tipoDadoId: number | null;
  readonly unidade: string | null;
  readonly visao: VisaoIndicadorOrcamentario;
  readonly tipoProjecao: ProjecaoIndicadorOrcamentario;
  readonly mesesProjecao: number | null;
  readonly observacao: string | null;
  readonly ativo: boolean;
}

const vazio = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

/** As falhas do cadastro do indicador (lista vazia: pode gravar). */
export function validarIndicadorOrcamentario(x: IndicadorOrcamentarioEntrada): FalhaCampoOrcamento[] {
  const f: FalhaCampoOrcamento[] = [];
  const c = x.codigo.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/u.test(c))
    f.push({ campo: 'codigo', mensagem: 'O código tem até 30 letras, números, ponto, hífen ou sublinhado.' });
  const d = x.descricao.trim();
  if (d.length < 3 || d.length > 150)
    f.push({ campo: 'descricao', mensagem: 'Descreva o indicador (de 3 a 150 caracteres).' });
  if (!VISOES_INDICADOR_ORCAMENTARIO.includes(x.visao))
    f.push({ campo: 'visao', mensagem: 'Escolha a visão: mensal, acumulada ou média.' });
  if (!PROJECOES_INDICADOR_ORCAMENTARIO.includes(x.tipoProjecao))
    f.push({ campo: 'tipoProjecao', mensagem: 'Escolha a forma de projeção.' });
  const m = x.mesesProjecao;
  if (m !== null && (!Number.isInteger(m) || m < 1 || m > 36))
    f.push({ campo: 'mesesProjecao', mensagem: 'Os meses da projeção vão de 1 a 36.' });
  if ((x.tipoProjecao === 'media' || x.tipoProjecao === 'tendencia') && m === null)
    f.push({ campo: 'mesesProjecao', mensagem: 'Informe quantos meses do realizado entram na projeção.' });
  if (x.tipoProjecao === 'tendencia' && m !== null && m < 2)
    f.push({ campo: 'mesesProjecao', mensagem: 'A tendência precisa de pelo menos 2 meses do realizado.' });
  if (x.tipoProjecao !== 'nenhuma' && x.tipoDadoId === null)
    f.push({
      campo: 'tipoDadoId',
      mensagem: 'A projeção vem do realizado: ligue o indicador a um dado estatístico.',
    });
  if (!vazio(x.unidade) && (x.unidade ?? '').trim().length > 30)
    f.push({ campo: 'unidade', mensagem: 'A unidade tem até 30 caracteres.' });
  if ((x.observacao ?? '').trim().length > 2000)
    f.push({ campo: 'observacao', mensagem: 'A observação tem até 2.000 caracteres.' });
  return f;
}

// ── Competência ───────────────────────────────────────────────────────────────────────────────────────────────────────

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/u;

/** AAAA-MM somado de n meses (n pode ser negativo). */
export function somarMeses(competencia: string, n: number): string {
  const m = COMPETENCIA.exec(competencia);
  if (!m) throw new Error(`competência inválida: ${competencia}`);
  const total = Number(m[1]) * 12 + Number(m[2]) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** As competências (AAAA-MM) da vigência, do início ao fim, inclusive. */
export function mesesDaVigencia(inicio: string, fim: string): string[] {
  const r: string[] = [];
  if (!COMPETENCIA.test(inicio) || !COMPETENCIA.test(fim) || fim < inicio) return r;
  for (let c = inicio; c <= fim && r.length < 120; c = somarMeses(c, 1)) r.push(c);
  return r;
}

export interface CelulaEstatisticaEntrada {
  readonly competencia: string;
  /** Quantidade orçada em centésimos; null retira a célula (lógico, nunca apaga). */
  readonly quantidadeCent: number | null;
  readonly projetadaCent: number | null;
}

/** As falhas da linha (indicador × setor) a gravar, contra a vigência da versão. */
export function validarCelulasEstatisticas(
  celulas: readonly CelulaEstatisticaEntrada[],
  vigencia: { readonly inicio: string; readonly fim: string },
): FalhaCampoOrcamento[] {
  const f: FalhaCampoOrcamento[] = [];
  if (celulas.length === 0) f.push({ campo: 'celulas', mensagem: 'Nenhum mês para gravar.' });
  const vistos = new Set<string>();
  for (const c of celulas) {
    const campo = `celulas.${c.competencia}`;
    if (!COMPETENCIA.test(c.competencia)) {
      f.push({ campo, mensagem: 'Mês inválido (use AAAA-MM).' });
      continue;
    }
    if (vistos.has(c.competencia)) f.push({ campo, mensagem: 'O mês aparece duas vezes.' });
    vistos.add(c.competencia);
    if (c.competencia < vigencia.inicio || c.competencia > vigencia.fim)
      f.push({ campo, mensagem: 'O mês está fora da vigência da versão.' });
    for (const [v, nome] of [
      [c.quantidadeCent, 'A quantidade'],
      [c.projetadaCent, 'A projeção'],
    ] as const)
      if (v !== null && (!Number.isSafeInteger(v) || v < 0 || v > TETO_QUANTIDADE_CENT))
        f.push({ campo, mensagem: `${nome} vai de zero a 10 bilhões, com até 2 casas.` });
  }
  return f;
}

/** Lê a quantidade digitada ("1.234,5", "1234,56", "1234", vazio = null) em centésimos, sem ponto flutuante. */
export function lerQuantidade(texto: string): number | null | 'invalida' {
  const s = texto.trim();
  if (s === '') return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/u.test(s) && !/^\d+(,\d{1,2})?$/u.test(s)) return 'invalida';
  const [i = '0', fr = ''] = s.split(',');
  const inteiro = i.replace(/\./gu, '');
  if (inteiro.length > 11) return 'invalida';
  const v = Number(inteiro) * 100 + Number(fr.padEnd(2, '0'));
  return v <= TETO_QUANTIDADE_CENT ? v : 'invalida';
}

/** 123456 → "1.234,56"; inteiro sem casas ("1.200"). */
export function quantidadeTexto(cent: number): string {
  const abs = Math.abs(Math.trunc(cent));
  const inteiro = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const resto = abs % 100;
  return `${cent < 0 ? '-' : ''}${inteiro}${resto ? `,${String(resto).padStart(2, '0')}` : ''}`;
}

// ── Projeção a partir do realizado ───────────────────────────────────────────────────────────────────────────────────

export interface RealizadoMes {
  readonly competencia: string;
  readonly cent: number;
}

/**
 * A projeção dos meses alvo a partir do realizado anterior ao primeiro deles (o que já aconteceu):
 *   - media: a média dos últimos `meses` com realizado; ultimo_mes: o último realizado;
 *   - tendencia: a reta dos mínimos quadrados sobre os últimos `meses`, estendida até o mês alvo (nunca negativa);
 *   - mesmo_mes_ano_anterior: o realizado do mesmo mês, 12 meses antes (quando houver).
 * Devolve null no mês sem base; 'nenhuma' devolve tudo null.
 */
export function projetarQuantidades(
  tipo: ProjecaoIndicadorOrcamentario,
  realizado: readonly RealizadoMes[],
  alvo: readonly string[],
  meses: number | null,
): Map<string, number | null> {
  const r = new Map<string, number | null>(alvo.map((c) => [c, null]));
  if (tipo === 'nenhuma' || alvo.length === 0) return r;
  const primeiro = [...alvo].sort()[0]!;
  const porMes = new Map<string, number>();
  for (const x of realizado) porMes.set(x.competencia, (porMes.get(x.competencia) ?? 0) + x.cent);
  const anteriores = [...porMes].filter(([c]) => c < primeiro).sort((a, b) => a[0].localeCompare(b[0]));
  const n = Math.max(1, Math.min(36, meses ?? 12));
  const base = anteriores.slice(-n);
  if (tipo === 'mesmo_mes_ano_anterior') {
    for (const c of alvo) {
      const v = porMes.get(somarMeses(c, -12));
      r.set(c, v === undefined ? null : v);
    }
    return r;
  }
  if (base.length === 0) return r;
  if (tipo === 'ultimo_mes') {
    for (const c of alvo) r.set(c, base[base.length - 1]![1]);
    return r;
  }
  if (tipo === 'media') {
    const m = Math.round(base.reduce((s, [, v]) => s + v, 0) / base.length);
    for (const c of alvo) r.set(c, m);
    return r;
  }
  // tendência: x = distância em meses ao primeiro mês da base.
  if (base.length < 2) {
    for (const c of alvo) r.set(c, base[0]![1]);
    return r;
  }
  const x0 = base[0]![0];
  const dist = (c: string) => {
    const [a, m] = c.split('-').map(Number) as [number, number];
    const [a0, m0] = x0.split('-').map(Number) as [number, number];
    return (a - a0) * 12 + (m - m0);
  };
  const xs = base.map(([c]) => dist(c));
  const ys = base.map(([, v]) => v);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  for (const c of alvo) r.set(c, Math.max(0, Math.round(my + b * (dist(c) - mx))));
  return r;
}

// ── Painel dos indicadores orçado × realizado ────────────────────────────────────────────────────────────────────────

export interface IndicadorDoPainel {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly unidade: string | null;
  readonly visao: VisaoIndicadorOrcamentario;
  readonly grupo: { readonly id: number; readonly codigo: string; readonly descricao: string } | null;
}

export interface CelulaDoPainel {
  readonly indicadorId: number;
  readonly centroId: number;
  readonly competencia: string;
  readonly orcadoCent: number;
  /** Realizado do mês (null: sem estatística apurada no mês). */
  readonly realizadoCent: number | null;
}

export type SituacaoIndicadorOrcamentario = 'acima' | 'abaixo' | 'no_orcado' | 'sem_realizado' | 'sem_orcado';

export interface ValorIndicadorOrcamentario {
  readonly orcadoCent: number;
  readonly realizadoCent: number | null;
  readonly desvioCent: number | null;
  /** Realizado ÷ orçado em décimos de ponto percentual (1234 = 123,4%); null sem base. */
  readonly atingimentoDecimos: number | null;
  readonly situacao: SituacaoIndicadorOrcamentario;
}

export interface LinhaPainelIndicador extends ValorIndicadorOrcamentario {
  readonly indicador: IndicadorDoPainel;
  /** O orçado do período inteiro (até `ate`), inclusive os meses ainda sem apuração; não entra na comparação. */
  readonly orcadoPeriodoCent: number;
  readonly porSetor: (ValorIndicadorOrcamentario & {
    readonly centroId: number;
    readonly orcadoPeriodoCent: number;
  })[];
  /** A conta impressa: o total com as parcelas por setor. */
  readonly conta: string;
}

export interface GrupoPainelIndicador {
  readonly grupo: IndicadorDoPainel['grupo'];
  readonly indicadores: LinhaPainelIndicador[];
}

/** Tolerância do "no orçado": até 2% de desvio para cima ou para baixo (20 décimos). */
const TOLERANCIA_DECIMOS = 20;

function valor(orc: number, real: number | null, temOrcado: boolean): ValorIndicadorOrcamentario {
  if (!temOrcado)
    return {
      orcadoCent: 0,
      realizadoCent: real,
      desvioCent: null,
      atingimentoDecimos: null,
      situacao: 'sem_orcado',
    };
  if (real === null)
    return {
      orcadoCent: orc,
      realizadoCent: null,
      desvioCent: null,
      atingimentoDecimos: null,
      situacao: 'sem_realizado',
    };
  const ating = orc === 0 ? null : Math.round((real * 1000) / orc);
  const situacao: SituacaoIndicadorOrcamentario =
    ating === null
      ? real === 0
        ? 'no_orcado'
        : 'acima'
      : Math.abs(ating - 1000) <= TOLERANCIA_DECIMOS
        ? 'no_orcado'
        : ating > 1000
          ? 'acima'
          : 'abaixo';
  return {
    orcadoCent: orc,
    realizadoCent: real,
    desvioCent: real - orc,
    atingimentoDecimos: ating,
    situacao,
  };
}

/**
 * Consolida a célula do setor no período pela visão do indicador, até a competência `ate` (inclusive):
 * mensal = só o mês `ate`; acumulado = a soma do primeiro mês até `ate`; media = a média dos meses com orçado.
 * A comparação é justa: havendo algum mês apurado, o orçado comparado (`orc`) é só o dos meses com realizado,
 * para que um mês ainda não apurado não entre como zero e puxe o indicador para "abaixo". O orçado do período
 * inteiro segue visível em `orcPeriodo`. Sem nenhum mês apurado, `orc` é o do período (situação sem realizado).
 */
function consolidar(
  visao: VisaoIndicadorOrcamentario,
  cs: readonly CelulaDoPainel[],
  ate: string,
): { orc: number; orcPeriodo: number; real: number | null; tem: boolean } {
  const doPeriodo = cs.filter((c) => (visao === 'mensal' ? c.competencia === ate : c.competencia <= ate));
  if (doPeriodo.length === 0) return { orc: 0, orcPeriodo: 0, real: null, tem: false };
  const soma = (xs: readonly CelulaDoPainel[], f: (c: CelulaDoPainel) => number) =>
    xs.reduce((s, c) => s + f(c), 0);
  const comReal = doPeriodo.filter((c) => c.realizadoCent !== null);
  const orcPeriodoSoma = soma(doPeriodo, (c) => c.orcadoCent);
  if (comReal.length === 0) {
    const o = visao === 'media' ? Math.round(orcPeriodoSoma / doPeriodo.length) : orcPeriodoSoma;
    return { orc: o, orcPeriodo: o, real: null, tem: true };
  }
  const orcComparavel = soma(comReal, (c) => c.orcadoCent);
  const real = soma(comReal, (c) => c.realizadoCent ?? 0);
  if (visao !== 'media') return { orc: orcComparavel, orcPeriodo: orcPeriodoSoma, real, tem: true };
  return {
    orc: Math.round(orcComparavel / comReal.length),
    orcPeriodo: Math.round(orcPeriodoSoma / doPeriodo.length),
    real: Math.round(real / comReal.length),
    tem: true,
  };
}

/** O painel por grupo: cada indicador ativo com o total da rede de setores e as parcelas por setor. */
export function montarPainelIndicadores(
  indicadores: readonly IndicadorDoPainel[],
  celulas: readonly CelulaDoPainel[],
  ate: string,
  nomeSetor: (id: number) => string = (id) => `setor ${id}`,
): GrupoPainelIndicador[] {
  const grupos = new Map<string, GrupoPainelIndicador>();
  const ordenados = [...indicadores].sort(
    (a, b) =>
      (a.grupo?.codigo ?? '￿').localeCompare(b.grupo?.codigo ?? '￿') || a.codigo.localeCompare(b.codigo),
  );
  for (const ind of ordenados) {
    const doInd = celulas.filter((c) => c.indicadorId === ind.id);
    const setores = [...new Set(doInd.map((c) => c.centroId))].sort((a, b) => a - b);
    const porSetor = setores.map((centroId) => {
      const k = consolidar(
        ind.visao,
        doInd.filter((c) => c.centroId === centroId),
        ate,
      );
      return { centroId, ...valor(k.orc, k.real, k.tem), orcadoPeriodoCent: k.orcPeriodo };
    });
    const comOrcado = porSetor.filter((s) => s.situacao !== 'sem_orcado');
    const reais = comOrcado.filter((s) => s.realizadoCent !== null);
    // A comparação do total usa só os setores apurados; sem nenhum, o orçado de todos (sem realizado).
    const comparados = reais.length > 0 ? reais : comOrcado;
    const orc = comparados.reduce((s, x) => s + x.orcadoCent, 0);
    const orcPeriodo = comOrcado.reduce((s, x) => s + x.orcadoPeriodoCent, 0);
    const real = reais.length === 0 ? null : reais.reduce((s, x) => s + (x.realizadoCent ?? 0), 0);
    const total = valor(orc, real, comOrcado.length > 0);
    const parcelas = comparados.map((s) => `${nomeSetor(s.centroId)} ${quantidadeTexto(s.orcadoCent)}`);
    const conta =
      comOrcado.length === 0
        ? 'sem orçado no período'
        : `orçado ${quantidadeTexto(orc)} = ${parcelas.join(' + ')}` +
          (real === null
            ? '; sem realizado'
            : `; realizado ${quantidadeTexto(real)} = ${reais
                .map((s) => `${nomeSetor(s.centroId)} ${quantidadeTexto(s.realizadoCent ?? 0)}`)
                .join(' + ')}`) +
          (orcPeriodo !== orc
            ? `; comparado só nos meses apurados (orçado do período ${quantidadeTexto(orcPeriodo)} = ${comOrcado
                .map((s) => `${nomeSetor(s.centroId)} ${quantidadeTexto(s.orcadoPeriodoCent)}`)
                .join(' + ')})`
            : '');
    const chave = ind.grupo ? String(ind.grupo.id) : '-';
    const g = grupos.get(chave) ?? { grupo: ind.grupo, indicadores: [] };
    g.indicadores.push({ indicador: ind, ...total, orcadoPeriodoCent: orcPeriodo, porSetor, conta });
    grupos.set(chave, g);
  }
  return [...grupos.values()];
}
