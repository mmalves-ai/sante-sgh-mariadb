// Apuração do ponto, regra 13 do M52 (cap-07 §7.1.3; ref 02): o previsto vem da escala PUBLICADA (plantão presencial
// ou diarista, não cancelado; o sobreaviso não é jornada sem acionamento), as marcações efetivas vêm do relógio e dos
// ajustes aprovados (regra 11), e as horas são classificadas pelos tipos do domínio de horas do ramo e
// somadas pelos 13 tipos de integração com a folha. Tudo em minutos de relógio local de Brasília.
//
// Regras de cálculo (CLT; padrões de mercado como parâmetro, D-APURA-524):
//   - tolerância (art. 58, §1º; Súmula 366 do TST): variação de até 5 min por marcação, no máximo 10 min no dia, não
//     conta; passou disso, conta TUDO;
//   - débito = previsto − tempo dentro do plantão (entre a primeira e a última marcação); extra = o que passou dele;
//     os intervalos entre os pares são o intervalo da jornada (não são débito);
//   - falta: plantão sem marcação; abonada pela justificativa do dia inteiro (ou pelos minutos abonados);
//   - feriado trabalhado é extra de feriado, salvo regime com acordo de compensação (12x36, art. 59-A);
//   - trabalho sem plantão na escala é extra de descanso semanal (com o alerta);
//   - intervalo intrajornada (art. 71, §4º): jornada acima de 6 h com menos de 1 h de intervalo marcado paga o que
//     faltou, salvo intervalo pré-assinalado (art. 74, §2º; padrão);
//   - adicional noturno (art. 73): das 22 h às 5 h, hora reduzida de 52 min 30 s; prorrogação depois das 5 h quando a
//     jornada cobriu a noite inteira (Súmula 60 do TST);
//   - descanso semanal descontado (Lei 605/1949): uma vez por semana (segunda a domingo) com falta não abonada.
import type { AlertaPonto, ClasseHora, EventoFolha, InconsistenciaPonto } from '@sgh/contratos';
import { diaDeMinuto, minutoLocal, segundaDaSemana } from '../escala/tempo.js';
import type { JustificativaAprovada, MarcacaoEfetiva } from './ajuste.js';

export interface PlantaoPrevisto {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string;
}

export interface RegrasApuracao {
  readonly toleranciaMarcacaoMin: number;
  readonly toleranciaDiariaMin: number;
  /** Minuto do dia em que começa (22 h = 1320) e termina (5 h = 300) a hora noturna. */
  readonly noturnoInicio: number;
  readonly noturnoFim: number;
  readonly prorrogacaoNoturna: boolean;
  readonly janelaMarcacaoMin: number;
  readonly limiteExtraDiarioMin: number;
  /** Faixas de hora extra por dia (a última faixa leva o resto): `[120]` = até 2 h na 1ª, o resto na 2ª. */
  readonly faixas: readonly number[];
  readonly feriadoCompensado: boolean;
  readonly intervaloPreAssinalado: boolean;
  /** Minutos do descanso semanal descontado na semana com falta não abonada. */
  readonly dsrMin: number;
  /** Descanso mínimo entre jornadas do regime (alerta no realizado). */
  readonly descansoMinimoMin: number;
}

export interface EntradaApuracao {
  /** Os dias do período em que o vínculo existia, em ordem. */
  readonly dias: readonly string[];
  readonly plantoes: readonly PlantaoPrevisto[];
  readonly marcacoes: readonly MarcacaoEfetiva[];
  readonly justificativas: readonly JustificativaAprovada[];
  readonly feriados: ReadonlySet<string>;
  readonly regras: RegrasApuracao;
}

export type MinutosPorClasse = Record<ClasseHora, number>;
export type MinutosPorEvento = Record<EventoFolha, number>;

export interface ParApurado {
  readonly entrada: string;
  readonly saida: string;
}

export interface JornadaApurada {
  readonly plantao: number | null;
  readonly previstoInicio: string | null;
  readonly previstoFim: string | null;
  readonly previstoMin: number;
  readonly pares: readonly ParApurado[];
  /** A marcação sem par (número ímpar), quando houver. */
  readonly semPar: string | null;
  readonly trabalhadoMin: number;
  readonly intervaloMin: number;
  readonly minutos: MinutosPorClasse;
  readonly noturnoMin: number;
  readonly noturnoReduzidoMin: number;
  readonly abonadoMin: number;
  readonly toleradoMin: number;
}

export interface DiaApurado {
  readonly dia: string;
  readonly feriado: boolean;
  readonly jornadas: readonly JornadaApurada[];
  readonly minutos: MinutosPorClasse;
  readonly noturnoMin: number;
  readonly noturnoReduzidoMin: number;
  readonly abonadoMin: number;
  readonly justificativa: number | null;
  readonly inconsistencias: readonly InconsistenciaPonto[];
  readonly alertas: readonly AlertaPonto[];
}

export interface ApuracaoPeriodo {
  readonly dias: readonly DiaApurado[];
  readonly totais: MinutosPorClasse;
  readonly eventos: MinutosPorEvento;
  /** As semanas (a segunda-feira) com o descanso semanal descontado. */
  readonly semanasDsr: readonly string[];
  readonly noturnoMin: number;
  readonly noturnoReduzidoMin: number;
  readonly diasInconsistentes: number;
}

export const zeroClasses = (): MinutosPorClasse => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 });
export const zeroEventos = (): MinutosPorEvento => ({
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
  9: 0,
  10: 0,
  11: 0,
  12: 0,
  13: 0,
});

/** Minutos de relógio convertidos em minutos de hora noturna reduzida (52 min 30 s = 60 min). */
export function horaNoturnaReduzida(min: number): number {
  return Math.round((min * 60) / 52.5);
}

/** Minutos noturnos de um par (com a prorrogação da Súmula 60 quando a jornada cobriu a noite inteira). */
export function noturnoDoPar(
  entrada: number,
  saida: number,
  r: Pick<RegrasApuracao, 'noturnoInicio' | 'noturnoFim' | 'prorrogacaoNoturna'>,
): number {
  let total = 0;
  const primeiroDia = Math.floor(entrada / 1440) - 1;
  const ultimoDia = Math.floor(saida / 1440);
  for (let d = primeiroDia; d <= ultimoDia; d++) {
    const ini = d * 1440 + r.noturnoInicio;
    const fim = (d + (r.noturnoFim <= r.noturnoInicio ? 1 : 0)) * 1440 + r.noturnoFim;
    total += Math.max(0, Math.min(saida, fim) - Math.max(entrada, ini));
    if (r.prorrogacaoNoturna && entrada <= ini && saida > fim) total += saida - fim;
  }
  return total;
}

/** Divide os minutos extras do dia pelas faixas (a última leva o resto), em até `buckets` posições. */
export function porFaixas(min: number, faixas: readonly number[], buckets: number): number[] {
  const r = Array.from({ length: buckets }, () => 0);
  let resto = min;
  for (let i = 0; i < buckets && resto > 0; i++) {
    const limite = faixas[i] ?? 0;
    const ultima = i === buckets - 1 || limite <= 0;
    const parte = ultima ? resto : Math.min(resto, limite);
    r[i] = parte;
    resto -= parte;
    if (ultima) break;
  }
  return r;
}

interface Bruta {
  readonly plantao: PlantaoPrevisto | null;
  readonly dia: string;
  readonly marcas: number[];
}

function distancia(m: number, ini: number, fim: number): number {
  return m < ini ? ini - m : m > fim ? m - fim : 0;
}

/** Agrupa as marcações efetivas nos plantões (a mais próxima, dentro da janela) e, as que sobram, em jornadas sem escala. */
export function agruparJornadas(
  plantoes: readonly PlantaoPrevisto[],
  marcacoes: readonly MarcacaoEfetiva[],
  janelaMin: number,
): Bruta[] {
  const ps = [...plantoes].sort((a, b) => minutoLocal(a.inicio) - minutoLocal(b.inicio));
  const grupos: Bruta[] = ps.map((p) => ({ plantao: p, dia: p.inicio.slice(0, 10), marcas: [] }));
  const soltas: number[] = [];
  const validas = marcacoes
    .filter((m) => !m.desconsiderada)
    .map((m) => minutoLocal(m.instante))
    .sort((a, b) => a - b);
  for (const m of validas) {
    let melhor = -1;
    let menor = Infinity;
    ps.forEach((p, i) => {
      const ini = minutoLocal(p.inicio);
      const fim = minutoLocal(p.fim);
      if (m < ini - janelaMin || m > fim + janelaMin) return;
      const d = distancia(m, ini, fim);
      if (d < menor) {
        menor = d;
        melhor = i;
      }
    });
    if (melhor >= 0) grupos[melhor]!.marcas.push(m);
    else soltas.push(m);
  }
  // Jornada sem escala: as marcações seguidas a até 16 h da primeira do grupo (o plantão noturno vira o dia).
  let atual: number[] = [];
  const fechar = () => {
    if (atual.length > 0) grupos.push({ plantao: null, dia: diaDeMinuto(atual[0]!), marcas: atual });
    atual = [];
  };
  for (const m of soltas) {
    if (atual.length > 0 && m - atual[0]! > 16 * 60) fechar();
    atual.push(m);
  }
  fechar();
  return grupos;
}

const p2 = (x: number) => String(x).padStart(2, '0');
function instante(minuto: number): string {
  const dia = Math.floor(minuto / 1440);
  const resto = minuto - dia * 1440;
  return `${new Date(dia * 86_400_000).toISOString().slice(0, 10)}T${p2(Math.floor(resto / 60))}:${p2(resto % 60)}`;
}

function apurarJornada(
  b: Bruta,
  feriado: boolean,
  justificativas: readonly JustificativaAprovada[],
  r: RegrasApuracao,
): JornadaApurada {
  const minutos = zeroClasses();
  const diaInteiro = justificativas.some((j) => j.minutos === null);
  let abonoDisponivel = justificativas.reduce((s, j) => s + (j.minutos ?? 0), 0);
  const p = b.plantao;
  const ini = p ? minutoLocal(p.inicio) : 0;
  const fim = p ? minutoLocal(p.fim) : 0;
  const previsto = p ? fim - ini : 0;
  const usaveis = b.marcas.slice(0, b.marcas.length - (b.marcas.length % 2));
  const semPar = b.marcas.length % 2 === 1 ? instante(b.marcas[b.marcas.length - 1]!) : null;
  const pares: ParApurado[] = [];
  let trabalhado = 0;
  let noturno = 0;
  for (let i = 0; i < usaveis.length; i += 2) {
    const e = usaveis[i]!;
    const s = usaveis[i + 1]!;
    pares.push({ entrada: instante(e), saida: instante(s) });
    trabalhado += s - e;
    noturno += noturnoDoPar(e, s, r);
  }
  const base = {
    plantao: p?.id ?? null,
    previstoInicio: p?.inicio ?? null,
    previstoFim: p?.fim ?? null,
    previstoMin: previsto,
    pares,
    semPar,
    trabalhadoMin: trabalhado,
    noturnoMin: noturno,
    noturnoReduzidoMin: horaNoturnaReduzida(noturno),
  };
  if (p && b.marcas.length === 0) {
    const abonado = diaInteiro ? previsto : Math.min(abonoDisponivel, previsto);
    minutos[8] = abonado;
    minutos[7] = previsto - abonado;
    return { ...base, intervaloMin: 0, minutos, abonadoMin: abonado, toleradoMin: 0 };
  }
  if (usaveis.length === 0) return { ...base, intervaloMin: 0, minutos, abonadoMin: 0, toleradoMin: 0 };
  const primeira = usaveis[0]!;
  const ultima = usaveis[usaveis.length - 1]!;
  const intervalo = ultima - primeira - trabalhado;
  if (r.intervaloPreAssinalado === false && trabalhado > 360 && intervalo < 60) minutos[6] = 60 - intervalo;
  if (!p) {
    minutos[feriado ? 4 : 3] = trabalhado;
    return { ...base, intervaloMin: intervalo, minutos, abonadoMin: 0, toleradoMin: 0 };
  }
  if (feriado && !r.feriadoCompensado) {
    minutos[4] = trabalhado;
    return { ...base, intervaloMin: intervalo, minutos, abonadoMin: 0, toleradoMin: 0 };
  }
  const dentro = Math.max(0, Math.min(ultima, fim) - Math.max(primeira, ini));
  let debito = previsto - dentro;
  const extraBruto = ultima - primeira - dentro;
  let extra = extraBruto;
  let tolerado = 0;
  const vIni = Math.abs(primeira - ini);
  const vFim = Math.abs(ultima - fim);
  if (
    vIni <= r.toleranciaMarcacaoMin &&
    vFim <= r.toleranciaMarcacaoMin &&
    vIni + vFim <= r.toleranciaDiariaMin
  ) {
    tolerado = debito;
    debito = 0;
    extra = 0;
  }
  if (diaInteiro) abonoDisponivel = debito;
  const abonado = Math.min(abonoDisponivel, debito);
  debito -= abonado;
  minutos[1] = Math.max(0, trabalhado - extraBruto);
  minutos[2] = debito;
  minutos[5] = extra;
  minutos[9] = tolerado;
  return { ...base, intervaloMin: intervalo, minutos, abonadoMin: abonado, toleradoMin: tolerado };
}

const somar = (a: MinutosPorClasse, b: MinutosPorClasse) => {
  for (const k of Object.keys(a)) a[Number(k) as ClasseHora] += b[Number(k) as ClasseHora];
};

/** A apuração do período: os dias com as jornadas, os totais por classe e os eventos para a folha. */
export function apurarPeriodo(e: EntradaApuracao): ApuracaoPeriodo {
  const r = e.regras;
  const diasDoPeriodo = new Set(e.dias);
  const grupos = agruparJornadas(e.plantoes, e.marcacoes, r.janelaMarcacaoMin).filter((g) =>
    diasDoPeriodo.has(g.dia),
  );
  const porDia = new Map<string, Bruta[]>();
  for (const g of grupos) porDia.set(g.dia, [...(porDia.get(g.dia) ?? []), g]);
  // Interjornada no realizado: o descanso entre a última marcação de uma jornada e a primeira da seguinte.
  const ordenadas = grupos.filter((g) => g.marcas.length >= 2).sort((a, b) => a.marcas[0]! - b.marcas[0]!);
  const descansoCurto = new Set<string>();
  for (let i = 1; i < ordenadas.length; i++) {
    const antes = ordenadas[i - 1]!;
    const depois = ordenadas[i]!;
    if (depois.marcas[0]! - antes.marcas[antes.marcas.length - 1]! < r.descansoMinimoMin)
      descansoCurto.add(depois.dia);
  }
  const totais = zeroClasses();
  const eventos = zeroEventos();
  const semanas = new Set<string>();
  let noturnoTotal = 0;
  let noturnoReduzidoTotal = 0;
  let inconsistentes = 0;
  const dias: DiaApurado[] = e.dias.map((dia) => {
    const feriado = e.feriados.has(dia);
    const just = e.justificativas.filter((j) => j.dia === dia);
    const jornadas = (porDia.get(dia) ?? [])
      .sort((a, b) => (a.marcas[0] ?? 0) - (b.marcas[0] ?? 0))
      .map((g) => apurarJornada(g, feriado, just, r));
    const minutos = zeroClasses();
    for (const j of jornadas) somar(minutos, j.minutos);
    const noturno = jornadas.reduce((s, j) => s + j.noturnoMin, 0);
    const reduzido = jornadas.reduce((s, j) => s + j.noturnoReduzidoMin, 0);
    const inconsistencias: InconsistenciaPonto[] = jornadas.some((j) => j.semPar !== null)
      ? ['marcacao-impar']
      : [];
    const alertas: AlertaPonto[] = [];
    if (minutos[5] > r.limiteExtraDiarioMin) alertas.push('extra-acima-do-limite');
    if (descansoCurto.has(dia)) alertas.push('interjornada-menor');
    if (jornadas.some((j) => j.plantao === null)) alertas.push('sem-escala');
    if (inconsistencias.length > 0) inconsistentes++;
    somar(totais, minutos);
    noturnoTotal += noturno;
    noturnoReduzidoTotal += reduzido;
    if (minutos[7] > 0) semanas.add(segundaDaSemana(dia));
    const [f1, f2] = porFaixas(minutos[4], r.faixas, 2);
    eventos[6] += f1!;
    eventos[7] += f2!;
    const [d1, d2] = porFaixas(minutos[3], r.faixas, 2);
    eventos[8] += d1!;
    eventos[9] += d2!;
    const n = porFaixas(minutos[5], r.faixas, 4);
    eventos[10] += n[0]! + minutos[6];
    eventos[11] += n[1]!;
    eventos[12] += n[2]!;
    eventos[13] += n[3]!;
    return {
      dia,
      feriado,
      jornadas,
      minutos,
      noturnoMin: noturno,
      noturnoReduzidoMin: reduzido,
      abonadoMin: jornadas.reduce((s, j) => s + j.abonadoMin, 0),
      justificativa: just[0]?.movimento ?? null,
      inconsistencias,
      alertas,
    };
  });
  eventos[1] = totais[1];
  eventos[2] = semanas.size * r.dsrMin;
  eventos[3] = totais[7];
  eventos[4] = totais[2];
  eventos[5] = noturnoReduzidoTotal;
  return {
    dias,
    totais,
    eventos,
    semanasDsr: [...semanas].sort(),
    noturnoMin: noturnoTotal,
    noturnoReduzidoMin: noturnoReduzidoTotal,
    diasInconsistentes: inconsistentes,
  };
}

/** Soma dos minutos extras dos eventos (as faixas de feriado, de descanso semanal e as normais). */
export function extrasDosEventos(ev: MinutosPorEvento): number {
  return ev[6] + ev[7] + ev[8] + ev[9] + ev[10] + ev[11] + ev[12] + ev[13];
}
