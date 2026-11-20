// Estatísticas de custeio (M54-F4; ficha, seções 4 e 6): a coleta do mês a partir das fontes do banco, agregadas no
// banco por centro de custo do movimento (nenhuma linha de paciente chega aqui), e a matriz centro × estatística da
// competência, em que o lançamento manual prevalece sobre o coletado e a estatística de referência (CTTIPODADO 2: por
// exemplo a área) vale nas competências seguintes até ser trocada. As quantidades andam em centésimos (inteiros).
import {
  type CodigoEstatistica,
  definicaoEstatistica,
  type FonteEstatistica,
  type LinhaMatrizEstatisticas,
  type MatrizEstatisticas,
  type OrigemEstatistica,
  type ResumoFonteColeta,
  TIPOS_DADO_ESTATISTICA,
  type TipoDadoEstatistica,
  type ValorEstatistica,
} from '@sgh/contratos';

// ── Competência ───────────────────────────────────────────────────────────────────────────────────────────────────────

const p2 = (n: number) => String(n).padStart(2, '0');

/** Primeiro e último dia, o primeiro dia do mês seguinte e a quantidade de dias da competência AAAA-MM. */
export function intervaloDaCompetencia(competencia: string): {
  inicio: string;
  fim: string;
  seguinte: string;
  dias: number;
} {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  const ano = Number(m?.[1]);
  const mes = Number(m?.[2]);
  if (!m || mes < 1 || mes > 12) throw new Error(`Competência inválida: ${competencia}.`);
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const [as, ms] = mes === 12 ? [ano + 1, 1] : [ano, mes + 1];
  return {
    inicio: `${ano}-${p2(mes)}-01`,
    fim: `${ano}-${p2(mes)}-${p2(dias)}`,
    seguinte: `${as}-${p2(ms)}-01`,
    dias,
  };
}

/** A competência ainda não começou (a coleta de um mês futuro é recusada). */
export function competenciaFutura(competencia: string, hoje: string): boolean {
  return competencia > hoje.slice(0, 7);
}

// ── Quantidades ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const centesimos = (v: number): number => Math.round(v * 100);
export const deCentesimos = (c: number): number => c / 100;

/** Duração HHMM (como a cirurgia grava) em minutos; null quando o texto não é uma duração. */
export function duracaoEmMinutos(hhmm: string | null): number | null {
  const m = /^(\d{2})(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm > 59) return null;
  return Number(m[1]) * 60 + mm;
}

// ── Coleta ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Um grupo agregado no banco: o código do centro de custo do movimento (TBCENCUS.COD) e a quantidade. */
export interface GrupoPorCodigo {
  readonly cdc: number | null;
  readonly quantidade: number;
}

export interface FontesLidas {
  /** Censo diário fechado no mês: internados somados por centro da acomodação, e os dias com censo fechado. */
  readonly censo: { readonly grupos: readonly GrupoPorCodigo[]; readonly diasFechados: number };
  /** Paciente-dia estimado pelas internações que tocam o mês (dia da entrada conta, o da alta não). */
  readonly internacoes: readonly GrupoPorCodigo[];
  /** Cirurgias do mês pelo centro da sala, agrupadas pela duração gravada (HHMM). */
  readonly cirurgias: readonly {
    readonly cdc: number | null;
    readonly duracao: string | null;
    readonly n: number;
  }[];
  readonly exames: readonly GrupoPorCodigo[];
  readonly requisicoes: readonly GrupoPorCodigo[];
  /** Colaboradores com vínculo no mês, já pelo TBCENCUS.ID da lotação (o cadastro de pessoas guarda o ID). */
  readonly colaboradores: readonly { readonly centro: number; readonly n: number; readonly horas: number }[];
  readonly leitos: readonly GrupoPorCodigo[];
}

export interface CentroDaColeta {
  readonly id: number;
  readonly codigo: number;
}

export interface LinhaColetada {
  readonly centro: number;
  readonly codigo: CodigoEstatistica;
  readonly cent: number;
  readonly fonte: FonteEstatistica;
  readonly estimada: boolean;
  readonly tipoDado: TipoDadoEstatistica;
}

export interface PlanoColeta {
  readonly linhas: readonly LinhaColetada[];
  readonly fontes: readonly ResumoFonteColeta[];
}

function tipoDe(codigo: CodigoEstatistica): TipoDadoEstatistica {
  return definicaoEstatistica(codigo)?.tipoDado ?? TIPOS_DADO_ESTATISTICA.lancamento;
}

/** Soma os grupos por centro (pelo código do movimento), contando os que não acham centro no cadastro. */
function porCentro(
  grupos: readonly { cdc: number | null; cent: number }[],
  idDoCodigo: ReadonlyMap<number, number>,
): { valores: Map<number, number>; semCentro: number } {
  const valores = new Map<number, number>();
  let semCentro = 0;
  for (const g of grupos) {
    const id = g.cdc === null ? undefined : idDoCodigo.get(g.cdc);
    if (id === undefined) {
      if (g.cent > 0) semCentro += 1;
      continue;
    }
    valores.set(id, (valores.get(id) ?? 0) + g.cent);
  }
  return { valores, semCentro };
}

/**
 * Monta a coleta da competência a partir das fontes lidas: uma linha por centro e estatística com quantidade
 * positiva, e o resumo de cada fonte. O paciente-dia vem do censo quando o censo foi fechado em todos os dias do mês;
 * senão, é estimado pelas internações (marcado como estimado, com o aviso).
 */
export function planejarColeta(
  fontes: FontesLidas,
  centros: readonly CentroDaColeta[],
  diasDoMes: number,
): PlanoColeta {
  const idDoCodigo = new Map(centros.map((c) => [c.codigo, c.id]));
  const ids = new Set(centros.map((c) => c.id));
  const linhas: LinhaColetada[] = [];
  const resumo: ResumoFonteColeta[] = [];
  const emitir = (
    fonte: FonteEstatistica,
    codigos: readonly { codigo: CodigoEstatistica; valores: Map<number, number> }[],
    grupos: number,
    semCentro: number,
    estimada: boolean,
    aviso: string | null,
  ) => {
    const centrosComValor = new Set<number>();
    for (const { codigo, valores } of codigos)
      for (const [centro, cent] of [...valores].sort((a, b) => a[0] - b[0])) {
        if (cent <= 0) continue;
        centrosComValor.add(centro);
        linhas.push({ centro, codigo, cent, fonte, estimada, tipoDado: tipoDe(codigo) });
      }
    resumo.push({ fonte, grupos, centros: centrosComValor.size, semCentro, estimada, aviso });
  };
  const simples = (gs: readonly GrupoPorCodigo[]) =>
    gs.map((g) => ({ cdc: g.cdc, cent: centesimos(g.quantidade) }));

  // Paciente-dia: censo completo ou estimativa.
  const censoCompleto = fontes.censo.diasFechados >= diasDoMes;
  if (censoCompleto) {
    const x = porCentro(simples(fontes.censo.grupos), idDoCodigo);
    emitir(
      'censo',
      [{ codigo: 'pacienteDia', valores: x.valores }],
      fontes.censo.grupos.length,
      x.semCentro,
      false,
      null,
    );
  } else {
    const x = porCentro(simples(fontes.internacoes), idDoCodigo);
    emitir(
      'internacoes',
      [{ codigo: 'pacienteDia', valores: x.valores }],
      fontes.internacoes.length,
      x.semCentro,
      true,
      `Censo diário fechado em ${fontes.censo.diasFechados} de ${diasDoMes} dias: paciente-dia estimado pelas internações do período.`,
    );
  }

  // Cirurgias: horas de sala (pela duração gravada) e quantidade.
  let invalidas = 0;
  const minutos: { cdc: number | null; cent: number }[] = [];
  const qtd: { cdc: number | null; cent: number }[] = [];
  for (const g of fontes.cirurgias) {
    qtd.push({ cdc: g.cdc, cent: centesimos(g.n) });
    const m = duracaoEmMinutos(g.duracao);
    if (m === null) {
      invalidas += g.n;
      continue;
    }
    minutos.push({ cdc: g.cdc, cent: m * g.n });
  }
  const horas = porCentro(minutos, idDoCodigo);
  for (const [id, min] of horas.valores) horas.valores.set(id, Math.round((min * 100) / 60));
  const cir = porCentro(qtd, idDoCodigo);
  emitir(
    'cirurgias',
    [
      { codigo: 'horasSala', valores: horas.valores },
      { codigo: 'cirurgias', valores: cir.valores },
    ],
    fontes.cirurgias.length,
    cir.semCentro,
    false,
    invalidas > 0 ? `${invalidas} cirurgia(s) sem duração válida ficaram fora das horas de sala.` : null,
  );

  const ex = porCentro(simples(fontes.exames), idDoCodigo);
  emitir(
    'exames',
    [{ codigo: 'exames', valores: ex.valores }],
    fontes.exames.length,
    ex.semCentro,
    false,
    null,
  );

  const rq = porCentro(simples(fontes.requisicoes), idDoCodigo);
  emitir(
    'requisicoes',
    [{ codigo: 'requisicoes', valores: rq.valores }],
    fontes.requisicoes.length,
    rq.semCentro,
    false,
    null,
  );

  const colab = new Map<number, number>();
  const horasContr = new Map<number, number>();
  let colabSem = 0;
  for (const g of fontes.colaboradores) {
    if (!ids.has(g.centro)) {
      colabSem += 1;
      continue;
    }
    colab.set(g.centro, (colab.get(g.centro) ?? 0) + centesimos(g.n));
    horasContr.set(g.centro, (horasContr.get(g.centro) ?? 0) + centesimos(g.horas));
  }
  emitir(
    'colaboradores',
    [
      { codigo: 'colaboradores', valores: colab },
      { codigo: 'horasContratadas', valores: horasContr },
    ],
    fontes.colaboradores.length,
    colabSem,
    false,
    fontes.colaboradores.length === 0
      ? 'Nenhum colaborador com vínculo no período no cadastro de pessoas.'
      : null,
  );

  const lt = porCentro(simples(fontes.leitos), idDoCodigo);
  emitir(
    'leitos',
    [{ codigo: 'leitos', valores: lt.valores }],
    fontes.leitos.length,
    lt.semCentro,
    false,
    null,
  );

  return { linhas, fontes: resumo };
}

// ── Matriz da competência ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RegistroParaMatriz {
  readonly id: number;
  readonly competencia: string;
  readonly centro: number;
  readonly codigo: string;
  readonly cent: number;
  readonly origem: OrigemEstatistica;
  readonly fonte: FonteEstatistica;
  readonly estimada: boolean;
  readonly tipoDado: TipoDadoEstatistica;
  readonly observacao: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
}

/** O mais recente primeiro (carimbo e ID). */
const maisRecente = (a: RegistroParaMatriz, b: RegistroParaMatriz) =>
  b.registradoEm.localeCompare(a.registradoEm) || b.id - a.id;

/**
 * A matriz centro × estatística da competência, com os registros vigentes: os da própria competência (o manual
 * prevalece sobre o coletado) e, para a estatística de referência sem valor na competência, o da competência anterior
 * mais recente (`herdadaDe`). Registros de competências posteriores e códigos fora do catálogo ficam fora.
 */
export function montarMatriz(
  competencia: string,
  registros: readonly RegistroParaMatriz[],
): Pick<MatrizEstatisticas, 'competencia' | 'linhas' | 'totais' | 'avisos'> {
  const escolhido = new Map<string, { r: RegistroParaMatriz; herdadaDe: string | null }>();
  const chave = (r: RegistroParaMatriz) => `${r.centro}|${r.codigo}`;
  const peso = (r: RegistroParaMatriz) => (r.origem === 'manual' ? 1 : 0);
  const daCompetencia = registros
    .filter((r) => r.competencia === competencia && definicaoEstatistica(r.codigo))
    .sort((a, b) => peso(b) - peso(a) || maisRecente(a, b));
  for (const r of daCompetencia)
    if (!escolhido.has(chave(r))) escolhido.set(chave(r), { r, herdadaDe: null });
  const anteriores = registros
    .filter(
      (r) =>
        r.competencia < competencia &&
        r.tipoDado === TIPOS_DADO_ESTATISTICA.referencia &&
        definicaoEstatistica(r.codigo)?.tipoDado === TIPOS_DADO_ESTATISTICA.referencia,
    )
    .sort((a, b) => b.competencia.localeCompare(a.competencia) || peso(b) - peso(a) || maisRecente(a, b));
  for (const r of anteriores)
    if (!escolhido.has(chave(r))) escolhido.set(chave(r), { r, herdadaDe: r.competencia });

  const porCentro = new Map<number, Partial<Record<CodigoEstatistica, ValorEstatistica>>>();
  const totaisCent = new Map<CodigoEstatistica, number>();
  let estimadas = 0;
  let herdadas = 0;
  for (const { r, herdadaDe } of escolhido.values()) {
    const codigo = r.codigo as CodigoEstatistica;
    const vs = porCentro.get(r.centro) ?? {};
    vs[codigo] = {
      id: r.id,
      quantidade: deCentesimos(r.cent),
      origem: r.origem,
      fonte: r.fonte,
      estimada: r.estimada,
      herdadaDe,
      observacao: r.observacao,
      registradoPor: r.registradoPor,
      registradoEm: r.registradoEm,
    };
    porCentro.set(r.centro, vs);
    totaisCent.set(codigo, (totaisCent.get(codigo) ?? 0) + r.cent);
    if (r.estimada) estimadas += 1;
    if (herdadaDe) herdadas += 1;
  }
  const linhas: LinhaMatrizEstatisticas[] = [...porCentro]
    .sort((a, b) => a[0] - b[0])
    .map(([centro, valores]) => ({ centro, valores }));
  const totais: Partial<Record<CodigoEstatistica, number>> = {};
  for (const [k, v] of [...totaisCent].sort((a, b) => a[0].localeCompare(b[0]))) totais[k] = deCentesimos(v);
  const avisos: string[] = [];
  if (escolhido.size === 0)
    avisos.push('Nenhuma estatística na competência: colete das fontes ou lance à mão.');
  if (estimadas > 0) avisos.push(`${estimadas} valor(es) estimado(s): confira antes da apuração do mês.`);
  if (herdadas > 0) avisos.push(`${herdadas} valor(es) de referência vindo(s) de competência anterior.`);
  return { competencia, linhas, totais, avisos };
}
