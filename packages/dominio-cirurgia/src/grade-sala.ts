// Grade de funcionamento da sala cirúrgica (04-CC linha 92; F3.4, fatia F3.4-4): as faixas de horário em que cada sala
// atende, por dia da semana (ISO: 1 segunda a 7 domingo), com vigência, feriado e, quando houver, a especialidade ou o
// cirurgião a quem a faixa está reservada. Regras puras, sem banco: a API relê as faixas sob a trava da sala e confere
// o pedido antes de agendar; o mapa usa a mesma leitura para mostrar o que está aberto.
// Melhoria: uma sala sem nenhuma faixa ativa não é restringida (o hospital que não usa grade não perde a agenda); com
// grade, a cirurgia inteira (início ao fim previsto) tem de caber nas faixas do dia, faixas contíguas somam; a faixa
// reservada a um cirurgião ou especialidade recusa os outros; a exceção registrada (urgência) passa, como nas demais
// conferências da agenda. As faixas do mesmo dia e vigência que se cruzam são recusadas ao gravar.

export interface FaixaGradeSala {
  readonly id?: number;
  /** Dia da semana ISO: 1 segunda a 7 domingo. */
  readonly diaSemana: number;
  /** 'HH:MM' (hora local da sala). */
  readonly inicio: string;
  readonly fim: string;
  /** 'AAAA-MM-DD'. */
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly valeFeriado: boolean;
  readonly especialidade: number | null;
  readonly profissional: number | null;
  readonly ativo: boolean;
}

export interface PedidoNaGrade {
  /** 'AAAA-MM-DD HH:MM' (hora local). */
  readonly inicio: string;
  readonly duracaoMin: number;
  readonly feriado: boolean;
  readonly especialidade: number | null;
  readonly cirurgiao: number | null;
  readonly excecao: boolean;
}

export interface RecusaGrade {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campo: string;
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Minutos desde a meia-noite de 'HH:MM' (ou 'HH:MM:SS'); NaN se inválida. */
export function minutosDaHora(h: string): number {
  const m = HORA.exec(h.slice(0, 5));
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

/** Dia da semana ISO (1 segunda a 7 domingo) de 'AAAA-MM-DD'. */
export function diaSemanaIso(data: string): number {
  const d = new Date(`${data}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function vigente(f: FaixaGradeSala, data: string): boolean {
  return f.ativo && f.vigenciaInicio <= data && (f.vigenciaFim === null || f.vigenciaFim >= data);
}

/** As faixas que valem na data (dia da semana, vigência, feriado), em ordem de início. */
export function faixasDoDia(
  faixas: readonly FaixaGradeSala[],
  data: string,
  feriado: boolean,
): FaixaGradeSala[] {
  const dia = diaSemanaIso(data);
  return faixas
    .filter((f) => f.diaSemana === dia && vigente(f, data) && (!feriado || f.valeFeriado))
    .sort((a, b) => minutosDaHora(a.inicio) - minutosDaHora(b.inicio));
}

/** Confere a faixa antes de gravar (formato, horas, vigência e cruzamento com as outras faixas ativas da sala). */
export function validarFaixaGrade(
  faixa: FaixaGradeSala,
  outras: readonly FaixaGradeSala[],
): RecusaGrade | null {
  if (!Number.isInteger(faixa.diaSemana) || faixa.diaSemana < 1 || faixa.diaSemana > 7)
    return {
      codigo: 'grade-dia-invalido',
      mensagem: 'O dia da semana vai de 1 (segunda) a 7 (domingo).',
      campo: 'diaSemana',
    };
  const ini = minutosDaHora(faixa.inicio);
  const fim = minutosDaHora(faixa.fim);
  if (Number.isNaN(ini))
    return { codigo: 'grade-hora-invalida', mensagem: 'Informe a hora de início (HH:MM).', campo: 'inicio' };
  if (Number.isNaN(fim))
    return { codigo: 'grade-hora-invalida', mensagem: 'Informe a hora de fim (HH:MM).', campo: 'fim' };
  if (fim <= ini)
    return {
      codigo: 'grade-hora-invertida',
      mensagem: 'O fim da faixa tem de ser depois do início.',
      campo: 'fim',
    };
  if (!DATA.test(faixa.vigenciaInicio))
    return {
      codigo: 'grade-vigencia-invalida',
      mensagem: 'Informe o início da vigência.',
      campo: 'vigenciaInicio',
    };
  if (
    faixa.vigenciaFim !== null &&
    (!DATA.test(faixa.vigenciaFim) || faixa.vigenciaFim < faixa.vigenciaInicio)
  )
    return {
      codigo: 'grade-vigencia-invertida',
      mensagem: 'O fim da vigência não pode ser antes do início.',
      campo: 'vigenciaFim',
    };
  if (faixa.especialidade !== null && faixa.profissional !== null)
    return {
      codigo: 'grade-reserva-dupla',
      mensagem: 'Reserve a faixa a uma especialidade ou a um cirurgião, não aos dois.',
      campo: 'profissional',
    };
  const cruzaVigencia = (o: FaixaGradeSala): boolean =>
    (o.vigenciaFim === null || o.vigenciaFim >= faixa.vigenciaInicio) &&
    (faixa.vigenciaFim === null || faixa.vigenciaFim >= o.vigenciaInicio);
  const cruzada = outras.find(
    (o) =>
      o.ativo &&
      o.id !== faixa.id &&
      o.diaSemana === faixa.diaSemana &&
      cruzaVigencia(o) &&
      minutosDaHora(o.inicio) < fim &&
      ini < minutosDaHora(o.fim),
  );
  if (cruzada)
    return {
      codigo: 'grade-faixa-cruzada',
      mensagem: `A faixa cruza com a de ${cruzada.inicio.slice(0, 5)} às ${cruzada.fim.slice(0, 5)} no mesmo dia.`,
      campo: 'inicio',
    };
  return null;
}

/**
 * Confere se a sala está aberta para o pedido inteiro. Sem faixa ativa na sala, não restringe; com exceção registrada
 * (urgência), passa. A cirurgia que vira a meia-noite precisa de faixa até 24:00 no dia e desde 00:00 no seguinte.
 */
export function conferirGradeSala(
  faixas: readonly FaixaGradeSala[],
  pedido: PedidoNaGrade,
  feriadoNoDiaSeguinte = false,
): RecusaGrade | null {
  if (pedido.excecao || !faixas.some((f) => f.ativo)) return null;
  const data = pedido.inicio.slice(0, 10);
  const ini = minutosDaHora(pedido.inicio.slice(11, 16));
  const fim = ini + Math.max(0, pedido.duracaoMin);
  // Intervalos abertos [a, b) em minutos desde a meia-noite do dia do pedido (o dia seguinte soma 1440).
  const abertas = [
    ...faixasDoDia(faixas, data, pedido.feriado).map((f) => ({
      f,
      a: minutosDaHora(f.inicio),
      b: minutosDaHora(f.fim),
    })),
    ...faixasDoDia(faixas, somarDias(data, 1), feriadoNoDiaSeguinte).map((f) => ({
      f,
      a: 1440 + minutosDaHora(f.inicio),
      b: 1440 + minutosDaHora(f.fim),
    })),
  ];
  // A faixa '23:59' de fim conta como até a meia-noite.
  const usadas: typeof abertas = [];
  let cursor = ini;
  while (cursor < fim) {
    const atual = abertas.find((x) => x.a <= cursor && cursor < (x.b % 1440 === 1439 ? x.b + 1 : x.b));
    if (!atual) {
      const dia = cursor >= 1440 ? 'no dia seguinte' : 'no dia';
      return {
        codigo: 'sala-fechada-na-grade',
        mensagem: `A sala não está aberta na grade ${dia} às ${String(Math.floor((cursor % 1440) / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}. Escolha um horário dentro da grade ou registre a exceção.`,
        campo: 'hora',
      };
    }
    usadas.push(atual);
    cursor = atual.b % 1440 === 1439 ? atual.b + 1 : atual.b;
  }
  for (const { f } of usadas) {
    if (f.profissional !== null && f.profissional !== pedido.cirurgiao)
      return {
        codigo: 'grade-reservada-cirurgiao',
        mensagem:
          'A faixa da grade está reservada a outro cirurgião. Escolha outro horário ou registre a exceção.',
        campo: 'hora',
      };
    if (f.especialidade !== null && f.especialidade !== pedido.especialidade)
      return {
        codigo: 'grade-reservada-especialidade',
        mensagem:
          'A faixa da grade está reservada a outra especialidade. Escolha outro horário ou registre a exceção.',
        campo: 'hora',
      };
  }
  return null;
}
