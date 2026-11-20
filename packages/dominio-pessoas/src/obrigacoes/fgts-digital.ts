// Apuração do FGTS Digital da competência (M53-F7; ficha do M53, seções 1 e 8; Lei 8.036/1990 arts. 15 e 18; Lei
// 14.438/2022): por trabalhador, a base e o depósito do FGTS dos processamentos da folha da competência (folha mensal,
// recibos de férias e rescisões; as parcelas do 13º à parte) e o FGTS rescisório (a multa depositada na conta
// vinculada). Os valores são os do cálculo (as linhas `baseFgts`, `fgts` e `multaFgts`), nunca recalculados aqui. O FGTS
// Digital monta a guia a partir dos eventos do eSocial: a apuração confere que cada trabalhador com base tem o evento
// aceito (S-1200 da remuneração; S-2299 da rescisão; o 13º final no S-1200 anual) e a conciliação confere a guia (GFD)
// emitida no portal com o apurado mais os acréscimos informados. Nenhum CPF nem nome.
//
// D-DECIMO1-FGTS-538 (POL-5): a 1ª parcela do 13º não vira demonstrativo do S-1200 mensal (D-DECIMO1-537), então o
// FGTS dela não aparece no FGTS Digital da competência do pagamento: a apuração soma o valor (o cálculo o fez) e marca o
// trabalhador como `nao-se-aplica` no eSocial dessa parcela, com o aviso `decimo-em-aberto` enquanto o anual não fecha.
import type {
  ConferenciaObrigacao,
  PapelLinhaFolha,
  TipoProcessoFolha,
  TotaisObrigacao,
  TrabalhadorApuracaoFgts,
} from '@sgh/contratos';

export interface ProcessoParaObrigacao {
  readonly id: number;
  readonly tipo: TipoProcessoFolha;
  readonly competencia: string;
}

export interface ResumoParaObrigacao {
  readonly vinculo: number;
  readonly porPapel: Readonly<Partial<Record<PapelLinhaFolha, number>>>;
}

export interface VinculoParaObrigacao {
  readonly vinculo: number;
  readonly matricula: string | null;
  /** A categoria do trabalhador no eSocial (a ficha); null sem ficha. */
  readonly categoria: string | null;
  readonly admissao: string;
  readonly desligamento: string | null;
}

/** O evento do eSocial do trabalhador no período (só o necessário para a conferência). */
export interface EventoParaFgts {
  readonly vinculo: number | null;
  readonly evento: string;
  readonly situacao: string;
  readonly dataReferencia: string;
}

const DECIMO: readonly TipoProcessoFolha[] = ['decimo1', 'decimo2'];
const ACEITO = 'aceito';
const DESCARTADOS = ['descartado', 'rejeitado', 'cancelado', 'substituido'];

/** Os eventos que cada tipo de processamento pede ao eSocial (e a data de referência deles). */
function eventoEsperado(
  tipo: TipoProcessoFolha,
  competencia: string,
): { evento: string; referencia: (d: string) => boolean } | null {
  switch (tipo) {
    case 'mensal':
    case 'ferias':
      return { evento: 'S-1200', referencia: (d) => d === competencia };
    case 'decimo2':
      return { evento: 'S-1200', referencia: (d) => d === competencia.slice(0, 4) };
    case 'rescisao':
      return { evento: 'S-2299', referencia: (d) => d.slice(0, 7) === competencia };
    default:
      return null;
  }
}

function situacaoEsocial(
  vinculo: number,
  tipos: ReadonlySet<TipoProcessoFolha>,
  competencia: string,
  eventos: readonly EventoParaFgts[],
): TrabalhadorApuracaoFgts['esocial'] {
  const esperados = [...tipos]
    .map((t) => eventoEsperado(t, competencia))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (!esperados.length) return 'nao-se-aplica';
  let andamento = false;
  for (const e of esperados) {
    const doVinculo = eventos.filter(
      (x) =>
        x.vinculo === vinculo &&
        x.evento === e.evento &&
        e.referencia(x.dataReferencia) &&
        !DESCARTADOS.includes(x.situacao),
    );
    if (!doVinculo.length) return 'sem-evento';
    if (!doVinculo.some((x) => x.situacao === ACEITO)) andamento = true;
  }
  return andamento ? 'em-andamento' : 'aceito';
}

const v = (r: ResumoParaObrigacao, p: PapelLinhaFolha) => r.porPapel[p] ?? 0;

export interface ApuracaoFgts {
  readonly trabalhadores: readonly TrabalhadorApuracaoFgts[];
  readonly totais: TotaisObrigacao;
}

/**
 * Soma por trabalhador os processamentos da competência. `resumos` traz, por processamento, o resumo de cada vínculo
 * (o do cálculo). Trabalhador sem base nem depósito não entra.
 */
export function apurarFgts(
  competencia: string,
  processos: readonly ProcessoParaObrigacao[],
  resumos: ReadonlyMap<number, readonly ResumoParaObrigacao[]>,
  vinculos: ReadonlyMap<number, VinculoParaObrigacao>,
  eventos: readonly EventoParaFgts[],
): ApuracaoFgts {
  interface Acc {
    baseFgts: number;
    fgts: number;
    baseDecimo: number;
    fgtsDecimo: number;
    rescisorio: number;
    processos: Set<number>;
    tipos: Set<TipoProcessoFolha>;
  }
  const por = new Map<number, Acc>();
  for (const p of processos.filter((x) => x.competencia === competencia)) {
    for (const r of resumos.get(p.id) ?? []) {
      const a = por.get(r.vinculo) ?? {
        baseFgts: 0,
        fgts: 0,
        baseDecimo: 0,
        fgtsDecimo: 0,
        rescisorio: 0,
        processos: new Set<number>(),
        tipos: new Set<TipoProcessoFolha>(),
      };
      if (DECIMO.includes(p.tipo)) {
        a.baseDecimo += v(r, 'baseFgts');
        a.fgtsDecimo += v(r, 'fgts');
      } else {
        a.baseFgts += v(r, 'baseFgts');
        a.fgts += v(r, 'fgts');
      }
      a.rescisorio += v(r, 'multaFgts');
      a.processos.add(p.id);
      a.tipos.add(p.tipo);
      por.set(r.vinculo, a);
    }
  }
  const trabalhadores: TrabalhadorApuracaoFgts[] = [];
  for (const [vinculo, a] of [...por].sort((x, y) => x[0] - y[0])) {
    if (a.baseFgts + a.fgts + a.baseDecimo + a.fgtsDecimo + a.rescisorio === 0) continue;
    const vin = vinculos.get(vinculo);
    trabalhadores.push({
      vinculo,
      matricula: vin?.matricula ?? null,
      categoria: vin?.categoria ?? null,
      baseFgts: a.baseFgts,
      fgts: a.fgts,
      baseDecimo: a.baseDecimo,
      fgtsDecimo: a.fgtsDecimo,
      rescisorio: a.rescisorio,
      processos: [...a.processos].sort((x, y) => x - y),
      esocial: situacaoEsocial(vinculo, a.tipos, competencia, eventos),
    });
  }
  const soma = (f: (t: TrabalhadorApuracaoFgts) => number) => trabalhadores.reduce((s, t) => s + f(t), 0);
  const noMes = (d: string | null | undefined) => !!d && d.slice(0, 7) === competencia;
  const vs = [...vinculos.values()];
  return {
    trabalhadores,
    totais: {
      trabalhadores: trabalhadores.length,
      remuneracao: soma((t) => t.baseFgts),
      remuneracaoDecimo: soma((t) => t.baseDecimo),
      baseFgts: soma((t) => t.baseFgts + t.baseDecimo),
      fgts: soma((t) => t.fgts + t.fgtsDecimo),
      rescisorio: soma((t) => t.rescisorio),
      admissoes: vs.filter((x) => noMes(x.admissao)).length,
      desligamentos: vs.filter((x) => noMes(x.desligamento)).length,
    },
  };
}

/** O total que a guia do FGTS Digital da competência deve trazer (sem acréscimos): depósitos + rescisório. */
export const totalDaGuiaFgts = (t: TotaisObrigacao): number => t.fgts + t.rescisorio;

const rotuloTrabalhador = (t: TrabalhadorApuracaoFgts) =>
  `Vínculo ${t.vinculo}${t.matricula ? ` (matrícula ${t.matricula})` : ''}`;

/**
 * Prova da soma da apuração: cada trabalhador (FGTS do mês + 13º + rescisório) e o total; confere também o FGTS
 * mensal com o total gravado no fechamento da folha (quando informado), que soma os mesmos processamentos.
 */
export function conferirApuracaoFgts(a: ApuracaoFgts, fgtsDoFechamento: number | null): ConferenciaObrigacao {
  const parcelas = a.trabalhadores.map((t) => ({
    rotulo: rotuloTrabalhador(t),
    valor: t.fgts + t.fgtsDecimo + t.rescisorio,
  }));
  const somaParcelas = parcelas.reduce((s, p) => s + p.valor, 0);
  const total = totalDaGuiaFgts(a.totais);
  parcelas.push({ rotulo: 'Total (depósitos + rescisório)', valor: total });
  const divergencias: string[] = [];
  if (somaParcelas !== total)
    divergencias.push(`A soma dos trabalhadores (${somaParcelas}) difere do total (${total}).`);
  if (fgtsDoFechamento !== null) {
    const mensal = a.trabalhadores.reduce((s, t) => s + t.fgts, 0);
    if (mensal !== fgtsDoFechamento)
      divergencias.push(
        `O FGTS do mês dos trabalhadores (${mensal}) difere do FGTS do fechamento da folha (${fgtsDoFechamento}).`,
      );
  }
  return { ok: divergencias.length === 0, parcelas, divergencias };
}

/**
 * Conciliação da guia do FGTS Digital: a guia emitida no portal tem de ser o apurado (depósitos + rescisório) mais os
 * acréscimos informados (juros e multa de atraso). Parcelas impressas; centavo a centavo.
 */
export function conciliarGuiaFgts(
  t: TotaisObrigacao,
  valorGuia: number,
  acrescimos: number,
): ConferenciaObrigacao {
  const esperado = totalDaGuiaFgts(t) + acrescimos;
  const parcelas = [
    { rotulo: 'FGTS mensal e do 13º', valor: t.fgts },
    { rotulo: 'FGTS rescisório', valor: t.rescisorio },
    { rotulo: 'Acréscimos informados', valor: acrescimos },
    { rotulo: 'Total esperado da guia', valor: esperado },
    { rotulo: 'Valor da guia emitida', valor: valorGuia },
  ];
  const divergencias =
    esperado === valorGuia
      ? []
      : [`A guia (${valorGuia}) difere do esperado (${esperado}) em ${valorGuia - esperado} centavos.`];
  return { ok: divergencias.length === 0, parcelas, divergencias };
}

/** Os vínculos com base de FGTS sem o evento aceito no eSocial (a pendência que barra a geração). */
export const semEventoAceito = (ts: readonly TrabalhadorApuracaoFgts[]): number[] =>
  ts.filter((t) => t.esocial === 'sem-evento' || t.esocial === 'em-andamento').map((t) => t.vinculo);
