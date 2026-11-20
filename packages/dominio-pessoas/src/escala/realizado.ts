// Plantão realizado para o repasse, fatia F6 (M52.6; ficha, seção 5 "repasse.lancarEvento, cenário origem-plantao" e
// seção 14, DP-33): a coordenação registra o realizado de cada plantão da escala publicada (o horário real, sugerido
// pelas marcações do ponto quando houver), outra pessoa aprova (quatro olhos; ninguém aprova o próprio plantão) e o
// realizado aprovado do PRESTADOR (cooperado, PJ ou terceiro; nunca CLT) vai ao relatório do repasse com o valor pela
// tarifa por hora do tipo de plantão vigente no dia, com as parcelas escritas. O lançamento no repasse soma, por
// prestador e competência, os realizados aprovados ainda não lançados. Instantes em hora local de Brasília.
import { type TipoVinculo, VINCULOS_PRESTADOR } from '@sgh/contratos';
import { type RecusaSesmt, recusaSesmt } from '../sesmt/recusa.js';
import { instanteDeMinuto, minutoLocal } from './tempo.js';

/** Duração máxima de um realizado (o plantão de 24 h com a passagem e a prorrogação). */
export const REALIZADO_MAXIMO_MIN = 36 * 60;
/** Quanto o início real pode vir antes do previsto (chegada antecipada, troca de turno). */
export const ANTECIPACAO_MAXIMA_MIN = 6 * 60;

export type SituacaoRealizado = 'informado' | 'aprovado' | 'recusado' | 'substituido' | 'estornado';

export interface PlantaoDoRealizado {
  readonly inicio: string;
  readonly fim: string;
  readonly situacao: string;
  readonly estadoEscala: string;
}

export interface RealizadoLido {
  readonly id: number;
  readonly plantao: number;
  readonly pessoa: number;
  readonly inicio: string;
  readonly fim: string;
  readonly situacao: SituacaoRealizado;
  readonly informadoPor: string;
}

export interface EntradaRealizado {
  readonly inicio: string;
  readonly fim: string;
}

/** Os minutos do realizado. */
export function minutosRealizado(e: EntradaRealizado): number {
  return minutoLocal(e.fim) - minutoLocal(e.inicio);
}

/**
 * O realizado de um plantão: escala publicada, plantão previsto (não cancelado), fim depois do início e até 36 h,
 * início não mais que 6 h antes do previsto e não depois do fim previsto, fim nunca no futuro; um plantão tem no máximo
 * um realizado em vigor (o aprovado não é substituído) e o realizado não sobrepõe outro da mesma pessoa.
 */
export function conferirRealizado(
  e: EntradaRealizado,
  p: PlantaoDoRealizado,
  agora: string,
  doPlantao: readonly RealizadoLido[],
  daPessoa: readonly RealizadoLido[],
): RecusaSesmt | null {
  if (p.estadoEscala !== 'publicada')
    return recusaSesmt('escala-em-rascunho', 'O realizado é registrado na escala publicada.', 'plantao');
  if (p.situacao !== 'previsto')
    return recusaSesmt('plantao-cancelado', 'O plantão foi cancelado na escala.', 'plantao');
  const ini = minutoLocal(e.inicio);
  const fim = minutoLocal(e.fim);
  if (fim <= ini) return recusaSesmt('periodo-invalido', 'O fim real vem antes do início real.', 'fim');
  if (fim - ini > REALIZADO_MAXIMO_MIN)
    return recusaSesmt('periodo-longo', 'O realizado passa de 36 horas: confira os horários.', 'fim');
  if (fim > minutoLocal(agora))
    return recusaSesmt('fim-futuro', 'O fim real não pode ficar no futuro.', 'fim');
  if (ini < minutoLocal(p.inicio) - ANTECIPACAO_MAXIMA_MIN || ini >= minutoLocal(p.fim))
    return recusaSesmt(
      'fora-do-plantao',
      'O início real fica fora do plantão previsto (até 6 horas antes do início e antes do fim).',
      'inicio',
    );
  if (doPlantao.some((r) => r.situacao === 'aprovado'))
    return recusaSesmt('ja-aprovado', 'O realizado deste plantão já foi aprovado.', 'plantao');
  const plantoes = new Set(doPlantao.map((r) => r.plantao));
  const choque = daPessoa.find(
    (r) =>
      !plantoes.has(r.plantao) &&
      (r.situacao === 'informado' || r.situacao === 'aprovado') &&
      minutoLocal(r.inicio) < fim &&
      ini < minutoLocal(r.fim),
  );
  if (choque)
    return recusaSesmt(
      'sobreposicao-realizado',
      'O horário sobrepõe o realizado de outro plantão da mesma pessoa.',
      'inicio',
    );
  return null;
}

export interface DecisaoRealizado {
  readonly situacao: SituacaoRealizado;
  readonly informadoPor: string;
  /** O plantão é do próprio decisor (um dos vínculos do login). */
  readonly proprio: boolean;
}

/** Aprovar ou recusar: só o informado, por outra pessoa (quatro olhos), nunca no próprio plantão. */
export function conferirDecisaoRealizado(r: DecisaoRealizado, decisor: string): RecusaSesmt | null {
  if (r.situacao !== 'informado')
    return recusaSesmt('ja-decidido', 'O realizado já foi decidido ou substituído.', 'realizado');
  if (r.informadoPor === decisor)
    return recusaSesmt(
      'quatro-olhos',
      'Quem registrou o realizado não o aprova: outra pessoa da coordenação decide.',
      'realizado',
    );
  if (r.proprio)
    return recusaSesmt(
      'proprio-plantao',
      'O seu próprio plantão é aprovado por outra pessoa da coordenação.',
      'realizado',
    );
  return null;
}

export interface TarifaPlantaoLida {
  readonly id: number;
  readonly tipo: string;
  readonly unidade: number | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly valorHora: number;
}

/** A tarifa do tipo de plantão vigente no dia: a da unidade vence a geral; entre as do mesmo nível, a de início mais recente. */
export function tarifaVigente<T extends TarifaPlantaoLida>(
  tarifas: readonly T[],
  tipo: string,
  unidade: number | null,
  dia: string,
): T | null {
  const vale = tarifas.filter(
    (t) =>
      t.tipo === tipo &&
      t.inicio <= dia &&
      (t.fim === null || dia <= t.fim) &&
      (t.unidade === null || t.unidade === unidade),
  );
  vale.sort((a, b) =>
    (a.unidade === null) !== (b.unidade === null)
      ? a.unidade === null
        ? 1
        : -1
      : b.inicio.localeCompare(a.inicio),
  );
  return vale[0] ?? null;
}

/** Uma tarifa nova não se sobrepõe a outra do mesmo tipo e unidade; o fim vem depois do início; valor positivo. */
export function conferirTarifa(
  e: Omit<TarifaPlantaoLida, 'id'>,
  existentes: readonly TarifaPlantaoLida[],
): RecusaSesmt | null {
  if (!(e.valorHora > 0)) return recusaSesmt('valor-invalido', 'Informe o valor por hora.', 'valorHora');
  if (e.fim !== null && e.fim < e.inicio)
    return recusaSesmt('periodo-invalido', 'O fim da vigência vem antes do início.', 'fim');
  const choque = existentes.some(
    (t) =>
      t.tipo === e.tipo &&
      t.unidade === e.unidade &&
      t.inicio <= (e.fim ?? '9999-12-31') &&
      e.inicio <= (t.fim ?? '9999-12-31'),
  );
  if (choque)
    return recusaSesmt(
      'vigencia-sobreposta',
      'Já existe tarifa deste tipo e unidade no período: encerre a vigência anterior antes.',
      'inicio',
    );
  return null;
}

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) =>
  `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const horas = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
};

export interface ValorRealizado {
  readonly minutos: number;
  readonly valorHora: number;
  readonly valor: number;
  /** A conta escrita: "12 h 30 min × R$ 100,00/h = R$ 1.250,00". */
  readonly parcelas: string;
}

/** O valor do realizado: minutos × tarifa por hora ÷ 60, arredondado ao centavo, com a conta escrita. */
export function valorRealizado(minutos: number, valorHora: number): ValorRealizado {
  const valor = Math.round((minutos * centavos(valorHora)) / 60) / 100;
  return {
    minutos,
    valorHora,
    valor,
    parcelas: `${horas(minutos)} × ${reais(centavos(valorHora))}/h = ${reais(centavos(valor))}`,
  };
}

/** O aprovado que ficou sem valor (sem tarifa no dia da aprovação), com o tipo e a unidade do plantão. */
export interface RealizadoSemValor {
  readonly id: number;
  readonly minutos: number;
  readonly inicio: string;
  readonly tipo: string;
  readonly unidade: number | null;
}

/**
 * Os aprovados sem valor que as tarifas (já com a nova) passam a alcançar: o valor de cada um pela tarifa vigente no
 * dia do realizado, com a mesma conta da aprovação. Os que nenhuma tarifa alcança seguem sem valor.
 */
export function valoracoesPelaTarifa(
  tarifas: readonly TarifaPlantaoLida[],
  realizados: readonly RealizadoSemValor[],
): { id: number; tarifa: number; valorHora: number; valor: number }[] {
  const r: { id: number; tarifa: number; valorHora: number; valor: number }[] = [];
  for (const x of realizados) {
    const t = tarifaVigente(tarifas, x.tipo, x.unidade, x.inicio.slice(0, 10));
    if (!t) continue;
    r.push({
      id: x.id,
      tarifa: t.id,
      valorHora: t.valorHora,
      valor: valorRealizado(x.minutos, t.valorHora).valor,
    });
  }
  return r;
}

/** Só o prestador recebe pelo repasse (cooperado, PJ, terceiro); o CLT, o estatutário, o residente e o estagiário não. */
export function vinculoNoRepasse(tipo: string): boolean {
  return VINCULOS_PRESTADOR.includes(tipo as TipoVinculo);
}

/** A competência (AAAA-MM) do realizado: o mês do início real. */
export function competenciaDoRealizado(inicio: string): string {
  return inicio.slice(0, 7);
}

/** A data do lançamento na competência: hoje, se for a competência corrente; senão o último dia dela. */
export function dataDoLancamento(competencia: string, hoje: string): string {
  if (hoje.slice(0, 7) === competencia) return hoje;
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${competencia}-${String(ultimo).padStart(2, '0')}`;
}

export interface RealizadoParaRepasse {
  readonly id: number;
  readonly prestador: number | null;
  readonly registro: number | null;
  readonly tipoVinculo: string;
  readonly situacao: SituacaoRealizado;
  readonly lancado: boolean;
  readonly inicio: string;
  readonly valor: number | null;
}

export interface GrupoRepasse {
  readonly prestador: number;
  readonly registro: number;
  readonly competencia: string;
  readonly realizados: readonly number[];
  readonly valor: number;
  /** A soma escrita: "R$ 1.250,00 + R$ 600,00 = R$ 1.850,00". */
  readonly parcelas: string;
}

/** Por que o realizado não entra no lançamento (null: entra). */
export function motivoForaDoRepasse(r: RealizadoParaRepasse): string | null {
  if (r.situacao !== 'aprovado') return 'O realizado ainda não foi aprovado pela coordenação.';
  if (r.lancado) return 'Já lançado no repasse.';
  if (!vinculoNoRepasse(r.tipoVinculo))
    return 'O vínculo não é de prestador: o plantão é pago pela folha, não pelo repasse.';
  if (r.prestador === null || r.registro === null)
    return 'O colaborador não tem registro de profissional ligado: sem prestador no repasse.';
  if (r.valor === null) return 'Sem tarifa vigente para o tipo de plantão no dia.';
  return null;
}

/** Os grupos do lançamento (prestador × competência) com a soma e as parcelas, na ordem do prestador e da competência. */
export function gruposRepasse(rs: readonly RealizadoParaRepasse[]): GrupoRepasse[] {
  const m = new Map<
    string,
    { prestador: number; registro: number; competencia: string; itens: RealizadoParaRepasse[] }
  >();
  for (const r of rs) {
    if (motivoForaDoRepasse(r) !== null) continue;
    const competencia = competenciaDoRealizado(r.inicio);
    const k = `${r.prestador}|${r.registro}|${competencia}`;
    const g = m.get(k) ?? { prestador: r.prestador!, registro: r.registro!, competencia, itens: [] };
    g.itens.push(r);
    m.set(k, g);
  }
  return [...m.values()]
    .sort((a, b) => a.prestador - b.prestador || a.competencia.localeCompare(b.competencia))
    .map((g) => {
      const cs = g.itens.map((i) => centavos(i.valor!));
      const total = cs.reduce((s, c) => s + c, 0);
      return {
        prestador: g.prestador,
        registro: g.registro,
        competencia: g.competencia,
        realizados: g.itens.map((i) => i.id),
        valor: total / 100,
        parcelas: cs.length === 1 ? reais(total) : `${cs.map(reais).join(' + ')} = ${reais(total)}`,
      };
    });
}

/** A sugestão do realizado pelas marcações do ponto na janela do plantão (a primeira e a última), ou null. */
export function sugestaoDoPonto(
  p: Pick<PlantaoDoRealizado, 'inicio' | 'fim'>,
  marcacoes: readonly string[],
  folgaMin = 120,
): EntradaRealizado | null {
  const de = minutoLocal(p.inicio) - folgaMin;
  const ate = minutoLocal(p.fim) + folgaMin;
  const ms = marcacoes
    .map(minutoLocal)
    .filter((m) => m >= de && m <= ate)
    .sort((a, b) => a - b);
  if (ms.length < 2) return null;
  return { inicio: instanteDeMinuto(ms[0]!), fim: instanteDeMinuto(ms[ms.length - 1]!) };
}
